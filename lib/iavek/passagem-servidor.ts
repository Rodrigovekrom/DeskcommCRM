import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { entradaDaEsteira } from "@/lib/iavek/cronometro-72h";
import { ETAPA_DA_PASSAGEM, type CamposDaPassagem, type TipoDePassagem } from "@/lib/iavek/passagem";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { clonarLeadParaFunil } from "@/lib/leads/clonar-lead-para-funil";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * ia.vek v1.9.4 — o lado SERVIDOR da passagem do lead (regras em `passagem.ts`).
 * Service role, SEMPRE filtrando a organização à mão (CLAUDE.md).
 */

export interface LeadDaPassagem {
  id: string;
  organization_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  owner_user_id: string | null;
  sdr_user_id: string | null;
  status: string;
  created_at: string;
  custom_fields: Record<string, unknown> | null;
  source_metadata: Record<string, unknown> | null;
}

const COLUNAS =
  "id, organization_id, pipeline_id, stage_id, contact_id, owner_user_id, sdr_user_id, status, created_at, custom_fields, source_metadata";

export async function lerLeadDaPassagem(admin: SupabaseClient, orgId: string, leadId: string): Promise<LeadDaPassagem | null> {
  const { data } = await admin.from("crm_leads").select(COLUNAS).eq("organization_id", orgId).eq("id", leadId).maybeSingle();
  return (data as LeadDaPassagem | null) ?? null;
}

/** O nascimento do lead para a conta das 72h (no clone da esteira, o do ciclo). */
export function nascimentoDoLead(lead: Pick<LeadDaPassagem, "created_at" | "source_metadata">): string {
  const inicio = lead.source_metadata?.esteira_inicio;
  return typeof inicio === "string" && !Number.isNaN(Date.parse(inicio)) ? inicio : lead.created_at;
}

/** As horas do ciclo (a esteira da empresa; sem esteira, 72). */
export function horasDoCiclo(settingsDaOrg: unknown): number {
  return entradaDaEsteira(settingsDaOrg)?.horas ?? 72;
}

