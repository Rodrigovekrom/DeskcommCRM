import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET/PATCH /api/v1/admin/tenants/[id]/perfil-iavek — ia.vek v1.9.0.
 *
 * O PERFIL DA EMPRESA (`settings.iavek.perfil`): loja de carros ou clínica, e o
 * modo agendamento. Só o admin da PLATAFORMA lê e grava (escrita com scope
 * full + MFA, como suspender): é decisão de quem monta a instalação, e o admin
 * da organização não muda o tipo da própria empresa por engano.
 *
 * Guarda: a organização que recebe o estoque do Altimus não deixa de ser loja
 * de carros — desligue a chave do estoque primeiro.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import {
  falhaDaEscritaDePlatformAdmin,
  requirePlatformAdmin,
  requirePlatformAdminEscrita,
  type PlatformAdminContext,
} from "@/lib/auth/requirePlatformAdmin";
import { altimusDaOrg } from "@/lib/estoque/org-dona";
import {
  comPerfilDaEmpresa,
  ehLojaDeCarros,
  lerPerfilDaEmpresa,
  perfilDaEmpresaSchema,
} from "@/lib/iavek/perfil-da-empresa";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

async function lerOrg(id: string) {
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("id, settings")
    .eq("id", id)
    .maybeSingle();
  return error ? "erro" : ((data as { id: string; settings: unknown } | null) ?? null);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const org = await lerOrg((await params).id);
  if (org === "erro") return fail("internal_error", "Não consegui ler a organização.", 500, { requestId });
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });
  return ok({ perfil: lerPerfilDaEmpresa(org.settings), recebe_estoque: altimusDaOrg(org.settings)?.ativa === true }, { requestId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: tenantId } = await params;
  const supportDenied = await requireSupportWrite(tenantId);
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();

  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const parsed = perfilDaEmpresaSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) {
    return fail("validation_error", "Envie { nicho: 'loja_de_carros' | 'clinica', modo_agendamento: boolean }.", 422, { requestId });
  }

  const org = await lerOrg(tenantId);
  if (org === "erro") return fail("internal_error", "Não consegui ler a organização.", 500, { requestId });
  if (!org) return fail("not_found", "Tenant not found", 404, { requestId });

  if (!ehLojaDeCarros(parsed.data) && altimusDaOrg(org.settings)?.ativa === true) {
    return fail(
      "state_conflict",
      "Esta organização recebe o estoque do Altimus. Desligue \"Estoque Altimus\" nela antes de mudar o tipo de empresa.",
      409,
      { requestId },
    );
  }

  const antes = lerPerfilDaEmpresa(org.settings);
  const { error } = await createAdminClient()
    .from("organizations")
    .update({ settings: comPerfilDaEmpresa(org.settings, parsed.data) })
    .eq("id", tenantId);
  if (error) return fail("internal_error", "Não deu para salvar.", 500, { requestId });

  await audit({
    action: "iavek.perfil_da_empresa_changed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: tenantId,
    resourceType: "organization",
    resourceId: tenantId,
    requestId,
    metadata: { antes, depois: parsed.data },
  });

  return ok({ perfil: parsed.data, recebe_estoque: altimusDaOrg(org.settings)?.ativa === true }, { requestId });
}
