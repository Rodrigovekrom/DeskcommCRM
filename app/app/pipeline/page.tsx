import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { CarteiraClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline" };

/**
 * ia.vek v1.7.7 — o Pipeline do vendedor: abre DIRETO no Kanban da carteira de
 * quem está conectado, sem escolher funil nem configurar filtro.
 *
 * O funil é o PADRÃO da organização (o que recebe o lead novo), com as etapas
 * OFICIAIS do admin — um quadro só, cada vendedor vendo a própria carteira. Não
 * há funil por usuário: etapas, relatórios e a visão do gerente continuam
 * únicos.
 */
export default async function PipelinePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  const supabase = await createClient();
  const { data: funis } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default, position")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");
  const lista = (funis ?? []) as Array<{ id: string; name: string; is_default: boolean }>;
  const funil = lista.find((f) => f.is_default) ?? lista[0] ?? null;
  if (!funil) {
    return <p className="p-6 text-sm text-muted-foreground">{t("Nenhum funil configurado ainda.")}</p>;
  }
  return <CarteiraClient pipelineId={funil.id} nomeDoFunil={funil.name} />;
}
