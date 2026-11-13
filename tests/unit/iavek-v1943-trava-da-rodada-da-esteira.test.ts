/**
 * ia.vek v1.9.43 (P3, 11/11): DUAS rodadas simultâneas da esteira não podem trabalhar a mesma
 * organização. A segunda PULA (não espera, não dobra cobrança nem ligação); a de outra organização
 * roda normalmente; e a trava é solta no fim, inclusive quando a rodada dá erro.
 *
 * O pool falso imita o `pg_try_advisory_xact_lock`: a trava é da TRANSAÇÃO que a pegou e só sai
 * quando essa transação termina (commit ou rollback). O teste real no Postgres fica no canário (TESTE).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Org = { id: string; settings: unknown };
const estado = vi.hoisted(() => ({
  orgs: [] as Org[],
  travas: new Map<string, number>(),
  conexoes: 0,
  soltas: 0,
  emCurso: new Map<string, number>(),
  maxSimultaneoPorOrg: 0,
  liberar: [] as Array<() => void>,
  falharOrg: null as string | null,
  rodadas: [] as string[],
  transacoes: new Set<number>(),
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/organizacao/operante", () => ({ idsDeOrgsParadas: vi.fn(async () => []) }));
vi.mock("@/lib/esteira/aviso-de-parada", () => ({
  esteiraRodou: vi.fn(async () => undefined),
  esteiraFalhou: vi.fn(async () => undefined),
}));
vi.mock("@/lib/esteira/config", () => ({ configDaEsteira: () => ({ funis: {} }) }));
vi.mock("@/lib/esteira/deps-reais", () => ({ depsReaisDaEsteira: (_a: unknown, org: string) => ({ org }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: estado.orgs, error: null }) }) }),
  }),
}));
vi.mock("@/lib/esteira/rodada", () => ({
  rodadaTeveEfeito: () => false,
  rodarEsteira: vi.fn(async (_cfg: unknown, deps: { org: string }) => {
    const org = deps.org;
    estado.rodadas.push(org);
    const n = (estado.emCurso.get(org) ?? 0) + 1;
    estado.emCurso.set(org, n);
    estado.maxSimultaneoPorOrg = Math.max(estado.maxSimultaneoPorOrg, n);
    try {
      await new Promise<void>((r) => estado.liberar.push(r)); // segura a rodada "lenta" até o teste soltar
      if (estado.falharOrg === org) throw new Error("rodada falhou");
      return { passados: 0, cobrancas: 1 };
    } finally {
      estado.emCurso.set(org, (estado.emCurso.get(org) ?? 1) - 1);
    }
  }),
}));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({
    connect: async () => {
      const sessao = ++estado.conexoes;
      return {
        query: async (sql: string, params: string[] = []) => {
          if (sql === "begin") { estado.transacoes.add(sessao); return { rows: [] }; }
          // v1.9.46 (nota 1 da Lupa): os tetos de comando e de trava, só na transação
          if (sql.startsWith("set local statement_timeout")) return { rows: [] };
          if (sql === "commit" || sql === "rollback") {
            estado.transacoes.delete(sessao);
            for (const [k, dona] of estado.travas) if (dona === sessao) estado.travas.delete(k);
            return { rows: [] };
          }
          const chave = params[0]!;
          if (sql.includes("pg_try_advisory_xact_lock")) {
            // fora de transação a trava de transação não vale: o teste tem de reprovar
            if (!estado.transacoes.has(sessao)) throw new Error("xact lock fora de transação");
            const dona = estado.travas.get(chave);
            if (dona !== undefined && dona !== sessao) return { rows: [{ travou: false }] };
            estado.travas.set(chave, sessao);
            return { rows: [{ travou: true }] };
          }
          throw new Error("sql inesperado: " + sql);
        },
        release: () => void estado.soltas++,
      };
    },
  }),
}));

import { GET } from "@/app/api/v1/cron/esteira-vendas/route";
import { chaveDaTravaDaEsteira } from "@/lib/esteira/trava-da-rodada";
import { esquecerRodadas } from "@/lib/esteira/rodada-em-paralelo";

const chamar = async () => {
  const res = await GET({} as never);
  return ((await res.json()) as { data: { organizacoes: Array<Record<string, unknown>> } }).data.organizacoes;
};
const esperarRodadas = async (n: number) => {
  await vi.waitFor(() => expect(estado.liberar.length).toBe(n));
};
const soltarTodas = () => estado.liberar.splice(0).forEach((r) => r());

afterEach(() => {
  soltarTodas();
  // CRM-354: a ordem "a mais antiga primeiro" guarda a hora da última rodada EM MEMÓRIA; entre os casos, zera.
  esquecerRodadas();
  Object.assign(estado, {
    orgs: [], travas: new Map(), conexoes: 0, soltas: 0, emCurso: new Map(),
    maxSimultaneoPorOrg: 0, liberar: [], falharOrg: null, rodadas: [], transacoes: new Set(),
  });
});

describe("v1.9.43: trava da rodada da esteira por organização", () => {
  it("⭐ 2 rodadas SIMULTÂNEAS: a 2ª pula a organização; só UMA rodada trabalha, e a trava é solta no fim", async () => {
    estado.orgs = [{ id: "org-a", settings: {} }];

    const primeira = chamar();
    await esperarRodadas(1); // a 1ª está DENTRO da rodada, segurando a trava
    const segunda = await chamar(); // a 2ª chega no meio

    expect(segunda).toEqual([{ organization_id: "org-a", pulada: "rodada_em_curso" }]);
    soltarTodas();
    expect(await primeira).toEqual([expect.objectContaining({ organization_id: "org-a", cobrancas: 1 })]);

    expect(estado.rodadas).toEqual(["org-a"]); // rodarEsteira só uma vez
    expect(estado.maxSimultaneoPorOrg).toBe(1);
    expect(estado.travas.size).toBe(0); // solta
    expect(estado.transacoes.size).toBe(0); // nenhuma transação aberta ficou para trás
    expect(estado.soltas).toBe(estado.conexoes); // toda conexão devolvida ao pool
  });

  it("depois que a 1ª termina, a rodada seguinte roda normalmente (a trava não fica presa)", async () => {
    estado.orgs = [{ id: "org-a", settings: {} }];
    const r1 = chamar();
    await esperarRodadas(1);
    soltarTodas();
    await r1;
    const r2 = chamar();
    await esperarRodadas(1);
    soltarTodas();
    expect(await r2).toEqual([expect.objectContaining({ organization_id: "org-a", cobrancas: 1 })]);
    expect(estado.rodadas).toEqual(["org-a", "org-a"]);
  });

  it("a trava é POR organização: a rodada de uma não segura a de outra", async () => {
    estado.orgs = [{ id: "org-a", settings: {} }];
    const r1 = chamar();
    await esperarRodadas(1);
    estado.orgs = [{ id: "org-a", settings: {} }, { id: "org-b", settings: {} }];
    const r2 = chamar();
    await esperarRodadas(2); // a org-b entrou, mesmo com a org-a travada
    // CRM-354: a org-a já gravou a hora ao pegar a trava, então a org-b (que nunca rodou) vai PRIMEIRO. Solta SÓ a
    // org-b: a 2ª chamada então tenta a org-a, que segue travada pela 1ª.
    estado.liberar.splice(1, 1).forEach((r) => r());
    const segunda = await r2;
    soltarTodas();
    await r1;
    expect(segunda).toEqual([
      expect.objectContaining({ organization_id: "org-b", cobrancas: 1 }),
      { organization_id: "org-a", pulada: "rodada_em_curso" },
    ]);
    expect(estado.travas.size).toBe(0);
  });

  it("se a rodada dá ERRO, a trava é solta mesmo assim (e o erro continua registrado)", async () => {
    estado.orgs = [{ id: "org-a", settings: {} }];
    estado.falharOrg = "org-a";
    const r1 = chamar();
    await esperarRodadas(1);
    soltarTodas();
    expect(await r1).toEqual([{ organization_id: "org-a", erro: "rodada falhou" }]);
    expect(estado.travas.size).toBe(0);
    expect(estado.soltas).toBe(estado.conexoes);
  });

  it("a chave é estável e por organização", () => {
    expect(chaveDaTravaDaEsteira("x")).toBe("esteira:x");
  });
});

describe("v1.9.43 (Lupa): a rodada da esteira deixa prova positiva no log do scheduler", () => {
  it("a rota da esteira está marcada com |resposta (uma linha por rodada; a vigia da troca exige ao menos uma)", async () => {
    const { readFileSync } = await import("node:fs");
    const s = readFileSync("docker/scheduler/entrypoint.sh", "utf8");
    expect(s).toMatch(/^\*\/5 \* \* \* \*\|300\|api\/v1\/cron\/esteira-vendas\|resposta$/m);
  });

  it("o entrypoint continua um sh válido e o bloco CRONS (entre aspas duplas) não tem crase nem $(", async () => {
    // Medido no 4634c9b: uma crase num comentário DENTRO de CRONS="..." vira comando no sh, e o
    // scheduler não sobe. A linha do crontab acima continuava casando: este caso é o que pega.
    const { readFileSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const s = readFileSync("docker/scheduler/entrypoint.sh", "utf8");
    const bloco = s.slice(s.indexOf('CRONS="'), s.indexOf('\n"\n', s.indexOf('CRONS="')));
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).not.toMatch(/`|\$\(/);
    expect(() => execFileSync("sh", ["-n", "docker/scheduler/entrypoint.sh"])).not.toThrow();
  });
});
