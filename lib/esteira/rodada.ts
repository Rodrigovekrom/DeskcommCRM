/**
 * A RODADA DA ESTEIRA DE VENDAS (ia.vek D3) — chamada pelo cron `esteira-vendas`.
 *
 * Decisões do Rodrigo (15–16/10/2026), na ordem em que a rodada as cumpre:
 *
 *  1. PASSAGEM DAS 72h. Lead aberto no funil de entrada há mais de `horas`, fora
 *     das colunas de compromisso (agendado/vídeo), vai UMA vez para o funil de
 *     follow-up: um clone só, com o histórico ligado (o clone da tela, que grava
 *     a linha "Veio do funil…" e fecha a origem), e a conversa passa para humano.
 *  2. FASES. No follow-up, o lead anda sozinho pelas colunas 3–10 / 11–30 /
 *     31–60 / 61–90 conforme o dia de vida (contado do nascimento no funil de
 *     entrada). Só para a frente; coluna que não é fase não é tocada.
 *  3. REENGAJOU. Cliente do follow-up que voltou a falar vai para "Reengajou" e
 *     gera a ligação de SINAL QUENTE (1 h útil).
 *  4. LIGAÇÕES L1–L7. L1 em até 1 h útil depois do handoff de quem não tem
 *     compromisso; L2 com 48 h; L3 na passagem (dia 3); L4 dia 11; L5 dia 31;
 *     L6 dia 61; L7 dia 85. Uma de cada por negócio, nunca repetida.
 *  5. COBRANÇA. Ligação vencida há `escaladaHoras` úteis cobra o destinatário da
 *     escalada (papel ou usuário, configurável); há `escaladaHorasNivel2`, o
 *     segundo nível. Cada nível uma vez por tarefa.
 *
 * Tudo atrás de `Deps`: a regra é testável sem banco, e o cron só liga os fios.
 */
import type { ConfigDaEsteira, Destinatario } from "./config";
import { horasUteisEntre, somarHorasUteis } from "./horas-uteis";

export const HORA = 3_600_000;
export const DIA = 24 * HORA;

/** As ligações da esteira. `quente` = cliente reengajou; `retorno`/`retentativa` nascem do registro. */
export type CodigoDeLigacao = "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "quente" | "retorno" | "retentativa";

/** `crm_tasks.source_kind` das ligações: `ligacao:<código>`. */
export const PREFIXO_DE_LIGACAO = "ligacao:";
export const sourceKindDaLigacao = (c: CodigoDeLigacao) => `${PREFIXO_DE_LIGACAO}${c}`;
export const ehLigacao = (sourceKind: string | null | undefined) =>
  typeof sourceKind === "string" && sourceKind.startsWith(PREFIXO_DE_LIGACAO);

/** Ligações por dia de vida no follow-up. O dia 1 é o do nascimento no funil de entrada. */
export const LIGACOES_DO_FOLLOWUP: ReadonlyArray<{ codigo: CodigoDeLigacao; dia: number }> = [
  { codigo: "L3", dia: 3 },
  { codigo: "L4", dia: 11 },
  { codigo: "L5", dia: 31 },
  { codigo: "L6", dia: 61 },
  { codigo: "L7", dia: 85 },
];

/** Horas úteis de prazo de cada ligação. As de "agora" (L1, quente) são 1 h. */
export const PRAZO_EM_HORAS_UTEIS: Record<CodigoDeLigacao, number> = {
  L1: 1,
  quente: 1,
  L2: 3,
  L3: 3,
  L4: 3,
  L5: 3,
  L6: 3,
  L7: 3,
  retorno: 3,
  retentativa: 2,
};

export const TITULO_DA_LIGACAO: Record<CodigoDeLigacao, string> = {
  L1: "Ligar (L1): passou para a equipe sem compromisso",
  L2: "Ligar (L2): 48 h de atendimento sem compromisso",
  L3: "Ligar (L3): fim das 72 h, entrou no follow-up",
  L4: "Ligar (L4): dia 11 do follow-up",
  L5: "Ligar (L5): dia 31 do follow-up",
  L6: "Ligar (L6): dia 61 do follow-up",
  L7: "Ligar (L7): dia 85, última tentativa",
  quente: "Ligar AGORA (sinal quente): o cliente voltou a falar",
  retorno: "Ligar (retorno combinado)",
  retentativa: "Ligar de novo (não atendeu)",
};

/** Dia de vida (1 = o dia do nascimento) no instante `agora`. */
export function diaDeVida(inicio: Date, agora: Date): number {
  return Math.floor((agora.getTime() - inicio.getTime()) / DIA) + 1;
}

