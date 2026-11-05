import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const JANELA_MS = 7 * 86_400_000;

/**
 * ia.vek v1.9.20 (CRM-234): os avisos de venda que esta pessoa ainda não viu em pop-up.
 * Só nome de quem vendeu e nome do carro: nunca cliente, lead ou valor.
 */
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notificacoes" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notificacoes")
    .select("id, ator_user_id, dados, created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("tipo", "aviso_da_loja")
    .eq("dados->>evento", "venda")
    .is("popup_visto_em", null)
    .gte("created_at", new Date(Date.now() - JANELA_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const linhas = (data ?? []) as Array<{
    id: string;
    ator_user_id: string | null;
    dados: { carro_nome?: string | null } | null;
  }>;
  const nomes = await nomesDosAtendentes(linhas.map((l) => l.ator_user_id));
  return ok(
    {
      avisos: linhas.map((l) => ({
        id: l.id,
        quem: l.ator_user_id ? (nomes.get(l.ator_user_id) ?? null) : null,
        carro: l.dados?.carro_nome ?? null,
      })),
    },
    { requestId },
  );
}

const vistosSchema = z.strictObject({ ids: z.array(z.string().uuid()).min(1).max(50) });

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notificacoes" });
  if (!authz.ok) return authz.response;
  const parsed = vistosSchema.safeParse((await req.json().catch(() => ({}))) as unknown);
  if (!parsed.success) return fail("validation_error", "Envie { ids: uuid[] }.", 422, { requestId });
  const supabase = await createClient();
  const { error } = await supabase
    .from("notificacoes")
    .update({ popup_visto_em: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .is("popup_visto_em", null)
    .in("id", parsed.data.ids);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  // Igual a marcar como lida: preferência de tela da própria pessoa, sem auditoria.
  return ok({ marcados: true }, { requestId });
}
