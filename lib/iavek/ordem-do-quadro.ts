import type { Lead } from "@/lib/types/leads";

/**
 * ia.vek v1.9.18 — a ordem do quadro e a marca "nova mensagem". Regras puras.
 *
 * Mensagem do lead sobe o cartão; mensagem enviada não. Na coluna da IA a ordem é a de
 * chegada, porque ainda não existe sinal de "pediu um humano", e não há marca.
 */
export const ORDENS_DO_QUADRO = ["ultima_mensagem", "maior_valor", "parado", "tarefa_atrasada", "chegada", "atividade"] as const;
export type OrdemDoQuadro = (typeof ORDENS_DO_QUADRO)[number];
export const ORDEM_PADRAO: OrdemDoQuadro = "ultima_mensagem";

export function ehColunaDaIa(nomeDaEtapa: string | null | undefined): boolean {
  return /^ia atendendo$/i.test((nomeDaEtapa ?? "").trim());
}

const instanteDe = (v: string | null | undefined): number => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Sem mensagem do lead, vale a chegada: o lead novo entra no topo. */
export function ultimaDoLead(l: Pick<Lead, "created_at" | "conversa">): number {
  return instanteDe(l.conversa?.last_inbound_at) || instanteDe(l.created_at);
}

/**
 * A mensagem do lead que espera resposta de uma pessoa, em ms, ou null.
 * Só resposta de pessoa pelo sistema apaga: uma saída de fora do sistema não conta.
 */
export function esperandoDesde(l: Pick<Lead, "status" | "conversa">, nomeDaEtapa: string | null | undefined): number | null {
  if (l.status !== "open" || ehColunaDaIa(nomeDaEtapa)) return null;
  const entrou = instanteDe(l.conversa?.last_inbound_at);
  if (!entrou) return null;
  return entrou > instanteDe(l.conversa?.ultima_resposta_humana_em) ? entrou : null;
}

export function tempoDeEspera(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

type Ordenavel = Pick<Lead, "id" | "created_at" | "updated_at" | "value_cents" | "conversa"> & {
  last_activity_at?: string | null;
};

/** `vencimentos`: a tarefa em aberto que vence primeiro de cada lead. */
export function compararLeads(
  ordem: OrdemDoQuadro,
  vencimentos?: Readonly<Record<string, string | null | undefined>>,
): (a: Ordenavel, b: Ordenavel) => number {
  const chegada = (a: Ordenavel, b: Ordenavel) => instanteDe(b.created_at) - instanteDe(a.created_at);
  const atividade = (l: Ordenavel) => instanteDe(l.last_activity_at) || instanteDe(l.updated_at) || instanteDe(l.created_at);
  switch (ordem) {
    case "chegada":
      return chegada;
    case "atividade":
      return (a, b) => atividade(b) - atividade(a);
    case "maior_valor":
      return (a, b) => (b.value_cents ?? 0) - (a.value_cents ?? 0) || chegada(a, b);
    case "parado":
      return (a, b) => atividade(a) - atividade(b);
    case "tarefa_atrasada":
      return (a, b) => {
        const va = instanteDe(vencimentos?.[a.id]) || Number.POSITIVE_INFINITY;
        const vb = instanteDe(vencimentos?.[b.id]) || Number.POSITIVE_INFINITY;
        return va === vb ? chegada(a, b) : va - vb;
      };
    default:
      return (a, b) => ultimaDoLead(b as never) - ultimaDoLead(a as never) || chegada(a, b);
  }
}

/**
 * CRM-244 (Fase 2, teste B): na ordem "Última mensagem do lead", o bloco SEM RESPOSTA vem no topo
 * da coluna (lead cuja última mensagem é dele e nenhuma PESSOA respondeu depois; a IA não conta).
 * Separação estável: dentro de cada bloco, a ordem que já veio.
 */
export function semRespostaPrimeiro<T extends Pick<Lead, "status" | "conversa">>(lista: T[], nomeDaEtapa: string | null | undefined): T[] {
  const sem: T[] = [];
  const resto: T[] = [];
  for (const l of lista) (esperandoDesde(l, nomeDaEtapa) !== null ? sem : resto).push(l);
  return sem.length === 0 || resto.length === 0 ? lista : [...sem, ...resto];
}

/** Ordem congelada (arrastando, ou com o menu de mover aberto): novos no fim, ninguém pula. */
export function manterOrdem<T extends { id: string }>(lista: T[], anterior: readonly string[] | undefined): T[] {
  if (!anterior) return lista;
  const pos = new Map(anterior.map((id, i) => [id, i]));
  return [...lista].sort((a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/** Aplica no cache o que o tempo real trouxe, para o cartão subir sem baixar o quadro. */
export function aplicarConversaNoQuadro<L extends Pick<Lead, "contact_id" | "conversa">>(
  leads: L[],
  c: {
    id: string;
    contact_id: string;
    last_inbound_at?: string | null;
    ultima_resposta_humana_em?: string | null;
    last_message_at?: string | null;
    last_message_preview?: string | null;
    unread_count_for_assignee?: number | null;
  },
): L[] {
  let mudou = false;
  const novos = leads.map((l) => {
    if (l.contact_id !== c.contact_id) return l;
    mudou = true;
    // CRM-244 (Fase 2): mensagem nova do cliente soma 1 às não lidas de quem olha; resposta de
    // pessoa zera. A leitura exata volta na próxima carga do quadro.
    const antes = l.conversa;
    const entrouNova = !!c.last_inbound_at && Date.parse(c.last_inbound_at) > Date.parse(antes?.last_inbound_at ?? "1970-01-01");
    const respondeu =
      !!c.ultima_resposta_humana_em &&
      Date.parse(c.ultima_resposta_humana_em) > Date.parse(antes?.ultima_resposta_humana_em ?? "1970-01-01");
    const nao_lidas = respondeu ? 0 : (antes?.nao_lidas ?? 0) + (entrouNova ? 1 : 0);
    return {
      ...l,
      conversa: {
        nao_lidas,
        ja_vi: respondeu || entrouNova ? false : antes?.ja_vi,
        id: c.id,
        preview: c.last_message_preview ?? l.conversa?.preview ?? null,
        last_message_at: c.last_message_at ?? l.conversa?.last_message_at ?? null,
        unread: c.unread_count_for_assignee ?? l.conversa?.unread ?? 0,
        last_inbound_at: c.last_inbound_at ?? l.conversa?.last_inbound_at ?? null,
        ultima_resposta_humana_em: c.ultima_resposta_humana_em ?? l.conversa?.ultima_resposta_humana_em ?? null,
      },
    };
  });
  return mudou ? novos : leads;
}
