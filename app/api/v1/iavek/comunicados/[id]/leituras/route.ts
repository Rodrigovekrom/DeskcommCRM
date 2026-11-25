/**
 * GET /api/v1/iavek/comunicados/[id]/leituras — quem leu, quando, e quem não leu (só gestor; ia.vek CRM-439, 0651).
 *
 * O Y é o RETRATO do envio (`iavek_comunicados_destinatarios`): quem entrou na função depois não conta, e quem saiu da
 * loja segue na conta. Cliente da SESSÃO (a RLS da 0651) com `organization_id` à mão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { contagemDeLeitura } from "@/lib/iavek/comunicados";
import { lerTudo } from "@/lib/supabase/paginas";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "iavek_comunicados_lidos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("not_found", t("Comunicado não encontrado."), 404, { requestId });
  const orgId = authz.org.orgId;
  const db = await createClient();
  const { data: comunicado, error } = await db
    .from("iavek_comunicados")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!comunicado) return fail("not_found", t("Comunicado não encontrado."), 404, { requestId });
  const dest = await lerTudo<{ user_id: string; funcao_no_envio: string | null }>((de, ate) =>
    db
      .from("iavek_comunicados_destinatarios")
      .select("user_id, funcao_no_envio")
      .eq("organization_id", orgId)
      .eq("comunicado_id", id)
      .range(de, ate),
  );
  if (dest.error) return fail("internal_error", dest.error.message, 500, { requestId });
  const lidos = await lerTudo<{ user_id: string; lida_em: string }>((de, ate) =>
    db
      .from("iavek_comunicados_lidos")
      .select("user_id, lida_em")
      .eq("organization_id", orgId)
      .eq("comunicado_id", id)
      .range(de, ate),
  );
  if (lidos.error) return fail("internal_error", lidos.error.message, 500, { requestId });
  const lidaEm = new Map(lidos.data.map((l) => [l.user_id, l.lida_em]));
  const nomes = await nomesDosAtendentes(dest.data.map((d) => d.user_id));
  const pessoas = dest.data
    .map((d) => ({
      user_id: d.user_id,
      nome: nomes.get(d.user_id) ?? null,
      funcao_no_envio: d.funcao_no_envio,
      lida_em: lidaEm.get(d.user_id) ?? null,
    }))
    .sort(
      (a, b) =>
        Number(a.lida_em !== null) - Number(b.lida_em !== null) ||
        (a.nome ?? "").localeCompare(b.nome ?? ""),
    );
  return ok(
    { id, leitura: contagemDeLeitura(dest.data.length, lidaEm.size), pessoas },
    { requestId },
  );
}
