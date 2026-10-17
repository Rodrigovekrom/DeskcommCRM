/**
 * ia.vek v1.5 (parte A): o cronômetro das 72h corridas do lead novo e a regra
 * de quem deve o próximo passo.
 */
import { describe, expect, it } from "vitest";
import {
  corDoCronometro,
  cronometroDoLead,
  entradaDaEsteira,
  textoDoRestante,
} from "@/lib/iavek/cronometro-72h";
import { exigeProximoPasso, quandoPadrao } from "@/lib/iavek/proximo-passo";

const FUNIL = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const AGENDADO = "33333333-3333-4333-8333-333333333333";
const NOVO = "44444444-4444-4444-8444-444444444444";
const HORA = 3_600_000;

const settings = {
  esteira: {
    ativa: false,
    entrada: { pipeline_id: FUNIL, horas: 72, etapas_de_compromisso: [AGENDADO] },
  },
};

describe("cronômetro das 72h", () => {
  const entrada = entradaDaEsteira(settings);
  const lead = {
    status: "open",
    pipeline_id: FUNIL,
    stage_id: NOVO,
    created_at: "2026-10-17T10:00:00.000Z",
  };

  it("lê o funil de entrada mesmo com a esteira desligada", () => {
    expect(entrada?.pipeline_id).toBe(FUNIL);
    expect(entradaDaEsteira({})).toBeNull();
    expect(entradaDaEsteira({ esteira: { entrada: { pipeline_id: "x" } } })).toBeNull();
  });

  it("vence 72h CORRIDAS depois da criação do lead", () => {
    expect(cronometroDoLead(lead, entrada)).toEqual({
      inicio: "2026-10-17T10:00:00.000Z",
      fim_em: "2026-10-20T10:00:00.000Z",
      horas: 72,
    });
  });

  it("some em coluna de compromisso, fora do funil de entrada ou com o lead fechado", () => {
    expect(cronometroDoLead({ ...lead, stage_id: AGENDADO }, entrada)).toBeNull();
    expect(cronometroDoLead({ ...lead, pipeline_id: OUTRO }, entrada)).toBeNull();
    expect(cronometroDoLead({ ...lead, status: "won" }, entrada)).toBeNull();
    expect(cronometroDoLead(null, entrada)).toBeNull();
    expect(cronometroDoLead(lead, null)).toBeNull();
  });

  it("verde acima de 24h, âmbar entre 6h e 24h, vermelho abaixo de 6h e vencido", () => {
    expect(corDoCronometro(50 * HORA)).toBe("verde");
    expect(corDoCronometro(24 * HORA)).toBe("ambar");
    expect(corDoCronometro(7 * HORA)).toBe("ambar");
    expect(corDoCronometro(6 * HORA)).toBe("vermelho");
    expect(corDoCronometro(-1 * HORA)).toBe("vermelho");
  });

  it("escreve o tempo que falta (ou há quanto venceu)", () => {
    expect(textoDoRestante(51 * HORA + 12 * 60_000)).toEqual({
      texto: "51h 12min",
      vencido: false,
    });
    expect(textoDoRestante(38 * 60_000)).toEqual({ texto: "38min", vencido: false });
    expect(textoDoRestante(-2 * HORA)).toEqual({ texto: "2h 00min", vencido: true });
  });
});

describe("próximo passo obrigatório", () => {
  const conversa = {
    assignee_kind: "user",
    assigned_to_user_id: "eu",
    is_group: false,
    contact_id: "c1",
  };

  it("vale só para o humano DONO da conversa", () => {
    expect(exigeProximoPasso(conversa, "eu")).toBe(true);
    expect(exigeProximoPasso(conversa, "outra-pessoa")).toBe(false);
  });

  it("nunca enquanto a IA atende, em conversa sem dono, em grupo ou sem contato", () => {
    expect(exigeProximoPasso({ ...conversa, assignee_kind: "ai" }, "eu")).toBe(false);
    expect(
      exigeProximoPasso({ ...conversa, assignee_kind: null, assigned_to_user_id: null }, "eu"),
    ).toBe(false);
    expect(exigeProximoPasso({ ...conversa, is_group: true }, "eu")).toBe(false);
    expect(exigeProximoPasso({ ...conversa, contact_id: null }, "eu")).toBe(false);
    expect(exigeProximoPasso(null, "eu")).toBe(false);
  });

  it("sugere amanhã às 10h", () => {
    const d = quandoPadrao(new Date(2026, 9, 17, 15, 30));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 9, 18, 10, 0,
    ]);
  });
});
