import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { InboxLayout } from "@/components/inbox/InboxLayout";
import { ehFuncao, veEspacoDaIa } from "@/lib/iavek/funcoes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Espaço da IA" };

/**
 * ia.vek v1.6: o "Espaço da IA" — a Entrada de leads presa na aba Automático
 * (as conversas que a IA está atendendo). Mesma tela, mesmas regras de acesso:
 * sem organização ativa, volta para a Entrada de leads, que explica o que fazer.
 *
 * v1.7.5: só o admin e a função "suporte" entram (a mesma regra do menu,
 * `veEspacoDaIa`); os outros vão para o Meu dia. Quem está em suporte
 * temporário entra, como em toda tela.
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
  const funcao = activeOrg.interface_settings?.funcao;
  if (
    !user.support &&
    !veEspacoDaIa(ehFuncao(funcao) ? funcao : null, activeOrg.role, user.is_platform_admin)
  ) {
    redirect("/app/meu-dia");
  }
  const { id } = await searchParams;
  return <InboxLayout initialSelectedId={id ?? null} abaFixa="ai" />;
}
