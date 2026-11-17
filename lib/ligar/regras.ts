/**
 * ia.vek CRM-532 — o botão "Ligar" (abre o discador do celular) e o "Como foi a ligação?" na volta.
 *
 * O PONTO ÚNICO da decisão que o Rodrigo ainda vai confirmar (Maestro 194333): quando NÃO há tarefa de ligação aberta
 * daquele negócio, o "Como foi a ligação?" também aparece (e o registro entra na linha do tempo + o próximo passo)?
 * `true` = sim (a recomendação: toda ligação conta). `false` = só pergunta quando há tarefa de ligação aberta.
 * A tela (a pergunta na volta) e a rota (POST /api/v1/contacts/[id]/ligacao) leem ESTA constante, e só ela.
 */
export const LIGACAO_SEM_TAREFA_REGISTRA = true;

/** Fora do CRM por pelo menos isto, para a volta contar como "voltou da ligação" (e não uma troca de aba rápida). */
export const MINIMO_FORA_MS = 5_000;
/** Depois disto, a marca "ligação começando" vence: a pergunta não aparece mais (a pessoa já seguiu a vida). */
export const VALIDADE_DA_MARCA_MS = 2 * 60 * 60 * 1000;

/**
 * O `href` do botão: `tel:+<dígitos>`, do telefone JÁ canônico do contato (o CRM guarda `+55…`, lib/channels/
 * phone-variants). Nunca vem de um campo digitado na hora. Sem número utilizável (menos de 8 dígitos), `null`: o botão
 * não aparece.
 */
export function hrefDeLigar(telefone: string | null | undefined): string | null {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 8 || digitos.length > 15) return null;
  return `tel:+${digitos}`;
}
