/**
 * ia.vek CRM-532 — o botão "Ligar" (abre o discador do celular) e o "Como foi a ligação?" na volta.
 *
 * O PONTO ÚNICO de uma decisão do Rodrigo (confirmada 17/11, Maestro 211323: "aparece SEMPRE"): quando NÃO há tarefa de
 * ligação aberta daquele negócio, o "Como foi a ligação?" também aparece (e o registro entra na linha do tempo + o
 * próximo passo). `true` = sim. `false` = só pergunta quando há tarefa de ligação aberta.
 * A tela (a pergunta na volta) e a rota (POST /api/v1/contacts/[id]/ligacao) leem ESTA constante, e só ela.
 */
import { FUNCOES } from "@/lib/iavek/funcoes";

export const LIGACAO_SEM_TAREFA_REGISTRA = true;

/**
 * QUEM liga pelo CRM (decisão do Rodrigo 17/11, "todo mundo que quiser"; Maestro 212519/212640; Lupa 212827): de fábrica,
 * TODO MUNDO QUE ATENDE (papel agent ou acima), com qualquer função ou sem função. O viewer NUNCA (não atende), e o
 * analista de ficha também não (ele nem usa o /app: o layout o leva para /fichas).
 * A loja pode RESTRINGIR, na config dela (settings.iavek.ligar.funcoes, ex.: ["vendedor"]), sem versão nova: aí só as
 * funções da lista ligam, e quem não tem função fica fora. Valor ruim volta ao padrão (que nunca inclui o viewer, porque
 * o "atende" é exigido sempre). A tela de Tarefas ("Registrar ligação") NÃO passa por aqui.
 */
export const FUNCOES_QUE_NUNCA_LIGAM: readonly string[] = ["analista_ficha"];

/** A lista da loja, ou `null` = sem restrição (todo mundo que atende). Valor ruim = `null` (o padrão). */
export function funcoesQueLigam(settingsDaOrg: unknown): readonly string[] | null {
  const bruto = (settingsDaOrg as { iavek?: { ligar?: { funcoes?: unknown } } } | null | undefined)?.iavek?.ligar?.funcoes;
  if (!Array.isArray(bruto)) return null;
  const validas = bruto.filter((f): f is string => typeof f === "string" && (FUNCOES as readonly string[]).includes(f));
  return validas.length > 0 ? validas : null;
}

/**
 * Esta pessoa liga pelo CRM? Só quem atende; nunca o analista de ficha; e, se a loja restringiu, só as funções da lista.
 * A função é a REAL do vínculo (o layout do servidor e a rota leem a do banco). O "ver como" do admin é trava SÓ DA TELA
 * (o BotaoLigar some na prévia); o servidor aceita, porque quem grava é a pessoa real, agent ou acima.
 */
export function ligaPeloCrm(funcao: unknown, settingsDaOrg: unknown, atende: boolean): boolean {
  if (!atende) return false;
  const f = typeof funcao === "string" && funcao ? funcao : null;
  if (f && FUNCOES_QUE_NUNCA_LIGAM.includes(f)) return false;
  const lista = funcoesQueLigam(settingsDaOrg);
  return lista === null || (f !== null && lista.includes(f));
}

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
  // (Lupa 205419) só com o CÓDIGO DO PAÍS: o número guardado com '+' (o canônico do CRM), ou com 12 a 15 dígitos (o
  // país + DDD + número). Um local de 10-11 dígitos sem o país viraria '+11…', outro país: aí NÃO há link.
  const comPais = telefone.trim().startsWith("+") ? digitos.length >= 8 : digitos.length >= 12;
  if (!comPais || digitos.length > 15) return null;
  return `tel:+${digitos}`;
}

/**
 * Na TELA: em prévia "ver como" (o admin escolheu ver como uma função), nem o botão nem a pergunta, para nunca gravar
 * ligação enquanto vê como outra função. Detectado pela PRESENÇA da prévia (Lupa 213638), e não pela diferença de função.
 * Trava SÓ da tela: o servidor não sabe da prévia (ela mora no navegador) e aceita, porque quem grava é a pessoa real.
 */
export function ligaNaTela(ligaPeloCrmNoServidor: boolean, emPrevia: boolean): boolean {
  return ligaPeloCrmNoServidor && !emPrevia;
}
