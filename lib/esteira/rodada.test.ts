import { describe, expect, it } from "vitest";
import { PADRAO_DA_ESTEIRA, type ConfigDaEsteira } from "./config";
import { instanteLocal } from "./horas-uteis";
import {
  DIA,
  HORA,
  diaDeVida,
  faseDoDia,
  ligacaoDoFollowupDevida,
  rodarEsteira,
  sourceKindDaLigacao,
  type CodigoDeLigacao,
  type DepsDaEsteira,
  type LeadDaEsteira,
  type LigacaoPendente,
} from "./rodada";

const E = "00000000-0000-4000-8000-0000000000e1"; // funil de entrada
const F = "00000000-0000-4000-8000-0000000000f1"; // funil de follow-up
const NOVO = "00000000-0000-4000-8000-000000000101";
const AGENDADO = "00000000-0000-4000-8000-000000000102";
const F3 = "00000000-0000-4000-8000-000000000201";
const F11 = "00000000-0000-4000-8000-000000000202";
const F31 = "00000000-0000-4000-8000-000000000203";
const F61 = "00000000-0000-4000-8000-000000000204";
const VOLTOU = "00000000-0000-4000-8000-000000000205";

const cfg: ConfigDaEsteira = {
  ...PADRAO_DA_ESTEIRA,
  funis: {
    entrada: { pipeline_id: E, horas: 72, etapas_de_compromisso: [AGENDADO] },
    followup: {
      pipeline_id: F,
      fases: [
        { ate_dia: 10, etapa_id: F3 },
        { ate_dia: 30, etapa_id: F11 },
        { ate_dia: 60, etapa_id: F31 },
        { ate_dia: 90, etapa_id: F61 },
      ],
      etapa_reengajou: VOLTOU,
    },
  },
};

// Segunda, 19/10/2026, 10h em São Paulo.
const AGORA = instanteLocal(2026, 10, 19, "10:00", "America/Sao_Paulo");
const ha = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();

function lead(p: Partial<LeadDaEsteira> & { id: string }): LeadDaEsteira {
  const created = p.created_at ?? ha(HORA);
  return { contact_id: "c-" + p.id, stage_id: NOVO, owner_user_id: null, inicio: created, created_at: created, ...p };
}

function montar(o: {
  entrada?: LeadDaEsteira[];
  followup?: LeadDaEsteira[];
  handoff?: string[];
  falou?: string[];
  ligacoes?: Record<string, string[]>;
  vencidas?: LigacaoPendente[];
  cobradas?: Record<string, number[]>;
  falhaNaPassagem?: boolean;
}) {
  const log = {
    passados: [] as string[],
    movidos: [] as Array<[string, string]>,
    criadas: [] as Array<[string, CodigoDeLigacao, Date]>,
    cobrancas: [] as Array<[string, number, string]>,
    reengajos: [] as string[],
  };
  const deps: DepsDaEsteira = {
    agora: () => AGORA,
    leadsAbertos: async (pid) => (pid === E ? (o.entrada ?? []) : (o.followup ?? [])),
    passarParaFollowup: async (l, etapa) => {
      if (o.falhaNaPassagem) return { ok: false, erro: "x" };
      log.passados.push(l.id);
      return { ok: true, lead: { ...l, id: l.id + "-fu", stage_id: etapa, created_at: AGORA.toISOString(), inicio: l.created_at } };
    },
    mover: async (l, etapa) => {
      log.movidos.push([l.id, etapa]);
      return true;
    },
    comHandoff: async (ids) => new Set(ids.filter((i) => o.handoff?.includes(i))),
    clienteFalouDesde: async (l) => o.falou?.includes(l.id) ?? false,
    ultimoReengajo: async () => null,
    marcarReengajou: async (l) => {
      log.reengajos.push(l.id);
    },
    ligacoesJaCriadas: async (ids) =>
      new Map(ids.map((i) => [i, new Set((o.ligacoes?.[i] ?? []).map((c) => sourceKindDaLigacao(c as CodigoDeLigacao)))])),
    criarLigacao: async (l, c, v) => {
      log.criadas.push([l.id, c, v]);
      return true;
    },
    ligacoesVencidas: async () => o.vencidas ?? [],
    cobrancasFeitas: async (ids) => new Map(ids.map((i) => [i, new Set(o.cobradas?.[i] ?? [])])),
    cobrar: async (t, n, d) => {
      log.cobrancas.push([t.id, n, d.tipo === "papel" ? d.papel : d.usuario_id]);
    },
  };
  return { deps, log };
}

describe("regras puras", () => {
  it("dia de vida começa em 1", () => {
    expect(diaDeVida(AGORA, AGORA)).toBe(1);
    expect(diaDeVida(new Date(AGORA.getTime() - 10 * DIA), AGORA)).toBe(11);
  });
  it("fase do dia: 3–10, 11–30, 31–60, 61–90 e fica na última depois", () => {
    const f = cfg.funis!.followup.fases;
    expect(faseDoDia(f, 4)).toBe(F3);
    expect(faseDoDia(f, 11)).toBe(F11);
    expect(faseDoDia(f, 60)).toBe(F31);
    expect(faseDoDia(f, 120)).toBe(F61);
  });
  it("ligação devida no follow-up é só a mais recente alcançada", () => {
    expect(ligacaoDoFollowupDevida(2)).toBeNull();
    expect(ligacaoDoFollowupDevida(10)).toBe("L3");
    expect(ligacaoDoFollowupDevida(11)).toBe("L4");
    expect(ligacaoDoFollowupDevida(40)).toBe("L5");
    expect(ligacaoDoFollowupDevida(85)).toBe("L7");
  });
});

