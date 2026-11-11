/**
 * MIGRATION É UMA TRIPLA — e o esquecimento vira falha de CI, não depende de lembrar.
 *
 * docs/DEPLOY-CHECKLIST.md: "Mudança de schema saiu como tripla: supabase/migrations/ + apêndice
 * idempotente no supabase/baseline.sql + linha `-- manifest:` no cabeçalho do .sql. O kit aplica só o
 * baseline — o que não chegar lá não chega a ninguém."
 *
 * Medido em 11/11 (ia.vek v1.9.43/v1.9.44): a 0616 foi para a produção sem o apêndice no baseline e a
 * 0617 também ia. A produção recebeu a 0616 pelo aplicar-0616.sh; uma instalação NOVA do kit, não. Só a
 * 0617 foi pega (uma invariante de banco a usava); a 0616 teria passado calada para sempre.
 *
 * As regras, medidas no TEXTO dos arquivos:
 *  1. o número NNNN de cada migration aparece num COMENTÁRIO do baseline.sql (o cabeçalho do apêndice,
 *     "-- ---- ... (migration NNNN) ----"), salvo as lacunas HISTÓRICAS congeladas abaixo;
 *  2. toda migration desde 02/10/2026 (quando o MANIFEST.md virou histórico) tem `-- manifest:`, salvo
 *     as 6 de antes da regra pegar, congeladas;
 *  3. nenhum número repetido;
 *  4. as listas só ENCOLHEM: nenhuma lacuna da era ia.vek (> 0578), e uma lacuna consertada sai da lista.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase", "migrations");
const BASELINE = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");
const COMENTARIOS_DO_BASELINE = BASELINE.split("\n")
  .filter((l) => l.trimStart().startsWith("--"))
  .join("\n");

/** Lacunas HISTÓRICAS (do upstream, até a 0578): nunca ganharam citação no baseline. Congeladas em 11/11. */
const HISTORICO_SEM_CITACAO_NO_BASELINE = new Set([
  "0001", "0020", "0022", "0051", "0052", "0133", "0134", "0136", "0152", "0245", "0277",
  "0322", "0324", "0369", "0379", "0438", "0528", "0529", "0532", "0537", "0578",
]);
/** Desde 02/10/2026 sem `-- manifest:` (da semana em que a regra nasceu). Congeladas em 11/11. */
const HISTORICO_SEM_MANIFEST = new Set(["0513", "0514", "0521", "0525", "0530", "0534"]);
const DESDE_O_MANIFEST = "20261002000000";
const ULTIMA_DO_UPSTREAM = 578;

const migrations = readdirSync(DIR)
  .filter((f) => /^\d{14}_\d{4}_.+\.sql$/.test(f))
  .map((arquivo) => {
    const [, ts, numero] = /^(\d{14})_(\d{4})_/.exec(arquivo)!;
    return { arquivo, ts: ts!, numero: numero!, texto: readFileSync(join(DIR, arquivo), "utf8") };
  });

const citadaNoBaseline = (n: string) => new RegExp(`\\b${n}\\b`).test(COMENTARIOS_DO_BASELINE);
const temManifest = (t: string) => /^-- manifest: \S/m.test(t);

describe("migration é uma tripla (migration + baseline + manifest)", () => {
  it("há migrations para medir (o padrão do nome não pode quebrar calado)", () => {
    expect(migrations.length).toBeGreaterThan(400);
  });

  it("⭐ toda migration tem o seu bloco citado no baseline.sql", () => {
    const faltam = migrations
      .filter((m) => !HISTORICO_SEM_CITACAO_NO_BASELINE.has(m.numero) && !citadaNoBaseline(m.numero))
      .map((m) => m.arquivo);
    expect(
      faltam,
      "Migration sem apêndice no supabase/baseline.sql. O kit e o CI aplicam SÓ o baseline: cole o bloco " +
        "idempotente com o cabeçalho '-- ---- <o quê> (migration NNNN) ----', ANTES do bloco '-- ---- VARREDURA anon:'.",
    ).toEqual([]);
  });

  it("⭐ toda migration desde 02/10/2026 tem a linha `-- manifest:`", () => {
    const faltam = migrations
      .filter((m) => m.ts >= DESDE_O_MANIFEST && !HISTORICO_SEM_MANIFEST.has(m.numero) && !temManifest(m.texto))
      .map((m) => m.arquivo);
    expect(faltam, "Migration sem '-- manifest: <o quê e o porquê>' no cabeçalho.").toEqual([]);
  });

  it("nenhum número de migration repetido", () => {
    const vistos = new Map<string, string>();
    const repetidos: string[] = [];
    for (const m of migrations) {
      if (vistos.has(m.numero)) repetidos.push(`${m.numero}: ${vistos.get(m.numero)} e ${m.arquivo}`);
      vistos.set(m.numero, m.arquivo);
    }
    expect(repetidos).toEqual([]);
  });

  it("as listas históricas só encolhem: nada da era ia.vek, e lacuna consertada sai da lista", () => {
    for (const n of [...HISTORICO_SEM_CITACAO_NO_BASELINE, ...HISTORICO_SEM_MANIFEST]) {
      expect(Number(n), `a ${n} é da era ia.vek: conserte em vez de congelar`).toBeLessThanOrEqual(ULTIMA_DO_UPSTREAM);
    }
    const consertadas = [...HISTORICO_SEM_CITACAO_NO_BASELINE].filter(citadaNoBaseline);
    expect(consertadas, "já citadas no baseline: tire da lista HISTORICO_SEM_CITACAO_NO_BASELINE").toEqual([]);
    const comManifest = migrations.filter((m) => HISTORICO_SEM_MANIFEST.has(m.numero) && temManifest(m.texto));
    expect(comManifest.map((m) => m.numero), "já têm manifest: tire da lista HISTORICO_SEM_MANIFEST").toEqual([]);
  });
});
