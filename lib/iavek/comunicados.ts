import { z } from "zod";

import { FUNCOES, ROTULO_DA_FUNCAO, type Funcao } from "@/lib/iavek/funcoes";

/**
 * ia.vek CRM-439 fase 1 (migration 0651): as ORIENTAÇÕES DA LOJA e as NOVIDADES DA VERSÃO.
 *
 * A gerência manda uma orientação a uma FUNÇÃO ou a uma PESSOA; ela chega no sino e no Meu dia com "li e entendi";
 * a gerência vê quem leu; tudo fica guardado (o Manual da loja). As Novidades vêm só do servidor (o time escreve).
 * Não se edita nem se apaga: errou, envia outra que corrige (`substitui_id`). Sem push.
 *
 * As listas abaixo são as MESMAS dos CHECKs da 0651 — quem confere é
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 */
export const TIPOS_DE_COMUNICADO = ["orientacao", "novidade"] as const;
export type TipoDeComunicado = (typeof TIPOS_DE_COMUNICADO)[number];

export const ALVOS_DE_COMUNICADO = ["funcao", "pessoa"] as const;
export type AlvoDeComunicado = (typeof ALVOS_DE_COMUNICADO)[number];

/**
 * As funções que podem ser ALVO. É o FUNCOES sem duas:
 *   - o 'apoio': o gerente de apoio conta como gerente (a mesma régua da `fn_iavek_funcao_na_org`, 0598), então uma
 *     orientação "para Gerente" o alcança;
 *   - a 'analista_ficha': ela não usa o CRM (a `fn_user_org_ids` a deixa de fora, 0586), e um comunicado para ela
 *     ficaria sem leitor. A função de envio também nunca a põe entre os destinatários.
 * Uma função nova em FUNCOES exige uma migration nova que recrie o check de `para_funcao` (o teste de FUNCOES_ALVO
 * acusa a diferença).
 */
export const FUNCOES_ALVO = ["sdr", "suporte", "vendedor", "gerente", "sdr_followup"] as const;
export type FuncaoAlvo = (typeof FUNCOES_ALVO)[number];

/** A função usada para resolver o alvo: 'apoio' conta como 'gerente'; a 'analista_ficha' não é alvo (null). */
export function funcaoDoAlvo(funcao: unknown): FuncaoAlvo | null {
  if (typeof funcao !== "string") return null;
  const f = funcao === "apoio" ? "gerente" : funcao;
  return (FUNCOES_ALVO as readonly string[]).includes(f) ? (f as FuncaoAlvo) : null;
}

/** As funções de FUNCOES que não são alvo próprio (hoje o 'apoio' e a 'analista_ficha'). */
export function funcoesForaDoAlvo(): Funcao[] {
  return FUNCOES.filter((f) => !(FUNCOES_ALVO as readonly string[]).includes(f));
}

export function rotuloDoAlvo(funcao: FuncaoAlvo): string {
  return ROTULO_DA_FUNCAO[funcao];
}

/** Os tipos do sino (0651). Nunca o 'aviso_da_loja', que é da esteira, do estoque e do pedido de ajuda. */
export const TIPO_DO_SINO: Record<TipoDeComunicado, "orientacao_da_loja" | "novidade_da_versao"> = {
  orientacao: "orientacao_da_loja",
  novidade: "novidade_da_versao",
};

const titulo = z.string().trim().min(1).max(120);
const texto = z.string().trim().min(1).max(4000);

/** O corpo do envio da gerência (POST /api/v1/iavek/comunicados). */
export const envioDaOrientacaoSchema = z.discriminatedUnion("alvo", [
  z.strictObject({
    alvo: z.literal("funcao"),
    titulo,
    texto,
    para_funcao: z.enum(FUNCOES_ALVO),
    substitui_id: z.string().uuid().optional(),
  }),
  z.strictObject({
    alvo: z.literal("pessoa"),
    titulo,
    texto,
    para_usuario: z.string().uuid(),
    substitui_id: z.string().uuid().optional(),
  }),
]);
export type EnvioDaOrientacao = z.infer<typeof envioDaOrientacaoSchema>;

