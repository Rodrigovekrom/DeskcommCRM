/**
 * ia.vek v1.9.8 — o PAINEL DO PIPELINE (feedback do Lucas, decidido com o
 * Rodrigo em 30/10; card CRM-218).
 *
 * Três peças, todas de APRESENTAÇÃO (quem pode abrir o quê continua decidido
 * pelo papel e pela RLS):
 *  - a VISÃO: Novos (o funil de entrada, as 72h) / Follow-up (o funil da
 *    esteira) / Todos (os dois, um ao lado do outro). Por dentro continuam os
 *    dois funis e o clone entre eles;
 *  - os CONTADORES fixos no topo (tarefas de hoje, atrasadas, sem tarefa,
 *    visitas de hoje), da carteira de quem olha — ou da loja, para a gerência;
 *  - os AVISOS no cartão: "sem tarefa" e "parado há N dias".
 *
 * As contas ficam aqui, puras, para o teste prender a regra; a rota
 * `GET /api/v1/iavek/pipeline/painel` só busca os dados.
 */
import { funcaoDaTela } from "@/lib/iavek/funcoes";

export const VISOES = ["novos", "followup", "todos"] as const;
export type Visao = (typeof VISOES)[number];

export function ehVisao(v: unknown): v is Visao {
  return typeof v === "string" && (VISOES as readonly string[]).includes(v);
}

/** Os funis que cada visão mostra, na ordem das colunas. Sem follow-up declarado: só o de entrada. */
export function funisDaVisao(
  visao: Visao,
  funis: { entrada: string; followup: string | null },
): string[] {
  if (!funis.followup) return [funis.entrada];
  if (visao === "novos") return [funis.entrada];
  if (visao === "followup") return [funis.followup];
  return [funis.entrada, funis.followup];
}

/**
 * De quem é o recorte: a carteira da pessoa (guardião, Suporte IA, vendedor)
 * ou a loja inteira (gerente, apoio, e quem não tem função — o admin).
 */
export type Recorte = { tipo: "carteira"; lado: "sdr" | "vendedor" } | { tipo: "loja" };

export function recorteDaFuncao(funcao: unknown): Recorte {
  const f = funcaoDaTela(funcao);
  if (f === "sdr" || f === "suporte") return { tipo: "carteira", lado: "sdr" };
  if (f === "vendedor") return { tipo: "carteira", lado: "vendedor" };
  return { tipo: "loja" };
}

/** Status de tarefa que ainda pede trabalho. */
export const TAREFA_ABERTA = ["pending", "in_progress"] as const;

/** A partir de quantos dias sem movimento o cartão avisa "parado". */
export const DIAS_PARA_PARADO = 3;

const DIA_MS = 86_400_000;

export interface LeadDoAviso {
  status: string;
  created_at: string;
  stage_changed_at?: string | null;
  last_activity_at?: string | null;
}

/** O último movimento do lead: a troca de etapa ou a atividade, a mais recente (sem nenhuma: a criação). */
export function ultimoMovimento(lead: LeadDoAviso): string {
  const datas = [lead.stage_changed_at, lead.last_activity_at, lead.created_at].filter(
    (d): d is string => typeof d === "string" && Number.isFinite(new Date(d).getTime()),
  );
  return datas.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a), lead.created_at);
}

/** Dias inteiros desde o último movimento (nunca negativo). */
export function diasParado(lead: LeadDoAviso, agora: Date = new Date()): number {
  const desde = new Date(ultimoMovimento(lead)).getTime();
  return Math.max(0, Math.floor((agora.getTime() - desde) / DIA_MS));
}

export interface AvisosDoCartao {
  semTarefa: boolean;
  /** `null`: não está parado (ou o lead já fechou). */
  paradoDias: number | null;
}

/** Lead fechado (vendido, perdido, arquivado) não avisa nada: não há o que fazer nele. */
export function avisosDoCartao(
  lead: LeadDoAviso,
  temTarefaAberta: boolean,
  agora: Date = new Date(),
  diasParaParado: number = DIAS_PARA_PARADO,
): AvisosDoCartao {
  if (lead.status !== "open") return { semTarefa: false, paradoDias: null };
  const dias = diasParado(lead, agora);
  return { semTarefa: !temTarefaAberta, paradoDias: dias >= diasParaParado ? dias : null };
}

export interface ContadoresDoPipeline {
  tarefas_hoje: number;
  atrasadas: number;
  sem_tarefa: number;
  visitas_hoje: number;
}

export interface TarefaDoContador {
  due_date: string | null;
}

/**
 * As tarefas abertas viram dois números: as que vencem HOJE (no fuso da loja,
 * e ainda não venceram) e as ATRASADAS (prazo já passou). Sem prazo não conta
 * em nenhum dos dois — e conta como tarefa para o "sem tarefa".
 */
export function contarTarefas(
  tarefas: TarefaDoContador[],
  agora: Date,
  hoje: { inicio: Date; fim: Date },
): { tarefas_hoje: number; atrasadas: number } {
  let tarefas_hoje = 0;
  let atrasadas = 0;
  for (const t of tarefas) {
    if (!t.due_date) continue;
    const prazo = new Date(t.due_date).getTime();
    if (!Number.isFinite(prazo)) continue;
    if (prazo < agora.getTime()) atrasadas += 1;
    else if (prazo >= hoje.inicio.getTime() && prazo < hoje.fim.getTime()) tarefas_hoje += 1;
  }
  return { tarefas_hoje, atrasadas };
}

/** Leads abertos que não têm nenhuma tarefa aberta. */
export function contarSemTarefa(leadsAbertos: string[], comTarefa: Set<string>): number {
  return leadsAbertos.filter((id) => !comTarefa.has(id)).length;
}

/**
 * Os dois funis da tela, lidos de `settings.esteira` (declarados, a esteira
 * ligada ou não). Sem entrada declarada: o funil padrão. Sem follow-up
 * declarado (toda loja que não usa a esteira): `null`, e a tela fica como
 * sempre foi — um funil, sem o botão.
 */
export function funisDaLoja(
  settings: unknown,
  funilPadrao: string | null,
): { entrada: string; followup: string | null } | null {
  const esteira = (settings as { esteira?: { entrada?: { pipeline_id?: unknown }; followup?: { pipeline_id?: unknown } } } | null)
    ?.esteira;
  const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  const entrada = uuid(esteira?.entrada?.pipeline_id) ?? funilPadrao;
  if (!entrada) return null;
  const followup = uuid(esteira?.followup?.pipeline_id);
  return { entrada, followup: followup && followup !== entrada ? followup : null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