export async function etapaPorSlug(
  admin: SupabaseClient,
  orgId: string,
  pipelineId: string,
  slug: string,
): Promise<string | null> {
  const { data } = await admin
    .from("crm_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipelineId)
    .eq("slug", slug)
    .eq("is_archived", false)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Grava os campos do negócio pelo MESMO merge atômico da tela (0502). */
export async function anotarCampos(
  admin: SupabaseClient,
  orgId: string,
  leadId: string,
  campos: CamposDaPassagem | undefined,
): Promise<Record<string, unknown> | null> {
  if (!campos || Object.keys(campos).length === 0) return null;
  const { data, error } = await admin.rpc("fn_lead_anotar_campos", { p_org: orgId, p_lead: leadId, p_campos: campos });
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? {};
}

/**
 * Troca o dono (e o guardião). Primeiro com a SESSÃO de quem age — o aviso
 * "passou o lead" do gatilho 0579 sai no nome dele —; se a RLS não deixar,
 * pelo servidor, e o aviso que o gatilho gravou sem autor ganha o autor certo.
 */
export async function mudarDono(
  admin: SupabaseClient,
  args: { orgId: string; leadId: string; dono: string; guardiao: string | null; atorId: string },
): Promise<boolean> {
  const mudanca = {
    owner_user_id: args.dono,
    owner_kind: "user",
    owner_agent_id: null,
    sdr_user_id: args.guardiao,
    assigned_at: new Date().toISOString(),
  };
  const sessao = await createClient();
  const { data: peloAtor } = await sessao
    .from("crm_leads")
    .update(mudanca)
    .eq("organization_id", args.orgId)
    .eq("id", args.leadId)
    .select("id")
    .maybeSingle();
  if (peloAtor) return true;
  const { data: peloServidor } = await admin
    .from("crm_leads")
    .update(mudanca)
    .eq("organization_id", args.orgId)
    .eq("id", args.leadId)
    .select("id")
    .maybeSingle();
  if (!peloServidor) return false;
  await admin
    .from("notificacoes")
    .update({ ator_user_id: args.atorId })
    .eq("organization_id", args.orgId)
    .eq("lead_id", args.leadId)
    .eq("user_id", args.dono)
    .eq("tipo", "lead_passado")
    .is("ator_user_id", null)
    .gte("created_at", new Date(Date.now() - 120_000).toISOString());
  return true;
}

/**
 * O aviso de QUEM RECEBE a passagem: o gatilho já gravou "passou o lead para
 * você"; aqui ele vira o aviso certo (devolvido, reativado), com o motivo.
 * Sem o aviso do gatilho (o dono não mudou), grava um novo.
 */
export async function avisoDaPassagem(
  admin: SupabaseClient,
  args: {
    orgId: string;
    leadId: string;
    para: string;
    atorId: string | null;
    tipo: "lead_passado" | "lead_devolvido" | "lead_retirado" | "lead_reativado";
    dados: Record<string, unknown>;
    converterOAvisoDoGatilho: boolean;
  },
): Promise<void> {
  if (args.converterOAvisoDoGatilho) {
    const { data } = await admin
      .from("notificacoes")
      .update({ tipo: args.tipo, dados: args.dados, ator_user_id: args.atorId })
      .eq("organization_id", args.orgId)
      .eq("lead_id", args.leadId)
      .eq("user_id", args.para)
      .eq("tipo", "lead_passado")
      .gte("created_at", new Date(Date.now() - 120_000).toISOString())
      .select("id");
    if ((data ?? []).length > 0) return;
  }
  if (args.para === args.atorId) return;
  await admin
    .from("notificacoes")
    .insert({
      organization_id: args.orgId,
      user_id: args.para,
      tipo: args.tipo,
      lead_id: args.leadId,
      ator_user_id: args.atorId,
      dados: args.dados,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Move pela MESMA rota da tela (atividade, eventos); a trava de campos é do banco. */
export async function moverParaAEtapaDaPassagem(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  lead: LeadDaPassagem,
  tipo: TipoDePassagem,
): Promise<boolean> {
  const slug = ETAPA_DA_PASSAGEM[tipo];
  if (!slug) return false;
  const etapa = await etapaPorSlug(admin, lead.organization_id, lead.pipeline_id, slug);
  if (!etapa || etapa === lead.stage_id) return false;
  try {
    await moveLeadHandler(admin, ctx, lead.id, { to_stage_id: etapa, reason: "Passagem do lead" });
    return true;
  } catch (err) {
    logger.warn("[iavek-passagem] não consegui mover o lead", {
      organization_id: lead.organization_id,
      lead_id: lead.id,
      causa: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return false;
  }
}

/** O RESUMO da passagem, na linha do tempo do lead (o cartão "Passagem" lê daqui). */
export async function registrarPassagem(
  admin: SupabaseClient,
  args: {
    lead: LeadDaPassagem;
    actor: Actor;
    tipo: TipoDePassagem;
    de: string | null;
    para: string | null;
    detalhes: Record<string, unknown>;
  },
): Promise<void> {
  const porque: Record<TipoDePassagem, string> = {
    agendamento: "O SDR marcou o agendamento e passou o lead ao vendedor",
    negociar: "O SDR passou o lead ao vendedor para negociar",
    devolver: "O vendedor devolveu o lead ao guardião",
    trocar_vendedor: "O lead foi passado a outro vendedor",
    reativar: "O lead reativou e voltou ao SDR",
  };
  const r = await emitLeadActivity(admin, {
    organizationId: args.lead.organization_id,
    leadId: args.lead.id,
    contactId: args.lead.contact_id,
    type: args.tipo === "reativar" ? "iavek_reativado" : "iavek_passagem",
    sourceModule: "iavek_passagem",
    actor: args.actor,
    reason: porque[args.tipo],
    payload: { tipo: args.tipo, de: args.de, para: args.para, ...args.detalhes },
  });
  if (!r.ok) {
    logger.warn("[iavek-passagem] a passagem não foi para a linha do tempo", {
      organization_id: args.lead.organization_id,
      lead_id: args.lead.id,
      causa: r.error,
    });
  }
}

/**
 * REATIVAR (decisão do Rodrigo, 27/10): o lead do follow-up que voltou —
 * respondeu no WhatsApp (a esteira detecta) ou o SDR marcou na tela — VOLTA
 * PARA O SDR e o processo recomeça: um clone no funil de ENTRADA, na etapa de
 * entrada, com um NOVO ciclo de 72h, dono = o guardião (o SDR que já cuidava;
 * sem guardião, fica sem dono e aparece em "Chegaram agora — sem dono"). O
 * negócio do follow-up fecha, ligado ao novo (o clone da tela).
 */
export async function reativarLead(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  lead: LeadDaPassagem,
  args: { atorId: string | null; motivo: string },
): Promise<{ ok: true; novoLeadId: string; para: string | null } | { ok: false; erro: string }> {
  const { data: org } = await admin.from("organizations").select("settings").eq("id", lead.organization_id).maybeSingle();
  const entrada = entradaDaEsteira((org as { settings?: unknown } | null)?.settings);
  if (!entrada) return { ok: false, erro: "sem_funil_de_entrada" };
  const { data: funil } = await admin
    .from("crm_pipelines")
    .select("settings")
    .eq("organization_id", lead.organization_id)
    .eq("id", entrada.pipeline_id)
    .maybeSingle();
  const slugDaEntrada = (funil as { settings?: { etapa_de_entrada?: unknown } } | null)?.settings?.etapa_de_entrada;
  const etapa =
    typeof slugDaEntrada === "string" ? await etapaPorSlug(admin, lead.organization_id, entrada.pipeline_id, slugDaEntrada) : null;
  const r = await clonarLeadParaFunil(admin, ctx, lead.id, { pipeline_id: entrada.pipeline_id, stage_id: etapa });
  if (!r.ok) return { ok: false, erro: r.code };
  const novo = r.clone as { id: string };
  const guardiao = lead.sdr_user_id;
  const agora = new Date().toISOString();
  // Ciclo novo: o nascimento das 72h é AGORA (o clone pode herdar a marca do ciclo antigo).
  await admin
    .from("crm_leads")
    .update({
      source_metadata: { ...((r.clone as { source_metadata?: Record<string, unknown> }).source_metadata ?? {}), esteira_inicio: agora },
      ...(guardiao
        ? { owner_user_id: guardiao, owner_kind: "user", owner_agent_id: null, sdr_user_id: guardiao, assigned_at: agora }
        : { owner_user_id: null, owner_kind: null, owner_agent_id: null }),
    })
    .eq("organization_id", lead.organization_id)
    .eq("id", novo.id);
  const novoLead = await lerLeadDaPassagem(admin, lead.organization_id, novo.id);
  if (novoLead) {
    await registrarPassagem(admin, {
      lead: novoLead,
      actor: ctx.actor,
      tipo: "reativar",
      de: lead.owner_user_id,
      para: guardiao,
      detalhes: { motivo: args.motivo, veio_do_lead: lead.id },
    });
  }
  if (guardiao) {
    await avisoDaPassagem(admin, {
      orgId: lead.organization_id,
      leadId: novo.id,
      para: guardiao,
      atorId: args.atorId,
      tipo: "lead_reativado",
      dados: { motivo: args.motivo },
      converterOAvisoDoGatilho: true,
    });
  }
  return { ok: true, novoLeadId: novo.id, para: guardiao };
}

/** O nome do cliente para o aviso de quem PERDE o lead (ele não lê mais o lead). */
export async function nomeDoCliente(admin: SupabaseClient, orgId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await admin
    .from("contacts")
    .select("display_name, name")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  const c = data as { display_name?: string | null; name?: string | null } | null;
  return c?.display_name ?? c?.name ?? null;
}
