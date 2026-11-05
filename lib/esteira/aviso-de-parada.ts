import type { SupabaseClient } from "@supabase/supabase-js";

import { membrosComPapel } from "@/lib/iavek/avisos-da-proposta";
import { logger } from "@/lib/logger";

/** Rodadas seguidas com erro até avisar. O cron roda a cada 5 min: cerca de 15 min parada. */
export const RODADAS_ATE_AVISAR = 3;
const INTERVALO_ENTRE_AVISOS_MS = 24 * 3_600_000;

// Na memória do processo: reiniciar o app zera a conta, e o pior caso é avisar 15 min depois.
const falhasSeguidas = new Map<string, number>();

async function avisar(admin: SupabaseClient, orgId: string, evento: "esteira_parada" | "esteira_voltou") {
  const destinos = await membrosComPapel(admin, orgId, ["manager", "admin"]);
  if (destinos.length === 0) return;
  const { error } = await admin.from("notificacoes").insert(
    destinos.map((user_id) => ({
      organization_id: orgId,
      user_id,
      tipo: "aviso_da_loja",
      ator_user_id: null,
      dados: { evento },
    })),
  );
  if (error) logger.error("esteira_aviso_falhou", { organization_id: orgId, error: error.message });
}

/**
 * ia.vek v1.9.19.2: a esteira parar não pode depender de alguém ler registro. Depois de
 * 3 rodadas seguidas com erro, gerente e admin recebem no sino; no máximo 1 aviso por dia.
 */
export async function esteiraFalhou(admin: SupabaseClient, orgId: string): Promise<void> {
  const seguidas = (falhasSeguidas.get(orgId) ?? 0) + 1;
  falhasSeguidas.set(orgId, seguidas);
  if (seguidas !== RODADAS_ATE_AVISAR) return;
  const { count } = await admin
    .from("notificacoes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("tipo", "aviso_da_loja")
    .eq("dados->>evento", "esteira_parada")
    .gte("created_at", new Date(Date.now() - INTERVALO_ENTRE_AVISOS_MS).toISOString());
  if ((count ?? 0) > 0) return;
  await avisar(admin, orgId, "esteira_parada");
}

/** A rodada voltou: zera a conta e, se tinha avisado, diz que voltou. */
export async function esteiraRodou(admin: SupabaseClient, orgId: string): Promise<void> {
  const seguidas = falhasSeguidas.get(orgId) ?? 0;
  falhasSeguidas.delete(orgId);
  if (seguidas >= RODADAS_ATE_AVISAR) await avisar(admin, orgId, "esteira_voltou");
}

/** Só para teste. */
export function zerarContaDaEsteira(): void {
  falhasSeguidas.clear();
}
