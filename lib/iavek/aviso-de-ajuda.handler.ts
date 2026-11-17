/**
 * ia.vek v1.9.22 — consome `message.group_received`: o aviso do Venda.IA no grupo configurado
 * move o lead para Suporte IA e entrega ao próximo guardião (a regra mora no banco,
 * `fn_iavek_aviso_de_ajuda`, 0610). Aviso que não casa com lead nenhum: o lead fica onde
 * está e gerente e admin recebem no sino.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { membrosComPapel } from "@/lib/iavek/avisos-da-proposta";
import { configDoGuardiaoLeads, lerAvisoDeAjuda, remetenteQueAvisa, type ResultadoDoAviso } from "@/lib/iavek/aviso-de-ajuda";
import { lerRodizio } from "@/lib/iavek/rodizio";
import { logger } from "@/lib/logger";
import { lerRemetenteDeGrupo } from "@/lib/messaging/remetente-de-grupo";
import { createAdminClient } from "@/lib/supabase/admin";

export const AVISO_DE_AJUDA_KEY = "iavek-aviso-de-ajuda";

const r = (status: HandlerResult["status"], detail: string): HandlerResult => ({
  consumer_key: AVISO_DE_AJUDA_KEY,
  status,
  detail,
});

async function avisar(db: SupabaseClient, orgId: string, destinos: string[], dados: Record<string, unknown>) {
  if (destinos.length === 0) return;
  const { error } = await db.from("notificacoes").insert(
    destinos.map((user_id) => ({ organization_id: orgId, user_id, tipo: "aviso_da_loja", ator_user_id: null, dados })),
  );
  if (error) logger.error("aviso_de_ajuda_sino_falhou", { organization_id: orgId, error: error.message });
}

/** O evento do sino quando o Venda.IA pede ajuda num lead que JÁ TEM DONO (v1.9.60, CRM-422). */
export const EVENTO_LEAD_COM_DONO = "aviso_de_ajuda_lead_com_dono";

/**
 * ia.vek v1.9.60 (CRM-422, decisão do Rodrigo 15/11 "aviso do grupo: avisar o dono"): no lead que já tem dono, o
 * aviso vai ao sino SÓ do Guardião do lead (`crm_leads.sdr_user_id`, a SDR), nunca ao vendedor. Sem Guardião, ou com
 * o Guardião fora da empresa, vai a UMA pessoa da lista do rodízio (`settings.iavek.rodizio.participantes`, as
 * Guardiãs de Leads), a que recebeu esse aviso há mais tempo (empate: a ordem da lista). Com a lista vazia ou sem
 * ninguém ativo nela (a decisão não cobre), gerente e admin recebem, para o aviso não se perder. Só o SINO: nada
 * move o lead, que segue com o dono.
 */
export async function quemAvisarNoLeadComDono(
  db: SupabaseClient,
  orgId: string,
  leadId: string,
  settings: unknown,
): Promise<{ destinos: string[]; por: "guardiao" | "rodizio" | "gerencia" | "ninguem" }> {
  const { data: lead } = await db
    .from("crm_leads")
    .select("sdr_user_id")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  const guardiao = (lead as { sdr_user_id?: string | null } | null)?.sdr_user_id ?? null;
  if (guardiao) {
    const { data: membro } = await db
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", guardiao)
      .is("revoked_at", null)
      .maybeSingle();
    if (membro) return { destinos: [guardiao], por: "guardiao" };
  }
  const lista = lerRodizio(settings).participantes;
  if (lista.length > 0) {
    const { data: ativos } = await db
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .is("revoked_at", null)
      .in("user_id", lista);
    const ativosSet = new Set(((ativos ?? []) as Array<{ user_id: string }>).map((a) => a.user_id));
    const fila = lista.filter((u) => ativosSet.has(u));
    if (fila.length > 0) {
      const { data: anteriores } = await db
        .from("notificacoes")
        .select("user_id, created_at")
        .eq("organization_id", orgId)
        .eq("tipo", "aviso_da_loja")
        .eq("dados->>evento", EVENTO_LEAD_COM_DONO)
        .in("user_id", fila)
        .order("created_at", { ascending: false })
        .limit(500);
      const ultimo = new Map<string, string>();
      for (const n of (anteriores ?? []) as Array<{ user_id: string; created_at: string }>) {
        if (!ultimo.has(n.user_id)) ultimo.set(n.user_id, n.created_at);
      }
      const escolhido = [...fila].sort((a, b) => {
        const ta = ultimo.get(a) ?? "";
        const tb = ultimo.get(b) ?? "";
        if (ta !== tb) return ta < tb ? -1 : 1;
        return fila.indexOf(a) - fila.indexOf(b);
      })[0]!;
      return { destinos: [escolhido], por: "rodizio" };
    }
  }
  const gerencia = await membrosComPapel(db, orgId, ["manager", "admin"]);
  return { destinos: gerencia, por: gerencia.length > 0 ? "gerencia" : "ninguem" };
}

