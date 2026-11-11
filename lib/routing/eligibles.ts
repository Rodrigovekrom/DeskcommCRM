/**
 * Carregador reutilizável de atendentes elegíveis (G5-02/G5-03 → G6-01/INB-12).
 *
 * A lógica de "quem pode receber uma conversa agora" (disponível ∧ dentro do
 * horário ∧ com folga) vivia inline no worker de roteamento. G6-01 unifica: o
 * mesmo cálculo alimenta o worker (cron), o handoff v2 (crm_request_human_handoff)
 * e o crm_get_queue_status — UM algoritmo, não três divergentes.
 *
 * O client é injetado (worker passa admin; tools MCP passam ctx.supabase admin),
 * mantendo a org-scoping explícita em toda query (service role bypassa RLS).
 */
import type { Json } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAttendantEligible, OPEN_LOAD_STATUSES } from "./eligibility";
import type { RoutingCandidate } from "./decide";
import { availabilityScheduleSchema } from "@/lib/schemas/routing";

export type RoutingScope =
  | { kind: "conversation_channel"; channelSessionId: string }
  | { kind: "organization_summary" };
export class InvalidRoutingChannel extends Error {
  constructor() { super("routing_channel_invalid"); }
}

/** Elegíveis = disponíveis ∧ dentro do horário ∧ com folga (carga < capacidade). */
export async function loadEligibleAttendants(
  supabase: SupabaseClient,
  organizationId: string,
  now: Date,
  scope: RoutingScope,
): Promise<RoutingCandidate[]> {
  let allowed: Set<string> | null = null;
  if (scope.kind === "conversation_channel") {
    const { data: channel, error: channelError } = await supabase.from("channel_sessions")
      .select("id").eq("organization_id", organizationId).eq("id", scope.channelSessionId).maybeSingle();
    if (channelError) throw new Error(channelError.message);
    if (!channel) throw new InvalidRoutingChannel();
    const { data: policy, error: policyError } = await supabase.from("channel_routing_policies")
      .select("id").eq("organization_id", organizationId).eq("channel_session_id", scope.channelSessionId).maybeSingle();
    if (policyError) throw new Error(policyError.message);
    if (policy) {
      const { data: responsibles, error } = await supabase.from("channel_routing_responsibles")
        .select("user_id").eq("organization_id", organizationId).eq("policy_id", policy.id);
      if (error) throw new Error(error.message);
      allowed = new Set((responsibles ?? []).map((r: { user_id: string }) => r.user_id));
      // Policy existente vazia é restrição explícita, não ausência de configuração.
      if (allowed.size === 0) return [];
    }
  }
  const { data: members, error: memberError } = await supabase.from("user_organizations")
    .select("user_id").eq("organization_id", organizationId).is("revoked_at", null)
    .in("role", ["agent", "manager", "admin"]);
  if (memberError) throw new Error(memberError.message);
  const active = new Set((members ?? []).map((r: { user_id: string }) => r.user_id));
  const { data: avail, error: availabilityError } = await supabase
    .from("attendant_availability").select("user_id, capacity, schedule")
    .eq("organization_id", organizationId).eq("is_available", true);
  if (availabilityError) throw new Error(availabilityError.message);
  const rows = ((avail ?? []) as Array<{ user_id: string; capacity: number; schedule: unknown }>)
    .filter((r) => active.has(r.user_id) && (allowed === null || allowed.has(r.user_id)));
  if (rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);

  // Carga atual: conversas abertas atribuídas, contadas por dono (1 query).
  const { data: openConvs, error: loadError } = await supabase
    .from("conversations")
    .select("assigned_to_user_id")
    .eq("organization_id", organizationId)
    .in("assigned_to_user_id", userIds)
    .in("status", OPEN_LOAD_STATUSES as unknown as string[]);
  if (loadError) throw new Error(loadError.message);
  const loadByUser = new Map<string, number>();
  for (const c of (openConvs ?? []) as Array<{ assigned_to_user_id: string | null }>) {
    if (c.assigned_to_user_id) {
      loadByUser.set(c.assigned_to_user_id, (loadByUser.get(c.assigned_to_user_id) ?? 0) + 1);
    }
  }

  // Última atribuição recebida (rodízio real, sem coluna de estado).
  // ia.vek v1.9.44 (0617, Lupa): antes vinham TODOS os eventos e o código ficava com o primeiro de
  // cada um. Acima do corte do servidor (3.000), quem recebeu antes dos eventos mais recentes voltava
  // como "nunca recebeu" e furava o rodízio. O rpc devolve no máximo uma linha por atendente.
  const { data: ultimas, error: historyError } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>)("fn_iavek_ultima_atribuicao", {
    p_org: organizationId,
    p_users: userIds,
    p_channel_session: scope.kind === "conversation_channel" ? scope.channelSessionId : null,
  });
  if (historyError) throw new Error(historyError.message);
  const lastAssignedByUser = new Map<string, number>();
  for (const e of (ultimas ?? []) as Array<{ to_user_id: string | null; created_at: string }>) {
    if (e.to_user_id) lastAssignedByUser.set(e.to_user_id, new Date(e.created_at).getTime());
  }

  const candidates: RoutingCandidate[] = [];
  for (const r of rows) {
    const currentLoad = loadByUser.get(r.user_id) ?? 0;
    const schedule = availabilityScheduleSchema.parse(r.schedule ?? {});
    const eligible = isAttendantEligible(
      { isAvailable: true, capacity: r.capacity, currentLoad, schedule },
      now,
    );
    if (eligible) {
      candidates.push({
        userId: r.user_id,
        currentLoad,
        scheduleSnapshot: r.schedule as Json,
        lastAssignedAt: lastAssignedByUser.get(r.user_id) ?? null,
      });
    }
  }
  return candidates;
}
