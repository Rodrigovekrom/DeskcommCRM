/**
 * ia.vek CRM-244 (Fase 2) — a LEITURA de cada pessoa, sem migration (aprovado pelo Maestro, 06/11).
 *
 * Cada pessoa tem as SUAS não lidas: mensagens do cliente depois da última resposta de PESSOA e
 * depois da última vez que ELA abriu a conversa. O vendedor abre: zera o dele (teste I). O admin
 * abre: não mexe no do vendedor (teste H). Cartão reatribuído: o novo dono vê as não lidas desde a
 * última resposta de pessoa (o "estado atual"). A IA não zera nada.
 *
 * A abertura mora no histórico do lead (`conversation_viewed`, "Abriu a conversa"): no máximo UMA
 * linha por pessoa a cada 30 min por lead. Dentro da janela, a linha existente só ganha o novo
 * `payload.visto_ate`, que é o marcador exato de leitura.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { esperandoDesde } from "@/lib/iavek/ordem-do-quadro";
import { IDS_POR_LOTE } from "@/lib/supabase/em-lotes";
import { todasAsPaginas } from "@/lib/supabase/paginas";

export const TIPO_DA_ABERTURA = "conversation_viewed" as const;
export const JANELA_DA_ABERTURA_MS = 30 * 60_000;

const ms = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** As não lidas de UMA pessoa: mensagens do cliente depois da última resposta de pessoa e da última abertura dela. */
export function naoLidasDaPessoa(
  entradas: readonly string[],
  ultimaRespostaHumana: string | null | undefined,
  vistoAte: string | null | undefined,
): number {
  const corte = Math.max(ms(ultimaRespostaHumana), ms(vistoAte));
  return entradas.filter((e) => ms(e) > corte).length;
}

/** "Já vi" do ADMIN: ele abriu a conversa depois da última mensagem do cliente. */
export function jaViu(vistoAte: string | null | undefined, ultimaDoCliente: string | null | undefined): boolean {
  return ms(vistoAte) > 0 && ms(vistoAte) >= ms(ultimaDoCliente);
}

/** O "visto até" de uma linha de abertura (a própria hora, ou o payload atualizado na janela). */
export function vistoAteDaLinha(l: { performed_at: string; payload: Record<string, unknown> | null }): string {
  const p = l.payload?.visto_ate;
  return typeof p === "string" && ms(p) > ms(l.performed_at) ? p : l.performed_at;
}

/**
 * Registra que `userId` abriu a conversa: em cada lead ABERTO do contato, uma linha nova
 * "Abriu a conversa" ou, dentro dos 30 min da última dele, só o `visto_ate` novo.
 * `admin` = service role: TODA consulta filtra a organização, resolvida pela sessão de quem chama.
 */
export async function registrarAbertura(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  conversationId: string,
  agora: Date = new Date(),
): Promise<{ ok: true; leads: string[] } | { ok: false; erro: string }> {
  const { data: conversa, error: e1 } = await admin
    .from("conversations")
    .select("contact_id")
    .eq("organization_id", orgId)
    .eq("id", conversationId)
    .maybeSingle();
  if (e1) return { ok: false, erro: e1.message };
  if (!conversa) return { ok: false, erro: "conversa_nao_achada" };
  const contactId = (conversa as { contact_id: string }).contact_id;
  const { data: leads, error: e2 } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("status", "open");
  if (e2) return { ok: false, erro: e2.message };
  const ids = ((leads ?? []) as Array<{ id: string }>).map((l) => l.id);
  if (ids.length === 0) return { ok: true, leads: [] };

  const agoraIso = agora.toISOString();
  const { data: recentes, error: e3 } = await admin
    .from("crm_lead_activities")
    .select("id, lead_id, performed_at, payload")
    .eq("organization_id", orgId)
    .eq("type", TIPO_DA_ABERTURA)
    .eq("performed_by_user_id", userId)
    .in("lead_id", ids)
    .gte("performed_at", new Date(agora.getTime() - JANELA_DA_ABERTURA_MS).toISOString());
  if (e3) return { ok: false, erro: e3.message };
  const naJanela = new Map<string, { id: string; payload: Record<string, unknown> | null }>();
  for (const r of (recentes ?? []) as Array<{ id: string; lead_id: string; payload: Record<string, unknown> | null }>) {
    naJanela.set(r.lead_id, r);
  }
  for (const leadId of ids) {
    const linha = naJanela.get(leadId);
    if (linha) {
      const { error } = await admin
        .from("crm_lead_activities")
        .update({ payload: { ...(linha.payload ?? {}), visto_ate: agoraIso } })
        .eq("organization_id", orgId)
        .eq("id", linha.id);
      if (error) return { ok: false, erro: error.message };
      continue;
    }
    const r = await emitLeadActivity(admin, {
      organizationId: orgId,
      leadId,
      contactId,
      type: TIPO_DA_ABERTURA,
      sourceModule: "conversa",
      sourceId: conversationId,
      actor: { type: "user", id: userId },
      reason: "Abriu a conversa",
      payload: { conversation_id: conversationId, visto_ate: agoraIso },
    });
    if (!r.ok) return { ok: false, erro: r.error ?? "falha_ao_registrar" };
  }
  return { ok: true, leads: ids };
}

