"use client";
import { ROTULO_DA_VERSAO } from "@/lib/iavek/versao";
import { cn } from "@/lib/utils";

/**
 * Versão do ia.vek CRM no rodapé da sidebar, discreta e fixa.
 *
 * ia.vek (16/10/2026): o sistema não segue mais o upstream. Saiu o aviso
 * aviso de versão nova (que lia `system_version.latest_version`, gravado pelo agente
 * de atualização do host) e saiu o link para o "Atualizar agora". Nada aqui
 * consulta versão de ninguém: o número é o de `lib/iavek/versao.ts`.
 */
export function VersionFooter({
  collapsed,
}: {
  collapsed: boolean;
  /** Mantido na assinatura: a Sidebar ainda o passa (não há mais link para fechar a gaveta). */
  onNavigate?: () => void;
}) {
  return (
    <p
      className={cn("px-3 py-1 text-[11px] text-muted-foreground", collapsed && "px-0 text-center")}
      title={ROTULO_DA_VERSAO}
      data-testid="versao-iavek"
    >
      {collapsed ? ROTULO_DA_VERSAO.replace(/^.* /, "") : ROTULO_DA_VERSAO}
    </p>
  );
}
