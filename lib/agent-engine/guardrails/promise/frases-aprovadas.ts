import type { PromiseClassification } from './semantic';

/**
 * FRASES APROVADAS NO PLAYBOOK DA MEMÓRIA (ia.vek C10, aprovada pelo Maestro em
 * 16/10/2026).
 *
 * A trava semântica de promessa barrava frases que a própria memória da
 * organização manda dizer ("Trabalhamos com financiamento, sim!", "vamos em
 * busca disso pra você"): a IA reescrevia e o turno custava o dobro (P06a da
 * bateria: 2× o custo, 75 s). Agora, quando o TRECHO SUSPEITO de promessa
 * comercial está contido numa frase entre aspas da memória, o veto comercial
 * cai.
 *
 * O que NÃO muda: o sinal de "promessa de retorno humano"
 * (`prometeuRetornoHumano`) segue intacto — é ele que obriga o handoff quando a
 * IA diz que alguém vai chamar. E só a MEMÓRIA conta (o prompt do agente não):
 * frase do prompt que contradiz a regra de promessa é decisão do dono.
 */

const MINIMO_DA_FRASE = 12;
const MINIMO_DO_TRECHO = 8;

export function normalizarFrase(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** As frases entre aspas ("…" ou “…”) da memória, já normalizadas. */
export function frasesAprovadasDaMemoria(conteudo: string | null | undefined): string[] {
  if (!conteudo) return [];
  const frases = new Set<string>();
  for (const m of conteudo.matchAll(/["“]([^"”\n]{12,600})["”]/g)) {
    const f = normalizarFrase(m[1]!);
    if (f.length >= MINIMO_DA_FRASE) frases.add(f);
  }
  return [...frases];
}

/** O veto COMERCIAL cai quando o trecho suspeito é parte de uma frase aprovada. */
export function liberarFrasesDoPlaybook(c: PromiseClassification, frases: readonly string[]): PromiseClassification {
  if (!c.isPromise || !c.suspectPhrase || frases.length === 0) return c;
  const trecho = normalizarFrase(c.suspectPhrase);
  if (trecho.length < MINIMO_DO_TRECHO) return c;
  return frases.some((f) => f.includes(trecho)) ? { ...c, isPromise: false, suspectPhrase: null } : c;
}
