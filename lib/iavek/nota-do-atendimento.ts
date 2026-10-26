import { z } from "zod";

/**
 * ia.vek v1.8.4 — NOTA DO ATENDIMENTO (pedido do Rodrigo, 24/10/2026).
 *
 * Quando o vendedor clica em Fechar, um avaliador separado lê aquele
 * atendimento e dá uma nota de 0 a 10 ao VENDEDOR. Aqui mora só o que é puro:
 * a chave da loja, os critérios padrão, a máscara de dados protegidos, a
 * transcrição e o formato da resposta. Quem chama o modelo é o worker
 * (`workers/iavek-nota-do-atendimento.ts`).
 *
 * O que NÃO entra na IA (regras de ouro do projeto): CPF, RG, renda, placa,
 * chassi, número longo, e-mail e o nome do cliente. O texto é mascarado ANTES
 * de sair do servidor.
 */

/** O modelo pedido pelo Maestro (o Haiku mais novo). Prefixo de rota do gateway. */
export const MODELO_DA_NOTA = "anthropic/claude-haiku-5-5";

/** O título fixo do material do Acervo com os critérios. */
export const TITULO_DOS_CRITERIOS = "Critérios de avaliação do atendimento";

export const CRITERIOS_PADRAO = [
  "1. Tempo da primeira resposta: respondeu o cliente logo, sem deixá-lo esperando.",
  "2. Cordialidade e português: educado, claro, sem erros que atrapalhem.",
  "3. Entendeu a necessidade: perguntou e registrou o carro de interesse, a forma de pagamento e se há carro na troca.",
  "4. Apresentou opção do estoque: ofereceu um carro concreto da loja que atende ao pedido.",
  "5. Tentou agendar ou avançar: propôs visita, ligação de vídeo ou o próximo passo com data.",
  "6. Registrou os campos do lead: o que o cliente disse ficou anotado no CRM.",
  "7. Não prometeu o que não pode: nada de preço, desconto ou condição fora da regra da loja.",
].join("\n");

// ---------------------------------------------------------------- a chave

export const configDaNotaSchema = z.object({ ativo: z.boolean() }).strict();
export type ConfigDaNota = z.infer<typeof configDaNotaSchema>;

/** `organizations.settings.iavek.nota_do_atendimento` — sem a chave, DESLIGADA. */
export function lerConfigDaNota(settings: unknown): ConfigDaNota {
  const bruto = (settings as { iavek?: { nota_do_atendimento?: unknown } } | null)?.iavek?.nota_do_atendimento;
  const lido = configDaNotaSchema.safeParse(bruto);
  return lido.success ? lido.data : { ativo: false };
}

export function comConfigDaNota(settings: unknown, config: ConfigDaNota): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, nota_do_atendimento: config } };
}

// ---------------------------------------------------------------- a máscara

const MASCARAS: Array<[RegExp, string]> = [
  // e-mail
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]"],
  // chassi (VIN: 17 caracteres, sem I/O/Q)
  [/\b(?=[A-HJ-NPR-Z0-9]*\d)[A-HJ-NPR-Z0-9]{17}\b/gi, "[chassi]"],
  // CPF (com ou sem pontuação) e CNPJ
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]"],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[documento]"],
  // RG (formatos comuns: 12.345.678-9)
  [/\b\d{1,2}\.\d{3}\.\d{3}-?[\dXx]\b/g, "[documento]"],
  // placa antiga (ABC-1234) e Mercosul (ABC1D23)
  [/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/gi, "[placa]"],
  // renda/salário com valor ("ganho 5 mil", "renda de R$ 4.500")
  [/\b(renda|sal[aá]rio|ganho|recebo)\b[^.\n]{0,30}?(r\$\s*)?\d[\d.,]*(\s*(mil|k))?/gi, "$1 [valor]"],
  // telefone e qualquer número longo (8+ dígitos, com separadores)
  [/(?:\+?\d[\s().-]?){8,}\d/g, "[número]"],
];