describe("rodada", () => {
  it("esteira desligada não faz nada", async () => {
    const { deps, log } = montar({ entrada: [lead({ id: "a", created_at: ha(100 * HORA) })] });
    const r = await rodarEsteira({ ...cfg, funis: null }, deps);
    expect(r.passados).toBe(0);
    expect(log.passados).toEqual([]);
  });

  it("72h: passa UMA vez para o follow-up e cria L3; quem tem compromisso fica", async () => {
    const { deps, log } = montar({
      entrada: [
        lead({ id: "velho", created_at: ha(73 * HORA) }),
        lead({ id: "agendado", created_at: ha(80 * HORA), stage_id: AGENDADO }),
        lead({ id: "novo", created_at: ha(10 * HORA) }),
      ],
    });
    const r = await rodarEsteira(cfg, deps);
    expect(log.passados).toEqual(["velho"]);
    expect(log.criadas.map(([id, c]) => [id, c])).toEqual([["velho-fu", "L3"]]);
    expect(r.passados).toBe(1);
  });

  it("L1 depois do handoff (1 h útil) e L2 com 48 h, sem repetir", async () => {
    const { deps, log } = montar({
      entrada: [
        lead({ id: "h", created_at: ha(5 * HORA) }),
        lead({ id: "d2", created_at: ha(49 * HORA) }),
        lead({ id: "ja", created_at: ha(49 * HORA) }),
      ],
      handoff: ["h"],
      ligacoes: { ja: ["L2"] },
    });
    await rodarEsteira(cfg, deps);
    expect(log.criadas.map(([id, c]) => [id, c])).toEqual([
      ["h", "L1"],
      ["d2", "L2"],
    ]);
    // L1 vence 1 hora útil depois (segunda 10h → 11h).
    expect(log.criadas[0]![2].toISOString()).toBe(instanteLocal(2026, 10, 19, "11:00", "America/Sao_Paulo").toISOString());
  });

  it("falha na passagem é contada e não cria ligação", async () => {
    const { deps, log } = montar({ entrada: [lead({ id: "v", created_at: ha(80 * HORA) })], falhaNaPassagem: true });
    const r = await rodarEsteira(cfg, deps);
    expect(r.falhasNaPassagem).toBe(1);
    expect(log.criadas).toEqual([]);
  });

  it("fases andam só para a frente, e a ligação do dia nasce", async () => {
    const { deps, log } = montar({
      followup: [
        lead({ id: "d12", stage_id: F3, inicio: ha(11 * DIA), created_at: ha(8 * DIA) }),
        lead({ id: "manual", stage_id: F31, inicio: ha(11 * DIA), created_at: ha(8 * DIA) }),
      ],
      ligacoes: { manual: ["L4"] },
    });
    await rodarEsteira(cfg, deps);
    expect(log.movidos).toEqual([["d12", F11]]);
    expect(log.criadas.map(([id, c]) => [id, c])).toEqual([["d12", "L4"]]);
  });

  it("cliente voltou a falar: Reengajou + ligação quente; não anda de fase", async () => {
    const { deps, log } = montar({
      followup: [lead({ id: "r", stage_id: F3, inicio: ha(12 * DIA), created_at: ha(9 * DIA) })],
      falou: ["r"],
      ligacoes: { r: ["L4"] },
    });
    const r = await rodarEsteira(cfg, deps);
    expect(log.movidos).toEqual([["r", VOLTOU]]);
    expect(log.reengajos).toEqual(["r"]);
    expect(log.criadas.map(([id, c]) => [id, c])).toEqual([["r", "quente"]]);
    expect(r.reengajados).toBe(1);
  });

  it("cobrança: 2 h úteis → nível 1 (gestor); 9 h úteis → nível 2 (admin); uma vez cada", async () => {
    const t = (id: string, vencida: Date): LigacaoPendente => ({
      id,
      lead_id: "l",
      contact_id: null,
      title: "Ligar",
      due_date: vencida.toISOString(),
      assigned_to: null,
    });
    const sp = (dia: number, h: string) => instanteLocal(2026, 10, dia, h, "America/Sao_Paulo");
    const { deps, log } = montar({
      vencidas: [
        t("1h", sp(19, "09:00")), // 1 h útil: ainda não
        t("sexta", sp(16, "17:00")), // sex 17h → seg 10h = 1 + 5 + 1 = 7 h úteis: nível 1
        t("ja1", sp(16, "17:00")),
        t("longe", sp(15, "10:00")), // > 9 h úteis: nível 2
      ],
      cobradas: { ja1: [1] },
    });
    await rodarEsteira(cfg, deps);
    expect(log.cobrancas).toEqual([
      ["sexta", 1, "manager"],
      ["longe", 2, "admin"],
    ]);
  });
});
