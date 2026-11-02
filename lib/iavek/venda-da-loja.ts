import { z } from "zod";

import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";

/**
 * ia.vek v1.9.12 — o VALOR FINAL e a DATA ao marcar vendido, na loja de carros.
 *
 * Valem para os dois caminhos da tela (o arrasto até a etapa de venda e o botão
 * "Marcar como ganho"), e a recusa é do servidor. O valor vira `value_cents` (o
 * que os relatórios somam) e a data vira `closed_at`; depois disso o Altimus não
 * mexe mais no lead (gatilho da 0600). A data é o dia na loja, nunca no futuro.
 */
export const FUSO_DA_LOJA = "America/Sao_Paulo";

export const vendaDaLojaSchema = z.object({
  valor_cents: z.number().int().positive().max(100_000_000_000),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type VendaDaLoja = z.infer<typeof vendaDaLojaSchema>;

/** A data de hoje na loja (`AAAA-MM-DD`), que é a sugerida e a mais tardia aceita. */
export function hojeNaLoja(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_DA_LOJA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function dataExiste(data: string): boolean {
  const d = new Date(`${data}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data;
}

/**
 * O instante gravado em `closed_at`. Hoje é o agora; dia passado é meio-dia no
 * fuso da loja, para a venda não cair no dia vizinho em relatório nenhum.
 */
export function fechadoEmDaVenda(data: string, agora: Date = new Date()): string {
  if (data === hojeNaLoja(agora)) return agora.toISOString();
  return new Date(`${data}T15:00:00Z`).toISOString();
}

export type LeituraDaVenda =
  | { ok: true; valorCents: number; data: string; fechadoEm: string }
  | { ok: false; codigo: "venda_incompleta" | "venda_data_invalida"; mensagem: string };

/** Lê o que a escrita trouxe e devolve o que gravar, ou a recusa legível. */
export function lerVendaDaLoja(
  bruto: unknown,
  idioma: Idioma = IDIOMA_PADRAO,
  agora: Date = new Date(),
): LeituraDaVenda {
  const lido = vendaDaLojaSchema.safeParse(bruto);
  if (!lido.success) {
    return {
      ok: false,
      codigo: "venda_incompleta",
      mensagem: traduzir("Informe o valor final e a data da venda.", idioma),
    };
  }
  const { valor_cents: valorCents, data } = lido.data;
  if (!dataExiste(data) || data > hojeNaLoja(agora)) {
    return {
      ok: false,
      codigo: "venda_data_invalida",
      mensagem: traduzir("A data da venda não pode ser no futuro.", idioma),
    };
  }
  return { ok: true, valorCents, data, fechadoEm: fechadoEmDaVenda(data, agora) };
}
