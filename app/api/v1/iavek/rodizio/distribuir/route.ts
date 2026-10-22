/**
 * POST /api/v1/iavek/rodizio/distribuir — ia.vek v1.7.7. Só o admin.
 * Corpo: `{ confirmar: boolean }`.
 *
 * Distribui pelo rodízio os leads ANTIGOS sem dono do funil padrão.
 * `confirmar: false` é a PRÉVIA (quantos para cada um, nada muda);
 * `confirmar: true` entrega — contato que já tem dono vai para o mesmo dono.
 * A regra mora no banco (`fn_iavek_rodizio_distribuir`, migration 0585), numa
 * transação só; cada entrega fica em `iavek_rodizio_registros`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ confirmar: z.boolean() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fn_iavek_rodizio_distribuir", {
    p_org: authz.org.orgId,
    p_por: authz.user.id,
    p_confirmar: corpo.data.confirmar,
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const linhas = (data ?? []) as Array<{ user_id: string; quantidade: number; mesmo_dono: number }>;
  const nomes = await nomesDosAtendentes(linhas.map((l) => l.user_id));
  const porPessoa = linhas
    .map((l) => ({ ...l, nome: nomes.get(l.user_id) ?? null }))
    .sort((a, b) => b.quantidade + b.mesmo_dono - (a.quantidade + a.mesmo_dono));
  const total = porPessoa.reduce((s, l) => s + l.quantidade + l.mesmo_dono, 0);

  if (corpo.data.confirmar) {
    void audit({
      action: "iavek.rodizio_distribuido",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "crm_leads",
      requestId,
      metadata: { total, por_pessoa: porPessoa.map(({ user_id, quantidade, mesmo_dono }) => ({ user_id, quantidade, mesmo_dono })) },
    });
  }
  return ok({ confirmado: corpo.data.confirmar, total, por_pessoa: porPessoa }, { requestId });
}