type ConversaDoCartao = {
  id: string;
  last_inbound_at?: string | null;
  ultima_resposta_humana_em?: string | null;
};

/**
 * As não lidas DE QUEM PEDE (e o "já vi" quando quem pede é admin), por lead. Só as conversas que
 * esperam resposta de pessoa podem ter não lidas: as outras saem com 0 sem ir ao banco.
 */
export async function leiturasDoQuadro(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  ehAdmin: boolean,
  leads: ReadonlyArray<{ id: string; status: string; stage_id: string; conversa?: ConversaDoCartao | null }>,
  nomeDaEtapa: (stageId: string) => string | null | undefined,
): Promise<{ porLead: Map<string, { nao_lidas: number; ja_vi?: boolean }>; error: string | null }> {
  const porLead = new Map<string, { nao_lidas: number; ja_vi?: boolean }>();
  // A MESMA régua da marca do cartão: aberto, fora da coluna da IA, esperando resposta de pessoa.
  const esperando = leads.filter(
    (l): l is { id: string; status: string; stage_id: string; conversa: ConversaDoCartao } =>
      !!l.conversa && esperandoDesde(l as never, nomeDaEtapa(l.stage_id)) !== null,
  );
  if (esperando.length === 0) return { porLead, error: null };

  type Abertura = { lead_id: string; performed_at: string; payload: Record<string, unknown> | null };
  const aberturas: Abertura[] = [];
  try {
    const ids = esperando.map((l) => l.id);
    for (let i = 0; i < ids.length; i += IDS_POR_LOTE) {
      const lote = ids.slice(i, i + IDS_POR_LOTE);
      aberturas.push(
        ...(await todasAsPaginas<Abertura>((de, ate) =>
          supabase
            .from("crm_lead_activities")
            .select("lead_id, performed_at, payload")
            .eq("organization_id", orgId)
            .eq("type", TIPO_DA_ABERTURA)
            .eq("performed_by_user_id", userId)
            .in("lead_id", lote)
            .order("id", { ascending: true })
            .range(de, ate),
        )),
      );
    }
  } catch (err) {
    return { porLead, error: err instanceof Error ? err.message : String(err) };
  }
  const visto = new Map<string, string>();
  for (const a of aberturas) {
    const v = vistoAteDaLinha(a);
    if (ms(v) > ms(visto.get(a.lead_id))) visto.set(a.lead_id, v);
  }

  // As mensagens do cliente depois do corte mais antigo; cada conversa conta com o próprio corte.
  const corte = (l: { id: string; conversa: ConversaDoCartao }) =>
    Math.max(ms(l.conversa.ultima_resposta_humana_em), ms(visto.get(l.id)));
  const desde = new Date(Math.min(...esperando.map(corte))).toISOString();
  const conversas = [...new Set(esperando.map((l) => l.conversa.id))];
  // Paginado: uma conversa longa sem resposta não pode passar do teto de linhas e cortar a conta calada.
  const msgs: Array<{ conversation_id: string; created_at: string }> = [];
  try {
    for (let i = 0; i < conversas.length; i += IDS_POR_LOTE) {
      const lote = conversas.slice(i, i + IDS_POR_LOTE);
      msgs.push(
        ...(await todasAsPaginas<{ conversation_id: string; created_at: string }>((de, ate) =>
          supabase
            .from("messages")
            .select("conversation_id, created_at")
            .eq("organization_id", orgId)
            .eq("direction", "inbound")
            .in("conversation_id", lote)
            .gt("created_at", desde)
            .order("id", { ascending: true })
            .range(de, ate),
        )),
      );
    }
  } catch (err) {
    return { porLead, error: err instanceof Error ? err.message : String(err) };
  }
  const entradas = new Map<string, string[]>();
  for (const m of msgs) {
    const lista = entradas.get(m.conversation_id) ?? [];
    lista.push(m.created_at);
    entradas.set(m.conversation_id, lista);
  }
  for (const l of esperando) {
    const nao_lidas = naoLidasDaPessoa(entradas.get(l.conversa.id) ?? [], l.conversa.ultima_resposta_humana_em, visto.get(l.id));
    porLead.set(l.id, ehAdmin ? { nao_lidas, ja_vi: jaViu(visto.get(l.id), l.conversa.last_inbound_at) } : { nao_lidas });
  }
  return { porLead, error: null };
}