/** O corpo da Novidade (só o servidor: POST /api/internal/iavek/novidade-da-versao). A org vem no corpo. */
export const envioDaNovidadeSchema = z.strictObject({
  organization_id: z.string().uuid(),
  versao: z.string().trim().min(1).max(40),
  titulo,
  texto,
  para_funcao: z.enum(FUNCOES_ALVO),
  pede_leitura: z.boolean().default(true),
  substitui_id: z.string().uuid().optional(),
});
export type EnvioDaNovidade = z.infer<typeof envioDaNovidadeSchema>;

/** Os parâmetros de `fn_iavek_enviar_comunicado`, montados de um envio. */
export function parametrosDoEnvio(
  orgId: string,
  envio:
    | { tipo: "orientacao"; enviadoPor: string; corpo: EnvioDaOrientacao }
    | { tipo: "novidade"; corpo: EnvioDaNovidade },
): Record<string, string | boolean | null> {
  if (envio.tipo === "orientacao") {
    const c = envio.corpo;
    return {
      p_org: orgId,
      p_tipo: "orientacao",
      p_titulo: c.titulo,
      p_texto: c.texto,
      p_alvo: c.alvo,
      p_para_funcao: c.alvo === "funcao" ? c.para_funcao : null,
      p_para_usuario: c.alvo === "pessoa" ? c.para_usuario : null,
      p_pede_leitura: true,
      p_enviado_por: envio.enviadoPor,
      p_substitui_id: c.substitui_id ?? null,
      p_versao: null,
    };
  }
  const c = envio.corpo;
  return {
    p_org: orgId,
    p_tipo: "novidade",
    p_titulo: c.titulo,
    p_texto: c.texto,
    p_alvo: "funcao",
    p_para_funcao: c.para_funcao,
    p_para_usuario: null,
    p_pede_leitura: c.pede_leitura,
    p_enviado_por: null,
    p_substitui_id: c.substitui_id ?? null,
    p_versao: c.versao,
  };
}

/**
 * Como a rota traduz o erro da função de envio. A função levanta com o código PostgREST de status (PT403/PT422);
 * o resto é 500.
 */
export function statusDoErroDoEnvio(code: string | null | undefined): 403 | 422 | 500 {
  if (code === "PT403") return 403;
  if (code === "PT422") return 422;
  return 500;
}

export interface ComunicadoDaLista {
  id: string;
  substitui_id: string | null;
  enviado_em: string;
}

/** Quem substituiu cada comunicado: a mais NOVA que aponta para ele (sem tocar a velha). */
export function substituidoPor<T extends ComunicadoDaLista>(
  lista: readonly T[],
): Map<string, string> {
  const porData = [...lista].sort((a, b) => a.enviado_em.localeCompare(b.enviado_em));
  const mapa = new Map<string, string>();
  for (const c of porData) {
    if (c.substitui_id) mapa.set(c.substitui_id, c.id);
  }
  return mapa;
}

/** O que vale hoje (o Manual da loja): os que ninguém substituiu. */
export function queAindaValem<T extends ComunicadoDaLista>(lista: readonly T[]): T[] {
  const substituidos = substituidoPor(lista);
  return lista.filter((c) => !substituidos.has(c.id));
}

/** O "X de Y leram" da gerência. */
export function contagemDeLeitura(
  destinatarios: number,
  lidos: number,
): { lidos: number; total: number; faltam: number } {
  const total = Math.max(0, destinatarios);
  const l = Math.min(Math.max(0, lidos), total);
  return { lidos: l, total, faltam: total - l };
}

/** O bloco do Meu dia: só os que pedem leitura e ainda não foram lidos, do mais antigo ao mais novo. */
export function pendentesDoMeuDia<
  T extends { pede_leitura: boolean; lido: boolean; enviado_em: string },
>(lista: readonly T[]): T[] {
  return lista
    .filter((c) => c.pede_leitura && !c.lido)
    .sort((a, b) => a.enviado_em.localeCompare(b.enviado_em));
}
