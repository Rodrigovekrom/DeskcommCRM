/**
 * GET /api/v1/iavek/notas/painel — ia.vek v1.8.4. Gerente e admin.
 * No Meu dia: média dos últimos 7 dias por vendedor e as 5 piores notas, com
 * link para a conversa. Chave desligada: `{ ativo: false }`.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerConfigDaNota } from "@/lib/iavek/nota-do-atendimento";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { data: org } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (!lerConfigDaNota(org?.settings).ativo) return ok({ ativo: false, vendedores: [], piores: [] }, { requestId });

  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("iavek_notas_de_atendimento")
    .select("id, conversation_id, vendedor_user_id, nota, pontos_a_melhorar, created_at")
    .eq("organization_id", authz.org.orgId)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const notas = (data ?? []) as Array<{
    id: string;
    conversation_id: string;
    vendedor_user_id: string | null;
    nota: number | string;
    pontos_a_melhorar: string[] | null;
    created_at: string;
  }>;

  const porVendedor = new Map<string, { soma: number; n: number }>();
  for (const n of notas) {
    if (!n.vendedor_user_id) continue;
    const v = porVendedor.get(n.vendedor_user_id) ?? { soma: 0, n: 0 };
    v.soma += Number(n.nota);
    v.n += 1;
    porVendedor.set(n.vendedor_user_id, v);
  }
  const piores = [...notas].sort((a, b) => Number(a.nota) - Number(b.nota)).slice(0, 5);
  const nomes = await nomesDosAtendentes([
    ...new Set([...porVendedor.keys(), ...piores.map((p) => p.vendedor_user_id).filter((x): x is string => !!x)]),
  ]);
  return ok(
    {
      ativo: true,
      vendedores: [...porVendedor.entries()]
        .map(([id, v]) => ({ vendedor_id: id, nome: nomes.get(id) ?? null, media: Math.round((v.soma / v.n) * 10) / 10, atendimentos: v.n }))
        .sort((a, b) => a.media - b.media),
      piores: piores.map((p) => ({
        id: p.id,
        conversation_id: p.conversation_id,
        vendedor: p.vendedor_user_id ? (nomes.get(p.vendedor_user_id) ?? null) : null,
        nota: Number(p.nota),
        a_melhorar: (p.pontos_a_melhorar ?? [])[0] ?? null,
        created_at: p.created_at,
      })),
    },
    { requestId },
  );
}
