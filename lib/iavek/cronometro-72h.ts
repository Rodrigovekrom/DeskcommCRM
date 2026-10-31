import { funilDeEntradaSchema } from "@/lib/esteira/config";
import type { z } from "zod";

/**
 * ia.vek v1.5: o CRONÔMETRO das primeiras 72h do lead novo (decisão do Rodrigo:
 * horas CORRIDAS, a mesma conta da esteira D3).
 *
 * O lead tem um prazo enquanto está ABERTO no funil de entrada da esteira
 * (`settings.esteira.entrada`) e FORA das colunas de compromisso. O cronômetro
 * aparece mesmo com a esteira desligada: a regra das 72h é do negócio, e a
 * esteira só decide se o lead passa SOZINHO para o follow-up quando o prazo vence.
 */
export type EntradaDaEsteira = z.infer<typeof funilDeEntradaSchema>;

export interface LeadDoCronometro {
  status: string;
  pipeline_id: string;
  stage_id: string | null;
  created_at: string;
  /** No clone da esteira (reativado, follow-up), `esteira_inicio` marca o ciclo. */
  source_metadata?: Record<string, unknown> | null;
}

/**
 * O NASCIMENTO do lead para a conta das 72h — o MESMO relógio em todo lugar
 * (pacote de defeitos D6: a esteira, o cronômetro da conversa, a passagem e o
 * Space do guardião contavam de pontos diferentes). No clone da esteira vale o
 * `source_metadata.esteira_inicio` (o ciclo); sem ele, a criação do lead.
 */
export function nascimentoDoLead(lead: { created_at: string; source_metadata?: Record<string, unknown> | null }): string {
  const inicio = lead.source_metadata?.esteira_inicio;
  return typeof inicio === "string" && !Number.isNaN(Date.parse(inicio)) ? inicio : lead.created_at;
}

export interface Cronometro {
  inicio: string;
  fim_em: string;
  horas: number;
}

export type CorDoCronometro = "verde" | "ambar" | "vermelho";

const HORA = 3_600_000;

/** O funil de entrada declarado em `settings.esteira`, ativa ou não; inválido = null. */
export function entradaDaEsteira(settings: unknown): EntradaDaEsteira | null {
  const bruto = (settings as { esteira?: { entrada?: unknown } } | null)?.esteira?.entrada;
  if (bruto === undefined || bruto === null) return null;
  const r = funilDeEntradaSchema.safeParse(bruto);
  return r.success ? r.data : null;
}

/** O prazo do lead, ou null quando o cronômetro não se aplica a ele. */
export function cronometroDoLead(
  lead: LeadDoCronometro | null,
  entrada: EntradaDaEsteira | null,
): Cronometro | null {
  if (!lead || !entrada) return null;
  if (lead.status !== "open") return null;
  if (lead.pipeline_id !== entrada.pipeline_id) return null;
  if (lead.stage_id && entrada.etapas_de_compromisso.includes(lead.stage_id)) return null;
  const inicio = new Date(nascimentoDoLead(lead)).getTime();
  if (Number.isNaN(inicio)) return null;
  return {
    inicio: new Date(inicio).toISOString(),
    fim_em: new Date(inicio + entrada.horas * HORA).toISOString(),
    horas: entrada.horas,
  };
}

/** Verde com mais de 24h, âmbar entre 6h e 24h, vermelho abaixo de 6h (e vencido). */
export function corDoCronometro(restanteMs: number): CorDoCronometro {
  if (restanteMs > 24 * HORA) return "verde";
  if (restanteMs > 6 * HORA) return "ambar";
  return "vermelho";
}

/** "51h 12min", "38min", "vencido há 2h". */
export function textoDoRestante(restanteMs: number): { texto: string; vencido: boolean } {
  const vencido = restanteMs <= 0;
  const total = Math.floor(Math.abs(restanteMs) / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const duracao = h > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min`;
  return { texto: duracao, vencido };
}
