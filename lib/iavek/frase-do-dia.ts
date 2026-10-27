/**
 * ia.vek v1.9.3 — a FRASE DO DIA no título do "Meu dia" do SDR e do vendedor
 * (pedido do Rodrigo, CRM-207/208). Lista fixa, sem IA: a frase muda uma vez
 * por dia (no fuso da loja) e é a mesma para todos da mesma função naquele dia.
 * Texto da loja, em português — não passa pelo dicionário.
 */
import type { Funcao } from "@/lib/iavek/funcoes";

export const FRASES_DO_SDR = [
  "Cada ligação é uma porta. Hoje, abra mais uma.",
  "Lead respondido rápido é lead que agenda.",
  "Quem pergunta bem, agenda melhor.",
  "Seis tentativas não é insistência: é cuidado com o cliente.",
  "Todo lead merece um próximo passo com dia e hora.",
  "Um bom agendamento começa com uma boa escuta.",
  "O cliente lembra de quem lembrou dele.",
  "Agenda cheia não é sorte: é rotina bem feita.",
  "Hoje é dia de transformar conversa em visita.",
  "O 'não agora' de ontem pode ser o 'sim' de hoje.",
  "Briefing completo é presente para o vendedor.",
  "Constância vence talento que não aparece.",
  "Sorria na voz: o cliente sente do outro lado.",
  "Pequenos avanços todo dia viram grandes resultados no mês.",
] as const;

export const FRASES_DO_VENDEDOR = [
  "Cliente na loja é chance real. Faça valer.",
  "Visitou? Proposta no mesmo dia.",
  "Venda boa é aquela em que o cliente volta e indica.",
  "Escute primeiro, ofereça depois.",
  "Toda perda tem um motivo, e todo motivo ensina.",
  "O carro certo para a pessoa certa: esse é o trabalho.",
  "Confiança se constrói em cada detalhe do atendimento.",
  "Quem acompanha o cliente até o fim, fecha mais.",
  "Hoje é dia de bater a meta, um cliente por vez.",
  "Atendimento rápido é respeito pelo tempo do cliente.",
  "Não deixe para amanhã o retorno que dá para dar hoje.",
  "Cada 'não' te deixa mais perto do próximo 'sim'.",
  "Conheça o estoque como conhece o caminho de casa.",
  "Entusiasmo vende: o cliente compra a sua certeza.",
] as const;

/** A data de hoje (AAAA-MM-DD) no fuso da loja. */
function diaNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** A frase de hoje para a função, ou `null` (o gerente e quem não tem função não recebem). */
export function fraseDoDia(funcao: Funcao, agora: Date, fuso: string): string | null {
  const lista =
    funcao === "sdr" || funcao === "suporte"
      ? FRASES_DO_SDR
      : funcao === "vendedor"
        ? FRASES_DO_VENDEDOR
        : null;
  if (!lista) return null;
  const [a = 1970, m = 1, d = 1] = diaNoFuso(agora, fuso).split("-").map(Number);
  const dias = Math.floor(Date.UTC(a, m - 1, d) / 86_400_000);
  return lista[dias % lista.length] ?? null;
}
