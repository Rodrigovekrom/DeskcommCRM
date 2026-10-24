import { z } from "zod";

/**
 * ia.vek v1.8.2 — CAMPOS OBRIGATÓRIOS do lead (bloco 6).
 *
 * Quem diz o que falta é o BANCO (`fn_iavek_campos_que_faltam`, migration 0590)
 * — a mesma função que a trava usa ao mover. Aqui moram só o interruptor da loja
 * (`organizations.settings.iavek.campos_obrigatorios.ativo`, padrão DESLIGADO)
 * e a lista, para a tela.
 *
 * A trava vale ao MOVER, por uma pessoa, para as etapas de compromisso abaixo
 * (slugs do funil 72h). A entrada do lead nunca trava.
 */
export const CAMPOS_OBRIGATORIOS = [
  "Contexto completo",
  "Tags de acompanhamento",
  "Fase do funil",
  "Guardião responsável",
  "Vendedor responsável",
  "Carro de interesse",
  "Parcela desejável",
] as const;

export const ETAPAS_QUE_TRAVAM = ["agendado-video", "ligacao-de-video", "qualificado", "troca", "vendido"] as const;

export const configDosObrigatoriosSchema = z.object({ ativo: z.boolean() }).strict();
export type ConfigDosObrigatorios = z.infer<typeof configDosObrigatoriosSchema>;

export function lerConfigDosObrigatorios(settings: unknown): ConfigDosObrigatorios {
  const bruto = (settings as { iavek?: { campos_obrigatorios?: unknown } } | null)?.iavek?.campos_obrigatorios;
  const lido = configDosObrigatoriosSchema.safeParse(bruto);
  return lido.success ? lido.data : { ativo: false };
}

export function comConfigDosObrigatorios(settings: unknown, config: ConfigDosObrigatorios): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, campos_obrigatorios: config } };
}
