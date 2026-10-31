import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { funisDaLoja, recorteDaFuncao } from "@/lib/iavek/painel-do-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { CarteiraClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pipeline" };

/**
 * ia.vek v1.7.7 — o Pipeline do vendedor: abre DIRETO no Kanban da carteira de
 * quem está conectado, sem escolher funil nem configurar filtro.
 *
 * v1.9.8 (CRM-218): UM funil na tela, com o botão Novos / Follow-up / Todos.
 * Os funis são os da esteira (`settings.esteira.entrada`/`followup`); sem
 * follow-up declarado (toda loja que não usa a esteira), a tela é a de sempre:
 * o funil padrão, sem o botão. Guardião, Suporte IA e vendedor veem a própria
 * carteira; gerente, apoio e quem não tem função (o admin), a loja inteira.
 * O vendedor fica sem o botão: o follow-up não é parte dele (a esteira passa o
 * lead com o guardião de dono).
 */
export default async function PipelinePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  const supabase = await createClient();
  const [{ data: listaDeFunis }, { data: org }] = await Promise.all([
    supabase
      .from("crm_pipelines")
      .select("id, name, is_default, position")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
    createAdminClient().from("organizations").select("settings").eq("id", activeOrg.orgId).maybeSingle(),
  ]);
  const lista = (listaDeFunis ?? []) as Array<{ id: string; name: string; is_default: boolean }>;
  const padrao = lista.find((f) => f.is_default) ?? lista[0] ?? null;
  const funis = funisDaLoja((org as { settings?: unknown } | null)?.settings, padrao?.id ?? null);
  const entrada = funis ? lista.find((f) => f.id === funis.entrada) ?? padrao : padrao;
  if (!entrada) {
    return <p className="p-6 text-sm text-muted-foreground">{t("Nenhum funil configurado ainda.")}</p>;
  }
  const followup = funis?.followup ? lista.find((f) => f.id === funis.followup) ?? null : null;
  const recorte = recorteDaFuncao(activeOrg.interface_settings?.funcao);
  const ehVendedor = recorte.tipo === "carteira" && recorte.lado === "vendedor";
  return (
    <CarteiraClient
      entrada={{ id: entrada.id, nome: entrada.name }}
      followup={followup ? { id: followup.id, nome: followup.name } : null}
      recorte={recorte.tipo}
      comBotao={followup !== null && !ehVendedor}
    />
  );
}
