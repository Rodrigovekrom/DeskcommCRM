/**
 * ia.vek v1.9.44 (Lupa/Maestro): a trava da prospecção é de TRANSAÇÃO (pg_try_advisory_xact_lock),
 * numa conexão SÓ DA TRAVA, e o trabalho roda em OUTRA conexão, sem transação.
 *
 * Por quê: o SUPABASE_DB_URL da produção é o pooler em modo transação (6543). A trava de sessão
 * (lock + unlock em comandos soltos) podia travar num backend e soltar em outro: ficaria PRESA.
 *
 * O pool falso imita o Postgres no que importa: a trava de transação é da TRANSAÇÃO que a pegou e só
 * sai no fim dela; e um `commit` na conexão do TRABALHO não pode soltá-la (era o risco de usar a
 * mesma conexão: as funções de store.ts e worker.ts abrem e fecham as próprias transações).
 */
import { afterEach, describe, expect, it } from "vitest";

import { withProspectingLock } from "@/lib/prospecting/store";

const e = {
  travas: new Map<string, number>(),
  emTransacao: new Set<number>(),
  conexoes: 0,
  soltas: 0,
  sqlDoTrabalho: [] as Array<{ sessao: number; sql: string; emTransacaoDaTrava: boolean }>,
};
let sessaoDaTrava = 0;
afterEach(() => {
  Object.assign(e, { travas: new Map(), emTransacao: new Set(), conexoes: 0, soltas: 0, sqlDoTrabalho: [] });
  sessaoDaTrava = 0;
});

function poolFalso() {
  return {
    connect: async () => {
      const sessao = ++e.conexoes;
      return {
        query: async (sql: string, params: string[] = []) => {
          if (sql === "begin") return void e.emTransacao.add(sessao), { rows: [] };
          if (sql === "commit" || sql === "rollback") {
            e.emTransacao.delete(sessao);
            for (const [k, dona] of e.travas) if (dona === sessao) e.travas.delete(k);
            return { rows: [] };
          }
          if (sql.includes("pg_try_advisory_xact_lock")) {
            if (!e.emTransacao.has(sessao)) throw new Error("xact lock fora de transação");
            const dona = e.travas.get(params[0]!);
            if (dona !== undefined && dona !== sessao) return { rows: [{ locked: false }] };
            e.travas.set(params[0]!, sessao);
            sessaoDaTrava = sessao;
            return { rows: [{ locked: true }] };
          }
          if (sql.includes("advisory")) throw new Error("trava de SESSÃO não pode mais ser usada: " + sql);
          e.sqlDoTrabalho.push({ sessao, sql, emTransacaoDaTrava: sessao === sessaoDaTrava });
          return { rows: [] };
        },
        release: () => void e.soltas++,
      };
    },
  } as never;
}

describe("v1.9.44: trava da prospecção (xact lock, conexão própria)", () => {
  it("⭐ 2 operações SIMULTÂNEAS na mesma organização: a 2ª recebe 409 e o trabalho roda uma vez", async () => {
    const pool = poolFalso();
    let soltar!: () => void;
    let rodou = 0;
    const primeira = withProspectingLock(pool, "org-a", async () => {
      rodou++;
      await new Promise<void>((r) => (soltar = r));
      return "ok";
    });
    await new Promise((r) => setTimeout(r, 0));
    await expect(withProspectingLock(pool, "org-a", async () => (rodou++, "dobrou"))).rejects.toMatchObject({ status: 409 });
    soltar();
    expect(await primeira).toBe("ok");
    expect(rodou).toBe(1);
    expect(e.travas.size).toBe(0);
    expect(e.soltas).toBe(e.conexoes);
  });

  it("⭐ o commit do PRÓPRIO trabalho não solta a trava (o trabalho roda em outra conexão)", async () => {
    const pool = poolFalso();
    await withProspectingLock(pool, "org-a", async (db) => {
      await db.query("begin");
      await db.query("update prospecting_campaigns set x=1");
      await db.query("commit");
      // a trava continua de pé depois do commit do trabalho
      expect(e.travas.size).toBe(1);
      await expect(withProspectingLock(pool, "org-a", async () => "dobrou")).rejects.toMatchObject({ status: 409 });
    });
    expect(e.sqlDoTrabalho.every((q) => !q.emTransacaoDaTrava)).toBe(true);
    expect(e.travas.size).toBe(0);
  });

  it("outra organização não é segurada; e a trava sai mesmo quando o trabalho dá erro", async () => {
    const pool = poolFalso();
    await withProspectingLock(pool, "org-a", async () => {
      expect(await withProspectingLock(pool, "org-b", async () => "b")).toBe("b");
    });
    await expect(withProspectingLock(pool, "org-a", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(e.travas.size).toBe(0);
    expect(e.emTransacao.size).toBe(0);
    expect(e.soltas).toBe(e.conexoes);
  });
});
