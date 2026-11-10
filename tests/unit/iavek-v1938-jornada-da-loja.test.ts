import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { horariosLivres } from "@/lib/agenda/horarios-livres";
import { jornadaDaGrade, lerJornadaDoBanco } from "@/lib/agenda/jornada";
import { JORNADA_DA_LOJA } from "@/lib/iavek/jornada-da-loja";
import { estaDePlantao, isAttendantEligible, isWithinSchedule } from "@/lib/routing/eligibility";

/**
 * ia.vek v1.9.38 (CRM-255) — "Novo agendamento" não trava mais na loja por falta de jornada.
 *
 * O Rodrigo testou na produção (10/11): a data não dava para escolher e aparecia "A jornada de
 * atendimento ainda não foi publicada". Na LOJA, quem não publicou jornada passa a ver o HORÁRIO DA LOJA
 * na grade (seg–sex 9–18, sáb 9–14). Nada é gravado em `attendant_availability`, então a distribuição
 * automática de conversas não muda.
 */
const TER_9H_SP = new Date("2026-11-17T12:00:00Z"); // terça 09:00 em São Paulo (os começos andam de 1h30 em 1h30)
const SEMANA = { de: new Date("2026-11-16T03:00:00Z"), ate: new Date("2026-11-23T03:00:00Z") }; // seg 00h → seg 00h (SP)
const TIPO = { duracaoMin: 90, bufferAntesMin: 0, bufferDepoisMin: 0, avisoMinimoMin: 0, janelaDias: 60 };
const AGORA = new Date("2026-11-15T12:00:00Z");

const slotsDa = (jornada: { timezone: string; windows: { dow: number; start: string; end: string }[] }) =>
  horariosLivres({ jornada, excecoes: [], ocupados: [], tipo: TIPO, ...SEMANA, agora: AGORA });

describe("(1) loja, pessoa SEM jornada → a grade abre com o horário da loja", () => {
  it("linha inexistente e windows vazio viram o horário da loja, publicado", () => {
    for (const doBanco of [null, undefined, {}, { timezone: "America/Sao_Paulo", windows: [] }]) {
      const l = jornadaDaGrade(doBanco, JORNADA_DA_LOJA);
      expect(l.ok).toBe(true);
      if (!l.ok) continue;
      expect(l.publicouHorarios).toBe(true);
      expect(l.usouReserva).toBe(true);
      expect(l.jornada).toEqual({ timezone: "America/Sao_Paulo", windows: JORNADA_DA_LOJA.windows });
    }
  });

  it("v1.9.40: o horário da loja é 24h, todos os dias (00:00–23:59), sem trava", () => {
    expect(JORNADA_DA_LOJA.windows).toEqual([0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "00:00", end: "23:59" })));
    const l = jornadaDaGrade(null, JORNADA_DA_LOJA);
    if (!l.ok) throw new Error("devia ler");
    const slots = slotsDa(l.jornada);
    expect(slots.some((s) => s.inicio.getTime() === TER_9H_SP.getTime())).toBe(true);
    const diaSP = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
    const horaSP = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(d);
    // Os 7 dias, inclusive domingo.
    expect(new Set(slots.map((s) => diaSP(s.inicio))).size).toBe(7);
    // Um dia: de 1h30 em 1h30 desde a meia-noite; o 22:30 não cabe (terminaria depois de 23:59).
    const terca = slots.filter((s) => diaSP(s.inicio) === "Tue").map((s) => horaSP(s.inicio));
    expect(terca).toEqual(["00:00", "01:30", "03:00", "04:30", "06:00", "07:30", "09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"]);
  });
});

describe("(2) pessoa COM jornada → vale a dela", () => {
  it("a jornada publicada não é trocada pela da loja", () => {
    const dela = { timezone: "America/Sao_Paulo", windows: [{ dow: 3, start: "14:00", end: "16:00" }] };
    const l = jornadaDaGrade(dela, JORNADA_DA_LOJA);
    expect(l).toMatchObject({ ok: true, publicouHorarios: true, jornada: dela });
    expect("usouReserva" in l && l.usouReserva).toBeFalsy();
  });

  it("jornada CORROMPIDA segue sendo recusa nomeada (não é escondida pela da loja)", () => {
    expect(jornadaDaGrade({ windows: [{ dow: 9, start: "x", end: "y" }] }, JORNADA_DA_LOJA).ok).toBe(false);
  });
});

describe("(3) clínica (modo agendamento) sem jornada → o aviso de hoje", () => {
  it("sem reserva, é exatamente a leitura de antes", () => {
    for (const doBanco of [null, { timezone: "America/Sao_Paulo", windows: [] }]) {
      expect(jornadaDaGrade(doBanco, null)).toEqual(lerJornadaDoBanco(doBanco));
    }
    const vazio = jornadaDaGrade({ timezone: "America/Sao_Paulo", windows: [] }, null);
    expect(vazio).toMatchObject({ ok: true, publicouHorarios: false });
  });

  it("a rota da grade só manda a reserva fora do modo agendamento; a IA e a criação não mandam", () => {
    const rota = readFileSync("app/api/v1/agenda/horarios-livres/route.ts", "utf8");
    expect(rota).toContain("jornadaSeNaoPublicou: naClinica ? null : JORNADA_DA_LOJA,");
    for (const outro of ["lib/mcp/tools/agendamento.ts", "app/api/v1/agenda/agendamentos/_handler.ts"]) {
      expect(readFileSync(outro, "utf8")).not.toContain("jornadaSeNaoPublicou");
    }
  });
});

describe("(4) a distribuição de conversas não muda", () => {
  it("nada da distribuição lê o horário da loja", () => {
    for (const arq of ["lib/routing/eligibility.ts", "lib/routing/eligibles.ts", "lib/routing/queue.ts", "lib/routing/worker.ts"]) {
      const fonte = readFileSync(arq, "utf8");
      expect(fonte, arq).not.toContain("jornada-da-loja");
      expect(fonte, arq).not.toContain("jornadaDaGrade");
    }
  });

  it("quem não publicou jornada continua elegível a qualquer hora (domingo 22h)", () => {
    const domingo22h = new Date("2026-11-23T01:00:00Z"); // dom 22:00 em SP
    expect(isWithinSchedule({ timezone: "America/Sao_Paulo", windows: [] }, domingo22h)).toBe(true);
    expect(isWithinSchedule(null, domingo22h)).toBe(true);
    expect(estaDePlantao({ isAvailable: true, schedule: { timezone: "America/Sao_Paulo", windows: [] } }, domingo22h)).toBe(true);
    expect(isAttendantEligible({ isAvailable: true, capacity: 5, currentLoad: 0, schedule: null }, domingo22h)).toBe(true);
  });

  it("a criação continua sem tocar attendant_availability (não publica jornada de ninguém)", () => {
    const consulta = readFileSync("lib/agenda/consulta.ts", "utf8");
    expect(consulta).not.toMatch(/from\("attendant_availability"\)\s*\.(insert|update|upsert)/);
  });
});
