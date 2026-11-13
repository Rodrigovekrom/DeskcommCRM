/**
 * ia.vek CRM-354 (v1.9.51.3; Lupa 182118): a esteira por loja em PARALELO.
 * Partes: (1) o laço com fila e N trabalhadores (rodarEmParalelo), o orçamento de 240 s e a justiça; (2) a ROTA de
 * verdade com N = 1 (o comportamento de antes) e N = 4, com o mesmo dublê de pool/trava do teste da v1.9.43.
 */
import type * as PgModulo from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as TravaModulo from "@/lib/esteira/trava-da-rodada";

import {
  concorrenciaDaEsteira,
  esquecerRodadas,
  marcarQueRodou,
  ordenarPorJustica,
  rodarEmParalelo,
} from "@/lib/esteira/rodada-em-paralelo";

describe("ESTEIRA_CONCORRENCIA", () => {
  it("vazio = 1 (o comportamento de antes)", () => {
    expect(concorrenciaDaEsteira(undefined)).toBe(1);
    expect(concorrenciaDaEsteira("")).toBe(1);
  });
  it("1 a 8 valem", () => {
    expect(concorrenciaDaEsteira("1")).toBe(1);
    expect(concorrenciaDaEsteira("4")).toBe(4);
    expect(concorrenciaDaEsteira("8")).toBe(8);
  });
  it("inválida (0, 99, 'x', -2, 2.5) = 1", () => {
    for (const v of ["0", "99", "x", "-2", "2.5"]) expect(concorrenciaDaEsteira(v)).toBe(1);
  });
});

describe("rodarEmParalelo: a fila com N trabalhadores", () => {
  it("N = 4 com 10 itens: no MÁXIMO 4 juntos, e os 10 rodam", async () => {
    let rodando = 0;
    let maximo = 0;
    const r = await rodarEmParalelo(Array.from({ length: 10 }, (_, i) => `org-${i}`), 4, async (x) => {
      rodando += 1;
      maximo = Math.max(maximo, rodando);
      await new Promise((ok) => setTimeout(ok, 5 + (x.length % 3)));
      rodando -= 1;
      return x;
    });
    expect(r.feitos).toHaveLength(10);
    expect(maximo).toBe(4);
    expect(r.maxJuntas).toBe(4);
    expect(r.semTempo).toHaveLength(0);
  });

  it("N = 1: um de cada vez, na ordem dada (o comportamento de antes)", async () => {
    const ordem: string[] = [];
    const r = await rodarEmParalelo(["a", "b", "c"], 1, async (x) => {
      ordem.push(x);
      return x;
    });
    expect(ordem).toEqual(["a", "b", "c"]);
    expect(r.maxJuntas).toBe(1);
  });

  it("orçamento: depois de 240 s NENHUM começa; os que sobraram saem 'sem tempo'", async () => {
    let agora = 0;
    const r = await rodarEmParalelo(["a", "b", "c", "d"], 1, async (x) => {
      agora += 130_000; // cada um leva 130 s: 'a' (0→130), 'b' (130→260), e 'c' já não começa
      return x;
    }, { agora: () => agora });
    expect(r.feitos.map((f) => f.item)).toEqual(["a", "b"]);
    expect(r.semTempo).toEqual(["c", "d"]);
  });

  it("(Lupa 1) o que começou aos 239 s TERMINA (passa dos 300 s): o orçamento é de COMEÇAR, não de cortar", async () => {
    let agora = 239_000;
    const inicio = 0;
    const r = await rodarEmParalelo(["tardia"], 1, async (x) => {
      agora += 172_000; // o máximo medido
      return x;
    }, { agora: () => (agora === 239_000 ? inicio + 239_000 : agora) });
    expect(r.feitos.map((f) => f.item)).toEqual(["tardia"]);
    expect(agora).toBe(411_000);
  });
});

describe("justiça: a que rodou há MAIS tempo primeiro", () => {
  afterEach(() => esquecerRodadas());
  it("a que nunca rodou vem antes; depois a mais antiga; empate pelo id", () => {
    marcarQueRodou("org-c", 3000);
    marcarQueRodou("org-a", 1000);
    const ordem = ordenarPorJustica([{ id: "org-c" }, { id: "org-a" }, { id: "org-z" }, { id: "org-b" }]).map((o) => o.id);
    expect(ordem).toEqual(["org-b", "org-z", "org-a", "org-c"]);
  });
});

describe("(Lupa 182714) a hora da justiça vale também no ERRO", () => {
  afterEach(() => esquecerRodadas());
  it("quando só UMA loja cabe por rodada, a que FALHA não fica em 1º nas 3 rodadas", async () => {
    // O cenário em que a ordem importa: o orçamento só deixa começar 1 loja por rodada. A 'org-00' falha sempre.
    const lojas = [{ id: "org-00" }, { id: "org-01" }, { id: "org-02" }];
    const primeiras: string[] = [];
    let relogio = 1000;
    for (let rodada = 0; rodada < 3; rodada++) {
      const ordem = ordenarPorJustica(lojas);
      const r = await rodarEmParalelo(ordem, 1, async (loja) => {
        marcarQueRodou(loja.id, relogio++); // como a rota: no COMEÇO da tentativa, com sucesso ou erro
        primeiras.push(loja.id);
        relogio += 250_000; // leva o orçamento inteiro: nenhuma outra começa nesta rodada
        if (loja.id === "org-00") return "erro";
        return "ok";
      }, { agora: () => relogio });
      expect(r.feitos).toHaveLength(1);
    }
    expect(primeiras).toEqual(["org-00", "org-01", "org-02"]);
  });
});

