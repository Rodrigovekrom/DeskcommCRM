/**
 * v1.9.52.4 (Maestro 071802; desenho aprovado pela Lupa 052617; os 4 casos da Lupa 052543): "Abrir conversa" pela
 * tela recusa a conversa de OUTRA pessoa que o chamador não vê. Por quê: abrir reabre a conversa fechada, e ao
 * reabrir o banco ZERA o dono (fn_service_stamp_status); medido na prova 2 da 52.3 (o SDR de antes reabriu a
 * conversa do SDR de Follow-up e ela ficou sem dono, visível à fila).
 *
 *   (1) o DONO abre: segue como hoje;
 *   (2) o GERENTE/ADMIN (vê a conversa de outra pessoa) abre: segue como hoje;
 *   (3) a conversa SEM dono: o SDR abre e reabre como hoje;
 *   (4) a conversa de OUTRA pessoa que o chamador NÃO vê: "conversation_of_other" (403 na rota), SEM chamar o
 *       fn_service_begin, então nada é reaberto e o chamador NÃO vira dono;
 *   (5) a conversa muda entre a conferência e a abertura (service_stale, 40001): "conversation_stale" (409).
 * E: sem chamador (tool MCP, token de API) segue exatamente como antes (sem conferência, sem p_observed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensure = vi.fn();
vi.mock("@/lib/automation/start-conversation", () => ({
  ensureConversation: (...a: unknown[]) => ensure(...a),
  sessaoProntaParaEnvio: async () => "sess-1",
}));

import { openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";

const ORG = "org-1";
const CONTATO = "contato-1";
const CONVERSA = "conversa-1";
const C = "user-c";
const B = "user-b";
const FRONTEIRA = { organization_id: ORG, contact_id: CONTATO, conversation_id: CONVERSA, service_revision: 3 };

type Conversa = { id: string; assigned_to_user_id: string | null } | null;

function admin(conversa: Conversa) {
  const consultas: Array<Record<string, unknown>> = [];
  const de = (tabela: string) => {
    const filtros: Record<string, unknown> = { tabela };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit"]) q[m] = () => q;
    q.eq = (k: string, v: unknown) => {
      filtros[k] = v;
      return q;
    };
    q.maybeSingle = async () => {
      consultas.push(filtros);
      if (tabela === "channel_sessions") return { data: { id: "sess-1" }, error: null };
      if (tabela === "contacts") return { data: { id: CONTATO, is_personal: false }, error: null };
      if (tabela === "conversations") return { data: conversa, error: null };
      return { data: null, error: null };
    };
    return q;
  };
  return {
    from: de,
    rpc: vi.fn(async () => ({ data: FRONTEIRA, error: null })),
    consultas,
  };
}

/** O cliente DO USUÁRIO: a RLS decide se ele vê a conversa. */
function doUsuario(ve: boolean) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.maybeSingle = async () => ({ data: ve ? { id: CONVERSA } : null, error: null });
  return { from: vi.fn(() => q) };
}

const entrada = { contact_id: CONTATO, channel_session_id: "sess-1" };

beforeEach(() => {
  ensure.mockReset();
  ensure.mockResolvedValue(CONVERSA);
});

describe("v1.9.52.4: Abrir conversa recusa a conversa de outra pessoa que o chamador não vê", () => {
  it("(1) o DONO abre: segue como hoje, com a fronteira observada", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: C });
    const u = doUsuario(true);
    const r = await openSharedContactConversation(a as never, ORG, entrada, { userId: C, supabase: u as never });
    expect(r).toEqual({ conversation_id: CONVERSA, contact_id: CONTATO });
    expect(ensure).toHaveBeenCalledWith(a, ORG, CONTATO, "sess-1", FRONTEIRA);
    expect(u.from).not.toHaveBeenCalled(); // é dele: nem precisa perguntar à RLS
  });

  it("(2) o GERENTE/ADMIN, que vê a conversa de outra pessoa, abre como hoje", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: C });
    const r = await openSharedContactConversation(a as never, ORG, entrada, { userId: "gerente", supabase: doUsuario(true) as never });
    expect(r.conversation_id).toBe(CONVERSA);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("(3) a conversa SEM dono: o SDR abre e reabre como hoje", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: null });
    const u = doUsuario(false);
    const r = await openSharedContactConversation(a as never, ORG, entrada, { userId: B, supabase: u as never });
    expect(r.conversation_id).toBe(CONVERSA);
    expect(ensure).toHaveBeenCalledWith(a, ORG, CONTATO, "sess-1", FRONTEIRA);
    expect(u.from).not.toHaveBeenCalled();
  });

  it("(4) a conversa de OUTRA pessoa que o chamador NÃO vê: recusa, SEM chamar o fn_service_begin (B não reabre nem vira dono)", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: C });
    await expect(
      openSharedContactConversation(a as never, ORG, entrada, { userId: B, supabase: doUsuario(false) as never }),
    ).rejects.toThrow("conversation_of_other");
    expect(ensure).not.toHaveBeenCalled();
  });

  it("a conferência escolhe a conversa com o MESMO filtro do banco (org, contato, 1:1, a sessão)", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: C });
    await openSharedContactConversation(a as never, ORG, entrada, { userId: C, supabase: doUsuario(true) as never });
    expect(a.consultas.find((q) => q.tabela === "conversations")).toEqual({
      tabela: "conversations",
      organization_id: ORG,
      contact_id: CONTATO,
      is_group: false,
      channel_session_id: "sess-1",
    });
  });

  it("(5) a conversa muda entre a conferência e a abertura (service_stale): conversation_stale, não abre outra", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: C });
    ensure.mockRejectedValue(Object.assign(new Error("service_stale"), { code: "40001" }));
    await expect(
      openSharedContactConversation(a as never, ORG, entrada, { userId: C, supabase: doUsuario(true) as never }),
    ).rejects.toThrow("conversation_stale");
  });

  it("o contato SEM conversa: a observação diz 'ausente' (o banco recusa se uma nascer no meio)", async () => {
    const a = admin(null);
    await openSharedContactConversation(a as never, ORG, entrada, { userId: B, supabase: doUsuario(false) as never });
    expect(ensure).toHaveBeenCalledWith(a, ORG, CONTATO, "sess-1", { organization_id: ORG, contact_id: CONTATO, absent: true });
  });

  it("SEM chamador (tool MCP, token de API): segue como antes, sem conferência e sem p_observed", async () => {
    const a = admin({ id: CONVERSA, assigned_to_user_id: C });
    await openSharedContactConversation(a as never, ORG, entrada);
    expect(ensure).toHaveBeenCalledWith(a, ORG, CONTATO, "sess-1", undefined);
    expect(a.rpc).not.toHaveBeenCalled();
  });
});
