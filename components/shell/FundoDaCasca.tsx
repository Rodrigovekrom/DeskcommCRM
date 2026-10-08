"use client";

import { FundoNeural } from "@/components/branding/FundoNeural";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { marcaEhADoProduto } from "@/lib/branding";
import { useMarcaDaInstalacao } from "@/lib/branding/contexto";

/**
 * A rede neural da marca na área logada, na variante `sutil`.
 *
 * Uma instância só, montada pela casca (`AppShell`) e não por página. A regra
 * de marca é a da barra lateral: o que ela mostra como nome e logo — a
 * organização por cima da instalação — decide; com marca própria, a casca fica
 * limpa.
 *
 * `fixed` e `-z-10` dentro de um contêiner `isolate`: o canvas pinta acima do
 * fundo da casca e abaixo de todo o conteúdo, sem mexer no empilhamento de
 * mais ninguém.
 */
export function FundoDaCasca() {
  const { activeOrg } = useAuth();
  const brand = useMarcaDaInstalacao();
  const nome = activeOrg?.marca?.nome ?? brand.name;
  const logo = activeOrg?.marca?.logoUrl || brand.logoUrl;
  if (!marcaEhADoProduto({ name: nome, logoUrl: logo ?? null })) return null;
  return (
    <FundoNeural
      variante="sutil"
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}
