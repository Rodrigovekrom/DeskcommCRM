"use client";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { funcaoDaTela } from "@/lib/iavek/funcoes";

/**
 * ia.vek v1.9.3 — na agenda, o VENDEDOR vê todos os agendamentos da loja com os
 * DELE em destaque. Devolve o id de quem destacar (o próprio vendedor) ou
 * `null` (qualquer outra função, ou fora do <AuthProvider>: a agenda de sempre).
 */
export function useDestaqueDaAgenda(): string | null {
  let auth: ReturnType<typeof useAuth> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- chamado SEMPRE, na mesma ordem; o try só segura o throw de fora do provedor
    auth = useAuth();
  } catch {
    auth = null;
  }
  if (!auth?.user) return null;
  return funcaoDaTela(auth.activeOrg?.interface_settings?.funcao) === "vendedor" ? auth.user.id : null;
}