export async function tratarAvisoDeAjuda(db: SupabaseClient, row: EventRow): Promise<HandlerResult> {
  const orgId = row.organization_id;
  const { data: org, error: eOrg } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (eOrg) return r("error", eOrg.message);
  const cfg = configDoGuardiaoLeads(org?.settings);
  if (!cfg) return r("skipped", "sem_configuracao");

  const conversa = typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null;
  const mensagemId = typeof row.payload.message_id === "string" ? row.payload.message_id : null;
  if (!conversa || !mensagemId) return r("skipped", "sem_mensagem");
  const { data: grupo } = await db
    .from("channel_session_groups")
    .select("id")
    .eq("organization_id", orgId)
    .eq("conversation_id", conversa)
    .eq("channel_session_id", cfg.grupo.channel_session_id)
    .eq("group_chat_id", cfg.grupo.group_chat_id)
    .maybeSingle();
  if (!grupo) return r("skipped", "outro_grupo");

  const { data: msg, error: eMsg } = await db
    .from("messages")
    .select("body, metadata")
    .eq("organization_id", orgId)
    .eq("id", mensagemId)
    .maybeSingle();
  if (eMsg) return r("error", eMsg.message);
  if (!msg) return r("skipped", "mensagem_sumiu");
  const remetente = lerRemetenteDeGrupo(msg.metadata);
  const casou = remetenteQueAvisa(remetente, cfg);
  const leitura = lerAvisoDeAjuda(msg.body as string | null);
  if (!casou) {
    // ia.vek v1.9.40 (CRM-241): o aviso chegou SEM telefone (só o lid) e a loja ainda não tem o lid de
    // quem avisa. Nada se move; o detalhe guarda o lid para a equipe conferir e gravar em
    // numero_que_avisa_lid. Só quando o texto É um aviso, para não juntar o lid de todo participante.
    if (remetente && !remetente.phone && remetente.lid && !cfg.numero_que_avisa_lid && leitura.tipo === "aviso") {
      logger.info("aviso_de_ajuda_remetente_so_lid", { organization_id: orgId, lid: remetente.lid });
      return r("skipped", `remetente_so_lid:${remetente.lid}`);
    }
    return r("skipped", "remetente_nao_autorizado");
  }
  if (leitura.tipo === "nao_e_aviso") return r("skipped", "nao_e_aviso");

  const { data, error } = await db.rpc("fn_iavek_aviso_de_ajuda", {
    p_org: orgId,
    p_telefones: leitura.telefones,
    p_nome: leitura.nome,
  });
  if (error) return r("error", error.message);
  const linha = ((data ?? []) as Array<{ resultado: ResultadoDoAviso; lead_id: string | null; user_id: string | null; metodo: string | null }>)[0];
  const resultado = linha?.resultado ?? "nao_reconhecido";

  if (resultado === "nao_reconhecido" || resultado === "ambiguo") {
    await avisar(db, orgId, await membrosComPapel(db, orgId, ["manager", "admin"]), {
      evento: "aviso_de_ajuda_nao_reconhecido",
      nome: leitura.nome,
      motivo: resultado,
    });
  } else if (resultado === "entregue" && linha?.user_id) {
    await avisar(db, orgId, [linha.user_id], { evento: "aviso_de_ajuda_entregue", nome: leitura.nome, lead_id: linha.lead_id });
  } else if (resultado === "ja_tem_dono" && linha?.lead_id) {
    const alvo = await quemAvisarNoLeadComDono(db, orgId, linha.lead_id, org?.settings);
    await avisar(db, orgId, alvo.destinos, { evento: EVENTO_LEAD_COM_DONO, nome: leitura.nome, lead_id: linha.lead_id, por: alvo.por });
    logger.info("aviso_de_ajuda_lead_com_dono", { organization_id: orgId, por: alvo.por, destinos: alvo.destinos.length });
    return r("ok", `${resultado}${linha.metodo ? `:${linha.metodo}` : ""}:${alvo.por}`);
  }
  logger.info("aviso_de_ajuda", { organization_id: orgId, resultado, metodo: linha?.metodo ?? null, remetente_por: casou });
  return r("ok", `${resultado}${linha?.metodo ? `:${linha.metodo}` : ""}`);
}

export const avisoDeAjudaHandler: EventHandler = {
  key: AVISO_DE_AJUDA_KEY,
  // Loja parada não recebe lead: o aviso fica marcado como pulado e não volta na reativação.
  naOrgParada: "pula",
  events: ["message.group_received"],
  handle: (row) => tratarAvisoDeAjuda(createAdminClient(), row),
};
