import type { Lead } from "@/lib/types/leads";

/**
 * ia.vek v1.9.50 (pedido do Rodrigo, Maestro 211138) — o filtro "Não respondidos | Todos" do Pipeline.
 *
 * O PADRÃO, para todo mundo e em todos os funis, é "Não respondidos". Quem escolhe "Todos" fica com
 * "Todos" (a escolha mora nas preferências de tela de cada pessoa). Só visualização: nada aqui muda dado.
 *
 * NÃO RESPONDIDO = lead ABERTO e:
 *  - SEM conversa nenhuma (ninguém falou com ele ainda: aparece, com a marca "sem conversa"); ou
 *  - a ÚLTIMA mensagem da conversa é do CLIENTE (a régua abaixo).
 * A coluna da IA ENTRA (diferente da marca "sem resposta" do cartão, que a deixa de fora).
 */
export const MOSTRAR_DO_PIPELINE = ["nao_respondidos", "todos"] as const;
export type MostrarDoPipeline = (typeof MOSTRAR_DO_PIPELINE)[number];
export const MOSTRAR_PADRAO: MostrarDoPipeline = "nao_respondidos";

const instanteDe = (v: string | null | undefined): number => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

type Filtravel = Pick<Lead, "status" | "conversa">;

/**
 * A RÉGUA, num lugar só (o filtro, a marca "sem resposta" do cartão, o bloco do topo e o "Sem resposta por
 * vendedor" leem DAQUI): a última mensagem do CLIENTE é mais nova que a última RESPOSTA. Responde: a tela do CRM,
 * o celular (e a Venda.IA, que fala pelo celular) e a IA do CRM (`ultima_resposta_em`, 0633). NÃO responde: a
 * mensagem automática do sistema (lembrete, aviso), porque ninguém falou com o cliente. O `ultima_resposta_humana_em`
 * entra no máximo só para o quadro de antes da 0633 (é um subconjunto: a resposta pela tela).
 */
export function ultimaEhDoCliente(c: Pick<NonNullable<Lead["conversa"]>, "last_inbound_at" | "ultima_resposta_em" | "ultima_resposta_humana_em">): boolean {
  const entrou = instanteDe(c.last_inbound_at);
  if (!entrou) return false;
  const respondeu = Math.max(instanteDe(c.ultima_resposta_em), instanteDe(c.ultima_resposta_humana_em));
  return entrou > respondeu;
}

/** Sem conversa = nenhuma conversa, ou uma conversa SEM mensagem nenhuma (ninguém falou com o lead ainda). */
export function semConversa(l: Filtravel): boolean {
  const c = l.conversa;
  return c == null || (!c.last_message_at && !c.last_inbound_at && !c.ultima_resposta_em && !c.ultima_resposta_humana_em);
}

export function naoRespondido(l: Filtravel): boolean {
  if (l.status !== "open") return false;
  if (semConversa(l)) return true;
  return ultimaEhDoCliente(l.conversa!);
}

/** Os leads que o quadro mostra, e as contagens do botão e do aviso ("mostrando N de M"). */
export function aplicarMostrar<T extends Filtravel>(
  leads: readonly T[],
  mostrar: MostrarDoPipeline,
): { visiveis: T[]; naoRespondidos: number; todos: number } {
  const nao = leads.filter(naoRespondido);
  return {
    visiveis: mostrar === "todos" ? [...leads] : nao,
    naoRespondidos: nao.length,
    todos: leads.length,
  };
}
