/**
 * Assinatura do emissor nas mensagens enviadas ao cliente (issue #2066).
 *
 * Quando uma mensagem é enviada ao WhatsApp, quem fala aparece em negrito na
 * linha de cima (`*Nome*\n`), com o texto logo abaixo — para o cliente saber
 * com quem está falando quando a conversa passa de um atendente para outro ou
 * para a IA.
 *
 * ## Config é OPT-IN, e só o `true` LIGA
 *
 * Moram em `organizations.settings.assinatura_mensagens`:
 *
 * ```json
 * {
 *   "assinatura_mensagens": {
 *     "humanos": true,
 *     "ia": true,
 *     "nome_ia": "Assistente Virtual"
 *   }
 * }
 * ```
 *
 * Seguindo a régua da casa (ver `colegasPodemMexerNaAgendaLigado` em
 * `lib/schemas/settings.ts`), **só o booleano `true` liga**: ausente, `false`,
 * a string `"true"` ou qualquer lixo é desligado — e, sendo o default `{}`
 * (tudo desligado), toda organização que já existia antes ganha o recurso sem
 * comportamento novo até um admin ligar. É decisão deliberada: uma assinatura
 * automática que o operador não pediu seria a mesma classe de surpresa que
 * quem liga a feature não controla.
 *
 * ## O que este módulo NÃO decide
 *
 * Este módulo é puro (não toca banco nem rede): a decisão de LER o settings,
 * resolver o nome do atendente (`nomesDosAtendentes`) e aplicar a assinatura
 * SÓ ao texto que vai ao canal (nunca ao `messages.body` gravado) é do
 * chamador — `app/api/v1/messages/_handler.ts`.
 */
import { z } from "zod";
import { FUNCOES, funcaoDaTela, type Funcao } from "@/lib/iavek/funcoes";

export interface ConfigAssinatura {
  /** Assina as mensagens de atendentes humanos quando `true`. */
  humanos: boolean;
  /** Assina as mensagens da IA quando `true`. */
  ia: boolean;
  /** O nome configurável da IA (ex.: "Assistente Virtual" ou o nome do agente). */
  nomeIa: string;
  /**
   * ia.vek v1.7.2: como cada FUNÇÃO aparece PARA O CLIENTE na assinatura do
   * humano (`*Nome | Rótulo*`). Um WhatsApp só para a equipe toda: o cliente
   * precisa saber se fala com o consultor, o relacionamento ou o gerente.
   */
  rotulosFuncao?: Record<Funcao, string>;
}

/** Os rótulos padrão de cada função para o cliente (configuráveis por organização). */
export const ROTULOS_FUNCAO_PADRAO: Record<Funcao, string> = {
  sdr: "Relacionamento",
  suporte: "Atendimento",
  vendedor: "Consultor de Vendas",
  apoio: "Gerente de Negócios",
  // ia.vek v1.7.6: um cargo só de gerente, e ele assina "Gerente de Negócios".
  gerente: "Gerente de Negócios",
};

/**
 * O padrão de gerente até a v1.7.5. A tela de Configurações grava os rótulos
 * de todas as funções juntos, então uma organização que salvou a tela antes da
 * v1.7.6 tem "Gerente" gravado sem ter escolhido: lido como "não configurado".
 */
const ROTULO_GERENTE_ANTIGO = "Gerente";

/** Rótulo seguro: sem `*` nem quebra de linha (desmontariam a linha `*...*\n`). */
const ROTULO = /^[^*\r\n]+$/;

function rotulosLidos(bruto: unknown): Record<Funcao, string> {
  const r = { ...ROTULOS_FUNCAO_PADRAO };
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return r;
  for (const f of FUNCOES) {
    const v = (bruto as Record<string, unknown>)[f];
    if (typeof v !== "string") continue;
    const limpo = v.trim();
    if (f === "gerente" && limpo === ROTULO_GERENTE_ANTIGO) continue;
    if (limpo.length >= 1 && limpo.length <= 60 && ROTULO.test(limpo)) r[f] = limpo;
  }
  // Apoio é apelido de gerente (v1.7.5): assina com o rótulo do gerente.
  r.apoio = r.gerente;
  return r;
}

const assinaturaSchema = z
  .object({
    humanos: z.boolean().catch(false),
    ia: z.boolean().catch(false),
    nome_ia: z.string().trim().min(1).max(120).catch("Assistente Virtual"),
  })
  .catch({ humanos: false, ia: false, nome_ia: "Assistente Virtual" });