// ─── A ROTA de verdade ──────────────────────────────────────────────────────────────────────────────────────────────
type Org = { id: string; settings: unknown };
const estado = vi.hoisted(() => ({
  orgs: [] as Array<{ id: string; settings: unknown }>,
  travas: new Map<string, number>(),
  conexoes: 0,
  transacoes: new Set<number>(),
  emCurso: 0,
  maxEmCurso: 0,
  liberar: [] as Array<() => void>,
  falharOrg: null as string | null,
  rodadas: [] as string[],
  falhou: [] as string[],
  logs: [] as Array<{ msg: string; ctx: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/organizacao/operante", () => ({ idsDeOrgsParadas: vi.fn(async () => []) }));
vi.mock("@/lib/logger", () => {
  const f = (msg: string, ctx: Record<string, unknown> = {}) => void estado.logs.push({ msg, ctx });
  return { logger: { info: f, warn: f, error: f, debug: f } };
});
vi.mock("@/lib/esteira/aviso-de-parada", () => ({
  esteiraRodou: vi.fn(async () => undefined),
  esteiraFalhou: vi.fn(async (_a: unknown, org: string) => void estado.falhou.push(org)),
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
    estado.rodadas.push(deps.org);
    estado.emCurso += 1;
    estado.maxEmCurso = Math.max(estado.maxEmCurso, estado.emCurso);
    try {
      await new Promise<void>((r) => estado.liberar.push(r));
      if (estado.falharOrg === deps.org) throw new Error("rodada falhou");
      return { passados: 0, cobrancas: 1 };
    } finally {
      estado.emCurso -= 1;
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
          if (sql.startsWith("set local statement_timeout")) return { rows: [] };
          if (sql === "commit" || sql === "rollback") {
            estado.transacoes.delete(sessao);
            for (const [k, dona] of estado.travas) if (dona === sessao) estado.travas.delete(k);
            return { rows: [] };
          }
          if (sql.includes("pg_try_advisory_xact_lock")) {
            const chave = params[0]!;
            const dona = estado.travas.get(chave);
            if (dona !== undefined && dona !== sessao) return { rows: [{ travou: false }] };
            estado.travas.set(chave, sessao);
            return { rows: [{ travou: true }] };
          }
          return { rows: [] };
        },
        release: () => undefined,
      };
    },
  }),
}));

import { GET } from "@/app/api/v1/cron/esteira-vendas/route";

const chamar = async () => {
  const res = await GET({} as never);
  return ((await res.json()) as { data: { organizacoes: Array<Record<string, unknown>> } }).data.organizacoes;
};
/** Solta as rodadas presas até a chamada terminar. */
const terminar = async <T>(p: Promise<T>): Promise<T> => {
  let pronto = false;
  void p.then(() => (pronto = true));
  while (!pronto) {
    estado.liberar.splice(0).forEach((r) => r());
    await new Promise((r) => setTimeout(r, 1));
  }
  return p;
};
const orgs = (n: number): Org[] => Array.from({ length: n }, (_, i) => ({ id: `org-${String(i).padStart(2, "0")}`, settings: {} }));