/** A etapa-fase em que o lead deve estar no dia `dia` (a última, depois do fim). */
export function faseDoDia(fases: ReadonlyArray<{ ate_dia: number; etapa_id: string }>, dia: number): string {
  for (const f of fases) if (dia <= f.ate_dia) return f.etapa_id;
  return fases[fases.length - 1]!.etapa_id;
}

/** A ligação de follow-up DEVIDA hoje: a de maior dia já alcançado (as anteriores não se acumulam). */
export function ligacaoDoFollowupDevida(dia: number): CodigoDeLigacao | null {
  let devida: CodigoDeLigacao | null = null;
  for (const l of LIGACOES_DO_FOLLOWUP) if (dia >= l.dia) devida = l.codigo;
  return devida;
}

export interface LeadDaEsteira {
  id: string;
  contact_id: string | null;
  stage_id: string;
  created_at: string;
  owner_user_id: string | null;
  /** Nascimento no funil de entrada (no clone, vem do `source_metadata.esteira_inicio`). */
  inicio: string;
}

export interface LigacaoPendente {
  id: string;
  lead_id: string;
  contact_id: string | null;
  title: string;
  due_date: string;
  assigned_to: string | null;
}

export interface DepsDaEsteira {
  agora(): Date;
  leadsAbertos(pipelineId: string): Promise<LeadDaEsteira[]>;
  /** Clona para o follow-up (etapa dada), grava `esteira_inicio` e passa a conversa para humano. */
  passarParaFollowup(lead: LeadDaEsteira, etapaId: string): Promise<{ ok: true; lead: LeadDaEsteira } | { ok: false; erro: string }>;
  mover(lead: LeadDaEsteira, etapaId: string): Promise<boolean>;
  /** Negócios (entre os dados) que já tiveram handoff para humano. */
  comHandoff(leadIds: string[]): Promise<Set<string>>;
  /** O cliente mandou mensagem depois de `desde`? */
  clienteFalouDesde(lead: LeadDaEsteira, desde: Date): Promise<boolean>;
  /** Quando foi a última marca de reengajamento deste negócio (null = nunca). */
  ultimoReengajo(leadId: string): Promise<Date | null>;
  marcarReengajou(lead: LeadDaEsteira): Promise<void>;
  /**
   * ia.vek v1.9.4 (Rodrigo, 27/10): o follow-up só REATIVA — quem voltou a falar
   * volta para o SDR (o guardião) num novo ciclo de 72h. Devolve o lead novo
   * (no funil de entrada), ou null se não deu (fica em "Reengajou", como antes).
   */
  reativar?(lead: LeadDaEsteira): Promise<LeadDaEsteira | null>;
  /** `source_kind` das ligações que cada negócio já teve (qualquer status). */
  ligacoesJaCriadas(leadIds: string[]): Promise<Map<string, Set<string>>>;
  criarLigacao(lead: LeadDaEsteira, codigo: CodigoDeLigacao, venceEm: Date): Promise<boolean>;
  ligacoesVencidas(antesDe: Date): Promise<LigacaoPendente[]>;
  /** Níveis de cobrança já feitos por tarefa. */
  cobrancasFeitas(tarefaIds: string[]): Promise<Map<string, Set<number>>>;
  cobrar(tarefa: LigacaoPendente, nivel: 1 | 2, destinatario: Destinatario): Promise<void>;
}

export interface ResumoDaRodada {
  passados: number;
  falhasNaPassagem: number;
  fasesMovidas: number;
  reengajados: number;
  ligacoesCriadas: number;
  cobrancas: number;
}

export function rodadaTeveEfeito(r: ResumoDaRodada): boolean {
  return r.passados + r.falhasNaPassagem + r.fasesMovidas + r.reengajados + r.ligacoesCriadas + r.cobrancas > 0;
}

