"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Providers } from "@/app/providers";
import { definirOrgDaAba } from "@/lib/auth/org-da-aba";
import { createClient, resetRealtimeAuthentication } from "@/lib/supabase/browser";
import type { AuthUser, ActiveOrg, Role } from "@/lib/auth/types";
import { ROLE_RANK } from "@/lib/auth/types";
import { ehFuncao, type Funcao } from "@/lib/iavek/funcoes";

interface AuthCtx {
  user: AuthUser;
  activeOrg: ActiveOrg | null;
  isAuthenticated: true;
  refreshing: boolean;
  signOut: () => Promise<void>;
  /**
   * ia.vek v1.6: "Ver como" — quem administra enxerga a interface de uma FUNÇÃO
   * (menu e tela inicial) sem trocar papel nem permissão. `activeOrg` acima já
   * sai com a função escolhida; a função real fica em `funcaoReal`.
   */
  verComo: Funcao | null;
  definirVerComo: (f: Funcao | null) => void;
  podeVerComo: boolean;
  funcaoReal: Funcao | null;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({
  user,
  activeOrg,
  children,
}: {
  user: AuthUser;
  activeOrg: ActiveOrg | null;
  children: ReactNode;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const supabaseRef = useRef(createClient());

  // ia.vek v1.6: "Ver como", lembrado por pessoa e organização neste navegador.
  const podeVerComo = (user.is_platform_admin && !user.support) || activeOrg?.role === "admin";
  const chaveVerComo = `iavek:ver-como:${user.id}:${activeOrg?.orgId ?? "-"}`;
  const [verComo, setVerComo] = useState<Funcao | null>(null);
  useEffect(() => {
    if (!podeVerComo) return setVerComo(null);
    try {
      const salvo = window.localStorage.getItem(chaveVerComo);
      setVerComo(ehFuncao(salvo) ? salvo : null);
    } catch {
      setVerComo(null);
    }
  }, [podeVerComo, chaveVerComo]);
  const definirVerComo = useMemo(
    () => (f: Funcao | null) => {
      setVerComo(f);
      try {
        if (f) window.localStorage.setItem(chaveVerComo, f);
        else window.localStorage.removeItem(chaveVerComo);
      } catch {
        // sem armazenamento: vale só nesta aba.
      }
    },
    [chaveVerComo],
  );
  const funcaoReal = ehFuncao(activeOrg?.interface_settings?.funcao)
    ? activeOrg!.interface_settings!.funcao!
    : null;
  // A interface VISTA: com "Ver como", a da função escolhida, inteira (sem as
  // áreas personalizadas de quem administra), para mostrar o que ela vê.
  const orgVista = useMemo<ActiveOrg | null>(
    () =>
      activeOrg && podeVerComo && verComo
        ? { ...activeOrg, interface_settings: { preset: "completa", funcao: verComo } }
        : activeOrg,
    [activeOrg, podeVerComo, verComo],
  );

  useEffect(() => {
    resetRealtimeAuthentication();
    return resetRealtimeAuthentication;
  }, [user.id, activeOrg?.orgId, user.support?.id, user.support?.access_mode]);

  // A organização que ESTA aba acha que é — a mesma das props, fixas durante a
  // vida do documento. Registrada para o `apiClient` carimbá-la em toda
  // mutação (#2335, metade 2): o servidor compara com o cookie e recusa a
  // divergência. É estado POR DOCUMENTO, e por isso não pode morar no cookie —
  // duas abas do mesmo navegador discordam justamente nele.
  useEffect(() => {
    definirOrgDaAba(
      activeOrg ? { orgId: activeOrg.orgId, nome: activeOrg.name, idioma: user.idioma } : null,
    );
    return () => definirOrgDaAba(null);
  }, [activeOrg, user.idioma]);

  // Revogação/scope no banco também derrubam o snapshot aberto de UI/realtime.
  useEffect(() => {
    if (!user.support) return;
    const expected = `${user.support.id}:${user.support.access_mode}:${user.support.status}`;
    const check = async () => {
      const response = await fetch("/api/v1/auth/support", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const result = await response.json();
      if (result.data.signature !== expected) window.location.reload();
    };
    const timer = setInterval(() => {
      void check();
    }, 15000);
    return () => clearInterval(timer);
  }, [user.support]);

  // Refresh session every 40 minutes (JWT default 1h, with margin).
  useEffect(() => {
    const interval = setInterval(
      async () => {
        setRefreshing(true);
        try {
          await supabaseRef.current.auth.refreshSession();
        } finally {
          setRefreshing(false);
        }
      },
      40 * 60 * 1000,
    );
    return () => clearInterval(interval);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      activeOrg: orgVista,
      verComo: podeVerComo ? verComo : null,
      definirVerComo,
      podeVerComo,
      funcaoReal,
      isAuthenticated: true,
      refreshing,
      signOut: async () => {
        resetRealtimeAuthentication();
        const { signOut } = await import("@/app/actions/auth/signOut");
        await signOut();
      },
    }),
    [user, orgVista, refreshing, podeVerComo, verComo, definirVerComo, funcaoReal],
  );

  return (
    <Ctx.Provider value={value}>
      <Providers
        key={`${user.id}:${activeOrg?.orgId ?? "none"}:${user.support?.id ?? "normal"}:${user.support?.access_mode ?? ""}`}
      >
        {children}
      </Providers>
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useUser(): AuthUser {
  return useAuth().user;
}

export function useActiveOrg(): ActiveOrg | null {
  return useAuth().activeOrg;
}

/**
 * Permission gate based on role rank. Action mapping is intentionally
 * minimal here — feature-specific gates can extend with custom logic.
 */
const ACTION_MIN_ROLE: Record<string, Role> = {
  "inbox.view": "viewer",
  "inbox.reply": "agent",
  "inbox.claim": "agent",
  "contact.view": "viewer",
  "contact.create": "agent",
  "contact.update": "agent",
  "contact.delete": "manager",
  "pipeline.view": "viewer",
  "pipeline.create": "manager",
  "pipeline.move_card": "agent",
  "team.invite": "admin",
  "team.change_role": "admin",
  "settings.write": "admin",
  "lgpd.execute_redact": "admin",
  "audit.view": "manager",
  "ai.automatico.view": "agent",
  "ai.inbox.view": "agent",
  "inbox.notes.view": "agent",
  // O cartão da passagem, dentro da conversa. `agent` e não `viewer` porque é o
  // piso que a policy de `passagens_de_atendimento` exige (migration 0291): o
  // briefing diz MAIS que a conversa — diz o que a IA concluiu sobre a pessoa.
  // Um `viewer` que sondasse esta rota levaria 403 em toda abertura de conversa.
  "inbox.passagens.view": "agent",
  "message-templates.view": "agent",
  "ai.agents.view": "manager",
  "ai.agents.write": "admin",
  "ai.memory.view": "manager",
  "ai.memory.publish": "admin",
  "ai.skills.view": "manager",
  "ai.skills.manage": "manager",
  "ai.routers.view": "manager",
  "ai.evolution.view": "manager",
  "ai.routers.manage": "admin",
  "ai.credentials.view": "manager",
  "ai.credentials.write": "admin",
  "webhooks.manage": "manager",
  // Mesmo mínimo de lib/navigation/catalogo.ts (destino /app/calls) e de
  // requireRole("manager") em app/api/v1/calls/route.ts — a RLS de crm_calls
  // é só por organização, então sem este gate o aviso ao vivo de ligação
  // chegaria pra viewer/agent, papéis que a tela nunca mostra pra eles.
  "calls.view": "manager",
  // Chamada de voz (spec 18). `agent` porque ligar e atender é ato de
  // atendimento, não de configuração — e porque é o piso que as rotas de
  // `app/api/v1/voice/calls/*` exigem. Quem não alcança este piso (viewer, e
  // acompanhamento administrativo somente-leitura, que é rebaixado a viewer em
  // `resolveActiveOrg`) não sonda, não assina e não vê telefone tocar: um
  // banner de chamada para quem não pode atendê-la é uma promessa falsa, e a
  // sondagem por trás dele levava 403 em toda navegação.
  "voice.call": "agent",
};

export function usePermission(action: string): boolean {
  const { user, activeOrg } = useAuth();
  if (user.is_platform_admin && !user.support) return true;
  if (!activeOrg) return false;
  const required = ACTION_MIN_ROLE[action];
  if (!required) return false;
  return ROLE_RANK[activeOrg.role] >= ROLE_RANK[required];
}
