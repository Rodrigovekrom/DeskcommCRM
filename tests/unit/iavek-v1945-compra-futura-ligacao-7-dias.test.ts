/**
 * ia.vek v1.9.45 (CRM-294): 7 dias antes do mês previsto, a TAREFA DE LIGAÇÃO nasce para o MESMO vendedor;
 * se ele saiu da loja, para o guardião do lead; sem nenhum dos dois, sem dono (nunca para quem saiu).
 * A marca condicional impede tarefa repetida, e a falha da tarefa desfaz a marca.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const e = vi.hoisted(() => ({
  leads: [] as Array<Record<string, unknown>>,
  membrosAtivos: [] as string[],
  tarefas: [] as Array<Record<string, unknown>>,
  falharTarefa: false,
}));

vi.mock("@/lib/tarefas/criar-tarefa", () => ({
  criarTarefaInterna: vi.fn(async (_db: unknown, pedido: Record<string, unknown>) => {
    if (e.falharTarefa) return { ok: false, codigo: "falha" };
    e.tarefas.push(pedido);
    return { ok: true, tarefa_id: `t${e.tarefas.length}`, assigned_to: null };
  }),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { limiteDoMes, rodarCompraFutura } from "@/lib/iavek/compra-futura/rodada";

/** Banco falso que APLICA os filtros que a rodada usa (eq, is null, lte) e a escrita condicional. */
function bancoFalso() {
  return {
    from: (tabela: string) => {
      const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
      let patch: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
        is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
        lte: (c: string, v: string) => (filtros.push((l) => String(l[c]) <= v), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const alvo = e.leads.find((l) => filtros.every((f) => f(l)));
          if (patch && alvo) Object.assign(alvo, patch);
          return { data: alvo ? { id: alvo.id } : null, error: null };
        },
        then: (r: (v: unknown) => unknown) => {
          if (tabela === "user_organizations") return Promise.resolve({ data: e.membrosAtivos.map((user_id) => ({ user_id })), error: null }).then(r);
          if (patch) {
            for (const l of e.leads.filter((x) => filtros.every((f) => f(x)))) Object.assign(l, patch);
            return Promise.resolve({ error: null }).then(r);
          }
          return Promise.resolve({ data: e.leads.filter((l) => filtros.every((f) => f(l))), error: null }).then(r);
        },
      });
      return q;
    },
  } as never;
}

const AGORA = new Date("2027-02-23T15:00:00Z"); // limite = 02/03/2027
const lead = (id: string, extra: Record<string, unknown> = {}) => ({
  id, organization_id: "org", title: `Lead ${id}`, status: "future", compra_futura_mes: "2027-03-01",
  compra_futura_vendedor_id: "vendedor", sdr_user_id: "guardiao", compra_futura_tarefa_em: null, ...extra,
});

beforeEach(() => Object.assign(e, { leads: [], membrosAtivos: ["vendedor", "guardiao"], tarefas: [], falharTarefa: false }));

describe("v1.9.45 (CRM-294): a ligação dos 7 dias antes", () => {
  it("o limite é hoje + 7 dias, no fuso de São Paulo", () => {
    expect(limiteDoMes(AGORA)).toBe("2027-03-02");
  });

  it("⭐ 7 dias antes de março: a tarefa vai para o MESMO vendedor, e o lead segue em Compra futura", async () => {
    e.leads = [lead("a")];
    const r = await rodarCompraFutura(bancoFalso(), "org", AGORA);
    expect(r).toMatchObject({ tarefas: 1, paraOVendedor: 1 });
    expect(e.tarefas[0]).toMatchObject({ atribuirA: { usuario_id: "vendedor" }, leadId: "a", sourceKind: "ligacao:compra_futura" });
    expect(e.leads[0]).toMatchObject({ status: "future" });
    expect(e.leads[0]!.compra_futura_tarefa_em).not.toBeNull();
  });

  it("⭐ o vendedor saiu da loja: vai para o GUARDIÃO do lead", async () => {
    e.membrosAtivos = ["guardiao"];
    e.leads = [lead("b")];
    const r = await rodarCompraFutura(bancoFalso(), "org", AGORA);
    expect(r).toMatchObject({ tarefas: 1, paraOGuardiao: 1 });
    expect(e.tarefas[0]).toMatchObject({ atribuirA: { usuario_id: "guardiao" } });
  });

  it("sem vendedor nem guardião ativos: SEM dono (nunca para quem saiu)", async () => {
    e.membrosAtivos = [];
    e.leads = [lead("c")];
    const r = await rodarCompraFutura(bancoFalso(), "org", AGORA);
    expect(r).toMatchObject({ tarefas: 1, semDono: 1 });
    expect(e.tarefas[0]).toMatchObject({ atribuirA: "ninguem", aceitaSemResponsavel: true });
  });

  it("mês ainda longe (abril) não gera tarefa", async () => {
    e.leads = [lead("d", { compra_futura_mes: "2027-04-01" })];
    expect((await rodarCompraFutura(bancoFalso(), "org", AGORA)).tarefas).toBe(0);
    expect(e.tarefas).toHaveLength(0);
  });

  it("⭐ duas rodadas não dobram: a marca impede a 2ª tarefa", async () => {
    e.leads = [lead("e")];
    await rodarCompraFutura(bancoFalso(), "org", AGORA);
    await rodarCompraFutura(bancoFalso(), "org", AGORA);
    expect(e.tarefas).toHaveLength(1);
  });

  it("a tarefa falhou: a marca é desfeita e a próxima rodada tenta de novo", async () => {
    e.leads = [lead("f")];
    e.falharTarefa = true;
    expect((await rodarCompraFutura(bancoFalso(), "org", AGORA)).falhas).toBe(1);
    expect(e.leads[0]!.compra_futura_tarefa_em).toBeNull();
    e.falharTarefa = false;
    expect((await rodarCompraFutura(bancoFalso(), "org", AGORA)).tarefas).toBe(1);
  });

  it("lead que não está em Compra futura nunca entra", async () => {
    e.leads = [lead("g", { status: "open", compra_futura_mes: null })];
    expect((await rodarCompraFutura(bancoFalso(), "org", AGORA)).tarefas).toBe(0);
  });
});
