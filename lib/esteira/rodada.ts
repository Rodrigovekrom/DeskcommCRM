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
 *  4b. SEM RETORNO (CRM-141, Rodrigo 06/11). Com `perder_sem_retorno` ligado, o lead
 *     que terminou a ÚLTIMA fase sem voltar a falar vira Perdido (motivo configurado,
 *     padrão `no_response`). Só quem termina a última fase depois de a regra ser
 *     ligada; quem já tinha terminado antes fica como está.
 *  5. COBRANÇA. Ligação vencida há `escaladaHoras` úteis cobra o destinatário da
 *     escalada (papel ou usuário, configurável); há `escaladaHorasNivel2`, o
 *     segundo nível. Cada nível uma vez por tarefa.
 *
 * Tudo atrás de `Deps`: a regra é testável sem banco, e o cron só liga os fios.
 */
import type { ConfigDaEsteira, Destinatario } from "./config";
import { horasUteisEntre, inicioDoDiaLocal, somarHorasUteis } from "./horas-uteis";

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

/** CRM-141: o instante em que o lead TERMINA a última fase (o fim do dia `ate_dia` dela). */
export function fimDaUltimaFase(fases: ReadonlyArray<{ ate_dia: number }>, inicio: Date): Date {
  return new Date(inicio.getTime() + fases[fases.length - 1]!.ate_dia * DIA);
}

/** CRM-141: já terminou a última fase, e terminou a partir de `desde` (o dia em que a regra foi ligada). */
export function entraNoSemRetorno(
  fases: ReadonlyArray<{ ate_dia: number }>,
  inicio: Date,
  agora: Date,
  desde: Date,
): boolean {
  const fim = fimDaUltimaFase(fases, inicio).getTime();
  return fim <= agora.getTime() && fim >= desde.getTime();
}

/**
 * CRM-141: a contagem que se mostra ANTES de ligar a regra, para os leads abertos nas
 * fases do follow-up (quem está em "Reengajou" ou fora das fases não conta).
 *  - `jaTerminaram`: já passaram da última fase; ligando agora, ficam DE FORA.
 *  - `vaoEntrar`: ainda não terminaram; viram Perdido quando terminarem, se não voltarem a falar.
 */
export function contagemSemRetorno(
  fases: ReadonlyArray<{ ate_dia: number; etapa_id: string }>,
  leads: ReadonlyArray<Pick<LeadDaEsteira, "stage_id" | "inicio">>,
  ligarEm: Date,
): { vaoEntrar: number; jaTerminaram: number } {
  const ids = new Set(fases.map((f) => f.etapa_id));
  let vaoEntrar = 0;
  let jaTerminaram = 0;
  for (const l of leads) {
    if (!ids.has(l.stage_id)) continue;
    if (fimDaUltimaFase(fases, new Date(l.inicio)).getTime() < ligarEm.getTime()) jaTerminaram += 1;
    else vaoEntrar += 1;
  }
  return { vaoEntrar, jaTerminaram };
}

export interface LeadDaEsteira {
  id: string;
  contact_id: string | null;
  stage_id: string;
  created_at: string;
  owner_user_id: string | null;
  /** Nascimento no funil de entrada (no clone, vem do `source_metadata.esteira_inicio`). */
  inicio: string;
  /** v1.9.23: "Manter em negociação" segura a passagem até aqui. */
  manter_ate?: string | null;
  /** v1.9.41: clone do LOTE ANTIGO com "só L3": a L4 de recuperação não nasce. */
  lote_antigo_so_l3?: boolean;
}

/** v1.9.41: o que a passagem do lote antigo leva junto. */
export interface PassagemDoLoteAntigo {
  /** O dono do rodízio (vale só se o lead não tiver guardião). */
  dono: string;
  soL3: boolean;
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
  passarParaFollowup(
    lead: LeadDaEsteira,
    etapaId: string,
    loteAntigo?: PassagemDoLoteAntigo,
  ): Promise<{ ok: true; lead: LeadDaEsteira } | { ok: false; erro: string }>;
  /** v1.9.41: quantos do lote antigo já passaram a partir de `desde` (a meia-noite local de hoje). */
  passadosDoLoteAntigoDesde?(desde: Date): Promise<number>;
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
  /** CRM-141: leva o lead para a etapa de perda do funil dele, com o motivo. */
  perderSemRetorno(lead: LeadDaEsteira, motivo: string): Promise<boolean>;
  criarLigacao(lead: LeadDaEsteira, codigo: CodigoDeLigacao, venceEm: Date): Promise<boolean>;
  ligacoesVencidas(antesDe: Date): Promise<LigacaoPendente[]>;
  /** Níveis de cobrança já feitos por tarefa. */
  cobrancasFeitas(tarefaIds: string[]): Promise<Map<string, Set<number>>>;
  /**
   * ia.vek v1.9.52.3 (Lupa 002312, Maestro 002322): a RECONCILIAÇÃO do Follow-up, idempotente, a cada rodada. Os
   * originais passados cujo clone é do SDR de Follow-up e que ainda estão com outro dono/guardião (e o clone com o
   * guardião diferente do dono) são corrigidos e CONTADOS. Opcional (os testes antigos não a têm).
   */
  reconciliarFollowup?(followupPipelineId: string): Promise<{ guardioes: number; originais: number; tarefas?: number; conversas?: number }>;
  cobrar(tarefa: LigacaoPendente, nivel: 1 | 2, destinatario: Destinatario): Promise<void>;
}

