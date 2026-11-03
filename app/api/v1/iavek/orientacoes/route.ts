/** GET /api/v1/iavek/orientacoes — a fila da revisão semanal (gerente e admin; ia.vek v1.9.13). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "iavek_orientacoes_da_ia" });
  if (!authz.ok) return authz.response;
  const todas = req.nextUrl.searchParams.get("todas") === "1";
  const db = await createClient();
  let q = db
    .from("iavek_orientacoes_da_ia")
    .select("id, conversation_id, autor_user_id, texto, revisao, revisada_em, criada_em")
    .eq("organization_id", authz.org.orgId)
    .order("criada_em", { ascending: false })
    .limit(200);
  if (!todas) q = q.is("revisao", null);
  const { data, error } = await q;
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const nomes = await nomesDosAtendentes((data ?? []).map((o) => o.autor_user_id as string | null));
  return ok(
    { orientacoes: (data ?? []).map((o) => ({ ...o, autor_nome: o.autor_user_id ? (nomes.get(o.autor_user_id as string) ?? null) : null })) },
    { requestId },
  );
}
