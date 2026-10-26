/**
 * GET /api/v1/iavek/notas?conversation_id=… — ia.vek v1.8.4. Gerente e admin.
 * As notas do atendimento daquela conversa, da mais nova para a mais velha.
 * A RLS de `iavek_notas_de_atendimento` também barra o vendedor (client da sessão).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("conversation_id"));
  if (!id.success) return fail("validation_failed", "conversation_id inválido.", 422, { requestId });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("iavek_notas_de_atendimento")
    .select("id, nota, pontos_fortes, pontos_a_melhorar, trecho, etapa_nome, vendedor_user_id, mensagens_avaliadas, created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("conversation_id", id.data)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}
