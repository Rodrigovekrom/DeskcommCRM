import { describe, expect, it } from 'vitest';
import {
  contarPerguntasDePreco,
  decidirAutorizacao,
  decidirPrecoNaResposta,
  ehPerguntaDePreco,
  formatarPrecoAutorizado,
  regraDePrecoLigada,
  renderContextoComercial,
  type MensagemParaContagem,
} from './preco-em-tres-niveis';

describe('ehPerguntaDePreco — frases de cliente de revenda', () => {
  const pedem = [
    'quanto custa?',
    'Qual o valor?',
    'e o preço?',
    'Valor?',
    'tá quanto?',
    'qto ta esse?',
    'quanto vcs querem nele',
    'qual valor do onix',
    'preço dele',
    'Quanto é o carro?',
    'me passa o valor por favor',
    'por quanto sai?',
    'Quanto tá saindo esse Corolla',
    'Quanto?',
    'valor à vista?',
    'quanto de entrada preciso? e o valor dele?',
    'qual o valor desse modelo?',
    'QUANTO CUSTA ESSE CARRO 🚗',
  ];
  const naoPedem = [
    'quanto de entrada preciso?',
    'qual o valor da parcela?',
    'quanto fica a parcela',
    'quanto pagam no meu carro?',
    'quanto vocês dão no meu gol na troca',
    'quantos km ele tem?',
    'qual a quilometragem',
    'qual o ano?',
    'quanto tempo demora a aprovação?',
    'quantas portas?',
    'tem como financiar?',
    'qual a taxa de juros',
    'quando posso ir?',
    'valeu!',
    'bom dia, tudo bem?',
    'gostei muito dele',
    'quanto ele rodou?',
    'quanto fica financiado em 48x?',
    '',
  ];
  it.each(pedem)('conta: %s', (frase) => expect(ehPerguntaDePreco(frase)).toBe(true));
  it.each(naoPedem)('não conta: %s', (frase) => expect(ehPerguntaDePreco(frase)).toBe(false));
  it('nulo não conta', () => expect(ehPerguntaDePreco(null)).toBe(false));
});

const cli = (texto: string): MensagemParaContagem => ({ direcao: 'inbound', texto, produtoCodigo: null });
const ia = (texto: string, produtoCodigo: string | null = null): MensagemParaContagem => ({
  direcao: 'outbound',
  texto,
  produtoCodigo,
});

describe('contarPerguntasDePreco', () => {
  it('conta só as perguntas de preço do cliente', () => {
    const r = contarPerguntasDePreco([
      cli('oi'),
      ia('Olha só esse aqui', 'ONIX-21'),
      cli('quanto custa?'),
      ia('Claro! ... à vista ou financiado?'),
      cli('financiado. e o valor?'),
      cli('quantos km?'),
    ]);
    expect(r).toEqual({ perguntas: 2, produtoCodigo: 'ONIX-21' });
  });

  it('pergunta ANTES das fotos do primeiro carro já conta para ele', () => {
    const r = contarPerguntasDePreco([cli('quanto custa o onix?'), ia('Olha ele', 'ONIX-21'), cli('valor?')]);
    expect(r).toEqual({ perguntas: 2, produtoCodigo: 'ONIX-21' });
  });

  it('trocar de um carro para OUTRO zera a contagem', () => {
    const r = contarPerguntasDePreco([
      ia('Olha ele', 'ONIX-21'),
      cli('quanto custa?'),
      cli('valor?'),
      ia('Então olha esse', 'HB20-22'),
      cli('e esse quanto é?'),
    ]);
    expect(r).toEqual({ perguntas: 1, produtoCodigo: 'HB20-22' });
  });

  it('reenviar fotos do MESMO carro não zera', () => {
    const r = contarPerguntasDePreco([
      ia('Olha ele', 'ONIX-21'),
      cli('quanto custa?'),
      ia('Mais fotos', 'ONIX-21'),
      cli('valor?'),
    ]);
    expect(r.perguntas).toBe(2);
  });
});

describe('autorização e bloco', () => {
  it('só autoriza a partir da 3ª pergunta e com preço no catálogo', () => {
    expect(decidirAutorizacao(2, 8990000)).toBeNull();
    expect(decidirAutorizacao(3, 8990000)).toBe(8990000);
    expect(decidirAutorizacao(4, 8990000)).toBe(8990000);
    expect(decidirAutorizacao(3, null)).toBeNull();
    expect(decidirAutorizacao(3, 0)).toBeNull();
  });

  it('formata como o prompt usa depois de "R$ "', () => {
    expect(formatarPrecoAutorizado(8990000)).toBe('89.900');
    expect(formatarPrecoAutorizado(8990050)).toBe('89.900,50');
    expect(formatarPrecoAutorizado(150000000)).toBe('1.500.000');
  });

  it('o bloco só traz preco_autorizado quando autorizado', () => {
    expect(renderContextoComercial({ perguntas: 1, produtoCodigo: 'ONIX-21', autorizadoCents: null })).toBe(
      '## Contexto comercial\npreco_perguntas: 1\ncarro_em_discussao: ONIX-21',
    );
    expect(renderContextoComercial({ perguntas: 3, produtoCodigo: 'ONIX-21', autorizadoCents: 8990000 })).toContain(
      'preco_autorizado: 89.900',
    );
    expect(renderContextoComercial({ perguntas: 0, produtoCodigo: null, autorizadoCents: null })).toBe(
      '## Contexto comercial\npreco_perguntas: 0',
    );
  });

  it('liga só quando o prompt cita preco_perguntas', () => {
    expect(regraDePrecoLigada('... `preco_perguntas` (quantas vezes ...)')).toBe(true);
    expect(regraDePrecoLigada('Você é um assistente de clínica.')).toBe(false);
    expect(regraDePrecoLigada(null)).toBe(false);
  });
});

describe('decidirPrecoNaResposta — a trava', () => {
  it('sem valor no texto, passa', () => {
    expect(decidirPrecoNaResposta([], { perguntas: 1, autorizadoCents: null })).toEqual({ permite: true });
  });
  it('qualquer valor antes da autorização é barrado', () => {
    const r = decidirPrecoNaResposta([8990000], { perguntas: 2, autorizadoCents: null });
    expect(r.permite).toBe(false);
  });
  it('o valor autorizado, exato, passa', () => {
    expect(decidirPrecoNaResposta([8990000], { perguntas: 3, autorizadoCents: 8990000 })).toEqual({ permite: true });
  });
  it('outro valor junto do autorizado é barrado', () => {
    const r = decidirPrecoNaResposta([8990000, 8500000], { perguntas: 3, autorizadoCents: 8990000 });
    expect(r.permite).toBe(false);
  });
});
