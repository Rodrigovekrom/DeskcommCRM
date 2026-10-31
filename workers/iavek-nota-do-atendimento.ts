/**
 * ia.vek v1.8.4 — o AVALIADOR do atendimento (pedido do Rodrigo, 24/10/2026).
 *
 * Consome `conversation.closed` (emitido pela rota de Fechar, só com a chave da
 * loja ligada) e grava UMA nota em `iavek_notas_de_atendimento`.
 *
 * ═══ O QUE ELE NUNCA FAZ ═══
 * Não tem ferramenta, não tem canal de envio, não usa o agente de atendimento
 * (Juliana/Daiane). Ele lê a conversa e devolve um objeto — fisicamente não há
 * caminho daqui até o WhatsApp do cliente.
 *
 * ═══ O QUE VAI À IA ═══
 * A transcrição MASCARADA (`mascarar`: documento, número, placa, chassi, renda,
 * e-mail, nome do cliente) desde a última nota daquela conversa, a etapa do
 * funil e os critérios do Acervo. Só se houve ao menos 1 fala do vendedor.
 *
 * ═══ CUSTO ═══
 * Um pedido por fechamento, pelo ponto `iavek_nota_atendimento` (modelo padrão
 * claude-haiku-5-5), com o teto de gasto da organização respeitado e o custo
 * gravado em `llm_calls` e na própria nota.
 *
 * NUNCA LANÇA: devolve o desfecho para o dispatcher.
 */
import { NoObjectGeneratedError, generateObject } from "ai";

