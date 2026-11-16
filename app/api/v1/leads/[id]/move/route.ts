import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/leads/[id]/move
 *
 * Moves a lead within its pipeline (P-01: cross-pipeline moves require clone).
 * Uses Pattern B optimistic concurrency (P-08): client sends `expected_updated_at`,
 * UPDATE filters by it, zero rows affected ⇒ 409 lead_stage_changed_concurrent.
 *
 * Status transitions are driven by trigger `fn_crm_lead_close_on_stage` (P-02);
 * this endpoint NEVER sets `status` directly.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { avisarGuardiaoDaCompraFutura } from "@/lib/iavek/compra-futura/avisar-guardiao";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerVendaDaLoja } from "@/lib/iavek/venda-da-loja";
import { lojaPedeDadosDaVenda } from "@/lib/iavek/venda-da-loja-servidor";
import { moveLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import {
  decideMotivoDaPerda,
  recusaDeMotivoDaPerdaPeloBanco,
} from "@/lib/leads/motivo-da-perda";
import { RECUSA_DE_TROCA_DE_FUNIL } from "@/lib/leads/clonar-para-funil";
import { modoDeReabertura, recusaReabertura } from "@/lib/leads/reabertura";
import {
  recusaDeCamposObrigatorios,
  recusaDeMotivoDoGanho,
  settingsDoFunil,
  validaCamposExigidos,
} from "@/lib/leads/campos-exigidos";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const user = authz.user;

  let input;
  try {
    input = await validateRequest(moveLeadSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // Fetch current lead (RLS scoped).
  const { data: lead, error: selErr } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (selErr) {
    return fail("internal_error", selErr.message, 500, { requestId });
  }
  if (!lead) {
    return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  }

  // Fetch target stage to validate same pipeline (P-01) — e `is_lost`/`is_won`,
  // que decidem respectivamente o motivo da perda (#917) e se a escrita
  // REABRIRIA um negócio encerrado (issue #1538).
  const { data: stage, error: stageErr } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, name, is_lost, is_won, is_compra_futura")
    .eq("id", input.stage_id)
    .maybeSingle();

  if (stageErr) {
    return fail("internal_error", stageErr.message, 500, { requestId });
  }
  if (!stage) {
    return fail("not_found", t("Stage não encontrado."), 404, { requestId });
  }
  if (stage.pipeline_id !== lead.pipeline_id) {
    return fail(
      "pipeline_immutable_use_clone",
      t(RECUSA_DE_TROCA_DE_FUNIL),
      422,
      { requestId, details: { use: "/api/v1/leads/{id}/clone" } },
    );
  }

  // ── O FUNIL DECIDE SE ESTA ESCRITA REABRIRIA O NEGÓCIO (issue #1538) ───────
  //
  // O arrasto é UM dos quatro caminhos; os outros três (lote, IA, automação e
  // MCP) passam pelo `moveLeadHandler`, que faz a MESMA pergunta com a mesma
  // função. Em `mesmo_registro` — o padrão, e o de todo funil que não declarou
  // nada — `recusaReabertura` devolve null e nada aqui muda.
  //
  // Vem ANTES da régua de campos: o card encerrado não reabre, então perguntar
  // pelos campos da etapa seria abrir um diálogo para uma escrita que o 409
  // abaixo recusa de qualquer jeito.
  const settings = await settingsDoFunil(supabase, lead.pipeline_id);
  const recusa = recusaReabertura({
    modo: modoDeReabertura(settings),
    statusAtual: (lead as { status?: string }).status,
    etapaDestino: stage,
    idioma: user.idioma,
  });
  if (recusa) {
    // 409 e não 422: o board já trata 409 como "o servidor tem outro estado e
    // a tela precisa se reconciliar com ele" — e aqui é exatamente isso, o
    // negócio encerrado que continua encerrado. O `details.use` é o ponteiro
    // para a porta que resolve, o mesmo formato do 422 do clone.
    return fail(recusa.codigo, recusa.mensagem, 409, {
      requestId,
      details: { use: "/api/v1/leads/{id}/retomar", lead_id: leadId },
    });
  }

  // ── A MESMA ETAPA É REORDENAÇÃO, NÃO ENTRADA (CR do mantenedor, #1536) ──────
  //
  // O card que já está NA coluna de destino não está ENTRANDO nela: arrastar
  // dentro da própria coluna só troca a posição. A régua abaixo pergunta "este
  // destino exige campos que o lead não tem?" e, sem esta comparação, respondia
  // 422 para um movimento que não muda de etapa — na coluna exigente o card
  // ficava preso sem ninguém conseguir reordená-lo, e com `won_reason_required`
  // valia para TODO card antigo da coluna Ganho (o `won_reason` nasce `null`,
  // então reordenar a coluna virava 422).
  //
  // Comparado AQUI, antes da régua, e não dentro dela: `campos-exigidos.ts`
  // continua não sabendo nada sobre "mesma etapa" — quem sabe é esta rota, que
  // é quem lê `lead.stage_id` ao lado do destino. As regras de vocabulário do
  // ganho e da perda (#917) SEGUEM valendo: elas decidem sobre VALORES que a
  // escrita traz, não sobre a entrada em si.
  const mesmaEtapa = input.stage_id === lead.stage_id;

  // ── OS CAMPOS OBRIGATÓRIOS (issue #1536) ────────────────────────────────────
  //
  // A mesma pergunta dos outros cinco caminhos, respondida pela MESMA função:
  // este destino exige campos que o lead não tem? Decidido ANTES do update, pela
  // mesma razão da perda abaixo — depois dele só existiria a linha recusada.
  // `details.faltando` nomeia chave e rótulo de cada campo: é ele que a tela
  // vira em diálogo (o único caminho onde dá para PREENCHER e tentar de novo).
  const vereditoDeCampos = mesmaEtapa
    ? { faltando: [] }
    : validaCamposExigidos({
        lead: lead as Record<string, unknown>,
        settingsDoFunil: settings,
        destino: {
          stageId: stage.id,
          desfecho: stage.is_won ? "won" : stage.is_lost ? "lost" : null,
        },
        motivoDeGanho: input.won_reason ?? null,
        customFieldsPropostos: input.custom_fields ?? null,
      });
  if (vereditoDeCampos.faltando.length > 0) {
    const recusa = recusaDeCamposObrigatorios(vereditoDeCampos.faltando, user.idioma);
    return fail(recusa.codigo, recusa.mensagem, 422, {
      requestId,
      details: { faltando: vereditoDeCampos.faltando },
    });
  }

  // O MOTIVO DE GANHO (issue #1536): vocabulário do funil quando há lista, e
  // obrigatoriedade opt-in (`settings.won_reason_required`) quando o funil pede.
  if (stage.is_won) {
    const recusaVocabulario = recusaDeMotivoDoGanho({
      motivo: input.won_reason,
      settingsDoFunil: settings,
      idioma: user.idioma,
    });
    if (recusaVocabulario) {
      return fail(recusaVocabulario.codigo, recusaVocabulario.mensagem, 422, {
        requestId,
      });
    }
  }

  // ── O MOTIVO DA PERDA (issue #917) ──────────────────────────────────────────
  //
  // A etapa de destino é de perda? Então esta escrita fecha o negócio, e o banco
  // exige o motivo. Decidido ANTES do update, porque depois dele o que existe é a
  // linha recusada — e a recusa do Postgres chegava ao board como 500.
  const veredito = decideMotivoDaPerda({
    etapaDeDestino: stage,
    motivo: input.lost_reason,
    motivoAtual: (lead as { lost_reason?: string | null }).lost_reason ?? null,
    idioma: user.idioma,
  });
  if (!veredito.ok) {
    return fail(veredito.codigo, veredito.mensagem, 422, { requestId });
  }

  // ia.vek v1.9.12: entrar na venda, na loja de carros, pede valor final e data.
  // Reordenar a coluna ou andar entre etapas de venda não é outra venda.
  const venda =
    stage.is_won &&
    !mesmaEtapa &&
    (lead as { status?: string }).status !== "won" &&
    (await lojaPedeDadosDaVenda(supabase, (lead as { organization_id: string }).organization_id))
      ? lerVendaDaLoja(input.venda, user.idioma)
      : null;
  if (venda && !venda.ok) {
    return fail(venda.codigo, venda.mensagem, 422, { requestId });
  }

  // ── TIRAR DO PERDIDO PEDE O MOTIVO (ia.vek v1.9.59.2) ───────────────────────
  //
  // Regra do Rodrigo: reabrir um lead perdido é LIVRE para quem pode mover o card, e só pede o motivo (texto
  // livre, vai à linha do tempo). Reabrir = o lead está 'lost' e o destino é uma etapa ABERTA (nem perda, nem
  // ganho, nem Compra futura). Esta exigência é da rota do BOARD: o `moveLeadHandler` (lote, IA, automação e MCP)
  // segue sem ela.
  //
  // A reabertura também ZERA o relógio das 72h (`source_metadata.esteira_inicio` = agora, e sai o
  // `esteira_manter_ate`), NA MESMA escrita da etapa: sem isto a esteira via o relógio antigo vencido e passava
  // o lead de novo ao Follow-up na rodada seguinte (medido na produção: um lead com 4 clones).
  //
  // DESFAZER DEPOIS DE VENDIDO (ia.vek v1.9.59.2, regra do Rodrigo): o lead 'won' que vai para uma etapa ABERTA
  // segue o MESMO caminho (motivo obrigatório, relógio zerado, tarefas devolvidas, nota "Reabriu do Vendido"), e o
  // carro vendido volta ao estoque (`devolverCarroAoEstoque`). Valor, data e motivo da venda não são tocados aqui:
  // a trava "só gerente corrige valor/data" (0608, `fn_iavek_venda_so_gerente_corrige`) segue no banco — e, na
  // loja de carros, ela também recusa quem não é gerente tirando o lead do Vendido (`venda_so_gerente`). O valor do
  // lead aberto volta ao preço do estoque sozinho (0600, `fn_iavek_valor_do_carro`, quando o status vira 'open').
  // Andar entre etapas de venda ou reordenar a coluna Vendido não é reabrir (o destino é is_won).
  const leadAtual = lead as {
    status?: string;
    closed_at?: string | null;
    source_metadata?: Record<string, unknown> | null;
    custom_fields?: Record<string, unknown> | null;
  };
  const deStatus: "won" | "lost" | null =
    leadAtual.status === "lost" ? "lost" : leadAtual.status === "won" ? "won" : null;
  const reabrindo =
    deStatus !== null &&
    !stage.is_lost &&
    !stage.is_won &&
    !(stage as { is_compra_futura?: boolean }).is_compra_futura;
  const motivoReabertura = reabrindo ? (input.motivo_reabertura?.trim() ?? "") : "";
  if (reabrindo && motivoReabertura.length < 3) {
    return fail(
      "motivo_da_reabertura_obrigatorio",
      deStatus === "won"
        ? t("Escreva o motivo para tirar o lead do Vendido.")
        : t("Escreva o motivo para tirar o lead do Perdido."),
      422,
      { requestId, details: { de_status: deStatus } },
    );
  }
  // O `closed_at` de ANTES da escrita: é dele em diante que se procuram as tarefas que o fechamento cancelou
  // (na venda da loja ele é a DATA da venda, nunca depois da escrita do ganho: as canceladas ficam dentro).
  const fechadoEmAntes = reabrindo ? (leadAtual.closed_at ?? null) : null;
  const metadataReaberta = reabrindo
    ? (() => {
        const { esteira_manter_ate: _manter, ...resto } = (leadAtual.source_metadata ?? {}) as Record<string, unknown>;
        void _manter;
        return { ...resto, esteira_inicio: new Date().toISOString() };
      })()
    : null;

  // OCC update (Pattern B / Spec 09 §7.2). O motivo da perda entra NA MESMA
  // escrita que muda a etapa — nunca numa segunda, que teria janela.
  const { data: updated, error: updErr } = await supabase
    .from("crm_leads")
    .update({
      stage_id: input.stage_id,
      position_in_stage: input.position_in_stage,
      updated_at: new Date().toISOString(),
      ...veredito.patch,
      ...(venda?.ok ? { value_cents: venda.valorCents, closed_at: venda.fechadoEm } : {}),
      // O motivo de ganho sai NA MESMA escrita que muda a etapa — o mesmo
      // desenho do motivo da perda (#917): uma segunda escrita teria janela.
      ...(stage.is_won && input.won_reason?.trim()
        ? { won_reason: input.won_reason.trim() }
        : {}),
      // ia.vek v1.9.45 (CRM-294): o mês da Compra futura, NA MESMA escrita (o gatilho exige e confere).
      ...((stage as { is_compra_futura?: boolean }).is_compra_futura && input.compra_futura_mes
        ? { compra_futura_mes: `${input.compra_futura_mes}-01` }
        : {}),
      // O merge é AQUI, nunca num PATCH anterior: ver `custom_fields` em
      // `moveLeadSchema` — dois writes teriam janela e uma segunda OCC.
      // ia.vek v1.9.59.2: a reabertura zera o relógio das 72h NA MESMA escrita (ver acima).
      ...(metadataReaberta ? { source_metadata: metadataReaberta } : {}),
      ...(input.custom_fields
        ? {
            custom_fields: {
              ...(((lead as { custom_fields?: Record<string, unknown> })
                .custom_fields ?? {}) as Record<string, unknown>),
              ...input.custom_fields,
            },
          }
        : {}),
    })
    .eq("id", leadId)
    .eq("updated_at", input.expected_updated_at)
    .select("id")
    .maybeSingle();

  if (updErr) {
    // Rede de segurança (issue #917): se o banco recusar por motivo da perda mesmo
    // com a decisão acima, quem está na tela recebe a recusa de negócio. Sem isto,
    // qualquer caminho novo que escreva `stage_id` sem passar pela decisão volta a
    // chegar aqui como 500 — que é o defeito, com outro nome.
    // ia.vek v1.9.45 (CRM-294): as recusas da Compra futura (sem mês, mês no passado) são de negócio.
    if (/compra_futura_mes_required/.test(updErr.message)) {
      return fail("compra_futura_mes_required", t("Informe o mês e o ano previstos da compra."), 422, { requestId });
    }
    if (/compra_futura_mes_no_passado/.test(updErr.message)) {
      return fail("compra_futura_mes_no_passado", t("O mês previsto não pode estar no passado."), 422, { requestId });
    }
    const recusa = recusaDeMotivoDaPerdaPeloBanco(updErr, user.idioma);
    // v1.8.3: a trava da loja leva a lista do que falta — a tela abre a janela, não um toast.
    if (recusa) {
      return fail(recusa.codigo, recusa.mensagem, 422, {
        requestId,
        ...(recusa.faltam ? { details: { faltam: recusa.faltam } } : {}),
      });
    }
    return fail("internal_error", updErr.message, 500, { requestId });
  }

  if (!updated) {
    // Concurrent edit. Re-fetch current to surface the latest updated_at.
    const { data: current } = await supabase
      .from("crm_leads")
      .select("updated_at")
      .eq("id", leadId)
      .maybeSingle();
    return fail(
      "lead_stage_changed_concurrent",
      t("Lead foi modificado por outro usuário. Recarregue e tente novamente."),
      409,
      {
        details: { current_updated_at: current?.updated_at ?? null },
        requestId,
      },
    );
  }

  // Wave 3 (CORE 2): esta é a rota que o BOARD usa — arrastar o card passa por
  // aqui, não pelo moveLeadHandler. O emissor é o mesmo dos outros escritores
  // (lib/leads/activity-emitter), para os quatro caminhos escreverem a mesma
  // linha na timeline.
  const { data: fromStage } = await supabase
    .from("crm_stages")
    .select("name")
    .eq("id", lead.stage_id)
    .maybeSingle();

  const atividade = await emitLeadActivity(supabase, {
    organizationId: lead.organization_id,
    leadId,
    contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
    type: "stage_changed",
    sourceModule: "crm",
    sourceId: leadId,
    actor: { type: "user", id: user.id },
    reason: stageChangeReason(fromStage?.name ?? null, stage.name),
    payload: {
      from_stage_id: lead.stage_id,
      to_stage_id: input.stage_id,
      pipeline_id: lead.pipeline_id,
      ...(venda?.ok ? { valor_final_cents: venda.valorCents, data_da_venda: venda.data } : {}),
      ...(reabrindo ? { motivo_reabertura: motivoReabertura, de_status: deStatus } : {}),
    },
  });
  if (!atividade.ok) {
    // Mesma política do handler: mutação já ocorrida não bloqueia, mas o rastro
    // perdido é contado em vez de sumir num log de processo.
    await registraFalhaDeAtividade(supabase, {
      organizationId: lead.organization_id,
      leadId,
      tipo: "stage_changed",
      origem: "leads/[id]/move",
      erro: atividade.error,
      requestId,
    });
  }

  // ── A REABERTURA: DEVOLVE AS TAREFAS QUE O FECHAMENTO CANCELOU E GRAVA A NOTA (ia.vek v1.9.59.2) ──
  // Do Vendido, também devolve o carro ao estoque (antes da nota, para ela dizer se voltou).
  let tarefasDevolvidas = 0;
  let carroVoltou = false;
  if (reabrindo) {
    tarefasDevolvidas = await devolverTarefasDaPerda({
      organizationId: lead.organization_id,
      leadId,
      fechadoEm: fechadoEmAntes,
      requestId,
    });
    if (deStatus === "won") {
      carroVoltou = await devolverCarroAoEstoque({
        organizationId: lead.organization_id,
        leadId,
        carro: leadAtual.custom_fields?.carro_interesse,
        requestId,
      });
    }
    const nota = await emitLeadActivity(supabase, {
      organizationId: lead.organization_id,
      leadId,
      contactId: (lead as { contact_id?: string | null }).contact_id ?? null,
      type: "note",
      sourceModule: "crm",
      sourceId: leadId,
      actor: { type: "user", id: user.id },
      reason: `${deStatus === "won" ? "Reabriu do Vendido" : "Reabriu do Perdido"}: ${motivoReabertura}`.slice(0, 500),
      payload: {
        motivo_reabertura: motivoReabertura,
        de_status: deStatus,
        from_stage_id: lead.stage_id,
        to_stage_id: input.stage_id,
        tarefas_devolvidas: tarefasDevolvidas,
        ...(deStatus === "won" ? { carro_voltou: carroVoltou } : {}),
      },
    });
    if (!nota.ok) {
      await registraFalhaDeAtividade(supabase, {
        organizationId: lead.organization_id,
        leadId,
        tipo: "note",
        origem: "leads/[id]/move",
        erro: nota.error,
        requestId,
      });
    }
  }

  // Re-SELECT so trigger-driven status/closed_at changes are reflected — e
  // DEPOIS da atividade: gravá-la dispara `trg_update_last_activity_at`, que
  // escreve no lead e troca o `updated_at` de novo. Relido antes, a resposta
  // levava um `updated_at` já vencido e o próximo arrastar do mesmo card caía
  // na OCC com 409 "modificado por outro usuário" (issue #916).
  const { data: fresh } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  const finalLead = fresh ?? lead;

  // Emit domain event (fire-and-forget; trigger NEVER does HTTP — workers do).
  await supabase
    .rpc("emit_event", {
      p_event_type: "lead.stage_changed",
      p_entity_kind: "crm_lead",
      p_entity_id: leadId,
      p_payload: {
        from_stage_id: lead.stage_id,
        to_stage_id: input.stage_id,
        position_in_stage: input.position_in_stage,
        status: finalLead.status,
      },
      p_metadata: { request_id: requestId, actor_user_id: user.id },
      p_organization_id: lead.organization_id,
    })
    .then(({ error }) => {
      if (error) console.error("[lead.move] emit_event failed", error.message);
    });

  await audit({
    action: "lead.moved",
    actorUserId: user.id,
    organizationId: lead.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: {
      from_stage_id: lead.stage_id,
      to_stage_id: input.stage_id,
      position_in_stage: input.position_in_stage,
      ...(input.via ? { via: input.via } : {}),
      ...(reabrindo && deStatus === "lost" ? { reabriu_do_perdido: true, tarefas_devolvidas: tarefasDevolvidas } : {}),
      ...(reabrindo && deStatus === "won"
        ? { reabriu_do_vendido: true, tarefas_devolvidas: tarefasDevolvidas, carro_voltou: carroVoltou }
        : {}),
    },
  });

  // ia.vek v1.9.45 (CRM-294, decisão (c), desligada até o ok do Rodrigo): avisa o guardião da Compra futura.
  if ((stage as { is_compra_futura?: boolean }).is_compra_futura && lead.stage_id !== input.stage_id) {
    void avisarGuardiaoDaCompraFutura(createAdminClient(), {
      orgId: lead.organization_id,
      leadId,
      titulo: String((lead as { title?: string }).title ?? ""),
      guardiaoId: (lead as { sdr_user_id?: string | null }).sdr_user_id ?? null,
      quemMoveu: user.id,
      mes: input.compra_futura_mes ? `${input.compra_futura_mes}-01` : null,
    });
  }

  return ok(
    reabrindo
      ? {
          ...finalLead,
          tarefas_devolvidas: tarefasDevolvidas,
          ...(deStatus === "won" ? { carro_voltou: carroVoltou } : {}),
        }
      : finalLead,
    { requestId },
  );
}

/**
 * ia.vek v1.9.59.2: devolve a 'pending' as tarefas que o FECHAMENTO (perda ou venda) cancelou. Quem cancelou foi o
 * gatilho `fn_iavek_cancela_tarefas_do_lead_fechado`, que deixa uma linha `task_cancelled` (source_module
 * 'tarefas', source_id = a tarefa) no instante do fechamento, com metadata.origem 'gatilho_0625' (corpo da 0625) ou
 * 'gatilho_0639' (o corpo em vigor desde a 0639, que também grava `crm_tasks.cancelada_motivo = 'lead_fechou'`). Na
 * venda o gatilho só cancela a pré-venda; na perda, todas — devolve-se o que ELE cancelou, nos dois casos. Só as
 * canceladas desse fechamento em diante (`closed_at` lido ANTES da reabertura) voltam; sem `closed_at`, nenhuma.
 * A tarefa devolvida perde o `cancelada_motivo` (pendente não tem motivo de cancelamento).
 *
 * Client de SERVIÇO, filtrado por organização e lead: a RLS de `crm_tasks` (0604) só deixa ver/editar as tarefas
 * de quem é dono/SDR do lead ou da própria pessoa, e a reabertura é livre para QUEM PODE MOVER o card (o mover já
 * passou pela RLS de `crm_leads` acima). Com o client do usuário, quem reabre o lead de outro devolveria 0 tarefas
 * em silêncio. Falha aqui não desfaz a reabertura: fica no log e a conta é 0.
 */
const ORIGENS_DO_GATILHO_DE_FECHAMENTO = ["gatilho_0625", "gatilho_0639"] as const;

async function devolverTarefasDaPerda(p: {
  organizationId: string;
  leadId: string;
  fechadoEm: string | null;
  requestId: string;
}): Promise<number> {
  if (!p.fechadoEm) return 0;
  try {
    const admin = createAdminClient();
    const { data: canceladas, error: e1 } = await admin
      .from("crm_lead_activities")
      .select("source_id")
      .eq("organization_id", p.organizationId)
      .eq("lead_id", p.leadId)
      .eq("type", "task_cancelled")
      .eq("source_module", "tarefas")
      .in("metadata->>origem", [...ORIGENS_DO_GATILHO_DE_FECHAMENTO])
      .gte("performed_at", p.fechadoEm);
    if (e1) throw new Error(e1.message);
    const ids = [
      ...new Set(
        ((canceladas ?? []) as Array<{ source_id: string | null }>)
          .map((r) => r.source_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (ids.length === 0) return 0;
    const { data: devolvidas, error: e2 } = await admin
      .from("crm_tasks")
      .update({ status: "pending", cancelada_motivo: null })
      .eq("organization_id", p.organizationId)
      .eq("lead_id", p.leadId)
      .eq("status", "cancelled")
      .in("id", ids)
      .select("id");
    if (e2) throw new Error(e2.message);
    return (devolvidas ?? []).length;
  } catch (err) {
    console.error("[lead.move] devolver tarefas da perda falhou", {
      request_id: p.requestId,
      lead_id: p.leadId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return 0;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ia.vek v1.9.59.2 (desfazer depois de vendido): o carro VOLTA ao estoque quando o lead sai do Vendido. Na loja a
 * venda nunca desativa o carro; a única marca nele é `catalog_products.aviso_da_loja_em`, posta pelo gatilho da
 * venda (0608, `fn_iavek_aviso_de_venda`, pelo `custom_fields.carro_interesse` do lead). Tirá-la reabre o ciclo
 * do carro (a próxima venda avisa a loja de novo), o mesmo que `fn_iavek_carro_voltou` (0600) faz quando o
 * Altimus devolve o carro.
 *
 * Só quando é o MESMO carro e ele não foi vendido de novo: o carro do lead é um produto do Altimus desta
 * organização, segue ATIVO (o que saiu do Altimus fica com a marca até voltar, pela 0600) e nenhum OUTRO lead da
 * organização está 'won' com ele. Client de SERVIÇO (a RLS do vendedor não alcança os leads dos outros), filtrado
 * por organização. Falha aqui não desfaz a reabertura: fica no log e a resposta diz `carro_voltou: false`.
 */
async function devolverCarroAoEstoque(p: {
  organizationId: string;
  leadId: string;
  carro: unknown;
  requestId: string;
}): Promise<boolean> {
  if (typeof p.carro !== "string" || !UUID.test(p.carro)) return false;
  try {
    const admin = createAdminClient();
    const { data: produto, error: e1 } = await admin
      .from("catalog_products")
      .select("id, ativo")
      .eq("organization_id", p.organizationId)
      .eq("id", p.carro)
      .eq("origem", "altimus")
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    const carro = produto as { id: string; ativo?: boolean | null } | null;
    if (!carro || carro.ativo !== true) return false;
    const { data: outros, error: e2 } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", p.organizationId)
      .eq("status", "won")
      .eq("custom_fields->>carro_interesse", p.carro)
      .neq("id", p.leadId)
      .limit(1);
    if (e2) throw new Error(e2.message);
    if ((outros ?? []).length > 0) return false;
    const { error: e3 } = await admin
      .from("catalog_products")
      .update({ aviso_da_loja_em: null })
      .eq("organization_id", p.organizationId)
      .eq("id", p.carro)
      .eq("ativo", true);
    if (e3) throw new Error(e3.message);
    return true;
  } catch (err) {
    console.error("[lead.move] devolver o carro ao estoque falhou", {
      request_id: p.requestId,
      lead_id: p.leadId,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return false;
  }
}