export async function rodarEsteira(cfg: ConfigDaEsteira, deps: DepsDaEsteira): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = {
    passados: 0,
    falhasNaPassagem: 0,
    fasesMovidas: 0,
    reengajados: 0,
    ligacoesCriadas: 0,
    cobrancas: 0,
  };
  if (cfg.funis === null) return resumo;
  const { entrada, followup } = cfg.funis;
  const agora = deps.agora();
  const prazo = (c: CodigoDeLigacao) => somarHorasUteis(agora, PRAZO_EM_HORAS_UTEIS[c], cfg.horario);
  const compromisso = new Set(entrada.etapas_de_compromisso);

  const criar = async (lead: LeadDaEsteira, codigo: CodigoDeLigacao, jaTem: Set<string> | undefined) => {
    if (jaTem?.has(sourceKindDaLigacao(codigo))) return;
    if (await deps.criarLigacao(lead, codigo, prazo(codigo))) {
      resumo.ligacoesCriadas += 1;
      jaTem?.add(sourceKindDaLigacao(codigo));
    }
  };

  // ── 1 e 4 (L1, L2, L3): funil de entrada ────────────────────────────────────
  // v1.9.4: lead nascido antes de `desde` (o dia em que a esteira foi ligada) não é tocado.
  const desde = entrada.desde ? Date.parse(entrada.desde) : null;
  const naEntrada = (await deps.leadsAbertos(entrada.pipeline_id)).filter(
    (l) => !compromisso.has(l.stage_id) && (desde === null || Date.parse(l.created_at) >= desde),
  );
  const criadasEntrada = await deps.ligacoesJaCriadas(naEntrada.map((l) => l.id));
  const handoffs = await deps.comHandoff(naEntrada.map((l) => l.id));
  for (const lead of naEntrada) {
    // D6: a idade conta do NASCIMENTO no ciclo (o mesmo relógio da tela), não da criação da linha.
    const idade = agora.getTime() - new Date(lead.inicio).getTime();
    if (idade >= entrada.horas * HORA) {
      const r = await deps.passarParaFollowup(lead, followup.fases[0]!.etapa_id);
      if (!r.ok) {
        resumo.falhasNaPassagem += 1;
        continue;
      }
      resumo.passados += 1;
      await criar(r.lead, "L3", new Set());
      continue;
    }
    const jaTem = criadasEntrada.get(lead.id) ?? new Set<string>();
    if (handoffs.has(lead.id)) await criar(lead, "L1", jaTem);
    if (idade >= 48 * HORA) await criar(lead, "L2", jaTem);
  }

  // ── 2, 3 e 4 (L4–L7, quente): funil de follow-up ────────────────────────────
  const fases = new Set(followup.fases.map((f) => f.etapa_id));
  const indiceDaFase = new Map(followup.fases.map((f, i) => [f.etapa_id, i]));
  const noFollowup = await deps.leadsAbertos(followup.pipeline_id);
  const criadasFollowup = await deps.ligacoesJaCriadas(noFollowup.map((l) => l.id));
  for (const lead of noFollowup) {
    const jaTem = criadasFollowup.get(lead.id) ?? new Set<string>();
    if (fases.has(lead.stage_id)) {
      const ultimo = await deps.ultimoReengajo(lead.id);
      const desde = new Date(Math.max(new Date(lead.created_at).getTime(), ultimo?.getTime() ?? 0));
      if (await deps.clienteFalouDesde(lead, desde)) {
        if (await deps.mover(lead, followup.etapa_reengajou)) {
          await deps.marcarReengajou(lead);
          resumo.reengajados += 1;
          // v1.9.4: volta ao SDR num novo ciclo; o sinal quente vai para o lead novo.
          const novo = deps.reativar ? await deps.reativar(lead) : null;
          // Sinal quente: uma por reengajamento (a pendente anterior, se houver, basta).
          await criar(novo ?? lead, "quente", undefined);
        }
        continue;
      }
      const alvo = faseDoDia(followup.fases, diaDeVida(new Date(lead.inicio), agora));
      if ((indiceDaFase.get(alvo) ?? 0) > (indiceDaFase.get(lead.stage_id) ?? 0)) {
        if (await deps.mover(lead, alvo)) resumo.fasesMovidas += 1;
      }
    }
    const devida = ligacaoDoFollowupDevida(diaDeVida(new Date(lead.inicio), agora));
    if (devida && devida !== "L3") await criar(lead, devida, jaTem);
  }

  // ── 5: cobrança de ligação vencida ──────────────────────────────────────────
  const vencidas = await deps.ligacoesVencidas(agora);
  const feitas = await deps.cobrancasFeitas(vencidas.map((t) => t.id));
  for (const t of vencidas) {
    const atraso = horasUteisEntre(new Date(t.due_date), agora, cfg.horario);
    const ja = feitas.get(t.id) ?? new Set<number>();
    if (atraso >= cfg.escaladaHorasNivel2 && !ja.has(2)) {
      await deps.cobrar(t, 2, cfg.escaladaNivel2);
      resumo.cobrancas += 1;
    } else if (atraso >= cfg.escaladaHoras && !ja.has(1) && !ja.has(2)) {
      await deps.cobrar(t, 1, cfg.escalada);
      resumo.cobrancas += 1;
    }
  }
  return resumo;
}
