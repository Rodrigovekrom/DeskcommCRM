/**
 * GET /api/v1/team/invites — convites da organização ativa (migration 0238).
 *
 * O que a aba "Membros" da tela de Equipe não mostrava: convite enviado,
 * pendente, expirado ou revogado — e se o e-mail chegou a sair. Manager+ lê
 * (RLS `team_invites_select`); as ações (reenviar / revogar) são admin.
 *
 * `status` é derivado aqui, não vem do banco. `accept_url` só acompanha convite
 * em aberto (pendente/expirado) — é o link copiável que o admin usa quando o
 * e-mail não saiu.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { EntregaDoConvite } from "@/lib/email/entrega-na-tela";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  conviteEstaEmAberto,
  linkDeAceite,
  statusConvite,
  type ConviteDeTime,
} from "@/lib/team/convites";

export const dynamic = "force-dynamic";

/**
 * ia.vek v1.9.47 (0627): a entrega mais recente de cada convite. A tabela é só do servidor (RLS sem policy), então
 * a leitura é pelo admin client, SEMPRE filtrada pela organização ativa (e por tipo e pelos ids desta lista). Um
 * erro aqui não derruba a lista: a tela só deixa de mostrar a entrega.
 */
async function entregasDosConvites(orgId: string, ids: string[]): Promise<Map<string, EntregaDoConvite>> {
  const mapa = new Map<string, EntregaDoConvite>();
  if (ids.length === 0) return mapa;
  const { data, error } = await createAdminClient()
    .from("iavek_entregas_de_email")
    .select("recurso_id, estado, detalhe, enviado_em")
    .eq("organization_id", orgId)
    .eq("tipo", "team_invite")
    .in("recurso_id", ids.slice(0, 500))
    .order("enviado_em", { ascending: false });
  if (error || !data) return mapa;
  for (const r of data as Array<{ recurso_id: string; estado: EntregaDoConvite["estado"]; detalhe: string | null }>) {
    if (!mapa.has(r.recurso_id)) mapa.set(r.recurso_id, { estado: r.estado, detalhe: r.detalhe });
  }
  return mapa;
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("team_invites")
    .select(
      "id, organization_id, email, role, interface_settings, invited_by, inviter_name, email_dispatched, created_at, last_sent_at, resend_count, expires_at, accepted_at, revoked_at",
    )
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const now = Date.now();
  const lista = (rows ?? []) as ConviteDeTime[];
  const entregas = await entregasDosConvites(activeOrg.orgId, lista.map((r) => r.id));
  const invites = lista.map((row) => {
    const status = statusConvite(row, now);
    return {
      ...row,
      status,
      accept_url: conviteEstaEmAberto(row, now) ? linkDeAceite(row) : null,
      // ia.vek v1.9.47 (0627): a entrega do ÚLTIMO e-mail deste convite (o webhook da Resend), ou null
      entrega: entregas.get(row.id) ?? null,
    };
  });

  return ok(invites, { requestId });
}
