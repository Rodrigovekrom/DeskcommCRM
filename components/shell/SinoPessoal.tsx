"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Bell } from "@/lib/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * ia.vek v1.7: o sino PESSOAL — "o que aconteceu com os meus leads".
 *
 * Lê `GET /api/v1/iavek/notificacoes` (só as minhas, pela RLS) e escuta o
 * tempo real da tabela `notificacoes` filtrado por mim. Abrir o sino marca
 * tudo como lido. A Central de avisos da IA continua no outro ícone.
 */
export interface NotificacaoDoSino {
  id: string;
  tipo: string;
  lida: boolean;
  created_at: string;
  dados: Record<string, unknown>;
  lead_id: string | null;
  lead_titulo: string | null;
  contato_nome: string | null;
  tarefa_titulo: string | null;
  ator_nome: string | null;
  conversation_id: string | null;
}

const CHAVE = ["iavek", "notificacoes"] as const;

/** A frase de cada aviso (o `t` traduz o molde; os nomes entram depois). */
export function fraseDaNotificacao(n: NotificacaoDoSino, t: (s: string) => string): string {
  const quem = n.contato_nome ?? n.lead_titulo ?? t("um lead");
  const ator = n.ator_nome ?? t("Alguém");
  const troca = (molde: string) =>
    t(molde)
      .replace("{lead}", quem)
      .replace("{who}", ator)
      .replace("{stage}", String(n.dados.para ?? "—"))
      .replace("{reason}", String(n.dados.motivo ?? t("motivo não informado")))
      .replace("{task}", n.tarefa_titulo ?? t("tarefa"));
  switch (n.tipo) {
    case "lead_passado":
      return troca("{who} passou {lead} para você");
    case "guardiao_etapa":
      return troca("{lead} foi para {stage}");
    case "guardiao_ganho":
      return troca("{lead} comprou");
    case "guardiao_perda":
      return troca("{lead} não comprou · {reason}");
    case "guardiao_tarefa_vencida":
      return troca("O próximo passo de {lead} venceu: {task}");
    case "tarefa_vencida":
      return troca("Sua tarefa venceu: {task} ({lead})");
    default:
      return quem;
  }
}

export function SinoPessoal() {
  const t = useT();
  const qc = useQueryClient();
  const { user, activeOrg } = useAuth();
  const [aberto, setAberto] = useState(false);
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: () =>
      apiClient
        .get<{ data: { notificacoes: NotificacaoDoSino[]; nao_lidas: number } }>(
          "/api/v1/iavek/notificacoes",
        )
        .then((r) => r.data),
    enabled: Boolean(activeOrg),
    refetchInterval: 120_000,
  });
  const recarregar = useCallback(() => void qc.invalidateQueries({ queryKey: CHAVE }), [qc]);
  useRealtimeChannel({
    name: `notificacoes:${user.id}:${activeOrg?.orgId ?? "-"}`,
    enabled: Boolean(activeOrg) && !user.support,
    postgresChanges: { event: "INSERT", table: "notificacoes", filter: `user_id=eq.${user.id}` },
    onChange: recarregar,
  });

  if (!activeOrg) return null;
  const naoLidas = data?.nao_lidas ?? 0;
  const lista = data?.notificacoes ?? [];

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (v && naoLidas > 0 && !user.support) {
          void apiClient
            .patch("/api/v1/iavek/notificacoes", {})
            .then(recarregar)
            .catch(() => {});
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="sino-pessoal"
          aria-label={
            naoLidas > 0
              ? `${t("Notificações")} — ${naoLidas} ${t("não lidas")}`
              : t("Notificações")
          }
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:h-9 lg:w-9"
        >
          <Bell size={18} aria-hidden />
          {naoLidas > 0 ? (
            <span
              data-testid="sino-pessoal-contagem"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-destructive-foreground"
            >
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,92vw)] p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-semibold">
          {t("Notificações")}
        </div>
        {lista.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("Nada novo por aqui. Quando algo acontecer com os seus leads, aparece neste sino.")}
          </p>
        ) : (
          <ul
            className="max-h-96 divide-y divide-border overflow-y-auto"
            data-testid="sino-pessoal-lista"
          >
            {lista.map((n) => {
              const href = n.conversation_id ? `/app/inbox?id=${n.conversation_id}` : null;
              const conteudo = (
                <>
                  <span className={cn("block text-sm", !n.lida && "font-medium")}>
                    {fraseDaNotificacao(n, t)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString(undefined, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </>
              );
              return (
                <li key={n.id} className={cn(!n.lida && "bg-accent/5")}>
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => setAberto(false)}
                      className="block px-3 py-2 hover:bg-surface-elevated"
                    >
                      {conteudo}
                    </Link>
                  ) : (
                    <div className="px-3 py-2">{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
