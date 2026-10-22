import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth/signOut";
import { FilaDeFichas } from "@/components/iavek/FilaDeFichas";
import { Button } from "@/components/ui/button";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fichas" };

/**
 * ia.vek v1.7.8 — a área do ANALISTA DE FICHA (e do admin).
 *
 * Fica FORA da casca do CRM de propósito: para o analista o banco fecha todo o
 * resto (migration 0586), e a casca do /app só traria menu, sino e telas que
 * ele não pode abrir. Aqui é só a fila das fichas — analisar, ver documento,
 * aprovar, recusar ou pedir documento, sempre com motivo.
 */
export default async function FichasPage() {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const funcao = (org.interface_settings as { funcao?: string } | undefined)?.funcao;
  const analista = funcao === "analista_ficha";
  const admin = !analista && org.role === "admin";
  if (!analista && !admin) redirect("/app");
  const t = (s: string) => traduzir(s, user.idioma);

  return (
    <IdiomaProvider locale={user.idioma}>
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4 md:p-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("Fichas de crédito")}</h1>
            <p className="text-sm text-muted-foreground">{org.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {admin && (
              <a className="text-sm underline" href="/app">
                {t("Voltar ao CRM")}
              </a>
            )}
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                {t("Sair")}
              </Button>
            </form>
          </div>
        </header>
        <FilaDeFichas admin={admin} />
      </main>
    </IdiomaProvider>
  );
}
