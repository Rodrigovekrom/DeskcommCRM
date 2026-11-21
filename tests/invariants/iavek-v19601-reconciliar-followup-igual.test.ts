import { beforeAll, describe, expect, it } from "vitest";

import { SQL_RECONCILIAR_FOLLOWUP } from "@/lib/esteira/reconciliar-followup-sql";

import { lastLine, sql } from "./gov-helpers";
import {
  C1, FOTOS_SQL, FU, O1, O_OUTRO_MOTIVO, ORG, RETORNO_ESPERADO, SQL_ANTIGO_V1960, TAREFAS, comParametros, sementeSql, tarefasEsperadas,
} from "./iavek-v19601-reconciliar-casos";

/**
 * ia.vek v1.9.60.1 (Maestro 232512): o passo 6 da rodada (reconciliarFollowup) com a parte das TAREFAS reescrita, sem a
 * subconsulta correlacionada que estourava o tempo-limite na produção desde 20/11 13:07Z, tem de dar o MESMO resultado
 * do SQL ANTIGO (a cópia congelada abaixo, da v1.9.60, deps-reais.ts:516-551). Os dois rodam no MESMO banco semeado,
 * cada um numa transação desfeita, e comparam: o retorno (guardioes, originais, tarefas), o dono e o guardião de cada
 * lead e o assigned_to de cada tarefa. E os dois batem com o esperado escrito à mão, caso a caso.
 * Organização PRÓPRIA deste arquivo; ids sintéticos.
 */
/** Roda o SQL numa transação DESFEITA e devolve: o retorno | os leads (id:dono:guardião) | as tarefas (id:assigned_to). */
function fotoDepoisDe(q: string): { retorno: string; leads: string; tarefas: string } {
  const out = sql(`begin;\n${comParametros(q)};\n${FOTOS_SQL}\nrollback;`).split("\n");
  // psql -tA: o retorno (guardioes|originais|tarefas), depois as 2 fotos
  const linhas = out.filter((l) => l.trim() !== "" && l !== "BEGIN" && l !== "ROLLBACK");
  return { retorno: linhas[0] ?? "", leads: linhas[1] ?? "", tarefas: linhas[2] ?? "" };
}

let antigo: ReturnType<typeof fotoDepoisDe>;
let novo: ReturnType<typeof fotoDepoisDe>;

beforeAll(() => {
  sql(sementeSql());
  antigo = fotoDepoisDe(SQL_ANTIGO_V1960);
  novo = fotoDepoisDe(SQL_RECONCILIAR_FOLLOWUP);
});

describe("v1.9.60.1 — o passo 6 da esteira (reconciliarFollowup) com as tarefas sem subconsulta correlacionada", () => {
  it("a semente é a que o teste diz (status, motivo e tarefas no lugar)", () => {
    const st = (id: string) => lastLine(sql(`select status || ':' || coalesce(lost_reason, '-') from public.crm_leads where id = '${id}';`));
    expect(st(O1)).toBe("lost:moved_to_another_pipeline");
    expect(st(O_OUTRO_MOTIVO)).toBe("lost:no_response");
    expect(st(C1)).toBe("open:-");
    expect(lastLine(sql(`select count(*) from public.crm_tasks where organization_id = '${ORG}';`))).toBe(String(TAREFAS.length));
  });

  it("o retorno é o MESMO (guardioes | originais | tarefas)", () => {
    expect(novo.retorno).toBe(antigo.retorno);
  });

  it("o dono e o guardião de cada lead ficam IGUAIS aos do SQL antigo", () => {
    expect(novo.leads).toBe(antigo.leads);
  });

  it("o assigned_to de cada tarefa fica IGUAL ao do SQL antigo", () => {
    expect(novo.tarefas).toBe(antigo.tarefas);
  });

  it("e os dois batem com o esperado, caso a caso (só as tarefas de clone de SDR de FU, até a passagem, mudam)", () => {
    const depois = new Map(novo.tarefas.split(",").map((p) => p.split(":") as [string, string]));
    for (const t of TAREFAS) {
      const quem = depois.get(t.id);
      expect({ tarefa: t.id.slice(-2), quem }).toEqual({ tarefa: t.id.slice(-2), quem: t.move ? FU : (t.quem ?? "-") });
    }
    expect(novo.tarefas).toBe(tarefasEsperadas());
    // g: C1 ganha o guardião; o: O1 (dono VEND) vira FU; O2 já estava certo
    expect(novo.retorno).toBe(RETORNO_ESPERADO);
  });

  it("sem SDR de Follow-up ativo, nada muda (os 2 SQLs)", () => {
    sql(`update public.user_organizations set revoked_at = now() where organization_id = '${ORG}' and user_id = '${FU}';`);
    try {
      expect(fotoDepoisDe(SQL_RECONCILIAR_FOLLOWUP).retorno).toBe("0|0|0");
      expect(fotoDepoisDe(SQL_ANTIGO_V1960).retorno).toBe("0|0|0");
    } finally {
      sql(`update public.user_organizations set revoked_at = null where organization_id = '${ORG}' and user_id = '${FU}';`);
    }
  });
});