/** Tira do texto o que nunca vai à IA. Nome do cliente é trocado à parte (`nomes`). */
export function mascarar(texto: string, nomes: readonly string[] = []): string {
  let t = texto;
  for (const [re, troca] of MASCARAS) t = t.replace(re, troca);
  for (const nome of nomes) {
    for (const parte of nome.split(/\s+/).filter((p) => p.length >= 3)) {
      t = t.replace(new RegExp(`\\b${parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "Cliente");
    }
  }
  return t;
}

// ---------------------------------------------------------------- a transcrição

export interface MensagemDoAtendimento {
  direction: "inbound" | "outbound";
  sent_via: string | null;
  type: string;
  body: string | null;
  created_at: string;
}

/** Quem falou, como o avaliador deve ler. */
export function quemFalou(m: Pick<MensagemDoAtendimento, "direction" | "sent_via">): "CLIENTE" | "VENDEDOR" | "IA" | "SISTEMA" {
  if (m.direction === "inbound") return "CLIENTE";
  if (m.sent_via === "ai") return "IA";
  if (m.sent_via === "automation" || m.sent_via === "system") return "SISTEMA";
  return "VENDEDOR";
}

export const ehDoVendedor = (m: Pick<MensagemDoAtendimento, "direction" | "sent_via">) => quemFalou(m) === "VENDEDOR";

/**
 * Tetos da transcrição. O preço de tabela do claude-haiku-5-5 (10/50 centavos
 * por milhão) vale para pedidos de ATÉ 100 mil tokens; acima, a faixa é 5x. O
 * catálogo guarda uma faixa só, então o avaliador nunca passa dela: 200
 * mensagens e 120 mil caracteres (~40 mil tokens; com o tokenizer novo, que
 * conta ~30% a mais, ainda bem abaixo de 100 mil, somados prompt e critérios).
 */
export const LIMITE_DE_MENSAGENS = 200;
export const LIMITE_DE_CARACTERES = 120_000;

/**
 * Monta a transcrição mascarada. Mensagem sem texto vira "[áudio]", "[imagem]"…
 * Devolve também se cortou (as MAIS ANTIGAS saem — o fim do atendimento é o que
 * mais pesa na nota) para a nota dizer que foi parcial.
 */
export function montarTranscricao(
  mensagens: readonly MensagemDoAtendimento[],
  nomesDoCliente: readonly string[],
  fuso = "America/Sao_Paulo",
): { texto: string; cortou: boolean; total: number } {
  const ordenadas = [...mensagens].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const cortou = ordenadas.length > LIMITE_DE_MENSAGENS;
  const usadas = cortou ? ordenadas.slice(-LIMITE_DE_MENSAGENS) : ordenadas;
  // "dd/mm, hh:mm" no fuso da loja. É texto para a IA, não para quem lê a tela:
  // o formato é fixo e neutro (en-GB dá exatamente dd/mm, hh:mm).
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const linhas = usadas.map((m) => {
    const corpo = m.body && m.body.trim() ? mascarar(m.body.trim(), nomesDoCliente) : `[${m.type}]`;
    return `[${hora.format(new Date(m.created_at))}] ${quemFalou(m)}: ${corpo}`;
  });
  // Teto de caracteres: saem as MAIS ANTIGAS até caber.
  let tamanho = linhas.reduce((t, l) => t + l.length + 1, 0);
  let inicio = 0;
  while (tamanho > LIMITE_DE_CARACTERES && inicio < linhas.length - 1) {
    tamanho -= linhas[inicio]!.length + 1;
    inicio += 1;
  }
  const finais = linhas.slice(inicio);
  return { texto: finais.join("\n").slice(-LIMITE_DE_CARACTERES), cortou: cortou || inicio > 0, total: finais.length };
}

// ---------------------------------------------------------------- a resposta

export const respostaDaNotaSchema = z.object({
  nota: z.number().min(0).max(10).describe("Nota do atendimento do VENDEDOR, de 0 a 10, com uma casa decimal."),
  pontos_fortes: z.array(z.string().max(200)).min(1).max(3).describe("De 1 a 3 pontos fortes do vendedor, frases curtas."),
  pontos_a_melhorar: z.array(z.string().max(200)).min(1).max(3).describe("De 1 a 3 pontos a melhorar, frases curtas e acionáveis."),
  trecho: z.string().max(300).describe("Um trecho curto da conversa (ou resumo de uma linha) que justifica a nota."),
});
export type RespostaDaNota = z.infer<typeof respostaDaNotaSchema>;

export function promptDoAvaliador(criterios: string): string {
  return [
    "Você avalia o ATENDIMENTO de um vendedor de uma loja de carros seminovos, pela conversa de WhatsApp.",
    "Você NÃO fala com o cliente e NÃO escreve mensagens para ele. Sua saída vai só para o gerente da loja.",
    "Avalie apenas as falas do VENDEDOR, usando os critérios abaixo. Falas da IA e do sistema não contam a favor nem contra o vendedor.",
    "Dados pessoais foram mascarados ([documento], [número], [placa]…): não comente isso.",
    "Seja justo: atendimento curto que resolveu o que o cliente pediu pode ter nota alta.",
    "",
    "CRITÉRIOS DA LOJA:",
    criterios.trim(),
  ].join("\n");
}
