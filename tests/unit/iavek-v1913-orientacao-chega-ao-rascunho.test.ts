import { beforeEach, describe, expect, it, vi } from "vitest";

/** A orientação da conversa chega ao texto que a IA recebe, e só a desta conversa é pedida. */
const preview = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/agent-engine/agent/inbound-turn", () => ({
  latestCheckpoint: async () => null,
  runAgentPreview: preview,
}));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: async () => ({ ok: true, context: { contact: { is_blocked: false } }, lgpd: { isAnonymized: false } }),
}));
vi.mock("@/lib/agent-engine/agent/fuso-da-org", () => ({ fusoDaOrganizacao: async () => "America/Sao_Paulo" }));
vi.mock("@/lib/atendimento/fronteira", () => ({
  parseServiceBoundary: (x: unknown) => x,
  assertCurrentServiceBoundary: () => undefined,
}));
vi.mock("@/lib/atendimento/fronteira-server", () => ({
  readCurrentServiceBoundary: async () => ({}),
  withServiceBoundary: async (_p: unknown, _b: unknown, f: () => unknown) => f(),
}));

const ORG = "00000000-0000-4000-8000-000000000001";
const CONV = "00000000-0000-4000-8000-000000000002";
const ID = "00000000-0000-4000-8000-000000000003";
const AG = { agentId: "a", versionId: "00000000-0000-4000-8000-000000000004", historyMessageWindow: 5, historyTokenWindow: 100 };

describe("v1.9.13 — a orientação chega ao rascunho", () => {
  beforeEach(() => preview.mockClear());

  it("entra no que a IA recebe, e a consulta é da conversa", async () => {
    const consultas: Array<{ sql: string; args: unknown[] }> = [];
    const pool = {
      query: async (sql: string, args: unknown[] = []) => {
        consultas.push({ sql, args });
        if (sql.includes("fn_reply_begin")) {
          return { rows: [{ id: ID, status: "generating", revision: "1", generation_token: args[4], original_body: null, agent_version_id: AG.versionId, service_boundary: {} }] };
        }
        if (sql.includes("iavek_orientacoes_da_ia")) return { rows: [{ texto: "ofereça o test-drive" }] };
        if (sql.includes("update ai_reply_drafts")) {
          return { rows: [{ id: ID, status: "failed", revision: "2", generation_token: args[2], original_body: "", agent_version_id: AG.versionId, service_boundary: {} }] };
        }
        return { rows: [] };
      },
    };
    const { generateReplyDraft } = await import("@/lib/agent-engine/agent/reply-drafts");
    await generateReplyDraft(pool as never, { crmCfg: {} } as never, {
      organizationId: ORG,
      conversationId: CONV,
      contactId: "c",
      channelId: "s",
      agent: AG as never,
    });
    const recebido = (preview.mock.calls[0] as unknown[])[2] as { feedback: string };
    expect(recebido.feedback).toContain("ofereça o test-drive");
    expect(recebido.feedback).toContain("Vale só para esta conversa");
    const leitura = consultas.find((c) => c.sql.includes("iavek_orientacoes_da_ia"));
    expect(leitura?.args).toEqual([ORG, CONV]);
  });
});
