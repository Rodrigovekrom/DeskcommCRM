import { z } from "zod";

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

export const ORDENS_DO_PIPELINE = ["chegada", "atividade"] as const;
export type OrdemDoPipeline = (typeof ORDENS_DO_PIPELINE)[number];

export const preferenciasDoPipelineSchema = z
  .object({
    ordem: z.enum(ORDENS_DO_PIPELINE).default("chegada"),
    ocultas: z.array(z.uuid()).max(50).default([]),
    recolhidas: z.array(z.uuid()).max(50).default([]),
  })
  .strict();
export type PreferenciasDoPipeline = z.infer<typeof preferenciasDoPipelineSchema>;

export const PIPELINE_PADRAO: PreferenciasDoPipeline = { ordem: "chegada", ocultas: [], recolhidas: [] };

/** Lê o que veio do banco; valor estranho volta ao padrão em vez de quebrar a tela. */
export function lerPreferenciasDoPipeline(valor: unknown): PreferenciasDoPipeline {
  const lido = preferenciasDoPipelineSchema.safeParse(valor ?? {});
  return lido.success ? lido.data : { ...PIPELINE_PADRAO };
}
