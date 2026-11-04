import { z } from "zod";

/**
 * ia.vek v1.9.16: a medição real por tela, no ar. Mede tempo e contagem, nunca o
 * conteúdo. O caminho perde a busca e os identificadores antes de sair do navegador
 * e de novo no servidor: nem nome, nem telefone, nem id de cliente chegam ao registro.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function caminhoSemDados(bruto: string): string {
  let caminho = bruto;
  try {
    caminho = new URL(bruto, "http://x").pathname;
  } catch {
    caminho = "/invalido";
  }
  const limpo = caminho
    .replace(UUID, "<id>")
    .replace(/\d{4,}/g, "<n>")
    .replace(/[^a-zA-Z0-9/_<>.-]/g, "")
    .slice(0, 120);
  return limpo || "/";
}

export const TIPOS_DE_MEDIDA = ["abrir", "menu", "clique", "preso", "resumo"] as const;

const chamadaSchema = z.object({ c: z.string().max(200), ms: z.number().int().min(0).max(600_000) }).strict();

export const medidaSchema = z
  .object({
    tipo: z.enum(TIPOS_DE_MEDIDA),
    tela: z.string().max(200),
    /** Para onde o clique ia, quando a tela não trocou (`preso`). */
    destino: z.string().max(200).optional(),
    ms: z.number().int().min(0).max(600_000),
    chamadas: z.number().int().min(0).max(5000).optional(),
    paginas: z.number().int().min(0).max(5000).optional(),
    lentas: z.array(chamadaSchema).max(5).optional(),
    em_voo: z.array(chamadaSchema).max(8).optional(),
    /** Só em `resumo`: cliques por faixa de tempo. */
    cliques: z.object({ ate_300: z.number().int().min(0), ate_1000: z.number().int().min(0), acima: z.number().int().min(0) }).strict().optional(),
    /** O maior atraso de resposta a uma interação (o navegador travado). */
    maior_atraso_ms: z.number().int().min(0).max(600_000).optional(),
    online: z.boolean().optional(),
    visivel: z.boolean().optional(),
  })
  .strict();

export type Medida = z.infer<typeof medidaSchema>;

/** A medida como vai ao registro: todo caminho passa de novo pela limpeza. */
export function medidaParaRegistro(m: Medida): Medida {
  const limpar = (l?: Medida["lentas"]) => l?.map((x) => ({ c: caminhoSemDados(x.c), ms: x.ms }));
  return {
    ...m,
    tela: caminhoSemDados(m.tela),
    ...(m.destino ? { destino: caminhoSemDados(m.destino) } : {}),
    ...(m.lentas ? { lentas: limpar(m.lentas) } : {}),
    ...(m.em_voo ? { em_voo: limpar(m.em_voo) } : {}),
  };
}
