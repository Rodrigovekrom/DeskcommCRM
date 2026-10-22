import { z } from "zod";

/**
 * ia.vek v1.7.7 — o rodízio de leads da loja.
 *
 * Mora em `organizations.settings.iavek.rodizio` (sem migration para a
 * configuração): `ativo` liga/desliga, `participantes` é a fila na ordem que o
 * admin marcou. Quem decide a vez é o banco (`fn_iavek_rodizio_no_lead_novo`,
 * migration 0585) — a mesma regra para o gatilho e para a distribuição.
 */
export interface ConfigDoRodizio {
  ativo: boolean;
  participantes: string[];
}

export const RODIZIO_PADRAO: ConfigDoRodizio = { ativo: false, participantes: [] };

export const configDoRodizioSchema = z
  .object({
    ativo: z.boolean().optional(),
    participantes: z.array(z.uuid()).max(100).optional(),
  })
  .strict()
  .refine((v) => v.ativo !== undefined || v.participantes !== undefined, { message: "nada para mudar" });

export function lerRodizio(settings: unknown): ConfigDoRodizio {
  const bruto = (settings as { iavek?: { rodizio?: unknown } } | null)?.iavek?.rodizio as
    | { ativo?: unknown; participantes?: unknown }
    | undefined;
  if (!bruto || typeof bruto !== "object") return { ...RODIZIO_PADRAO };
  const participantes = Array.isArray(bruto.participantes)
    ? bruto.participantes.filter((p): p is string => typeof p === "string" && z.uuid().safeParse(p).success)
    : [];
  return { ativo: bruto.ativo === true, participantes: [...new Set(participantes)] };
}

/** Merge na chave `iavek.rodizio`, sem tocar no resto de `settings`. */
export function comRodizio(settings: unknown, novo: ConfigDoRodizio): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, rodizio: novo } };
}
