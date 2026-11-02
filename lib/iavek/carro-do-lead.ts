/**
 * ia.vek v1.9.12 — o estado do carro de interesse, lido do catálogo. Puro: o
 * selo "Carro indisponível" e o campo de valor usam a mesma resposta.
 */
export interface ProdutoDoLead {
  id: string;
  codigo: string | null;
  preco_cents: number | null;
  ativo: boolean;
}

/** O código dos carros que vêm do Altimus (`PREFIXO_DO_CODIGO`, `lib/estoque/altimus.ts`). */
export const PREFIXO_DO_CARRO_DO_ESTOQUE = "ALT-";

function produtoDoLead(valor: unknown, produtos: readonly ProdutoDoLead[] | undefined): ProdutoDoLead | null {
  if (typeof valor !== "string" || !produtos) return null;
  const id = valor.trim().toLowerCase();
  return produtos.find((p) => p.id.toLowerCase() === id) ?? null;
}

/** Lead aberto cujo carro saiu do estoque. Lead fechado já resolveu: sem selo. */
export function carroIndisponivel(
  valor: unknown,
  status: string | null | undefined,
  produtos: readonly ProdutoDoLead[] | undefined,
): boolean {
  if (status !== "open") return false;
  const p = produtoDoLead(valor, produtos);
  return p !== null && !p.ativo;
}

/** Lead aberto com carro do estoque e com preço: o valor é o do carro (gatilho da 0600). */
export function valorVemDoEstoque(
  valor: unknown,
  status: string | null | undefined,
  produtos: readonly ProdutoDoLead[] | undefined,
): boolean {
  if (status !== "open") return false;
  const p = produtoDoLead(valor, produtos);
  return p !== null && (p.codigo ?? "").startsWith(PREFIXO_DO_CARRO_DO_ESTOQUE) && (p.preco_cents ?? 0) > 0;
}