import { getBudgetStatus } from "@/lib/ai/budget/check";
import { computeCost } from "@/lib/ai/cost";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { logInvocation } from "@/lib/ai/log-invocation";
import { decidirOrcamento } from "@/lib/agent-engine/edge/llm/orcamento";
import type { OrigemDaEscolha } from "@/lib/ai/pontos/resolver";
import type { EventRow } from "@/lib/event-log/dispatcher";
import {
  MODELO_DA_NOTA,
  ehDoVendedor,
  lerConfigDaNota,
  montarTranscricao,
  promptDoAvaliador,
  respostaDaNotaSchema,
  type MensagemDoAtendimento,
} from "@/lib/iavek/nota-do-atendimento";
import { lerCriteriosDoAcervo } from "@/lib/iavek/nota-do-atendimento-servidor";
import { lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const PONTO_DA_NOTA = "iavek_nota_atendimento";
const TEMPO_MAXIMO_MS = 60_000;

export type DesfechoDaNota =
  | { status: "ok"; nota: number; custo_cents: number }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

export async function avaliarAtendimento(event: EventRow): Promise<DesfechoDaNota> {
  const orgId = event.organization_id;
  const conversationId = (event.payload?.["conversation_id"] as string | undefined) ?? event.entity_id ?? null;
  const fechadoPor = (event.payload?.["closed_by_user_id"] as string | undefined) ?? null;
  if (!conversationId) return { status: "skipped", reason: "sem_conversa" };

  try {
    const admin = createAdminClient();

    // A chave pode ter sido desligada entre o Fechar e agora.
    const { data: org, error: erroDaOrg } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    // Pacote de segurança e defeitos (31/10): erro de leitura não é "chave desligada".
    if (erroDaOrg) return { status: "error", reason: `leitura_da_organizacao: ${erroDaOrg.message}` };
    if (!lerConfigDaNota((org as { settings?: unknown } | null)?.settings).ativo) {
      return { status: "skipped", reason: "chave_desligada" };
    }
    // v1.9.0: o texto do avaliador e o critério padrão seguem o perfil da empresa.
    const { nicho } = lerPerfilDaEmpresa((org as { settings?: unknown } | null)?.settings);

    // Reprocessar o mesmo evento não gera nota de novo (e não gasta de novo).
    const { count: jaTem, error: erroDoJaTem } = await admin
      .from("iavek_notas_de_atendimento")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("event_id", event.id);
    // Sem saber se já foi avaliada, não avalia: chamaria a IA (e pagaria) de novo.
    if (erroDoJaTem) return { status: "error", reason: `leitura_da_nota_anterior: ${erroDoJaTem.message}` };
    if ((jaTem ?? 0) > 0) return { status: "skipped", reason: "ja_avaliada" };

    const { data: conversa, error: erroDaConversa } = await admin
      .from("conversations")
      .select("id, contact_id, assigned_to_user_id, is_group")
      .eq("id", conversationId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const conv = conversa as { id: string; contact_id: string | null; assigned_to_user_id: string | null; is_group: boolean | null } | null;
    if (erroDaConversa) return { status: "error", reason: `leitura_da_conversa: ${erroDaConversa.message}` };
    if (!conv) return { status: "skipped", reason: "conversa_nao_encontrada" };
    if (conv.is_group) return { status: "skipped", reason: "grupo" };

    // O atendimento: desde a última nota desta conversa.
    const { data: ultima } = await admin
      .from("iavek_notas_de_atendimento")
      .select("ate")
      .eq("organization_id", orgId)
      .eq("conversation_id", conversationId)
      .order("ate", { ascending: false })
      .limit(1);
    const desde = ((ultima ?? [])[0] as { ate: string } | undefined)?.ate ?? null;

    let consulta = admin
      .from("messages")
      .select("direction, sent_via, type, body, created_at, sent_by_user_id")
      .eq("organization_id", orgId)
      .eq("conversation_id", conversationId)
      .neq("type", "reaction")
      .order("created_at", { ascending: false })
      .limit(400);
    if (desde) consulta = consulta.gt("created_at", desde);
    const { data: msgs, error: erroMsgs } = await consulta;
    if (erroMsgs) return { status: "error", reason: `mensagens: ${erroMsgs.message}` };
    const mensagens = (msgs ?? []) as Array<MensagemDoAtendimento & { sent_by_user_id: string | null }>;
    const doVendedor = mensagens.filter(ehDoVendedor);
    if (doVendedor.length === 0) return { status: "skipped", reason: "sem_fala_do_vendedor" };

    // O avaliado: quem mais falou como vendedor; senão o atendente; senão quem fechou.
    const contagem = new Map<string, number>();
    for (const m of doVendedor) if (m.sent_by_user_id) contagem.set(m.sent_by_user_id, (contagem.get(m.sent_by_user_id) ?? 0) + 1);
    const vendedor =
      [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? conv.assigned_to_user_id ?? fechadoPor;

    // Nome do cliente (para mascarar) e o lead aberto mais recente (etapa).
    let nomes: string[] = [];
    let leadId: string | null = null;
    let etapaNome: string | null = null;
    if (conv.contact_id) {
      const { data: contato } = await admin
        .from("contacts")
        .select("display_name, name")
        .eq("id", conv.contact_id)
        .eq("organization_id", orgId)
        .maybeSingle();
      const c = contato as { display_name?: string | null; name?: string | null } | null;
      nomes = [c?.display_name, c?.name].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      const { data: leads } = await admin
        .from("crm_leads")
        .select("id, crm_stages!crm_leads_stage_id_fkey(name)")
        .eq("organization_id", orgId)
        .eq("contact_id", conv.contact_id)
        .order("updated_at", { ascending: false })
        .limit(1);
      const l = (leads ?? [])[0] as { id: string; crm_stages?: { name?: string | null } | null } | undefined;
      leadId = l?.id ?? null;
      etapaNome = l?.crm_stages?.name ?? null;
    }

    // Teto de gasto da organização (o mesmo do agente de atendimento).
    const veto = await vetoDoTeto(orgId);
    if (veto) return { status: "skipped", reason: veto };

    const resolvido = await resolverModeloDoPonto(PONTO_DA_NOTA, orgId, MODELO_DA_NOTA, {
      naFaltaUsarOPadraoDaOrganizacao: true,
    });
    if (!resolvido) return { status: "skipped", reason: "sem_chave_de_ia" };

    const criterios = await lerCriteriosDoAcervo(admin, orgId, nicho);
    const transcricao = montarTranscricao(mensagens, nomes);
    const prompt = [
      etapaNome ? `Etapa do lead no funil: ${etapaNome}.` : "Lead sem etapa conhecida.",
      transcricao.cortou ? `Atenção: atendimento longo; abaixo estão só as últimas ${transcricao.total} mensagens.` : "",
      "",
      "CONVERSA:",
      transcricao.texto,
    ]
      .filter((l, i) => l !== "" || i === 2)
      .join("\n");

    const inicio = Date.now();
    const abortar = new AbortController();
    const relogio = setTimeout(() => abortar.abort(), TEMPO_MAXIMO_MS);
    let resposta;
    let tokensEntrada = 0;
    let tokensSaida = 0;
    try {
      const gerado = await generateObject({
        model: resolvido.model,
        schema: respostaDaNotaSchema,
        system: promptDoAvaliador(criterios.texto, nicho),
        prompt,
        // Haiku 5.5: raciocínio adaptativo ligado por padrão e cobrado como
        // saída — esforço baixo basta para dar nota. Sem `temperature` (o
        // modelo recusa). Saída estruturada nativa, não modo ferramenta.
        providerOptions: { anthropic: { effort: "low", structuredOutputMode: "outputFormat" } },
        maxOutputTokens: 4000,
        abortSignal: abortar.signal,
      });
      resposta = gerado.object;
      const uso = gerado.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      tokensEntrada = uso?.inputTokens ?? 0;
      tokensSaida = uso?.outputTokens ?? 0;
    } catch (err) {
      const causa = err instanceof Error ? err.message : String(err);
      // Recusa do modelo (stop_reason "refusal" → "content-filter") ou resposta
      // cortada: tentar de novo dá o mesmo resultado e gasta de novo. Fica sem
      // nota, com o motivo registrado — nunca em laço.
      const fim = NoObjectGeneratedError.isInstance(err) ? err.finishReason : undefined;
      const definitivo = fim === "content-filter" ? "recusa_do_modelo" : fim === "length" ? "resposta_cortada" : null;
      logInvocation({
        organization_id: orgId,
        agent_id: null,
        conversation_id: conversationId,
        message_id: null,
        invocation_kind: PONTO_DA_NOTA,
        model: resolvido.modelId,
        prompt_tokens: 0,
        completion_tokens: 0,
        latency_ms: Date.now() - inicio,
        cost_cents: null,
        origem_da_escolha: origemDaEscolha(resolvido.origem),
        error_code: definitivo ?? "iavek_nota_falhou",
        finish_reason: fim ?? null,
        error_payload: { causa: causa.slice(0, 500) },
      });
      if (definitivo) return { status: "skipped", reason: definitivo };
      return { status: "error", reason: `modelo: ${causa.slice(0, 200)}` };
    } finally {
      clearTimeout(relogio);
    }

    const custo = await computeCost({ model: resolvido.modelId, promptTokens: tokensEntrada, completionTokens: tokensSaida });
    logInvocation({
      organization_id: orgId,
      agent_id: null,
      conversation_id: conversationId,
      message_id: null,
      invocation_kind: PONTO_DA_NOTA,
      model: resolvido.modelId,
      prompt_tokens: tokensEntrada,
      completion_tokens: tokensSaida,
      latency_ms: Date.now() - inicio,
      cost_cents: custo,
      origem_da_escolha: origemDaEscolha(resolvido.origem),
    });

    const nota = Math.round(Math.min(10, Math.max(0, resposta.nota)) * 10) / 10;
    const { error: erroGravar } = await admin.from("iavek_notas_de_atendimento").upsert(
      {
        organization_id: orgId,
        conversation_id: conversationId,
        contact_id: conv.contact_id,
        lead_id: leadId,
        vendedor_user_id: vendedor,
        fechado_por_user_id: fechadoPor,
        event_id: event.id,
        nota,
        pontos_fortes: resposta.pontos_fortes.slice(0, 3),
        pontos_a_melhorar: resposta.pontos_a_melhorar.slice(0, 3),
        // O trecho volta da IA: passa de novo pela máscara antes de gravar.
        trecho: resposta.trecho ? montarTranscricaoDeUmaLinha(resposta.trecho, nomes) : null,
        etapa_nome: etapaNome,
        desde,
        ate: mensagens[0]?.created_at ?? new Date().toISOString(),
        mensagens_avaliadas: transcricao.total,
        modelo: resolvido.modelId,
        tokens_entrada: tokensEntrada,
        tokens_saida: tokensSaida,
        custo_cents: custo,
        criterios_do_acervo: criterios.doAcervo,
      },
      { onConflict: "organization_id,event_id", ignoreDuplicates: true },
    );
    if (erroGravar) return { status: "error", reason: `gravar: ${erroGravar.message}` };
    return { status: "ok", nota, custo_cents: custo };
  } catch (err) {
    logger.warn("[iavek-nota] avaliação falhou", {
      organization_id: orgId,
      event_id: event.id,
      causa: err instanceof Error ? err.message : String(err),
    });
    return { status: "error", reason: err instanceof Error ? err.message.slice(0, 200) : "erro" };
  }
}

/** De onde veio o modelo, no vocabulário de `llm_calls.origem_da_escolha`. */
function origemDaEscolha(o: "binding" | "credencial_da_organizacao" | "padrao"): OrigemDaEscolha {
  if (o === "binding") return "binding";
  if (o === "credencial_da_organizacao") return "padrao_da_organizacao";
  return "variavel_de_ambiente";
}

function montarTranscricaoDeUmaLinha(trecho: string, nomes: string[]): string {
  return montarTranscricao([{ direction: "outbound", sent_via: "user", type: "text", body: trecho, created_at: new Date(0).toISOString() }], nomes)
    .texto.replace(/^\[[^\]]*\] VENDEDOR: /, "")
    .slice(0, 300);
}

/** O teto de gasto: `null` segue; texto = motivo de pular. Nunca lança (erro de leitura segue sem teto). */
async function vetoDoTeto(orgId: string): Promise<string | null> {
  try {
    const status = await getBudgetStatus(orgId);
    if (status.enforcement_mode === "off") return null;
    const veredito = decidirOrcamento({
      modo: status.enforcement_mode,
      tetoCents: status.monthly_limit_cents,
      gastoCents: status.current_month_consumed_cents,
      efetivoEm: status.enforcement_effective_at === null ? null : new Date(status.enforcement_effective_at),
      agora: new Date(),
      purpose: PONTO_DA_NOTA,
      chave: status.enforcement_env,
      limiarPct: status.alarm_threshold_pct,
      // O aviso de orçamento é do agente de atendimento; aqui só obedecemos o bloqueio.
      avisadoNesteMes: true,
    });
    return veredito.acao === "bloquear" ? "teto_de_gasto" : null;
  } catch {
    return null;
  }
}
