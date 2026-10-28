/**
 * /api/v1/iavek/passagem — ia.vek v1.9.4, o trajeto do lead em 72h (CRM-209).
 *
 * GET  ?lead_id=  o RESUMO para quem recebe (campos, o que falta, as últimas
 *                 passagens) e o que QUEM ESTÁ CONECTADO pode fazer com o lead.
 * POST            uma passagem: `negociar` | `devolver` | `trocar_vendedor` |
 *                 `reativar` (regras em lib/iavek/passagem.ts). A passagem por
 *                 agendamento é o "Marcar agendamento" do SDR (pedidos-de-agendamento).
 *
 * Só na loja (perfil loja de carros, fora do modo agendamento). Quem pode o
 * quê sai do VÍNCULO no banco (papel e função) e do próprio lead (dono e
 * guardião) — nunca do corpo. Service role, sempre filtrando a organização.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { funcaoDaTela } from "@/lib/iavek/funcoes";
import {
  CAMPOS_DA_PASSAGEM,
  MOTIVOS_DE_DESISTENCIA,
  camposQueFaltam,
  dentroDoPrazo,
  passagemSchema,
  podeTrocarVendedor,
} from "@/lib/iavek/passagem";
import {
  anotarCampos,
  avisoDaPassagem,
  horasDoCiclo,
  lerLeadDaPassagem,
  moverParaAEtapaDaPassagem,
  mudarDono,
  nomeDoCliente,
  nascimentoDoLead,
  reativarLead,
  registrarPassagem,
  type LeadDaPassagem,
} from "@/lib/iavek/passagem-servidor";
import { ehLojaDeCarros, lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { vendedoresDaLoja } from "@/lib/iavek/sdr-marca-direto";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";
import { SOURCE_KIND_PROXIMO_PASSO } from "@/lib/iavek/proximo-passo";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

type Autorizado = Extract<Awaited<ReturnType<typeof requireRole>>, { ok: true }>;
type Admin = ReturnType<typeof createAdminClient>;

interface Contexto {
  lead: LeadDaPassagem;
  loja: boolean;
  souAdmin: boolean;
  souGestor: boolean;
  funcao: string | null;
  dentroDas72h: boolean;
  noFollowup: boolean;
  horas: number;
}

async function contexto(admin: Admin, authz: Autorizado, leadId: string): Promise<Contexto | null> {
  const lead = await lerLeadDaPassagem(admin, authz.org.orgId, leadId);
  if (!lead) return null;
  const { data: org } = await admin.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  const settings = (org as { settings?: unknown } | null)?.settings;
  const perfil = lerPerfilDaEmpresa(settings);
  const horas = horasDoCiclo(settings);
  const followup = (settings as { esteira?: { followup?: { pipeline_id?: string } } } | null)?.esteira?.followup?.pipeline_id;
  return {
    lead,
    loja: ehLojaDeCarros(perfil) && !perfil.modo_agendamento,
    souAdmin: roleAtLeast(authz.org.role, "admin"),
    souGestor: roleAtLeast(authz.org.role, "manager"),
    funcao: funcaoDaTela(authz.org.interface_settings?.funcao),
    dentroDas72h: dentroDoPrazo(nascimentoDoLead(lead), new Date(), horas),
    noFollowup: Boolean(followup) && lead.pipeline_id === followup,
    horas,
  };
}

function permissoes(c: Contexto, eu: string) {
  const aberto = c.lead.status === "open";
  const souDono = c.lead.owner_user_id === eu;
  const souGuardiao = c.lead.sdr_user_id === eu;
  const sdr = c.funcao === "sdr" || c.funcao === "suporte";
  return {
    negociar: c.loja && aberto && !c.noFollowup && (c.souAdmin || (sdr && (souDono || souGuardiao))),
    devolver: c.loja && aberto && souDono && Boolean(c.lead.sdr_user_id) && !souGuardiao,
    trocar_vendedor:
      c.loja && aberto && Boolean(c.lead.owner_user_id) && !c.noFollowup &&
      podeTrocarVendedor({ souGuardiao, souAdmin: c.souAdmin, dentroDas72h: c.dentroDas72h }),
    reativar: c.loja && aberto && c.noFollowup && (souGuardiao || souDono || c.souGestor),
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const leadId = req.nextUrl.searchParams.get("lead_id") ?? "";
  if (!z.string().uuid().safeParse(leadId).success) return fail("validation_failed", t("Lead inválido."), 422, { requestId });
  const admin = createAdminClient();
  const c = await contexto(admin, authz, leadId);
  if (!c) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const pode = permissoes(c, authz.user.id);
  const { data: historico } = await admin
    .from("crm_lead_activities")
    .select("id, type, created_at, performed_by_user_id, payload")
    .eq("organization_id", authz.org.orgId)
    .eq("lead_id", leadId)
    .in("type", ["iavek_passagem", "iavek_reativado"])
    .order("created_at", { ascending: false })
    .limit(10);
  const linhas = (historico ?? []) as Array<{ id: string; type: string; created_at: string; performed_by_user_id: string | null; payload: Record<string, unknown> | null }>;
  const pessoas = new Set<string>();
  for (const l of linhas) {
    if (l.performed_by_user_id) pessoas.add(l.performed_by_user_id);
    for (const k of ["de", "para"]) if (typeof l.payload?.[k] === "string") pessoas.add(l.payload[k] as string);
  }
  if (c.lead.owner_user_id) pessoas.add(c.lead.owner_user_id);
  if (c.lead.sdr_user_id) pessoas.add(c.lead.sdr_user_id);
  const nomes = await nomesDosAtendentes([...pessoas]);
  const nome = (id: unknown) => (typeof id === "string" ? (nomes.get(id) ?? null) : null);
  return ok(
    {
      loja: c.loja,
      dono: { id: c.lead.owner_user_id, nome: nome(c.lead.owner_user_id) },
      guardiao: { id: c.lead.sdr_user_id, nome: nome(c.lead.sdr_user_id) },
      dentro_das_72h: c.dentroDas72h,
      fim_das_72h: new Date(Date.parse(nascimentoDoLead(c.lead)) + c.horas * 3_600_000).toISOString(),
      no_followup: c.noFollowup,
      campos: Object.fromEntries(
        [...CAMPOS_DA_PASSAGEM.map((x) => x.chave), "troca_modelo", "troca_ano"].map((k) => [k, c.lead.custom_fields?.[k] ?? null]),
      ),
      faltam: camposQueFaltam(c.lead.custom_fields),
      pode,
      vendedores: pode.negociar || pode.trocar_vendedor ? await vendedoresDaLoja(admin, authz.org.orgId) : [],
      motivos_de_desistencia: MOTIVOS_DE_DESISTENCIA,
      historico: linhas.map((l) => ({
        id: l.id,
        tipo: l.payload?.tipo ?? l.type,
        quando: l.created_at,
        quem: nome(l.performed_by_user_id),
        de: nome(l.payload?.de),
        para: nome(l.payload?.para),
        detalhes: l.payload ?? {},
      })),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const parsed = passagemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Preencha os campos da passagem."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const p = parsed.data;
  const admin = createAdminClient();
  const c = await contexto(admin, authz, p.lead_id);
  if (!c) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const eu = authz.user.id;
  const pode = permissoes(c, eu);
  const proibido = (msg: string) => fail("forbidden_role", t(msg), 403, { requestId });
  const ctx = { organization_id: authz.org.orgId, actor: { type: "user" as const, id: eu, role: authz.org.role }, requestId };
  const orgId = authz.org.orgId;
  const lead = c.lead;

  if (p.tipo === "negociar") {
    if (!pode.negociar) return proibido("Só o SDR do lead (ou o administrador) passa o lead para negociar.");
    if (!(await vendedoresDaLoja(admin, orgId)).some((v) => v.id === p.vendedor_id)) {
      return fail("validation_failed", t("Escolha um vendedor da loja."), 422, { requestId });
    }
    const campos = (await anotarCampos(admin, orgId, lead.id, p.campos)) ?? lead.custom_fields;
    const faltam = camposQueFaltam(campos);
    if (faltam.length > 0) {
      return fail("validation_failed", `${t("Faltam campos para passar o lead")}: ${faltam.map(t).join(", ")}`, 422, {
        requestId,
        details: { faltam },
      });
    }
    const guardiao = lead.sdr_user_id ?? (c.funcao === "sdr" || c.funcao === "suporte" ? eu : null);
    if (!(await mudarDono(admin, { orgId, leadId: lead.id, dono: p.vendedor_id, guardiao, atorId: eu }))) {
      return fail("internal_error", t("Não consegui passar o lead."), 500, { requestId });
    }
    await moverParaAEtapaDaPassagem(admin, ctx, { ...lead, owner_user_id: p.vendedor_id, sdr_user_id: guardiao }, "negociar");
    await criarTarefaInterna(admin, {
      organizationId: orgId,
      titulo: p.proximo_passo.o_que,
      venceEmDias: 0,
      venceEm: new Date(p.proximo_passo.quando),
      atribuirA: { usuario_id: p.vendedor_id },
      prioridade: "high",
      leadId: lead.id,
      origem: "iavek:passagem",
      sourceKind: SOURCE_KIND_PROXIMO_PASSO,
      requestId,
    });
    await registrarPassagem(admin, {
      lead,
      actor: ctx.actor,
      tipo: "negociar",
      de: eu,
      para: p.vendedor_id,
      detalhes: { campos: soOsDaPassagem(campos), contexto: p.contexto, objecao: p.objecao, proximo_passo: p.proximo_passo },
    });
    return feito(authz, requestId, lead.id, "negociar", { vendedor_id: p.vendedor_id });
  }

  if (p.tipo === "devolver") {
    if (!pode.devolver) return proibido("Só o vendedor dono do lead devolve ao guardião.");
    const guardiao = lead.sdr_user_id as string;
    if (!(await mudarDono(admin, { orgId, leadId: lead.id, dono: guardiao, guardiao, atorId: eu }))) {
      return fail("internal_error", t("Não consegui devolver o lead."), 500, { requestId });
    }
    await moverParaAEtapaDaPassagem(admin, ctx, { ...lead, owner_user_id: guardiao }, "devolver");
    await avisoDaPassagem(admin, {
      orgId,
      leadId: lead.id,
      para: guardiao,
      atorId: eu,
      tipo: "lead_devolvido",
      dados: { motivo: p.motivo },
      converterOAvisoDoGatilho: true,
    });
    await registrarPassagem(admin, {
      lead,
      actor: ctx.actor,
      tipo: "devolver",
      de: eu,
      para: guardiao,
      detalhes: { motivo: p.motivo, feito: p.feito, proximo_passo_sugerido: p.proximo_passo_sugerido },
    });
    return feito(authz, requestId, lead.id, "devolver", { motivo: p.motivo });
  }

  if (p.tipo === "trocar_vendedor") {
    if (!pode.trocar_vendedor) {
      return proibido(
        c.dentroDas72h
          ? "Só o guardião do lead (ou o administrador) troca o vendedor."
          : "Depois das 72h, só o administrador troca o vendedor.",
      );
    }
    if (p.vendedor_id === lead.owner_user_id) return fail("validation_failed", t("O lead já está com este vendedor."), 422, { requestId });
    if (!(await vendedoresDaLoja(admin, orgId)).some((v) => v.id === p.vendedor_id)) {
      return fail("validation_failed", t("Escolha um vendedor da loja."), 422, { requestId });
    }
    const anterior = lead.owner_user_id as string;
    if (!(await mudarDono(admin, { orgId, leadId: lead.id, dono: p.vendedor_id, guardiao: lead.sdr_user_id, atorId: eu }))) {
      return fail("internal_error", t("Não consegui trocar o vendedor."), 500, { requestId });
    }
    // Quem perdeu o lead fica sabendo, com o motivo.
    await avisoDaPassagem(admin, {
      orgId,
      leadId: lead.id,
      para: anterior,
      atorId: eu,
      tipo: "lead_retirado",
      dados: { motivo: p.motivo, contato_nome: await nomeDoCliente(admin, orgId, lead.contact_id) },
      converterOAvisoDoGatilho: false,
    });
    await registrarPassagem(admin, {
      lead,
      actor: ctx.actor,
      tipo: "trocar_vendedor",
      de: anterior,
      para: p.vendedor_id,
      detalhes: { motivo: p.motivo, campos: soOsDaPassagem(lead.custom_fields) },
    });
    return feito(authz, requestId, lead.id, "trocar_vendedor", { de: anterior, para: p.vendedor_id, motivo: p.motivo });
  }

  // reativar
  if (!pode.reativar) return proibido("Só o guardião, o dono ou a gestão reativam um lead do follow-up.");
  const r = await reativarLead(admin, ctx, lead, { atorId: eu, motivo: p.motivo ?? "Reativado na tela" });
  if (!r.ok) return fail("state_conflict", t("Não consegui reativar o lead."), 409, { requestId, details: { causa: r.erro } });
  return feito(authz, requestId, lead.id, "reativar", { novo_lead_id: r.novoLeadId, para: r.para });
}

/** No resumo vão só os 7 campos da passagem (nada de outros dados do negócio). */
function soOsDaPassagem(campos: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const c = campos ?? {};
  return Object.fromEntries(
    [...CAMPOS_DA_PASSAGEM.map((x) => x.chave), "troca_modelo", "troca_ano"].filter((k) => k in c).map((k) => [k, c[k]]),
  );
}

function feito(authz: Autorizado, requestId: string, leadId: string, tipo: string, metadata: Record<string, unknown>) {
  void audit({
    action: "iavek.lead_passagem",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_leads",
    resourceId: leadId,
    requestId,
    metadata: { tipo, ...metadata },
  });
  return ok({ lead_id: leadId, tipo, ...metadata }, { requestId });
}