export interface ResumoDaRodada {
  passados: number;
  falhasNaPassagem: number;
  /** v1.9.41: quantos dos `passados` vieram do lote antigo. */
  passadosLoteAntigo: number;
  /** v1.9.23: venceram as 72h mas ficaram, pelo "Manter em negociação" ou por resposta recente. */
  seguradosManter: number;
  seguradosResposta: number;
  fasesMovidas: number;
  reengajados: number;
  /** CRM-141: viraram Perdido sem retorno, e as tentativas que falharam. */
  perdidosSemRetorno: number;
  falhasSemRetorno: number;
  ligacoesCriadas: number;
  cobrancas: number;
  /** v1.9.52.3: o que a reconciliação do Follow-up corrigiu nesta rodada (0 = a entrega na passagem funcionou). */
  reconciliadosFollowup?: number;
}

export function rodadaTeveEfeito(r: ResumoDaRodada): boolean {
  return (
    r.passados + r.falhasNaPassagem + r.fasesMovidas + r.reengajados + r.perdidosSemRetorno + r.falhasSemRetorno +
      r.ligacoesCriadas + r.cobrancas >
    0
  );
}

export async function rodarEsteira(cfg: ConfigDaEsteira, deps: DepsDaEsteira): Promise<ResumoDaRodada> {
  const resumo: ResumoDaRodada = {
    passados: 0,
    falhasNaPassagem: 0,
    passadosLoteAntigo: 0,
    seguradosManter: 0,
    seguradosResposta: 0,
    fasesMovidas: 0,
    reengajados: 0,
    perdidosSemRetorno: 0,
    falhasSemRetorno: 0,
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
  const todosNaEntrada = await deps.leadsAbertos(entrada.pipeline_id);
  const naEntrada = todosNaEntrada.filter(
    (l) => !compromisso.has(l.stage_id) && (desde === null || Date.parse(l.created_at) >= desde),
  );
  const criadasEntrada = await deps.ligacoesJaCriadas(naEntrada.map((l) => l.id));
  const handoffs = await deps.comHandoff(naEntrada.map((l) => l.id));
  for (const lead of naEntrada) {
    // D6: a idade conta do NASCIMENTO no ciclo (o mesmo relógio da tela), não da criação da linha.
    const idade = agora.getTime() - new Date(lead.inicio).getTime();
    if (idade >= entrada.horas * HORA) {
      // v1.9.23 (Rodrigo, 05/11): duas exceções, nesta ordem. "Manter em negociação" segura
      // até a data marcada; e o cliente que falou nas últimas `horas` (corridas) não passa.
      if (lead.manter_ate && Date.parse(lead.manter_ate) > agora.getTime()) {
        resumo.seguradosManter += 1;
        continue;
      }
      if (await deps.clienteFalouDesde(lead, new Date(agora.getTime() - entrada.horas * HORA))) {
        resumo.seguradosResposta += 1;
        continue;
      }
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

  // ── 1b. LOTE ANTIGO (v1.9.41): os nascidos antes de `desde`, aos poucos e com dono ─────
  const lote = entrada.lote_antigo;
  if (lote?.ativo && desde !== null && lote.donos.length > 0 && deps.passadosDoLoteAntigoDesde) {
    const aPartirDe = lote.a_partir_de ? Date.parse(lote.a_partir_de) : null;
    const jaHoje = await deps.passadosDoLoteAntigoDesde(inicioDoDiaLocal(agora, cfg.horario.fuso));
    let cota = lote.por_dia - jaHoje;
    if (cota > 0) {
      const antigos = todosNaEntrada
        .filter(
          (l) =>
            !compromisso.has(l.stage_id) &&
            Date.parse(l.created_at) < desde &&
            (aPartirDe === null || Date.parse(l.created_at) >= aPartirDe),
        )
        // Do mais antigo para o mais novo; o id desempata (a ordem não muda entre rodadas).
        .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio) || a.id.localeCompare(b.id));
      let i = 0;
      for (const lead of antigos) {
        if (cota <= 0) break;
        if (agora.getTime() - new Date(lead.inicio).getTime() < entrada.horas * HORA) continue;
        // As mesmas exceções do lote novo: "Manter em negociação" e cliente que falou nas últimas `horas`.
        if (lead.manter_ate && Date.parse(lead.manter_ate) > agora.getTime()) {
          resumo.seguradosManter += 1;
          continue;
        }
        if (await deps.clienteFalouDesde(lead, new Date(agora.getTime() - entrada.horas * HORA))) {
          resumo.seguradosResposta += 1;
          continue;
        }
        const dono = lote.donos[(jaHoje + i) % lote.donos.length]!;
        const r = await deps.passarParaFollowup(lead, followup.fases[0]!.etapa_id, { dono, soL3: lote.so_l3 });
        if (!r.ok) {
          resumo.falhasNaPassagem += 1;
          continue;
        }
        i += 1;
        cota -= 1;
        resumo.passados += 1;
        resumo.passadosLoteAntigo += 1;
        await criar(r.lead, "L3", new Set());
      }
    }
  }

  // ── 2, 3 e 4 (L4–L7, quente): funil de follow-up ────────────────────────────
  const fases = new Set(followup.fases.map((f) => f.etapa_id));
  const indiceDaFase = new Map(followup.fases.map((f, i) => [f.etapa_id, i]));
  const semRetornoDesde = cfg.semRetorno ? new Date(cfg.semRetorno.desde) : null;
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
      // CRM-141: terminou a última fase sem voltar a falar (o "falou?" acima já respondeu não).
      if (cfg.semRetorno && semRetornoDesde && entraNoSemRetorno(followup.fases, new Date(lead.inicio), agora, semRetornoDesde)) {
        if (await deps.perderSemRetorno(lead, cfg.semRetorno.motivo)) resumo.perdidosSemRetorno += 1;
        else resumo.falhasSemRetorno += 1;
        continue;
      }
      const alvo = faseDoDia(followup.fases, diaDeVida(new Date(lead.inicio), agora));
      if ((indiceDaFase.get(alvo) ?? 0) > (indiceDaFase.get(lead.stage_id) ?? 0)) {
        if (await deps.mover(lead, alvo)) resumo.fasesMovidas += 1;
      }
    }
    const devida = ligacaoDoFollowupDevida(diaDeVida(new Date(lead.inicio), agora));
    // v1.9.41: lote antigo com "só L3": a L4 (de recuperação, já vencida pela idade) não nasce.
    if (devida && devida !== "L3" && !(devida === "L4" && lead.lote_antigo_so_l3)) await criar(lead, devida, jaTem);
  }

  // ── 5: cobrança de ligação vencida ──────────────────────────────────────────
  const vencidas = await deps.ligacoesVencidas(agora);
  const feitas = await deps.cobrancasFeitas(vencidas.map((t) => t.id));
  let n = 0;
  for (const t of vencidas) {
    // ia.vek v1.9.52.2 (Lupa 224739): o laço cede a vez a cada 50 tarefas (as telas não esperam a rodada), e a tarefa
    // já cobrada no nível 2 não tem mais nada a fazer: nem calcula o atraso.
    if (++n % 50 === 0) await new Promise<void>((r) => setImmediate(r));
    const ja = feitas.get(t.id) ?? new Set<number>();
    if (ja.has(2)) continue;
    const atraso = horasUteisEntre(new Date(t.due_date), agora, cfg.horario);
    if (atraso >= cfg.escaladaHorasNivel2 && !ja.has(2)) {
      await deps.cobrar(t, 2, cfg.escaladaNivel2);
      resumo.cobrancas += 1;
    } else if (atraso >= cfg.escaladaHoras && !ja.has(1) && !ja.has(2)) {
      await deps.cobrar(t, 1, cfg.escalada);
      resumo.cobrancas += 1;
    }
  }

  // ── 6 (v1.9.52.3): a reconciliação do Follow-up (privacidade: o lead do SDR de Follow-up não fica à vista de antes) ──
  if (deps.reconciliarFollowup) {
    const r = await deps.reconciliarFollowup(followup.pipeline_id);
    resumo.reconciliadosFollowup = r.guardioes + r.originais + (r.tarefas ?? 0) + (r.conversas ?? 0);
  }
  return resumo;
}
