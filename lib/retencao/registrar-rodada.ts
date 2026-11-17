/**
 * ia.vek v1.9.60 (0643, CRM-490): a ÚLTIMA RODADA de uma rotina automática fica registrada, também quando ela dá certo
 * sem apagar nada. Uma linha por rotina em `iavek_rotinas_rodadas` (upsert), só com as contagens.
 *
 * Não é auditoria: a regra "auditar quando há efeito" (data-retention, `houveEfeito`) não muda. É o "rodou às 04:40"
 * que faltava, porque o scheduler só escreve no log quando o cron FALHA. NUNCA lança: o registro é para acompanhar, e a
 * rodada já terminou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export type RotinaRegistrada = "data-retention" | "media-retention";

/** Só números e booleanos vão ao registro: nada de texto livre (que poderia trazer dado de alguém). */
export function soContagens(resultado: Record<string, unknown>): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(resultado)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export async function registrarRodada(
  admin: Pick<SupabaseClient, "from">,
  rotina: RotinaRegistrada,
  resultado: Record<string, unknown>,
  requestId: string,
  agora: Date = new Date(),
): Promise<void> {
  try {
    // o nome LITERAL aqui: a varredura do onConflict confere a constraint pela tabela do .from("...")
    const { error } = await admin.from("iavek_rotinas_rodadas").upsert(
      {
        rotina,
        ultima_em: agora.toISOString(),
        ultimo_resultado: soContagens(resultado),
        request_id: requestId.slice(0, 100),
      },
      { onConflict: "rotina" },
    );
    if (error) logger.warn("rotina_rodada_registro_falhou", { rotina, codigo: error.code ?? null });
  } catch (err) {
    logger.warn("rotina_rodada_registro_falhou", { rotina, erro: err instanceof Error ? err.name : "desconhecido" });
  }
}
