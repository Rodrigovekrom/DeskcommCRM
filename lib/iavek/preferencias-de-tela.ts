import { z } from "zod";

import { MOSTRAR_DO_PIPELINE, MOSTRAR_PADRAO } from "@/lib/iavek/filtro-nao-respondidos";
import { ORDEM_PADRAO, ORDENS_DO_QUADRO, type OrdemDoQuadro } from "@/lib/iavek/ordem-do-quadro";

/**
 * ia.vek v1.7.9 — preferências de VISUALIZAÇÃO por pessoa.
 *
 * Moram em `iavek_preferencias_de_tela` (migration 0587), NUNCA em
 * `user_organizations.interface_settings` — lá está a função do vínculo, e a
 * função "analista_ficha" é o que fecha o CRM. Mudam só o que a pessoa VÊ:
 * etapas continuam do admin, e nada aqui filtra dado que ela não veria.
 */
export const TELAS = ["pipeline"] as const;
export type Tela = (typeof TELAS)[number];

export const ORDENS_DO_PIPELINE = ORDENS_DO_QUADRO;
export type OrdemDoPipeline = OrdemDoQuadro;

export const preferenciasDoPipelineSchema = z
  .object({
    ordem: z.enum(ORDENS_DO_PIPELINE).default(ORDEM_PADRAO),
    // v1.9.18: "chegada" gravada antes desta versão era só o padrão antigo; sem a marca, começa na
    // nova ordem. Escolher de novo grava a marca.
    v: z.literal(2).optional(),
    ocultas: z.array(z.uuid()).max(50).default([]),
    recolhidas: z.array(z.uuid()).max(50).default([]),
    // v1.9.50: "Não respondidos" (o padrão para todo mundo) ou "Todos"; a escolha é de cada pessoa.
    mostrar: z.enum(MOSTRAR_DO_PIPELINE).default(MOSTRAR_PADRAO),
  })
  .strict();
export type PreferenciasDoPipeline = z.infer<typeof preferenciasDoPipelineSchema>;

export const PIPELINE_PADRAO: PreferenciasDoPipeline = { ordem: ORDEM_PADRAO, ocultas: [], recolhidas: [], mostrar: MOSTRAR_PADRAO };

/** Lê o que veio do banco; valor estranho volta ao padrão em vez de quebrar a tela. */
export function lerPreferenciasDoPipeline(valor: unknown): PreferenciasDoPipeline {
  const lido = preferenciasDoPipelineSchema.safeParse(valor ?? {});
  if (!lido.success) return { ...PIPELINE_PADRAO };
  return lido.data.v === 2 || lido.data.ordem !== "chegada" ? lido.data : { ...lido.data, ordem: ORDEM_PADRAO };
}
