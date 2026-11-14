/**
 * ia.vek v1.9.52.2 (Lupa 224739, Maestro 224758): o laço do app travava ~2 s no fim de cada rodada da esteira.
 * Perfil no canário: o tempo próprio estava em lib/esteira/horas-uteis (a cobrança das ligações vencidas chama
 * horasUteisEntre para cada tarefa, e cada dia percorrido criava ~8 Intl.DateTimeFormat).
 *  1) EQUIVALÊNCIA: o código novo dá EXATAMENTE o mesmo resultado que o da 52.1 (copiado em fixtures) em milhares de
 *     instantes aleatórios, em fusos com e sem horário de verão.
 *  2) CUSTO: o lote do tamanho da Fenômenos (619 tarefas, 4 dias de atraso na mediana, 11 no máximo) cai muito.
 */
import { describe, expect, it } from "vitest";

import * as antes from "./fixtures/horas-uteis-v1952";
import { HORARIO_PADRAO, horasUteisEntre, inicioDoDiaLocal, somarHorasUteis, type HorarioComercial } from "@/lib/esteira/horas-uteis";

function aleatorio(semente: number) {
  let s = semente >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const FUSOS: HorarioComercial[] = [
  HORARIO_PADRAO,
  { ...HORARIO_PADRAO, fuso: "America/New_York" },
  { ...HORARIO_PADRAO, fuso: "Europe/Lisbon" },
  { fuso: "Asia/Kolkata", dias: { 0: ["10:00", "12:30"], 3: ["08:15", "17:45"] } },
];

describe("as horas úteis: o MESMO resultado da 52.1", () => {
  it("horasUteisEntre, somarHorasUteis e inicioDoDiaLocal batem em 1.200 casos (4 fusos, 2026-2027)", () => {
    const r = aleatorio(42);
    const base = Date.UTC(2026, 0, 1);
    const ano = 2 * 365 * 86_400_000;
    for (const h of FUSOS) {
      for (let i = 0; i < 300; i++) {
        const a = new Date(base + Math.floor(r() * ano));
        const b = new Date(a.getTime() + Math.floor(r() * 40 * 86_400_000) - 5 * 86_400_000);
        const horas = Math.floor(r() * 60) / 4;
        expect(horasUteisEntre(a, b, h)).toBe(antes.horasUteisEntre(a, b, h));
        expect(somarHorasUteis(a, horas, h).getTime()).toBe(antes.somarHorasUteis(a, horas, h).getTime());
        expect(inicioDoDiaLocal(a, h.fuso).getTime()).toBe(antes.inicioDoDiaLocal(a, h.fuso).getTime());
      }
    }
  }, 120_000);
});

describe("o custo do lote da Fenômenos (619 tarefas vencidas)", () => {
  it("cai a menos de 1/3 do de antes (o menor de 5 rodadas)", () => {
    const r = aleatorio(7);
    const agora = new Date("2026-11-13T23:00:00Z");
    // a distribuição MEDIDA em 13/11: mediana 4 dias, máximo 11 (soma ~3.100 dias)
    const vencidas = Array.from({ length: 619 }, () => new Date(agora.getTime() - (0.2 + r() * r() * 10.8) * 86_400_000));
    const medir = (f: (a: Date, b: Date) => number) => {
      const t0 = performance.now();
      for (const v of vencidas) f(v, agora);
      return performance.now() - t0;
    };
    medir((a, b) => horasUteisEntre(a, b)); // aquece os dois (JIT)
    medir((a, b) => antes.horasUteisEntre(a, b));
    // v1.9.52.3: o CI (máquina compartilhada, arquivos em paralelo) mediu 1 amostra só e deu 4,4x (853 -> 194 ms).
    // O MENOR de 5 rodadas alternadas tira o ruído da máquina. Só ESTA função ganha ~5x (medido 14/11: 4,97x a 5,2x),
    // então 1/5 ficava no fio; o limite passa a 1/3 (medido 14/11 com esta forma: 5 de 5 verdes, 552–580 -> 109–118 ms;
    // sem o cache a razão volta a ~1x e o teste reprova). O ganho de verdade da 52.2 é o do laço do app (4,4 s -> 0 janela
    // > 50 ms, ~/operacao/medidas/v1522-laco-*.txt), que soma o pulo das tarefas já no nível 2 e as pausas.
    let velho = Infinity;
    let novo = Infinity;
    for (let k = 0; k < 5; k++) {
      velho = Math.min(velho, medir((a, b) => antes.horasUteisEntre(a, b)));
      novo = Math.min(novo, medir((a, b) => horasUteisEntre(a, b)));
    }
    process.stdout.write(`\n[medida] 619 tarefas: antes ${velho.toFixed(0)} ms, agora ${novo.toFixed(0)} ms\n`);
    expect(novo).toBeLessThan(velho / 3);
  }, 60_000);
});
