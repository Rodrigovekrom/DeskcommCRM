/**
 * ia.vek v1.9.45 (CRM-297): "coloque em radar, para analisar a situação de cada um e transferir manualmente para cada
 * usuário responsável" (Rodrigo). O radar mostra por padrão só os leads COM dono; os sem dono ficam numa aba com o
 * número; nela, "Transferir para…" (gerente e admin) usa o MESMO caminho do cartão do lead.
 */
// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const e = vi.hoisted(() => ({ role: "manager", mutate: vi.fn() }));
const lead = (id: string, extra: Record<string, unknown>) => ({
  id, title: `Lead ${id}`, pipeline_id: "f", stage_name: "Novo", risk: "em_risco", conversation_id: null,
  owner_user_id: null, owner_kind: null, owner_agent_name: null, assignee_kind: null, contact_name: `Cliente ${id}`, ...extra,
});
vi.mock("@/hooks/leads/useAtRiskLeads", () => ({
  useAtRiskLeads: () => ({
    isLoading: false,
    data: {
      total: 3, counts: { frio: 0, em_risco: 3, em_voo: 0 },
      items: [lead("a", { owner_user_id: "u1" }), lead("b", {}), lead("c", { owner_kind: "ai", owner_agent_name: "IA" })],
      sem_proximo_passo: [], propostas_vencidas_sem_retomada: [], propostas_esperando_revisao: [],
    },
  }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ activeOrg: { role: e.role } }) }));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({ useAssignableMembers: () => ({ data: [{ user_id: "vend1", full_name: "Vendedor Um" }] }) }));
vi.mock("@/hooks/kanban/useUpdateLead", () => ({ useEditLead: () => ({ mutate: e.mutate, isPending: false }) }));
vi.mock("@/hooks/inbox/useClaimConversation", () => ({ useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig<object>()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => <a href={href}>{children as never}</a> }));

import { RiskRadarList, semDonoNoRadar } from "@/app/app/radar/_components/RiskRadarList";

afterEach(() => { cleanup(); e.mutate.mockReset(); e.role = "manager"; });

describe("v1.9.45 (CRM-297): o radar com a aba Sem dono", () => {
  it("⭐ por padrão mostra só os COM dono (humano ou agente); a aba Sem dono tem o número", () => {
    render(<RiskRadarList />);
    expect(screen.getByTestId("radar-aba-com-dono").textContent).toContain("(2)");
    expect(screen.getByTestId("radar-aba-sem-dono").textContent).toContain("(1)");
    expect(screen.getAllByTestId("radar-item")).toHaveLength(2);
    expect(screen.queryByTestId("radar-transferir")).toBeNull(); // na aba Com dono não há transferir
  });

  it("⭐ na aba Sem dono, o gerente transfere pelo MESMO caminho do cartão (PATCH owner_user_id)", () => {
    render(<RiskRadarList />);
    fireEvent.click(screen.getByTestId("radar-aba-sem-dono"));
    expect(screen.getAllByTestId("radar-item")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("radar-transferir"), { target: { value: "vend1" } });
    expect(e.mutate).toHaveBeenCalledWith({ leadId: "b", patch: { owner_user_id: "vend1" } }, expect.anything());
  });

  it("vendedor (agent) vê a aba, mas NÃO vê o Transferir para…", () => {
    e.role = "agent";
    render(<RiskRadarList />);
    fireEvent.click(screen.getByTestId("radar-aba-sem-dono"));
    expect(screen.queryByTestId("radar-transferir")).toBeNull();
  });

  it("a regra do sem dono é a mesma do rótulo do radar", () => {
    expect(semDonoNoRadar({ owner_user_id: null, owner_kind: null, assignee_kind: null } as never)).toBe(true);
    expect(semDonoNoRadar({ owner_user_id: "u", owner_kind: "user", assignee_kind: null } as never)).toBe(false);
    expect(semDonoNoRadar({ owner_user_id: null, owner_kind: "ai", assignee_kind: null } as never)).toBe(false);
    expect(semDonoNoRadar({ owner_user_id: null, owner_kind: null, assignee_kind: "user" } as never)).toBe(false);
  });

  it("o aviso ao recebedor vem do banco: o PATCH de owner_user_id dispara o lead_passado", () => {
    const b = readFileSync("supabase/baseline.sql", "utf8");
    expect(b).toMatch(/after update of owner_user_id, stage_id, status on public\.crm_leads[\s\S]{0,120}fn_iavek_notifica_mudanca_do_lead/);
  });
});
