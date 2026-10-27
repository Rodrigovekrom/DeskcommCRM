import { limitesDoDia } from "@/lib/iavek/meu-dia";

/**
 * ia.vek v1.9.3 — "MEUS NÚMEROS" (CRM-207/208): os resultados SÓ de quem está
 * conectado, calculados no servidor (nunca dá para ver o de outra pessoa).
 * Aqui ficam as regras puras: o período e o que cada função vê.
 */
export const PERIODOS = ["hoje", "7d", "30d"] as const;
export type Periodo = (typeof PERIODOS)[number];

export function ehPeriodo(v: unknown): v is Periodo {
  return typeof v === "string" && (PERIODOS as readonly string[]).includes(v);
}

/** Hoje = desde a meia-noite no fuso da loja; 7d/30d = os últimos N dias até agora. */
export function limitesDoPeriodo(periodo: Periodo, agora: Date, fuso: string): { inicio: Date; fim: Date } {
  if (periodo === "hoje") return { inicio: limitesDoDia(agora, fuso).inicio, fim: agora };
  const dias = periodo === "7d" ? 7 : 30;
  return { inicio: new Date(agora.getTime() - dias * 86_400_000), fim: agora };
}

/** O SDR (e o SDR de suporte) vê os números de SDR; os demais, os de vendedor. */
export function visaoDosNumeros(funcao: string | null): "sdr" | "vendedor" {
  return funcao === "sdr" || funcao === "suporte" ? "sdr" : "vendedor";
}

export interface NumerosDoSdr {
  visao: "sdr";
  leads_comigo: number;
  ligacoes: number;
  agendamentos_marcados: number;
  pedidos_feitos: number;
  pedidos_confirmados: number;
  compareceram: number;
  nao_vieram: number;
  vendidos: number;
}

export interface NumerosDoVendedor {
  visao: "vendedor";
  carteira_aberta: number;
  agendamentos: number;
  compareceram: number;
  nao_vieram: number;
  propostas_enviadas: number;
  vendas: number;
  valor_vendido_cents: number;
  perdas: number;
  motivos_de_perda: Array<{ motivo: string; total: number }>;
}

/** Os motivos de perda, do mais comum para o menos, no máximo 5. */
export function topMotivos(motivos: Array<string | null>): Array<{ motivo: string; total: number }> {
  const conta = new Map<string, number>();
  for (const m of motivos) {
    const k = (m ?? "").trim();
    if (k) conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  return [...conta.entries()]
    .map(([motivo, total]) => ({ motivo, total }))
    .sort((a, b) => b.total - a.total || a.motivo.localeCompare(b.motivo))
    .slice(0, 5);
}
