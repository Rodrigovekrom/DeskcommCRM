import { describe, expect, it } from 'vitest';
import { frasesAprovadasDaMemoria, liberarFrasesDoPlaybook } from './frases-aprovadas';
import type { PromiseClassification } from './semantic';

const memoria = `
**Financiado.** "Trabalhamos com financiamento, sim! A gente busca a melhor possibilidade conforme a análise de cada cliente 😊"
**Entrada.** "Entendi, e vamos em busca disso pra você."
Curto: "oi"
`;
const c = (suspectPhrase: string, extra: Partial<PromiseClassification> = {}): PromiseClassification => ({
  isPromise: true,
  suspectPhrase,
  prometeuRetornoHumano: false,
  retornoSoDoAssistente: false,
  ...extra,
});

describe('C10: frases aprovadas na memória não caem na trava comercial', () => {
  const frases = frasesAprovadasDaMemoria(memoria);
  it('extrai as frases entre aspas (as curtas ficam de fora)', () => {
    expect(frases).toHaveLength(2);
  });
  it('trecho suspeito que é frase do playbook: o veto comercial cai', () => {
    expect(liberarFrasesDoPlaybook(c('Trabalhamos com financiamento, sim!'), frases).isPromise).toBe(false);
    expect(liberarFrasesDoPlaybook(c('vamos em busca disso pra você'), frases).isPromise).toBe(false);
  });
  it('promessa fora do playbook continua barrada', () => {
    expect(liberarFrasesDoPlaybook(c('consigo 10% de desconto pra você'), frases).isPromise).toBe(true);
  });
  it('promessa de retorno humano nunca é tocada', () => {
    const r = liberarFrasesDoPlaybook(c('vamos em busca disso pra você', { prometeuRetornoHumano: true }), frases);
    expect(r.prometeuRetornoHumano).toBe(true);
  });
  it('trecho curto demais não libera nada', () => {
    expect(liberarFrasesDoPlaybook(c('sim'), frases).isPromise).toBe(true);
  });
});