/**
 * Lê a config de `organizations.settings`. Nunca lança: um jsonb torto não pode
 * derrubar um envio — degrada para o padrão (tudo desligado).
 */
export function configAssinatura(settings: unknown): ConfigAssinatura {
  const raiz =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : undefined;
  const bruto = raiz?.assinatura_mensagens ?? {};
  const parsed = assinaturaSchema.parse(bruto);
  return {
    humanos: parsed.humanos,
    ia: parsed.ia,
    nomeIa: parsed.nome_ia,
    rotulosFuncao: rotulosLidos((bruto as { rotulos_funcao?: unknown } | null)?.rotulos_funcao),
  };
}

/**
 * As "iniciais em maiúsculo" do relato: a primeira letra de cada palavra em
 * maiúscula, o resto como veio. Não usa o title-case do JS porque ele rebaixa
 * "da" / "de" / "do" — e o relato pede iniciais, não um título próprio.
 */
export function capitalizarIniciais(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra) => palavra.charAt(0).toUpperCase() + palavra.slice(1))
    .join(" ");
}

/**
 * A linha de assinatura em negrito (`*Nome*\n`) que abre o que vai ao canal,
 * ou `null` quando não há o que assinar (config desligada para esta origem, ou
 * — no humano — o nome não pôde ser resolvido).
 *
 * A origem cobre só humano e IA: automação e sistemas externos ficam de fora,
 * como o relato pede.
 */
export function linhaDeAssinatura(
  config: ConfigAssinatura,
  origem: "user" | "ai",
  nomeHumano?: string | null,
  /** ia.vek v1.7.2: a função do atendente; sem função, só o nome (como antes). */
  funcaoHumano?: Funcao | null,
): string | null {
  if (origem === "ai") {
    if (!config.ia) return null;
    // Para a IA o relato não pede capitalização — o nome é o que a organização
    // configurou ("Assistente Virtual", o nome do agente, uma marca).
    return `*${config.nomeIa}*\n`;
  }
  if (!config.humanos) return null;
  const nome = nomeHumano?.trim();
  if (!nome) return null;
  // Apoio é apelido de gerente: os dois assinam com o rótulo do gerente.
  const funcao = funcaoDaTela(funcaoHumano);
  const rotulo = funcao ? config.rotulosFuncao?.[funcao] : undefined;
  return rotulo
    ? `*${capitalizarIniciais(nome)} | ${rotulo}*\n`
    : `*${capitalizarIniciais(nome)}*\n`;
}

/**
 * Aplica a linha de assinatura sobre o texto que sai ao canal. Com assinatura
 * ausente ou texto vazio/nulo devolve o texto como veio — uma mídia sem legenda
 * não ganha uma linha de nome solta.
 */
export function aplicarAssinatura(
  assinatura: string | null,
  texto: string | null | undefined,
): string | null | undefined {
  if (!assinatura || !texto) return texto;
  return assinatura + texto;
}

/**
 * O que a porta de Configurações aceita gravar. O nome da IA não leva `*` nem
 * quebra de linha: qualquer um dos dois desmonta a linha `*Nome*\n` — o
 * negrito sai torto para o cliente e `semAssinatura` deixa de reconhecê-la.
 */
export const assinaturaEntradaSchema = z
  .object({
    humanos: z.boolean(),
    ia: z.boolean(),
    nome_ia: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[^*\r\n]+$/),
    // ia.vek v1.7.2: rótulo de cada função para o cliente. Opcional: a tela
    // antiga, que não manda o campo, não apaga o que já foi configurado.
    rotulos_funcao: z
      .object(
        Object.fromEntries(
          FUNCOES.map((f) => [
            f,
            z
              .string()
              .trim()
              .min(1)
              .max(60)
              .regex(/^[^*\r\n]+$/),
          ]),
        ) as Record<Funcao, z.ZodString>,
      )
      .partial()
      .strict()
      .optional(),
  })
  .strict();

const LINHA_DE_ASSINATURA = /^\*[^*\n]+\*\n/;

/**
 * O texto sem a linha de assinatura do começo, se houver. Quem precisa é a
 * guarda de eco da ingestão do canal: o eco devolve o que SAIU
 * (`*Nome*\ntexto`), e `messages.body` guarda só `texto`.
 */
export function semAssinatura(texto: string): string {
  return texto.replace(LINHA_DE_ASSINATURA, "");
}
