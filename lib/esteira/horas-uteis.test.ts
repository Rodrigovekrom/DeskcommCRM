import { describe, expect, it } from "vitest";
import { dentroDoExpediente, horasUteisEntre, instanteLocal, somarHorasUteis } from "./horas-uteis";

const SP = "America/Sao_Paulo";
// 2026-10-16 é sexta-feira; 17 sábado; 18 domingo; 19 segunda.
const em = (dia: number, hhmm: string) => instanteLocal(2026, 10, dia, hhmm, SP);
const iso = (d: Date) => d.toISOString();

describe("somarHorasUteis (horário padrão: seg–sex 9–18, sáb 9–14)", () => {
  it("dentro do expediente: soma direto", () => {
    expect(iso(somarHorasUteis(em(16, "10:00"), 1))).toBe(iso(em(16, "11:00")));
  });
  it("atravessa o fechamento: o resto vai para o próximo dia útil", () => {
    expect(iso(somarHorasUteis(em(16, "17:30"), 1))).toBe(iso(em(17, "09:30")));
  });
  it("criada antes de abrir: começa a contar na abertura", () => {
    expect(iso(somarHorasUteis(em(16, "07:00"), 1))).toBe(iso(em(16, "10:00")));
  });
  it("sábado depois das 14h e domingo não contam: vai para segunda", () => {
    expect(iso(somarHorasUteis(em(17, "15:00"), 1))).toBe(iso(em(19, "10:00")));
    expect(iso(somarHorasUteis(em(18, "11:00"), 2))).toBe(iso(em(19, "11:00")));
  });
  it("sábado curto: 5h do sábado + resto na segunda", () => {
    expect(iso(somarHorasUteis(em(17, "09:00"), 7))).toBe(iso(em(19, "11:00")));
  });
});

describe("horasUteisEntre", () => {
  it("conta só o expediente", () => {
    expect(horasUteisEntre(em(16, "17:00"), em(19, "10:00"))).toBe(1 + 5 + 1);
  });
  it("b antes de a = 0", () => {
    expect(horasUteisEntre(em(16, "12:00"), em(16, "10:00"))).toBe(0);
  });
});

describe("dentroDoExpediente", () => {
  it("sexta 10h sim; sábado 15h e domingo não", () => {
    expect(dentroDoExpediente(em(16, "10:00"))).toBe(true);
    expect(dentroDoExpediente(em(17, "15:00"))).toBe(false);
    expect(dentroDoExpediente(em(18, "10:00"))).toBe(false);
  });
});

describe("instanteLocal", () => {
  it("São Paulo é UTC-3 (sem horário de verão)", () => {
    expect(iso(em(16, "10:00"))).toBe("2026-10-16T13:00:00.000Z");
  });
});
