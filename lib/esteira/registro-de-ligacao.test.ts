import { describe, expect, it } from "vitest";
import { PADRAO_DA_ESTEIRA, type ConfigDaEsteira } from "./config";
import { instanteLocal } from "./horas-uteis";
import { efeitosDoRegistro, registroDeLigacaoSchema } from "./registro-de-ligacao";

const E = "00000000-0000-4000-8000-0000000000e1";
const F = "00000000-0000-4000-8000-0000000000f1";
const AG = "00000000-0000-4000-8000-000000000102";
const VOLTOU = "00000000-0000-4000-8000-000000000205";
const cfg: ConfigDaEsteira = {
  ...PADRAO_DA_ESTEIRA,
  funis: {
    entrada: { pipeline_id: E, horas: 72, etapas_de_compromisso: [AG] },
    followup: { pipeline_id: F, fases: [{ ate_dia: 10, etapa_id: VOLTOU }], etapa_reengajou: VOLTOU },
  },
};
const sp = (h: string) => instanteLocal(2026, 10, 19, h, "America/Sao_Paulo");
const L = { source_kind: "ligacao:L2" };

describe("schema dos 3 campos", () => {
  it("atendeu exige próximo passo; não atendeu não exige", () => {
    expect(registroDeLigacaoSchema.safeParse({ atendeu: true, resumo: "Falei com ele" }).success).toBe(false);
    expect(registroDeLigacaoSchema.safeParse({ atendeu: false, resumo: "Caixa postal" }).success).toBe(true);
  });
  it("sem interesse exige motivo do vocabulário (o do sistema fica de fora)", () => {
    const base = { atendeu: true, resumo: "Comprou em outra loja" };
    expect(registroDeLigacaoSchema.safeParse({ ...base, proximo: { tipo: "sem_interesse", motivo: "price" } }).success).toBe(true);
    expect(
      registroDeLigacaoSchema.safeParse({ ...base, proximo: { tipo: "sem_interesse", motivo: "moved_to_another_pipeline" } }).success,
    ).toBe(false);
  });
});

describe("efeitos", () => {
  it("não atendeu: 1 retentativa em 2 h úteis, no máximo até o fim do expediente", () => {
    const e = efeitosDoRegistro({ atendeu: false, resumo: "Não atendeu" }, L, null, cfg, sp("10:00"));
    expect(e).toEqual([expect.objectContaining({ tipo: "nova_ligacao", sourceKind: "ligacao:retentativa", venceEm: sp("12:00") })]);
    const tarde = efeitosDoRegistro({ atendeu: false, resumo: "Não atendeu" }, L, null, cfg, sp("17:00"));
    expect(tarde[0]).toEqual(expect.objectContaining({ venceEm: sp("18:00") }));
  });
  it("a retentativa que não atende não gera outra", () => {
    expect(efeitosDoRegistro({ atendeu: false, resumo: "Nada" }, { source_kind: "ligacao:retentativa" }, null, cfg, sp("10:00"))).toEqual([]);
  });
  it("agendou: entrada → coluna de compromisso; follow-up → Reengajou; e cancela as pendentes", () => {
    const r = { atendeu: true, resumo: "Vem sábado", proximo: { tipo: "agendou" as const, data: sp("11:00").toISOString() } };
    expect(efeitosDoRegistro(r, L, { pipelineId: E, status: "open" }, cfg, sp("10:00"))).toEqual([
      { tipo: "mover", etapaId: AG },
      { tipo: "cancelar_ligacoes_pendentes" },
    ]);
    expect(efeitosDoRegistro(r, L, { pipelineId: F, status: "open" }, cfg, sp("10:00"))[0]).toEqual({ tipo: "mover", etapaId: VOLTOU });
  });
  it("retornar: ligação de retorno na data combinada", () => {
    const quando = sp("15:00").toISOString();
    const e = efeitosDoRegistro({ atendeu: true, resumo: "Liga depois", proximo: { tipo: "retornar", data: quando } }, L, null, cfg, sp("10:00"));
    expect(e).toEqual([expect.objectContaining({ tipo: "nova_ligacao", sourceKind: "ligacao:retorno", venceEm: new Date(quando) })]);
  });
  it("sem interesse: cancela pendentes e perde com o motivo (só se aberto)", () => {
    const r = { atendeu: true, resumo: "Desistiu", proximo: { tipo: "sem_interesse" as const, motivo: "price" } };
    expect(efeitosDoRegistro(r, L, { pipelineId: E, status: "open" }, cfg, sp("10:00"))).toEqual([
      { tipo: "cancelar_ligacoes_pendentes" },
      { tipo: "perder", motivo: "price", detalhe: null },
    ]);
    expect(efeitosDoRegistro(r, L, { pipelineId: E, status: "won" }, cfg, sp("10:00"))).toEqual([{ tipo: "cancelar_ligacoes_pendentes" }]);
  });
});
