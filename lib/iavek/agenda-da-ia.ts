import { z } from "zod";

import { tagDeIdioma } from "@/lib/i18n/datas";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * ia.vek v1.9.2 — a IA AGENDANDO (só no modo agendamento).
 *
 * Até a v1.9.1 a IA nunca marcava: ela registrava um PEDIDO e o admin
 * confirmava (decisão da loja, v1.7.6). A chave que religava o motor era do
 * AMBIENTE (`IAVEK_IA_AGENDA_SOZINHA`) — valia para todas as empresas ao mesmo
 * tempo. Agora é POR EMPRESA: no modo agendamento (clínica) a IA vê os horários
 * livres e marca; fora dele (a Fenômenos) segue o pedido, igual.
 *
 * Como a IA marca é configuração da empresa (o admin escolhe):
 *   pre_agendado (padrão) → status `pending` (amarelo): a clínica confirma, e
 *                            a confirmação sai para a cliente pelo WhatsApp;
 *   agendado              → status `confirmed` (verde): já vale.
 * Mora em `organizations.settings.iavek.agenda_ia`. Ausente = pré-agendado.
 */

export const MARCA_COMO = ["pre_agendado", "agendado"] as const;
export type MarcaComo = (typeof MARCA_COMO)[number];

export const agendaDaIaSchema = z.strictObject({ marca_como: z.enum(MARCA_COMO) });
export type AgendaDaIa = z.infer<typeof agendaDaIaSchema>;

export const AGENDA_DA_IA_PADRAO: AgendaDaIa = Object.freeze({ marca_como: "pre_agendado" });

export function lerAgendaDaIa(settings: unknown): AgendaDaIa {
  const bruto = (settings as { iavek?: { agenda_ia?: unknown } } | null)?.iavek?.agenda_ia;
  const lido = agendaDaIaSchema.safeParse(bruto);
  return lido.success ? lido.data : { ...AGENDA_DA_IA_PADRAO };
}

export function comAgendaDaIa(settings: unknown, config: AgendaDaIa): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, agenda_ia: config } };
}

/** O status do compromisso que a IA marca. */
export function statusDaMarcacaoDaIa(config: AgendaDaIa): "pending" | "confirmed" {
  return config.marca_como === "agendado" ? "confirmed" : "pending";
}

/**
 * O PROMPT-BASE DA CLÍNICA — ponto de partida para o admin colar no agente de
 * IA da clínica (Agentes › prompt). Nada de carro, troca, financiamento ou
 * estoque. A IA nunca é publicada sozinha: quem cola e publica é a equipe.
 */
export const PROMPT_BASE_CLINICA = [
  "Você é a atendente virtual de uma clínica de procedimentos estéticos, pelo WhatsApp.",
  "Fale em português simples, com educação e frases curtas. Uma pergunta por vez.",
  "",
  "SEU OBJETIVO: entender o que a cliente procura e AGENDAR o procedimento.",
  "1. Cumprimente e pergunte o nome, se ainda não souber.",
  "2. Entenda o procedimento de interesse e o objetivo dela. Use a lista de atendimentos da clínica (crm_list_event_types); nunca invente procedimento.",
  "3. Tire dúvidas só com o que está no material da clínica. Não prometa resultado, não dê diagnóstico e não fale de preço que não esteja no material.",
  "4. Para agendar: consulte os horários livres (crm_find_free_slots) e ofereça 2 ou 3 opções. Nunca ofereça horário que não veio da consulta.",
  "5. Quando ela escolher, marque (crm_find_and_book_appointment ou crm_book_appointment) e repita dia, hora e procedimento.",
  "6. Se a marcação vier como pré-agendada, diga que o horário está reservado e que a clínica confirma por aqui. Se vier confirmada, diga que está agendado.",
  "7. Se o horário acabou de ser ocupado, peça desculpas e ofereça outro da lista.",
  "8. Se ela pedir para falar com uma pessoa, ou se o assunto for reclamação, saúde ou algo fora do material, passe para a equipe.",
  "",
  "NUNCA: peça CPF, documento ou dados de cartão; fale de outras clientes; marque sem a cliente escolher o horário.",
].join("\n");

/** O texto da CONFIRMAÇÃO que sai pelo WhatsApp quando a clínica confirma o pré-agendado. */
export function textoDaConfirmacao(args: {
  nome: string | null;
  procedimento: string;
  inicio: Date;
  fuso: string;
  /** O idioma da empresa: a data segue ele (o texto é da clínica, em português). */
  idioma: Idioma;
}): string {
  const tag = tagDeIdioma(args.idioma);
  const dia = new Intl.DateTimeFormat(tag, { timeZone: args.fuso, weekday: "long", day: "2-digit", month: "2-digit" }).format(args.inicio);
  const hora = new Intl.DateTimeFormat(tag, { timeZone: args.fuso, hour: "2-digit", minute: "2-digit", hour12: false }).format(args.inicio);
  const ola = args.nome ? `Olá, ${args.nome.split(/\s+/)[0]}!` : "Olá!";
  return `${ola} Seu horário de ${args.procedimento} está CONFIRMADO para ${dia}, às ${hora}. Qualquer coisa, é só responder por aqui.`;
}
