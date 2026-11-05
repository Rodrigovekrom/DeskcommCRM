/**
 * /api/v1/iavek/pipeline/faixa-de-ajuda — ia.vek v1.9.21 (0609), Guardião Leads.
 *
 * GET  os leads em Suporte IA, abertos e sem dono. Quem não é guardião recebe a lista vazia.
 * POST `{ lead_id }`: o guardião assume. Quem chega depois recebe 409.
 *
 * Quem decide é o banco: com `guardiao_ve_sem_dono = false`, a RLS não mostra lead sem dono
 * ao guardião, e esta faixa é a única exceção.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ lead_id: z.uuid() }).strict();

type LinhaDaFaixa = { lead_id: string; titulo: string; cliente: string | null; desde: string; total: number };

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_iavek_faixa_de_ajuda", { p_org: authz.org.orgId });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const linhas = (data ?? []) as unknown as LinhaDaFaixa[];
  return ok(
    {
      total: linhas[0]?.total ?? 0,
      itens: linhas.map((l) => ({ id: l.lead_id, titulo: l.titulo, cliente: l.cliente, desde: l.desde })),
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
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const supabase = await createClient();
  const { data: conversa, error } = await supabase.rpc("fn_iavek_assumir_da_faixa", {
    p_lead: corpo.data.lead_id,
  });
  if (error) {
    const texto = error.message ?? "";
    if (texto.startsWith("faixa_so_guardiao")) {
      return fail("forbidden", t("Só o guardião assume por aqui."), 403, { requestId });
    }
    if (texto.startsWith("faixa_ja_entregue")) {
      return fail("state_conflict", t("Este lead já foi entregue."), 409, { requestId });
    }
    if (texto.startsWith("faixa_conversa_de_outro")) {
      return fail("state_conflict", t("A conversa deste cliente já é de outra pessoa."), 409, { requestId });
    }
    return fail("internal_error", texto, 500, { requestId });
  }
  const conversaId = (conversa as string | null) ?? null;
  if (conversaId) {
    const { data: c } = await supabase
      .from("conversations")
      .select("contact_id")
      .eq("organization_id", authz.org.orgId)
      .eq("id", conversaId)
      .maybeSingle();
    if (c?.contact_id) {
      await registrarTrocaDeComando({
        supabase,
        organizationId: authz.org.orgId,
        conversationId: conversaId,
        contactId: c.contact_id,
        tipo: "conversation_claimed",
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        motivo: "Assumiu pela faixa de pedidos de ajuda",
      });
    }
  }
  void audit({
    action: "iavek.lead_assumido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_leads",
    resourceId: corpo.data.lead_id,
    requestId,
    metadata: { caminho: "faixa_de_ajuda" },
  });
  return ok({ lead_id: corpo.data.lead_id, conversation_id: conversaId }, { requestId });
}
