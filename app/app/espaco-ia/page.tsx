import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { InboxLayout } from "@/components/inbox/InboxLayout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Espaço da IA" };

/**
 * ia.vek v1.6: o "Espaço da IA" — a Entrada de leads presa na aba Automático
 * (as conversas que a IA está atendendo). Mesma tela, mesmas regras de acesso:
 * sem organização ativa, volta para a Entrada de leads, que explica o que fazer.
 */
export default async function EspacoDaIaPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app/inbox");
  const { id } = await searchParams;
  return <InboxLayout initialSelectedId={id ?? null} abaFixa="ai" />;
}
