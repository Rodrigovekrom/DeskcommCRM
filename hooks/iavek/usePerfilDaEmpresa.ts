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
  const perfil = useAuth().activeOrg?.iavek_perfil ?? PERFIL_PADRAO;
  return { ...perfil, lojaDeCarros: ehLojaDeCarros(perfil) };
}
