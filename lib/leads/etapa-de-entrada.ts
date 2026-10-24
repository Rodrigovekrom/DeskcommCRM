import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ia.vek v1.8.2 — ONDE O LEAD NASCE num funil.
 *
 * Antes: sempre a primeira etapa ABERTA pela posição. Com a ordem nova do funil
 * 72h, a primeira é "IA responsável" — e com a IA ainda não publicada o lead
 * ficaria parado onde ninguém atende, enquanto o webhook do Meta
 * (`default_stage_id`) manda para "Lead novo": duas portas de entrada.
 *
 * Agora o funil pode dizer a etapa de entrada pelo SLUG
 * (`crm_pipelines.settings.etapa_de_entrada`, migration 0589: "novo" no 72h).
 * Sem a chave, ou com um slug que não existe / está arquivado / é de ganho ou
 * perda, vale a regra antiga (primeira etapa aberta pela posição). Quando a IA
 * for publicada, troca-se a entrada no funil — sem código.
 */
export async function etapaDeEntrada(
  db: SupabaseClient,
  organizationId: string,
  pipelineId: string,
): Promise<string | null> {
  const { data: funil } = await db
    .from("crm_pipelines")
    .select("settings")
    .eq("organization_id", organizationId)
    .eq("id", pipelineId)
    .maybeSingle();
  const slug = (funil?.settings as { etapa_de_entrada?: unknown } | null)?.etapa_de_entrada;
  if (typeof slug === "string" && slug.trim()) {
    const { data: etapa } = await db
      .from("crm_stages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("pipeline_id", pipelineId)
      .eq("slug", slug.trim())
      .eq("is_archived", false)
      .eq("is_won", false)
      .eq("is_lost", false)
      .maybeSingle();
    if (etapa?.id) return etapa.id as string;
  }
  const { data: primeira } = await db
    .from("crm_stages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("is_archived", false)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (primeira?.id as string | undefined) ?? null;
}