describe("a ROTA da esteira", () => {
  afterEach(() => {
    estado.liberar.splice(0).forEach((r) => r());
    vi.unstubAllEnvs();
    esquecerRodadas();
    Object.assign(estado, {
      orgs: [], travas: new Map(), conexoes: 0, transacoes: new Set(), emCurso: 0, maxEmCurso: 0,
      liberar: [], falharOrg: null, rodadas: [], falhou: [], logs: [],
    });
  });

  it("SEM a variável (N = 1): uma de cada vez, todas rodam, e a linha da rodada diz concorrencia 1 / max_juntas 1", async () => {
    estado.orgs = orgs(3);
    const r = await terminar(chamar());
    expect(r).toHaveLength(3);
    expect(estado.maxEmCurso).toBe(1);
    const linha = estado.logs.find((l) => l.msg === "esteira_rodada_paralela");
    expect(linha?.ctx).toMatchObject({ concorrencia: 1, organizacoes: 3, max_juntas: 1, sem_tempo: 0 });
  });

  it("(Lupa 184158) cada loja deixa 1 linha com o INÍCIO e o FIM da sua rodada", async () => {
    vi.stubEnv("ESTEIRA_CONCORRENCIA", "4");
    estado.orgs = orgs(4);
    await terminar(chamar());
    const linhas = estado.logs.filter((l) => l.msg === "esteira_rodada_da_loja");
    expect(linhas).toHaveLength(4);
    for (const l of linhas) {
      expect(l.ctx).toMatchObject({ organization_id: expect.any(String), inicio: expect.any(String), fim: expect.any(String), ms: expect.any(Number) });
      expect(Date.parse(String(l.ctx.fim))).toBeGreaterThanOrEqual(Date.parse(String(l.ctx.inicio)));
    }
  });

  it("N = 4 com 10 lojas: as 10 rodam, no máximo 4 JUNTAS, e a trava fica limpa no fim", async () => {
    vi.stubEnv("ESTEIRA_CONCORRENCIA", "4");
    estado.orgs = orgs(10);
    const p = chamar();
    await vi.waitFor(() => expect(estado.liberar.length).toBe(4)); // 4 juntas, segurando
    expect(estado.maxEmCurso).toBe(4);
    const r = await terminar(p);
    expect(r).toHaveLength(10);
    expect(estado.maxEmCurso).toBe(4);
    expect(new Set(estado.rodadas).size).toBe(10);
    expect(estado.travas.size).toBe(0);
    expect(estado.transacoes.size).toBe(0);
    expect(estado.logs.find((l) => l.msg === "esteira_rodada_paralela")?.ctx).toMatchObject({ concorrencia: 4, max_juntas: 4 });
  });

  it("(Lupa 1) uma loja que passou da rodada (trava ainda pega): a rodada seguinte a marca 'rodada_em_curso' e roda as outras", async () => {
    vi.stubEnv("ESTEIRA_CONCORRENCIA", "4");
    estado.orgs = [{ id: "org-lenta", settings: {} }];
    const primeira = chamar();
    await vi.waitFor(() => expect(estado.liberar.length).toBe(1)); // a lenta segura a trava
    const presa = estado.liberar.splice(0);
    estado.orgs = [{ id: "org-lenta", settings: {} }, ...orgs(2)];
    const segunda = await terminar(chamar());
    expect(segunda).toContainEqual({ organization_id: "org-lenta", pulada: "rodada_em_curso" });
    expect(segunda.filter((x) => x.cobrancas === 1)).toHaveLength(2);
    presa.forEach((r) => r());
    await terminar(primeira);
  });

  it("o ERRO numa loja não para as outras, e só ela vai para o esteiraFalhou", async () => {
    vi.stubEnv("ESTEIRA_CONCORRENCIA", "4");
    estado.orgs = orgs(5);
    estado.falharOrg = "org-02";
    const r = await terminar(chamar());
    expect(r).toContainEqual({ organization_id: "org-02", erro: "rodada falhou" });
    expect(r.filter((x) => x.cobrancas === 1)).toHaveLength(4);
    expect(estado.falhou).toEqual(["org-02"]);
  });

  it("'rodada_em_curso' NÃO grava a hora: a loja pulada vai na FRENTE na rodada seguinte", async () => {
    estado.orgs = [{ id: "org-z", settings: {} }];
    const presa = chamar();
    await vi.waitFor(() => expect(estado.liberar.length).toBe(1)); // org-z segura a trava (e já gravou a hora)
    const segura = estado.liberar.splice(0);
    marcarQueRodou("org-a", Date.now() + 10); // org-a 'rodou' DEPOIS da org-z
    estado.orgs = [{ id: "org-a", settings: {} }, { id: "org-z", settings: {} }];
    const r = await terminar(chamar()); // a org-z sai 'rodada_em_curso'
    expect(r).toContainEqual({ organization_id: "org-z", pulada: "rodada_em_curso" });
    segura.forEach((x) => x());
    await terminar(presa);
  });

  it("justiça na rota: a que rodou há mais tempo vem PRIMEIRO na rodada seguinte", async () => {
    estado.orgs = orgs(3);
    marcarQueRodou("org-00", 3000);
    marcarQueRodou("org-01", 1000);
    marcarQueRodou("org-02", 2000);
    await terminar(chamar());
    expect(estado.rodadas).toEqual(["org-01", "org-02", "org-00"]);
  });
});

describe("o pool das travas acompanha N", () => {
  it("N conexões, separado do pool das telas, um por tamanho", async () => {
    const pg = (await vi.importActual<typeof PgModulo>("pg")).default;
    const { poolDasTravasDaEsteira } = await vi.importActual<typeof TravaModulo>("@/lib/esteira/trava-da-rodada");
    const base = new pg.Pool({ connectionString: "postgres://u:p@127.0.0.1:1/db", max: 4 });
    const de4 = poolDasTravasDaEsteira(base, 4) as InstanceType<typeof pg.Pool>;
    const de1 = poolDasTravasDaEsteira(base) as InstanceType<typeof pg.Pool>;
    expect(de4.options.max).toBe(4);
    expect(de1.options.max).toBe(1);
    expect(de4).not.toBe(base);
    expect(poolDasTravasDaEsteira(base, 4)).toBe(de4);
    await Promise.all([base.end(), de4.end(), de1.end()]);
  });
});
