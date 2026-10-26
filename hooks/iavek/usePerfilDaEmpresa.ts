"use client";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { PERFIL_PADRAO, ehLojaDeCarros, type PerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";

/**
 * ia.vek v1.9.0 — o perfil da empresa ativa, como o layout de `/app` o
 * entregou. Fora dele (testes, telas de admin) vale o padrão: loja de carros,
 * sem modo agendamento — a tela da Fenômenos de sempre.
 */
export function usePerfilDaEmpresa(): PerfilDaEmpresa & { lojaDeCarros: boolean } {
  // `useAuth().activeOrg` é o que `useActiveOrg()` devolve; lido assim, as
  // telas que os testes montam com `useAuth` simulado seguem funcionando.
  // Fora do <AuthProvider> (a vitrine da agenda, por exemplo) `useAuth` lança:
  // ali vale o padrão. O hook é chamado sempre, na mesma ordem.
  let activeOrg: ReturnType<typeof useAuth>["activeOrg"] | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- chamado SEMPRE, na mesma ordem; o try só segura o throw de fora do provedor
    activeOrg = useAuth().activeOrg;
  } catch {
    activeOrg = null;
  }
  const perfil = activeOrg?.iavek_perfil ?? PERFIL_PADRAO;
  return { ...perfil, lojaDeCarros: ehLojaDeCarros(perfil) };
}
