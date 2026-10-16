/**
 * O CLONE PARA OUTRO FUNIL, como função (ia.vek D3).
 *
 * Era o corpo de `POST /api/v1/leads/[id]/clone`; saiu para cá sem mudar uma
 * regra para que a ESTEIRA DE VENDAS (passagem das 72h para o funil de
 * follow-up) leve o negócio pelo MESMO caminho da tela — mesmas recusas antes
 * da primeira escrita, mesma ordem "clone primeiro", mesmas linhas de timeline
 * nos dois lados e o mesmo audit. A rota agora só autentica e delega.
 *
 * O ator vem do `HandlerCtx`: `user` na tela, `system` na esteira.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { modoDeReabertura } from "@/lib/leads/reabertura";
import {
  recusaDeCamposObrigatorios,
  settingsDoFunil,
  validaCamposExigidos,
} from "@/lib/leads/campos-exigidos";
import {
  FUNIL_DE_DESTINO_NAO_ENCONTRADO,
  ORIGEM_SEM_ETAPA_DE_PERDA,
  escolheEtapaDeDestino,
  montaPayloadDoClone,
  recusaTrocaDeFunil,
  registroDoDestino,
  type EtapaDoFunil,
  type OrigemParaClonar,
} from "@/lib/leads/clonar-para-funil";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { encerraDemanda } from "@/lib/leads/encerramento";
import {
  motivoDaPerdaDaOrigem,
  recusaDeMotivoForaDoVocabulario,
} from "@/lib/leads/motivo-da-perda";

export interface PedidoDeClone {
  pipeline_id: string;
  stage_id?: string | null;
  lost_reason?: string | null;
}

export type ResultadoDoClone =
  | { ok: true; clone: Record<string, unknown>; origem: Record<string, unknown> }
  | { ok: false; code: string; message: string; status: number; details?: Record<string, unknown> };

function falha(
  code: string,
  message: string,
  status: number,
  extra: { details?: Record<string, unknown> } & Record<string, unknown>,
): ResultadoDoClone {
  return { ok: false, code, message, status, ...(extra.details ? { details: extra.details } : {}) };
}

export async function clonarLeadParaFunil(
  supabase: SupabaseClient,
  handlerCtx: HandlerCtx,
  leadId: string,
  input: PedidoDeClone,
): Promise<ResultadoDoClone> {
  const t = (texto: string) => traduzir(texto, handlerCtx.idioma ?? "pt-BR");

  // Filtro por organização explícito como defesa em profundidade: a RLS já
  // recorta o client do usuário, e o filtro continua valendo se esta rota um
  // dia passar a receber um client service-role (é o que o `_handler` faz).
  const { data: origem, error: selErr } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", handlerCtx.organization_id)
    .maybeSingle();

  if (selErr) {
    return falha("internal_error", selErr.message, 500, {});
  }
  if (!origem) {
    return falha("not_found", t("Lead não encontrado."), 404, {});
  }

  const { data: pipelineDestino, error: pipeErr } = await supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("id", input.pipeline_id)
    .eq("organization_id", handlerCtx.organization_id)
    .maybeSingle();

  if (pipeErr) {
    return falha("internal_error", pipeErr.message, 500, {});
  }
  if (!pipelineDestino) {
    return falha("pipeline_not_found", t(FUNIL_DE_DESTINO_NAO_ENCONTRADO), 404, {});
  }

  // O funil de ORIGEM responde DUAS coisas antes da primeira escrita: se um
  // encerrado pode ser clonado (issue #1538 — só num funil `novo_negocio`) e,
  // abaixo, se o `lost_reason` do chamador está no vocabulário dele.
  const { data: pipelineOrigem, error: origemPipeErr } = await supabase
    .from("crm_pipelines")
    .select("settings, name")
    .eq("id", (origem as OrigemParaClonar).pipeline_id)
    .eq("organization_id", handlerCtx.organization_id)
    .maybeSingle();

  if (origemPipeErr) {
    return falha("internal_error", origemPipeErr.message, 500, {});
  }
  const modoDaOrigem = modoDeReabertura(
    (pipelineOrigem as { settings?: unknown } | null)?.settings,
  );

  const recusa = recusaTrocaDeFunil(
    origem as OrigemParaClonar,
    input.pipeline_id,
    modoDaOrigem,
  );
  if (recusa) {
    return falha(recusa.code, t(recusa.texto), recusa.status, {});
  }

  // ── O MOTIVO DO CHAMADOR SE CONFERE ANTES DA PRIMEIRA ESCRITA ─────────────
  //
  // `lost_reason` chega do chamador como string livre (cloneLeadSchema só exige
  // não-vazia), e quem o recusa é `fn_validate_lost_reason_required` — no
  // encerramento da ORIGEM, que acontece DEPOIS de `createLeadHandler`. Nessa
  // ordem, `{"lost_reason": "mudou de funil"}` produzia 500 com o clone já
  // criado no destino e a origem ainda aberta: o negócio duplicado, e a
  // resposta dizendo que algo quebrou em vez de dizer o que fazer.
  //
  // O vocabulário é o do funil de ORIGEM porque é a linha da origem que fecha,
  // e o trigger lê `new.pipeline_id` (supabase/baseline.sql).
  const motivoRecusado = recusaDeMotivoForaDoVocabulario({
    motivo: input.lost_reason,
    settingsDoFunil: (pipelineOrigem as { settings?: unknown } | null)?.settings ?? null,
    idioma: handlerCtx.idioma,
  });
  if (motivoRecusado) {
    return falha(motivoRecusado.codigo, motivoRecusado.mensagem, 422, {});
  }

  const { data: etapas, error: stagesErr } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, position, is_won, is_lost, is_archived")
    .eq("organization_id", handlerCtx.organization_id)
    .eq("pipeline_id", input.pipeline_id)
    .eq("is_archived", false)
    .order("position", { ascending: true });

  if (stagesErr) {
    return falha("internal_error", stagesErr.message, 500, {});
  }

  const destino = escolheEtapaDeDestino(
    (etapas ?? []) as EtapaDoFunil[],
    input.stage_id ?? null,
  );
  if (!destino.ok) {
    return falha(destino.code, t(destino.texto), destino.status, {});
  }

  // ── A ETAPA DE DESTINO TAMBÉM É UMA ENTRADA ────────────────────────────────
  //
  // O clone nasce numa etapa do funil de destino, e entrar nela é o mesmo
  // gatilho do arrasto e da retomada: o funil que exige um campo para receber
  // o negócio o exige aqui também. Sem esta pergunta, a troca de funil
  // aterrissava numa etapa exigente com o campo em branco e a exigência só era
  // cobrada na PRÓXIMA escrita — o negócio já estava lá.
  //
  // A régua é a MESMA função de todos os outros caminhos, e o valor que ela lê
  // é o que o negócio novo VAI ter: o clone leva os campos personalizados da
  // origem inteiros. A pergunta vem antes da primeira escrita, como todas as
  // outras recusas desta rota — recusar depois deixaria o clone no destino e o
  // 500 escondendo a meia-execução.
  //
  // O `settings` perguntado é o do funil de DESTINO: é onde o negócio entra. O
  // `pipelineOrigem` logo acima é o da origem, e serviria à pergunta errada.
  const settingsDoDestino = await settingsDoFunil(supabase, destino.etapa.pipeline_id);
  const vereditoDeCampos = validaCamposExigidos({
    lead: { custom_fields: (origem as OrigemParaClonar).custom_fields ?? {} },
    settingsDoFunil: settingsDoDestino,
    destino: { stageId: destino.etapa.id, desfecho: null },
    motivoDeGanho: null,
  });
  if (vereditoDeCampos.faltando.length > 0) {
    const recusaDeCampos = recusaDeCamposObrigatorios(
      vereditoDeCampos.faltando,
      handlerCtx.idioma,
    );
    return falha(recusaDeCampos.codigo, recusaDeCampos.mensagem, 422, {
      details: { faltando: vereditoDeCampos.faltando },
      requestId: handlerCtx.requestId,
    });
  }

  // ── A ORIGEM PRECISA TER ONDE FECHAR, E ISSO SE PERGUNTA ANTES ─────────────
  //
  // `encerraDemanda` recusa com 422 `pipeline_no_lost_stage` quando o funil de
  // ORIGEM não tem etapa de perda não arquivada — e ele roda DEPOIS da criação
  // do clone. Nessa ordem o operador lia uma recusa de pedido ("nada mudou")
  // com o negócio JÁ duplicado no funil de destino: o pior dos dois mundos,
  // porque a meia-execução fica invisível.
  //
  // O estado é alcançável e o próprio repo o reconhece (lib/pipelines/
  // pipeline-editing.ts cita o espelho deste caso no `/win`). A pergunta é
  // barata e não tem corrida que importe: se alguém arquivar a etapa entre esta
  // consulta e o encerramento, o 422 volta a acontecer — mas aí ele é honesto,
  // e a ordem "clone primeiro" continua sendo a certa pelo motivo do cabeçalho.
  // Só a origem ABERTA precisa de onde fechar (issue #1538): a encerrada que
  // o funil `novo_negocio` deixa clonar como nova tentativa não é reencerrada,
  // e cobrar etapa de perda dela recusaria uma troca que não escreve nada.
  const origemJaEncerrada = (origem as OrigemParaClonar).status !== "open";
  if (!origemJaEncerrada) {
    const { data: etapaDePerdaDaOrigem, error: perdaErr } = await supabase
      .from("crm_stages")
      .select("id")
      .eq("organization_id", handlerCtx.organization_id)
      .eq("pipeline_id", (origem as OrigemParaClonar).pipeline_id)
      .eq("is_lost", true)
      .eq("is_archived", false)
      .limit(1)
      .maybeSingle();

    if (perdaErr) {
      return falha("internal_error", perdaErr.message, 500, {});
    }
    if (!etapaDePerdaDaOrigem) {
      return falha(
        "pipeline_no_lost_stage",
        t(ORIGEM_SEM_ETAPA_DE_PERDA),
        422,
        {},
      );
    }
  }

  const clone = await createLeadHandler(
    supabase,
    handlerCtx,
    montaPayloadDoClone(origem as OrigemParaClonar, destino.etapa),
  );

  const destination = registroDoDestino(clone);
  const nomeDoFunilDeOrigem = (pipelineOrigem as { name?: string | null } | null)?.name ?? null;
  const nomeDoFunilDeDestino = (pipelineDestino as { name?: string | null }).name ?? null;

  // ── A TROCA NA LINHA DO TEMPO, DOS DOIS LADOS ──────────────────────────────
  //
  // `source_metadata` guarda os ponteiros, mas nenhuma tela o lê — a linha do
  // tempo do dossiê vem de `crm_lead_activities` (hooks/leads/useLeadTimeline.ts).
  // Sem estas linhas o negócio novo aparecia no destino sem história nenhuma, e
  // a origem dizia "Perdido — other" para um negócio que não se perdeu.
  // Os nomes dos funis entram na frase como entram os das etapas em
  // `stageChangeReason`: é o que quem lê reconhece.
  const atividadeDoClone = await emitLeadActivity(supabase, {
    organizationId: handlerCtx.organization_id,
    leadId: String(destination.lead_id),
    contactId: (origem as OrigemParaClonar).contact_id ?? null,
    type: "moved_from_pipeline",
    sourceModule: "crm",
    sourceId: leadId,
    actor: handlerCtx.actor,
    reason: nomeDoFunilDeOrigem ? `Veio do funil ${nomeDoFunilDeOrigem}` : "Veio de outro funil",
    payload: {
      from_pipeline_id: (origem as OrigemParaClonar).pipeline_id,
      from_lead_id: leadId,
    },
  });
  if (!atividadeDoClone.ok) {
    // Falha BAIXO, como em `encerraDemanda`: o clone já existe, e prender a
    // troca à timeline deixaria a operação refém do registro. Contada, nunca
    // engolida.
    await registraFalhaDeAtividade(supabase, {
      organizationId: handlerCtx.organization_id,
      leadId: String(destination.lead_id),
      tipo: "moved_from_pipeline",
      origem: "app/api/v1/leads/[id]/clone",
      erro: atividadeDoClone.error,
      requestId: handlerCtx.requestId,
    });
  }

  // ── A ORIGEM ENCRERRADA NÃO É REENCERRADA (issue #1538) ───────────────────
  //
  // Escrever `lost` por cima de `won` — ou por cima de `lost` com OUTRO motivo
  // — apagaria o desfecho anterior, que é justamente metade do valor desta
  // operação num funil `novo_negocio`: a primeira perda fica intocada, com o
  // motivo dela, e o que a origem ganha é o ponteiro `movido_para` (logo
  // abaixo) mais a linha do tempo do clone, já gravada acima.
  const motivo = origemJaEncerrada
    ? ((origem as { lost_reason?: string | null }).lost_reason ?? null)
    : motivoDaPerdaDaOrigem(input.lost_reason);
  let origemEncerrada: Record<string, unknown> | null = null;
  if (!origemJaEncerrada) {
    const encerrada = await encerraDemanda(supabase, handlerCtx, {
      leadId,
      desfecho: "lost",
      motivo,
      razaoNaTimeline: nomeDoFunilDeDestino
        ? `Levado para o funil ${nomeDoFunilDeDestino}`
        : "Levado para outro funil",
      payloadNaTimeline: {
        to_pipeline_id: input.pipeline_id,
        to_lead_id: destination.lead_id,
      },
    });
    origemEncerrada = encerrada.lead as Record<string, unknown>;
  }

  // Onde a origem foi parar. Fica na ORIGEM porque o clone já carrega
  // `clonado_de`: cada lado guarda o ponteiro para o outro. É o dado para quem
  // integra pela API; para o operador na tela, a história são as duas linhas
  // de timeline gravadas acima.
  const sourceMetadata = {
    ...(((origem as OrigemParaClonar).source_metadata ?? {}) as Record<string, unknown>),
    movido_para: destination,
  };

  const { data: origemFinal, error: updErr } = await supabase
    .from("crm_leads")
    .update({ source_metadata: sourceMetadata, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("organization_id", handlerCtx.organization_id)
    .select("*")
    .maybeSingle();

  if (updErr) {
    return falha("internal_error", updErr.message, 500, {});
  }

  await audit({
    action: "lead.moved_to_pipeline",
    actorUserId: (handlerCtx.actor.type === "user" ? handlerCtx.actor.id : null),
    organizationId: handlerCtx.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId: handlerCtx.requestId,
    metadata: {
      actor_type: handlerCtx.actor.type,
      from_pipeline_id: (origem as OrigemParaClonar).pipeline_id,
      to_pipeline_id: input.pipeline_id,
      to_stage_id: destino.etapa.id,
      cloned_lead_id: destination.lead_id,
      lost_reason: motivo,
    },
  });

  return { ok: true, clone, origem: (origemFinal ?? origemEncerrada ?? origem) as Record<string, unknown> };
}
