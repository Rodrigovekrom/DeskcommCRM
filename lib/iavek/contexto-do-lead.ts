import { CONTEXTO_MINIMO } from "@/lib/iavek/passagem";

/**
 * ia.vek v1.9.39 (CRM-282, opção A, Rodrigo 10/11) — o contexto do lead no card.
 *
 * A trava (0612, `fn_iavek_campos_que_faltam_do_lead`) aceita a Descrição com
 * 20 letras ou mais, contadas depois de tirar os espaços das pontas
 * (`char_length(btrim(...))`). A tela diz quanto falta com a MESMA régua.
 */
export function faltamParaOContexto(texto: string | null | undefined): number {
  // O formulário grava `description.trim()` (LeadFieldsForm), e o banco mede com
  // `char_length`, que conta caracteres (code points): um emoji conta 1, não 2.
  return Math.max(0, CONTEXTO_MINIMO - [...(texto ?? "").trim()].length);
}
