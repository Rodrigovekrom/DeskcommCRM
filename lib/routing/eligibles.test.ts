import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEligibleAttendants } from "./eligibles";

function fixture(over: Record<string, unknown> = {}) {
  const filters: Array<[string, string, unknown]> = [];
  // v1.9.44 (0617): a última atribuição vem do rpc fn_iavek_ultima_atribuicao.
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rows: Record<string, unknown> = {
    channel_sessions: { id: "channel" }, channel_routing_policies: null,
    channel_routing_responsibles: [], user_organizations: [{ user_id: "ana" }],
    attendant_availability: [{ user_id: "ana", capacity: 2, schedule: {} }],
    conversations: [], conversation_assignment_events: [], ...over,
  };
  const db = { rpc(fn: string, args: Record<string, unknown>) {
    rpcs.push({ fn, args });
    const r = rows.ultimas_atribuicoes ?? [];
    return Promise.resolve(r instanceof Error ? { data: null, error: r } : { data: r, error: null });
  }, from(table: string) {
    const q = {
      select() { return q; }, order() { return q; },
      eq(key: string, value: unknown) { filters.push([table, key, value]); return q; },
      is(key: string, value: unknown) { filters.push([table, key, value]); return q; },
      in(key: string, value: unknown) { filters.push([table, key, value]); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[table], error: null }); },
      then(resolve: (x: unknown) => unknown) {
        return Promise.resolve(rows[table] instanceof Error
          ? { data: null, error: rows[table] }
          : { data: rows[table], error: null }).then(resolve);
      },
    }; return q;
  } } as unknown as SupabaseClient;
  return { db, filters, rpcs };
}
const scope = { kind: "conversation_channel", channelSessionId: "channel" } as const;
const now = new Date("2026-09-06T15:00:00Z");
describe("elegibilidade com origem explícita", () => {
  it("política vazia não cai no conjunto legado", async () => {
    const { db } = fixture({ channel_routing_policies: { id: "policy" } });
    expect(await loadEligibleAttendants(db, "org", now, scope)).toEqual([]);
  });
  it("membro revogado não recebe mesmo com disponibilidade legada", async () => {
    const { db } = fixture({ user_organizations: [] });
    expect(await loadEligibleAttendants(db, "org", now, scope)).toEqual([]);
  });
  it("capacidade é global e histórico é apenas do canal, com org nas duas tabelas", async () => {
    const { db, filters, rpcs } = fixture();
    expect(await loadEligibleAttendants(db, "org", now, scope)).toMatchObject([{ userId: "ana" }]);
    // v1.9.44: o histórico do canal vai pelo rpc, com a organização e o canal (o rpc filtra
    // e.organization_id, c.organization_id e c.channel_session_id).
    expect(rpcs).toEqual([{ fn: "fn_iavek_ultima_atribuicao", args: { p_org: "org", p_users: ["ana"], p_channel_session: "channel" } }]);
    expect(filters).not.toContainEqual(["conversations", "channel_session_id", "channel"]);
  });
  it("resumo global não consulta política", async () => {
    const { db, filters } = fixture();
    await loadEligibleAttendants(db, "org", now, { kind: "organization_summary" });
    expect(filters.some(([table]) => table === "channel_routing_policies")).toBe(false);
  });
  it("v1.9.44: resumo global pede o histórico sem canal (p_channel_session = null)", async () => {
    const { db, rpcs } = fixture();
    await loadEligibleAttendants(db, "org", now, { kind: "organization_summary" });
    expect(rpcs[0]?.args).toMatchObject({ p_org: "org", p_channel_session: null });
  });
  it("v1.9.44: a última atribuição de cada um vem do rpc (uma linha por atendente)", async () => {
    const { db } = fixture({
      user_organizations: [{ user_id: "ana" }, { user_id: "bia" }],
      attendant_availability: [
        { user_id: "ana", capacity: 2, schedule: {} },
        { user_id: "bia", capacity: 2, schedule: {} },
      ],
      ultimas_atribuicoes: [{ to_user_id: "ana", created_at: "2026-09-06T14:00:00Z" }],
    });
    const r = await loadEligibleAttendants(db, "org", now, scope);
    expect(r.find((c) => c.userId === "ana")?.lastAssignedAt).toBe(Date.parse("2026-09-06T14:00:00Z"));
    expect(r.find((c) => c.userId === "bia")?.lastAssignedAt).toBeNull();
  });
  it("v1.9.44: erro no rpc do histórico não vira 'ninguém recebeu'", async () => {
    const { db } = fixture({ ultimas_atribuicoes: new Error("rpc fora") });
    await expect(loadEligibleAttendants(db, "org", now, scope)).rejects.toThrow("rpc fora");
  });
  it("canal inexistente não autoriza fallback", async () => {
    const { db } = fixture({ channel_sessions: null });
    await expect(loadEligibleAttendants(db, "org", now, scope)).rejects.toThrow("routing_channel_invalid");
  });
  it("erro de banco não vira sem elegível", async () => {
    const { db } = fixture({ attendant_availability: new Error("offline") });
    await expect(loadEligibleAttendants(db, "org", now, scope)).rejects.toThrow("offline");
  });
});
