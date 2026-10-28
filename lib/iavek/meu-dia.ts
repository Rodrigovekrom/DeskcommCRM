/**
 * ia.vek v1.6 (parte B): as contas puras do "Meu dia" (SDR, Vendedor, Gerente).
 * A rota `GET /api/v1/iavek/meu-dia` busca os dados; aqui ficam as regras que
 * o teste prende: o que é "hoje" no fuso da loja, a ordem dos leads pelo
 * prazo das 72h, e os agrupamentos do gerente.
 */
import { instanteLocal } from "@/lib/esteira/horas-uteis";
import { ehPerdaDeVerdade } from "@/lib/iavek/meus-numeros";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";

/** Início e fim de HOJE no fuso da organização (o fim é o início de amanhã). */
export function limitesDoDia(agora: Date, fuso: string): { inicio: Date; fim: Date } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const inicio = instanteLocal(Number(p.year), Number(p.month), Number(p.day), "00:00", fuso);
  // +26h e corta no dia seguinte: atravessa o horário de verão sem errar o dia.
  const depois = new Date(inicio.getTime() + 26 * 3_600_000);
  const q = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(depois)
      .map((x) => [x.type, x.value]),
  );
  const fim = instanteLocal(Number(q.year), Number(q.month), Number(q.day), "00:00", fuso);
  return { inicio, fim };
}

/** Menos tempo primeiro: o lead mais perto de estourar as 72h no topo. */
export function porPrazo<T extends { fim_em: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.fim_em.localeCompare(b.fim_em));
}

export interface AtrasoDaTarefa {
  assigned_to: string | null;
  source_kind: string | null;
}

export interface AtrasoPorPessoa {
  user_id: string | null;
  ligacoes: number;
  proximos_passos: number;
  outras: number;
}

/** Tarefas vencidas e abertas, contadas por responsável (sem responsável = null). */
export function atrasosPorPessoa(tarefas: AtrasoDaTarefa[]): AtrasoPorPessoa[] {
  const mapa = new Map<string | null, AtrasoPorPessoa>();
  for (const t of tarefas) {
    const chave = t.assigned_to ?? null;
    const linha = mapa.get(chave) ?? { user_id: chave, ligacoes: 0, proximos_passos: 0, outras: 0 };
    if (t.source_kind?.startsWith("ligacao:")) linha.ligacoes += 1;
    else if (t.source_kind === "proximo_passo") linha.proximos_passos += 1;
    else linha.outras += 1;
    mapa.set(chave, linha);
  }
  return [...mapa.values()].sort(
    (a, b) =>
      b.ligacoes + b.proximos_passos + b.outras - (a.ligacoes + a.proximos_passos + a.outras),
  );
}

/** Perdas agrupadas pelo motivo escrito (sem motivo vira "Sem motivo"). */
export function perdasPorMotivo(
  leads: Array<{ lost_reason: string | null }>,
): Array<{ motivo: string; total: number }> {
  const mapa = new Map<string, number>();
  for (const l of leads) {
    // 28/10 (Rodrigo): ir para o Follow-up (ou outro funil) não é perda em lugar nenhum.
    if (!ehPerdaDeVerdade(l.lost_reason)) continue;
    const motivo = l.lost_reason?.trim() ? rotuloDoMotivoDePerda(l.lost_reason.trim()) : "Sem motivo";
    mapa.set(motivo, (mapa.get(motivo) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * ia.vek v1.7.5: as tarefas da equipe no Meu dia do gerente — quem tem o quê.
 * `concluidas` são as feitas na janela que a rota pediu (as `done` cujo
 * `updated_at` caiu nela); `atrasadas` são as abertas com prazo vencido.
 */
export interface TarefaDaEquipe {
  assigned_to: string | null;
  status: string;
  due_date: string | null;
}
export interface TarefasPorPessoa {
  user_id: string | null;
  abertas: number;
  atrasadas: number;
  concluidas: number;
}
export function tarefasPorPessoa(tarefas: TarefaDaEquipe[], agora: Date): TarefasPorPessoa[] {
  const mapa = new Map<string | null, TarefasPorPessoa>();
  for (const t of tarefas) {
    const chave = t.assigned_to ?? null;
    const linha = mapa.get(chave) ?? { user_id: chave, abertas: 0, atrasadas: 0, concluidas: 0 };
    if (t.status === "done") linha.concluidas += 1;
    else if (t.status === "pending" || t.status === "in_progress") {
      linha.abertas += 1;
      if (t.due_date && new Date(t.due_date).getTime() < agora.getTime()) linha.atrasadas += 1;
    }
    mapa.set(chave, linha);
  }
  return [...mapa.values()].sort(
    (a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas || b.concluidas - a.concluidas,
  );
}
