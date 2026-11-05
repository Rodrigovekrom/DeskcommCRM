import { notFound, redirect } from "next/navigation";
import { abreFunisEEntrada } from "@/lib/iavek/funcoes";
import { destinoDoVendedor } from "@/lib/iavek/vendedor-fora-de-funis";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PipelinePageClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lead?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  // ia.vek v1.9.19: fora da tela do vendedor, inclusive pelo endereço.
  if (!abreFunisEEntrada(activeOrg.interface_settings?.funcao)) {
    redirect(await destinoDoVendedor(await createClient(), activeOrg.orgId, { leadId: (await searchParams).lead }));
  }

  const { id } = await params;
  const supabase = await createClient();
  // Mesma razão da Agenda: a RLS é piso, não escopo. Sem este filtro o funil de
  // OUTRA organização do mesmo usuário abre, e o quadro monta com as etapas de
  // um lugar e o cabeçalho de outro.
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id, name, vocabulary")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) notFound();
  return <PipelinePageClient pipelineId={id} initialName={pipeline.name} role={activeOrg.role} />;
}
