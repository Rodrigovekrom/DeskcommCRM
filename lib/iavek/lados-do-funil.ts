import { z } from "zod";

import { funcaoDaTela } from "@/lib/iavek/funcoes";

/**
 * ia.vek v1.9.3 — O PIPELINE POR FUNÇÃO (CRM-207/208).
 *
 * Um funil só (o padrão da loja), e cada etapa tem um LADO: do SDR, do
 * vendedor, ou dos dois ("ambos": Vendido e Perdido, decisão do Rodrigo de
 * 27/10). No Pipeline, o SDR vê só as etapas do lado dele e só os leads DELE
 * (dono ou guardião); o vendedor, as do lado dele e a carteira dele. É
 * APRESENTAÇÃO: o que cada um pode abrir continua decidido pelo papel e pela RLS.
 *
 * Mora em `crm_pipelines.settings.iavek_lados` = `{ <stage_id>: lado }`. Vazio
 * (o padrão de todo funil): ninguém é recortado — o Pipeline de sempre.
 */
export const LADOS = ["sdr", "vendedor", "ambos"] as const;
export type Lado = (typeof LADOS)[number];

export const ladosSchema = z.record(z.string().uuid(), z.enum(LADOS));
export type LadosDoFunil = z.infer<typeof ladosSchema>;

export function lerLados(settings: unknown): LadosDoFunil {
  const bruto = (settings as { iavek_lados?: unknown } | null)?.iavek_lados;
  const lido = ladosSchema.safeParse(bruto);
  return lido.success ? lido.data : {};
}

export function comLados(settings: unknown, lados: LadosDoFunil): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return { ...atual, iavek_lados: lados };
}

/** O lado de quem tem esta função no Pipeline, ou `null` (não é recortado). */
export function ladoDaFuncao(funcao: unknown): Exclude<Lado, "ambos"> | null {
  const f = funcaoDaTela(funcao);
  // O SDR de suporte tem a mesma visão do SDR (menu do SDR + Espaço da IA).
  if (f === "sdr" || f === "suporte") return "sdr";
  if (f === "vendedor") return "vendedor";
  return null;
}

/** A etapa aparece para este lado? Funil sem lados configurados: aparece tudo. */
export function etapaDoLado(lados: LadosDoFunil, stageId: string, lado: Exclude<Lado, "ambos"> | null): boolean {
  if (!lado || Object.keys(lados).length === 0) return true;
  const daEtapa = lados[stageId];
  return daEtapa === lado || daEtapa === "ambos";
}
