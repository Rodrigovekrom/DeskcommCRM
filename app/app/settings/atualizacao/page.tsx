import { notFound } from "next/navigation";

import { loadAuthUser } from "@/lib/auth/server";
import { AtualizacaoIavek } from "./_components/AtualizacaoIavek";

export const metadata = { title: "Atualização do sistema" };
export const dynamic = "force-dynamic";

/**
 * Só o dono do servidor. Um `notFound()` em vez de uma tela de "sem permissão"
 * porque, para quem não é dono, esta página simplesmente não faz parte do
 * produto.
 *
 * ia.vek (16/10/2026): o painel "Atualizar agora" do upstream (`UpdatePanel`)
 * saiu da tela — o ia.vek não segue mais o upstream. Ver `lib/iavek/versao.ts`.
 */
export default async function Page() {
  const user = await loadAuthUser();
  if (!user?.is_platform_admin) notFound();
  return <AtualizacaoIavek />;
}
