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
    /**
     * ia.vek v1.9.51.4 (Lupa 192902 b): a REDE do navegador, quando ele diz (navigator.connection: Chrome e Android;
     * o Safari não tem). Para separar 'a rede da pessoa' de 'o servidor' sem saber quem é nem onde está.
     */
    rede: z
      .object({
        tipo: z.enum(["slow-2g", "2g", "3g", "4g"]).optional(),
        mbps: z.number().min(0).max(10_000).optional(),
        rtt_ms: z.number().int().min(0).max(60_000).optional(),
        economia: z.boolean().optional(),
      })
      .strict()
      .optional(),
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

/** O que o navegador conta da rede (navigator.connection), já no formato da medida; nada se ele não contar. */
export function redeDoNavegador(nav: unknown): Medida["rede"] | undefined {
  const c = (nav as { connection?: Record<string, unknown> } | null | undefined)?.connection;
  if (!c || typeof c !== "object") return undefined;
  const r: NonNullable<Medida["rede"]> = {};
  const tipo = c.effectiveType;
  if (tipo === "slow-2g" || tipo === "2g" || tipo === "3g" || tipo === "4g") r.tipo = tipo;
  if (typeof c.downlink === "number" && Number.isFinite(c.downlink) && c.downlink >= 0) r.mbps = Math.min(10_000, c.downlink);
  if (typeof c.rtt === "number" && Number.isFinite(c.rtt) && c.rtt >= 0) r.rtt_ms = Math.min(60_000, Math.round(c.rtt));
  if (typeof c.saveData === "boolean") r.economia = c.saveData;
  return Object.keys(r).length ? r : undefined;
}
