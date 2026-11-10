import { describe, expect, it } from "vitest";
import { PADRAO_DA_ESTEIRA, configDaEsteira, type ConfigDaEsteira } from "./config";
import { instanteLocal } from "./horas-uteis";
import {
  DIA,
  HORA,
  diaDeVida,
  faseDoDia,
  contagemSemRetorno,
  entraNoSemRetorno,
  fimDaUltimaFase,
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
  falhaNaPerda?: boolean;
  /** v1.9.41: quantos do lote antigo já passaram hoje. */
  loteHoje?: number;
}) {
  const log = {
    passados: [] as string[],
    loteAntigo: [] as Array<[string, string, boolean]>,
    movidos: [] as Array<[string, string]>,
    criadas: [] as Array<[string, CodigoDeLigacao, Date]>,
    cobrancas: [] as Array<[string, number, string]>,
    reengajos: [] as string[],
    perdidos: [] as Array<[string, string]>,
  };
  const deps: DepsDaEsteira = {
    agora: () => AGORA,
    leadsAbertos: async (pid) => (pid === E ? (o.entrada ?? []) : (o.followup ?? [])),
    passadosDoLoteAntigoDesde: async () => o.loteHoje ?? 0,
    passarParaFollowup: async (l, etapa, lote) => {
      if (o.falhaNaPassagem) return { ok: false, erro: "x" };
      log.passados.push(l.id);
      if (lote) log.loteAntigo.push([l.id, lote.dono, lote.soL3]);
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
    perderSemRetorno: async (l, motivo) => {
      if (o.falhaNaPerda) return false;
      log.perdidos.push([l.id, motivo]);
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
  it("D6: a idade das 72h conta do NASCIMENTO no ciclo (esteira_inicio), não da criação da linha", async () => {
    // Lead reativado: a linha nasceu há 100 h, o ciclo novo começou há 10 h.
    const reativado = lead({ id: "reativado", created_at: ha(100 * HORA), inicio: ha(10 * HORA) });
    // O contrário: linha recente, ciclo vencido (clone que herdou o início).
    const vencido = lead({ id: "vencido", created_at: ha(1 * HORA), inicio: ha(80 * HORA) });
    const { deps, log } = montar({ entrada: [reativado, vencido] });
    await rodarEsteira(cfg, deps);
    expect(log.passados).toEqual(["vencido"]);
  });

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

  it("v1.9.23: cliente que falou nas últimas 72h não passa; quem não falou passa", async () => {
    const { deps, log } = montar({
      entrada: [lead({ id: "falou", created_at: ha(80 * HORA) }), lead({ id: "calado", created_at: ha(80 * HORA) })],
      falou: ["falou"],
    });
    const r = await rodarEsteira(cfg, deps);
    expect(log.passados).toEqual(["calado"]);
    expect(r.seguradosResposta).toBe(1);
  });

  it("v1.9.23: 'Manter em negociação' segura até a data; vencida, segue a regra", async () => {
    const futuro = new Date(AGORA.getTime() + 10 * HORA).toISOString();
    const passado = new Date(AGORA.getTime() - HORA).toISOString();
    const { deps, log } = montar({
      entrada: [
        lead({ id: "mantido", created_at: ha(80 * HORA), manter_ate: futuro }),
        lead({ id: "venceu", created_at: ha(80 * HORA), manter_ate: passado }),
      ],
    });
    const r = await rodarEsteira(cfg, deps);
    expect(log.passados).toEqual(["venceu"]);
    expect(r.seguradosManter).toBe(1);
  });

  it("v1.9.23: a pergunta 'falou?' olha as últimas 72h corridas", async () => {
    const pedidos: Date[] = [];
    const { deps } = montar({ entrada: [lead({ id: "x", created_at: ha(100 * HORA) })] });
    deps.clienteFalouDesde = async (_l, desde) => {
      pedidos.push(desde);
      return false;
    };
    await rodarEsteira(cfg, deps);
    expect(pedidos.map((d) => AGORA.getTime() - d.getTime())).toEqual([72 * HORA]);
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

describe("CRM-141: terminou o follow-up sem retorno vira Perdido", () => {
  // Última fase vai até o dia 90: termina 90 dias depois do nascimento.
  const ligada = (desde: Date): ConfigDaEsteira => ({ ...cfg, semRetorno: { desde: desde.toISOString(), motivo: "no_response" } });
  const naUltima = (id: string, diasDeVida: number) => lead({ id, stage_id: F61, created_at: ha(diasDeVida * DIA), inicio: ha(diasDeVida * DIA) });

  it("desligada (padrão): ninguém é perdido, fica na última fase como antes", async () => {
    const { deps, log } = montar({ followup: [naUltima("velho", 120)] });
    const r = await rodarEsteira(cfg, deps);
    expect(log.perdidos).toEqual([]);
    expect(r.perdidosSemRetorno).toBe(0);
  });

  it("fim da última fase = início + ate_dia da última; entra só quem terminou DEPOIS de ligar", () => {
    const f = cfg.funis!.followup.fases;
    const inicio = new Date(AGORA.getTime() - 91 * DIA);
    expect(fimDaUltimaFase(f, inicio).getTime()).toBe(inicio.getTime() + 90 * DIA);
    expect(entraNoSemRetorno(f, inicio, AGORA, new Date(AGORA.getTime() - 2 * DIA))).toBe(true); // terminou ontem, ligada anteontem
    expect(entraNoSemRetorno(f, inicio, AGORA, new Date(AGORA.getTime() - 12 * HORA))).toBe(false); // terminou antes de ligar
    expect(entraNoSemRetorno(f, new Date(AGORA.getTime() - 89 * DIA), AGORA, new Date(0))).toBe(false); // ainda no dia 90
  });

  it("ligada: quem terminou depois vira Perdido com o motivo; quem terminou antes e quem ainda está na fase, não", async () => {
    const desde = new Date(AGORA.getTime() - 5 * DIA);
    const { deps, log } = montar({
      followup: [naUltima("terminou-depois", 92), naUltima("terminou-antes", 100), naUltima("ainda-no-dia-80", 79)],
    });
    const r = await rodarEsteira(ligada(desde), deps);
    expect(log.perdidos).toEqual([["terminou-depois", "no_response"]]);
    expect(r.perdidosSemRetorno).toBe(1);
    // perdido não ganha ligação nem movimento de fase
    expect(log.criadas.filter(([id]) => id === "terminou-depois")).toEqual([]);
    expect(log.movidos.filter(([id]) => id === "terminou-depois")).toEqual([]);
  });

  it("quem voltou a falar vai para Reengajou, nunca para Perdido", async () => {
    const { deps, log } = montar({ followup: [naUltima("falou", 92)], falou: ["falou"] });
    await rodarEsteira(ligada(new Date(AGORA.getTime() - 5 * DIA)), deps);
    expect(log.perdidos).toEqual([]);
    expect(log.reengajos).toEqual(["falou"]);
  });

  it("coluna que não é fase (Reengajou) não é tocada", async () => {
    const voltou = lead({ id: "voltou", stage_id: VOLTOU, created_at: ha(92 * DIA), inicio: ha(92 * DIA) });
    const { deps, log } = montar({ followup: [voltou] });
    await rodarEsteira(ligada(new Date(AGORA.getTime() - 5 * DIA)), deps);
    expect(log.perdidos).toEqual([]);
  });

  it("falha ao perder é contada e a rodada segue", async () => {
    const { deps } = montar({ followup: [naUltima("x", 92)], falhaNaPerda: true });
    const r = await rodarEsteira(ligada(new Date(AGORA.getTime() - 5 * DIA)), deps);
    expect(r.falhasSemRetorno).toBe(1);
    expect(r.perdidosSemRetorno).toBe(0);
  });

  it("contagem antes de ligar: os que vão entrar e os que já terminaram (ficam de fora)", () => {
    const f = cfg.funis!.followup.fases;
    const c = contagemSemRetorno(
      f,
      [naUltima("a", 100), naUltima("b", 91), naUltima("c", 40), lead({ id: "d", stage_id: VOLTOU, inicio: ha(100 * DIA) })],
      AGORA,
    );
    expect(c).toEqual({ vaoEntrar: 1, jaTerminaram: 2 });
  });
});

describe("v1.9.41: o LOTE ANTIGO (nascidos antes de `desde`)", () => {
  const DESDE = ha(5 * DIA);
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";
  const comLote = (lote: Record<string, unknown> | undefined): ConfigDaEsteira => ({
    ...cfg,
    funis: { ...cfg.funis!, entrada: { ...cfg.funis!.entrada, desde: DESDE, ...(lote ? { lote_antigo: lote as never } : {}) } },
  });
  // Três antigos (nascidos antes de DESDE) e um novo vencido.
  const antigos = [
    lead({ id: "velho-3", created_at: ha(8 * DIA) }),
    lead({ id: "velho-1", created_at: ha(20 * DIA) }),
    lead({ id: "velho-2", created_at: ha(12 * DIA) }),
  ];
  const novo = lead({ id: "novo", created_at: ha(4 * DIA) });

  it("desligado (o padrão) ou sem lote: os antigos não são tocados, como na v1.9.4", async () => {
    for (const c of [comLote(undefined), comLote({ ativo: false, por_dia: 50, donos: [A], so_l3: false })]) {
      const { deps, log } = montar({ entrada: [...antigos, novo] });
      const r = await rodarEsteira(c, deps);
      expect(log.passados).toEqual(["novo"]);
      expect(r.passadosLoteAntigo).toBe(0);
    }
  });

  it("ligado: passa até `por_dia`, do mais antigo para o mais novo, com dono em rodízio", async () => {
    const { deps, log } = montar({ entrada: [...antigos, novo] });
    const r = await rodarEsteira(comLote({ ativo: true, por_dia: 2, donos: [A, B], so_l3: false }), deps);
    expect(log.passados).toEqual(["novo", "velho-1", "velho-2"]);
    expect(log.loteAntigo).toEqual([
      ["velho-1", A, false],
      ["velho-2", B, false],
    ]);
    expect(r.passadosLoteAntigo).toBe(2);
    // L3 na passagem para cada um (o novo e os dois antigos).
    expect(log.criadas.filter(([, c]) => c === "L3").map(([id]) => id)).toEqual(["novo-fu", "velho-1-fu", "velho-2-fu"]);
  });

  it("a cota é do DIA: o que já passou hoje conta, e o rodízio continua de onde parou", async () => {
    const { deps, log } = montar({ entrada: antigos, loteHoje: 1 });
    await rodarEsteira(comLote({ ativo: true, por_dia: 2, donos: [A, B], so_l3: false }), deps);
    expect(log.loteAntigo).toEqual([["velho-1", B, false]]);
    const cheia = montar({ entrada: antigos, loteHoje: 2 });
    await rodarEsteira(comLote({ ativo: true, por_dia: 2, donos: [A, B], so_l3: false }), cheia.deps);
    expect(cheia.log.passados).toEqual([]);
  });

  it("as exceções valem: cliente que falou nas últimas 72h fica, e o próximo entra no lugar", async () => {
    const { deps, log } = montar({ entrada: antigos, falou: ["velho-1"] });
    const r = await rodarEsteira(comLote({ ativo: true, por_dia: 1, donos: [A], so_l3: false }), deps);
    expect(log.passados).toEqual(["velho-2"]);
    expect(r.seguradosResposta).toBe(1);
  });

  it("`a_partir_de` deixa de fora os mais antigos ainda", async () => {
    const { deps, log } = montar({ entrada: antigos });
    await rodarEsteira(comLote({ ativo: true, por_dia: 10, donos: [A], so_l3: false, a_partir_de: ha(15 * DIA) }), deps);
    expect(log.passados).toEqual(["velho-2", "velho-3"]);
  });

  it("só L3: o clone do lote antigo não ganha a L4 de recuperação; sem a marca, ganha", async () => {
    const clone = (soL3: boolean) =>
      lead({ id: soL3 ? "so-l3" : "normal", stage_id: F11, created_at: ha(1 * HORA), inicio: ha(20 * DIA), lote_antigo_so_l3: soL3 });
    const { deps, log } = montar({ followup: [clone(true), clone(false)] });
    await rodarEsteira(comLote(undefined), deps);
    expect(log.criadas.filter(([, c]) => c === "L4").map(([id]) => id)).toEqual(["normal"]);
  });

  it("a configuração: desligada por padrão e nunca sem dono", () => {
    const base = { ativa: true, entrada: { pipeline_id: E, desde: DESDE }, followup: cfg.funis!.followup };
    const ler = (lote: unknown) => configDaEsteira({ esteira: { ...base, entrada: { ...base.entrada, lote_antigo: lote } } });
    expect(ler({ por_dia: 50, donos: [A] }).funis?.entrada.lote_antigo).toMatchObject({ ativo: false, so_l3: false });
    // Lista de donos vazia derruba a configuração inteira (cai no padrão desligado).
    expect(ler({ ativo: true, por_dia: 50, donos: [] }).funis).toBeNull();
  });
});
