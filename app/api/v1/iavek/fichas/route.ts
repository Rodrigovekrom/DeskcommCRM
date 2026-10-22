/**
 * /api/v1/iavek/fichas — ia.vek v1.7.8 (Passar Ficha).
 *
 * POST  o vendedor envia a ficha do PRÓPRIO lead: `{ lead_id, dados }`. Os
 *       dados são conferidos contra os campos do admin; a resposta de erro
 *       nomeia o CAMPO, nunca o valor.
 * GET   a lista, sem os dados:
 *         - analista: a fila da organização (`?status=`);
 *         - admin: todas;
 *         - vendedor: as dos leads dele (`?lead_id=` filtra um lead);
 *         - gerente: SÓ o status, por lead (padrão aprovado).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { conferirDados, lerCamposDaFicha, quemNaFicha, STATUS_DA_FICHA } from "@/lib/iavek/fichas";
import { analistasDaOrg, avisar, semAcesso } from "@/lib/iavek/fichas-servidor";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const envioSchema = z.object({ lead_id: z.uuid(), dados: z.record(z.string(), z.unknown()) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const t = (s: string) => traduzir(s, quem.idioma);
  if (quem.analista || quem.suporteSoLeitura || quem.role === null || quem.role === "viewer") return semAcesso(quem, requestId);

  const corpo = envioSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("crm_leads")
    .select("id, owner_user_id, contact_id, status")
    .eq("organization_id", quem.orgId)
    .eq("id", corpo.data.lead_id)
    .maybeSingle();
  if (!lead) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  // O vendedor só passa ficha de lead DELE; o admin, de qualquer um.
  if (!quem.admin && lead.owner_user_id !== quem.userId) {
    return fail("forbidden", t("Só o vendedor dono do lead passa a ficha dele."), 403, { requestId });
  }
  if (!lead.contact_id) return fail("validation_failed", t("O lead precisa ter um cliente."), 422, { requestId });

  const { data: org } = await admin.from("organizations").select("settings").eq("id", quem.orgId).maybeSingle();
  const campos = lerCamposDaFicha(org?.settings);
  const { dados, problemas } = conferirDados(campos, corpo.data.dados);
  if (problemas.length > 0) {
    return fail("validation_failed", t("A ficha tem campos a corrigir."), 422, { requestId, details: { problemas } });
  }

  const { data: ficha, error } = await admin
    .from("iavek_fichas")
    .insert({
      organization_id: quem.orgId,
      lead_id: lead.id,
      contact_id: lead.contact_id,
      enviada_por: quem.userId,
      status: "enviada",
      dados,
      campos,
    })
    .select("id")
    .single();
  if (error || !ficha) return fail("internal_error", t("Não consegui gravar a ficha."), 500, { requestId });

  void avisar(quem.orgId, await analistasDaOrg(quem.orgId), "ficha_enviada", lead.id, quem.userId);
  // Auditoria SEM dados: só ids.
  void audit({
    action: "iavek.ficha_enviada",
    actorUserId: quem.userId,
    organizationId: quem.orgId,
    resourceType: "iavek_fichas",
    resourceId: ficha.id,
    requestId,
    metadata: { lead_id: lead.id },
  });
  return ok({ id: ficha.id, status: "enviada" }, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  if (!quem.analista && (quem.role === null || quem.role === "viewer")) return semAcesso(quem, requestId);

  const leadId = req.nextUrl.searchParams.get("lead_id");
  const status = req.nextUrl.searchParams.get("status");
  const admin = createAdminClient();
  let consulta = admin
    .from("iavek_fichas")
    .select("id, lead_id, enviada_por, status, motivo, decidida_em, created_at, updated_at, crm_leads(owner_user_id, title), contacts(name, display_name)")
    .eq("organization_id", quem.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (leadId && z.uuid().safeParse(leadId).success) consulta = consulta.eq("lead_id", leadId);
  if (status && (STATUS_DA_FICHA as readonly string[]).includes(status)) consulta = consulta.eq("status", status);
  const { data, error } = await consulta;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  type Linha = {
    id: string;
    lead_id: string | null;
    enviada_por: string | null;
    status: string;
    motivo: string | null;
    decidida_em: string | null;
    created_at: string;
    updated_at: string;
    crm_leads?: unknown;
    contacts?: unknown;
  };
  const um = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null | undefined;
  let linhas = ((data ?? []) as unknown as Linha[]).map((l) => {
    const lead = um<{ owner_user_id: string | null; title: string | null }>(l.crm_leads);
    const contato = um<{ name: string | null; display_name: string | null }>(l.contacts);
    return { ...l, dono_do_lead: lead?.owner_user_id ?? null, titulo_do_lead: lead?.title ?? null, contato };
  });
  // Vendedor/SDR: só as dos leads dele (ou que ele enviou).
  if (!quem.analista && !quem.admin && !quem.gerente) {
    linhas = linhas.filter((l) => l.dono_do_lead === quem.userId || l.enviada_por === quem.userId);
  }
  const nomes = await nomesDosAtendentes(linhas.map((l) => l.enviada_por));
  const verMotivo = (l: (typeof linhas)[number]) =>
    quem.analista || quem.admin || l.dono_do_lead === quem.userId || l.enviada_por === quem.userId;

  return ok(
    linhas.map((l) => ({
      id: l.id,
      lead_id: l.lead_id,
      titulo_do_lead: l.titulo_do_lead,
      cliente: nomeDoContato(l.contato),
      status: l.status,
      // O gerente vê o status; o motivo é texto da analista sobre a pessoa.
      motivo: verMotivo(l) ? l.motivo : null,
      enviada_por: l.enviada_por,
      enviada_por_nome: l.enviada_por ? (nomes.get(l.enviada_por) ?? null) : null,
      decidida_em: l.decidida_em,
      created_at: l.created_at,
    })),
    { requestId },
  );
}
