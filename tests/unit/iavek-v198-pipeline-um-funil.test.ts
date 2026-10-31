import { describe, expect, it } from "vitest";

import {
  avisosDoCartao,
  contarSemTarefa,
  contarTarefas,
  diasParado,
  funisDaLoja,
  funisDaVisao,
  recorteDaFuncao,
  ultimoMovimento,
} from "@/lib/iavek/painel-do-pipeline";

const ENTRADA = "11111111-1111-4111-8111-111111111111";
const FOLLOWUP = "22222222-2222-4222-8222-222222222222";
const PADRAO = "33333333-3333-4333-8333-333333333333";

describe("v1.9.8 — um funil na tela: Novos / Follow-up / Todos", () => {
  it("cada visão mostra os funis certos, na ordem das colunas", () => {
    const funis = { entrada: ENTRADA, followup: FOLLOWUP };
    expect(funisDaVisao("novos", funis)).toEqual([ENTRADA]);
    expect(funisDaVisao("followup", funis)).toEqual([FOLLOWUP]);
    expect(funisDaVisao("todos", funis)).toEqual([ENTRADA, FOLLOWUP]);
  });

  it("sem follow-up declarado: só o funil de entrada, em qualquer visão", () => {
    expect(funisDaVisao("todos", { entrada: ENTRADA, followup: null })).toEqual([ENTRADA]);
    expect(funisDaVisao("followup", { entrada: ENTRADA, followup: null })).toEqual([ENTRADA]);
  });

  it("os funis vêm da esteira (ligada ou não); sem esteira, o padrão e nenhum follow-up", () => {
    const settings = { esteira: { ativa: false, entrada: { pipeline_id: ENTRADA }, followup: { pipeline_id: FOLLOWUP } } };
    expect(funisDaLoja(settings, PADRAO)).toEqual({ entrada: ENTRADA, followup: FOLLOWUP });
    expect(funisDaLoja({}, PADRAO)).toEqual({ entrada: PADRAO, followup: null });
    expect(funisDaLoja(null, null)).toBeNull();
    // Lixo no settings não derruba a tela.
    expect(funisDaLoja({ esteira: { followup: { pipeline_id: "x" } } }, PADRAO)).toEqual({ entrada: PADRAO, followup: null });
    // O mesmo funil nos dois papéis: não há o que alternar.
    expect(funisDaLoja({ esteira: { entrada: { pipeline_id: ENTRADA }, followup: { pipeline_id: ENTRADA } } }, PADRAO)).toEqual({
      entrada: ENTRADA,
      followup: null,
    });
  });

  it("cada papel vê a sua parte: carteira do guardião, do Suporte IA e do vendedor; a loja para gerência e admin", () => {
    expect(recorteDaFuncao("sdr")).toEqual({ tipo: "carteira", lado: "sdr" });
    expect(recorteDaFuncao("suporte")).toEqual({ tipo: "carteira", lado: "sdr" });
    expect(recorteDaFuncao("vendedor")).toEqual({ tipo: "carteira", lado: "vendedor" });
    expect(recorteDaFuncao("gerente")).toEqual({ tipo: "loja" });
    expect(recorteDaFuncao("apoio")).toEqual({ tipo: "loja" });
    expect(recorteDaFuncao(undefined)).toEqual({ tipo: "loja" });
  });
});

describe("v1.9.8 — avisos no cartão", () => {
  const agora = new Date("2026-10-31T15:00:00Z");
  const base = { status: "open", created_at: "2026-10-20T10:00:00Z" };

  it("o último movimento é a troca de etapa ou a atividade, a mais recente", () => {
    expect(ultimoMovimento({ ...base, stage_changed_at: "2026-10-25T10:00:00Z", last_activity_at: "2026-10-28T10:00:00Z" })).toBe(
      "2026-10-28T10:00:00Z",
    );
    expect(ultimoMovimento({ ...base, stage_changed_at: "2026-10-29T10:00:00Z", last_activity_at: null })).toBe("2026-10-29T10:00:00Z");
    expect(ultimoMovimento(base)).toBe("2026-10-20T10:00:00Z");
  });

  it("parado há N dias: a partir de 3 dias inteiros sem movimento", () => {
    expect(diasParado({ ...base, last_activity_at: "2026-10-28T16:00:00Z" }, agora)).toBe(2);
    expect(avisosDoCartao({ ...base, last_activity_at: "2026-10-28T16:00:00Z" }, true, agora).paradoDias).toBeNull();
    expect(avisosDoCartao({ ...base, last_activity_at: "2026-10-28T14:00:00Z" }, true, agora).paradoDias).toBe(3);
    expect(avisosDoCartao(base, true, agora).paradoDias).toBe(11);
  });

  it("sem tarefa: lead aberto sem nenhuma tarefa aberta", () => {
    const novo = { ...base, created_at: "2026-10-31T14:00:00Z" };
    expect(avisosDoCartao(novo, false, agora)).toEqual({ semTarefa: true, paradoDias: null });
    expect(avisosDoCartao(novo, true, agora)).toEqual({ semTarefa: false, paradoDias: null });
  });

  it("lead fechado (vendido, perdido) não avisa nada", () => {
    expect(avisosDoCartao({ ...base, status: "won" }, false, agora)).toEqual({ semTarefa: false, paradoDias: null });
    expect(avisosDoCartao({ ...base, status: "lost" }, false, agora)).toEqual({ semTarefa: false, paradoDias: null });
  });
});

describe("v1.9.8 — contadores fixos", () => {
  const agora = new Date("2026-10-31T15:00:00Z"); // 12:00 em São Paulo
  const hoje = { inicio: new Date("2026-10-31T03:00:00Z"), fim: new Date("2026-11-01T03:00:00Z") };

  it("tarefas de hoje (ainda no prazo) e atrasadas (prazo passou); sem prazo não entra", () => {
    const r = contarTarefas(
      [
        { due_date: "2026-10-31T20:00:00Z" }, // hoje, 17h
        { due_date: "2026-10-31T13:00:00Z" }, // hoje, 10h — já passou: atrasada
        { due_date: "2026-10-29T13:00:00Z" }, // anteontem: atrasada
        { due_date: "2026-11-01T13:00:00Z" }, // amanhã: nenhum dos dois
        { due_date: null },
      ],
      agora,
      hoje,
    );
    expect(r).toEqual({ tarefas_hoje: 1, atrasadas: 2 });
  });

  it("sem tarefa conta os leads abertos sem nenhuma tarefa aberta", () => {
    expect(contarSemTarefa(["a", "b", "c"], new Set(["b"]))).toBe(2);
    expect(contarSemTarefa([], new Set())).toBe(0);
  });
});
