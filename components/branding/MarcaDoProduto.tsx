import { LOGOTIPO, SIMBOLO_PEQUENO } from "@/lib/branding/desenho";
import { cn } from "@/lib/utils";

/**
 * A marca do PRODUTO desenhada em SVG inline — o que a tela mostra quando
 * ninguém configurou marca própria (`marcaEhADoProduto`, em `lib/branding.ts`).
 *
 * Inline, e não `<img src="/algo.svg">`, por três motivos:
 *  - as cores seguem o TEMA: sálvia mais clara e nome em creme no escuro, como
 *    a régua do produto já define — um arquivo estático teria uma cor só;
 *  - nada em `public/`: um `.svg` fixo ali seria servido na instalação de um
 *    revendedor que configurou a marca dele (ver `lib/branding/desenho.ts`);
 *  - a barra lateral já usa `<img>` para o logo CONFIGURADO, e o e2e
 *    `marca-logo.spec.ts` mede "barra sem `<img>`" como "sem logo do
 *    revendedor". Um `<img>` do produto ali faria a spec medir a coisa errada.
 *
 * O texto alternativo é o `nome` que a tela já resolveu — nunca uma string
 * fixa, para que a catraca de marca (`tests/unit/branding.test.ts`) continue
 * contando ZERO ocorrências fora de `lib/branding.ts`.
 */

type Props = {
  readonly nome: string;
  readonly className?: string;
  /** `true` quando o texto ao lado já nomeia a marca — evita ler duas vezes. */
  readonly decorativo?: boolean;
};

const SIMBOLO_CLARO_ESCURO = "fill-[#0e1b2b] dark:fill-[#f2f4f6]";
const NO_FINAL = "fill-[#e08a2b] dark:fill-[#e08a2b]";
const NOME_CLARO_ESCURO = "fill-[#0e1b2b] dark:fill-[#f2f4f6]";

// As classes acima repetem os hexes de `CORES_DA_MARCA` porque o Tailwind só
// gera utilitário para valor LITERAL no fonte. Quem impede os dois de divergirem
// é `tests/unit/marca-do-produto.test.tsx`, que compara as classes à paleta —
// e não uma asserção em runtime: um throw aqui derrubaria a casca inteira.
export const CLASSES_DE_COR = {
  simbolo: SIMBOLO_CLARO_ESCURO,
  noFinal: NO_FINAL,
  nome: NOME_CLARO_ESCURO,
} as const;

function acessibilidade(nome: string, decorativo: boolean) {
  return decorativo
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": nome } as const);
}

/**
 * O símbolo sozinho — para a barra recolhida, avatar e cantos apertados. Usa o
 * desenho PEQUENO (ligações mais grossas, viewBox quadrado): todos os usos são
 * de 32-36 px, onde o traço fino do símbolo grande some.
 */
export function SimboloDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <svg
      viewBox={SIMBOLO_PEQUENO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <path className={SIMBOLO_CLARO_ESCURO} d={SIMBOLO_PEQUENO.base} />
      <path className={NO_FINAL} d={SIMBOLO_PEQUENO.noFinal} />
    </svg>
  );
}

/** Símbolo + wordmark — para a barra aberta e a fachada de entrada. */
export function LogotipoDoProduto({ nome, className, decorativo = false }: Props) {
  return (
    <svg
      viewBox={LOGOTIPO.viewBox}
      className={cn("shrink-0", className)}
      {...acessibilidade(nome, decorativo)}
    >
      <path className={SIMBOLO_CLARO_ESCURO} d={LOGOTIPO.simbolo.base} />
      <path className={NO_FINAL} d={LOGOTIPO.simbolo.noFinal} />
      <path className={NOME_CLARO_ESCURO} d={LOGOTIPO.nome} />
    </svg>
  );
}
