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
 * A régua, num lugar só: a última ENTRADA é mais nova que a última SAÍDA (qualquer saída responde:
 * pelo CRM, pelo celular ou pela Venda.IA, que chegam como mensagem enviada).
 */
export function ultimaEhDoCliente(c: NonNullable<Lead["conversa"]>): boolean {
  const entrou = instanteDe(c.last_inbound_at);
  if (!entrou) return false;
  const saiu = Math.max(instanteDe(c.last_outbound_at), instanteDe(c.ultima_resposta_humana_em));
  return entrou > saiu;
}

export function semConversa(l: Filtravel): boolean {
  return l.conversa == null;
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
