"use client";

import { useCallback, useRef } from "react";

import { useActiveOrg, useUser } from "@/hooks/auth/AuthProvider";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { entregarAviso } from "@/lib/notifications/deliver";
import { mencaoAtingeUsuario, textoLegivelDeMencao } from "@/lib/notifications/mentions";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function sides(payload: unknown): {
  novo: Record<string, unknown> | null;
  antigo: Record<string, unknown> | null;
} {
  if (!payload || typeof payload !== "object") return { novo: null, antigo: null };
  const p = payload as { new?: unknown; old?: unknown; payload?: { new?: unknown; old?: unknown } };
  const novoRaw = p.new ?? p.payload?.new;
  const antigoRaw = p.old ?? p.payload?.old;
  return {
    novo: novoRaw && typeof novoRaw === "object" && !Array.isArray(novoRaw) ? (novoRaw as Record<string, unknown>) : null,
    antigo:
      antigoRaw && typeof antigoRaw === "object" && !Array.isArray(antigoRaw)
        ? (antigoRaw as Record<string, unknown>)
        : null,
  };
}

/**
 * ia.vek v1.8.4 — os avisos do lead só quando algo MUDOU de fato.
 *
 * O realtime manda o registro antigo só com a chave primária (nenhuma tabela
 * tem `replica identity full`), então `old.owner_user_id` e `old.status` chegam
 * SEMPRE vazios e qualquer UPDATE de um lead do usuário — salvar a ficha, um
 * gatilho que mexe no `updated_at` — repetia "Lead atribuído a você" (medido
 * no canário: 3 avisos iguais a cada Salvar), e um lead ganho repetia "Lead
 * ganho". A régua é o último valor que ESTA tela viu; lead nunca visto só avisa
 * se o carimbo da mudança é recente (`assigned_at` / `closed_at` até 2 minutos).
 */
const JANELA_DA_NOVIDADE_MS = 2 * 60_000;

export function ehNovidade(
  vistoAntes: string | null | undefined,
  valor: string | null,
  esperado: string,
  carimbo: string | null,
  agora: number = Date.now(),
): boolean {
  if (valor !== esperado) return false;
  if (vistoAntes !== undefined) return vistoAntes !== valor;
  const quando = carimbo ? Date.parse(carimbo) : NaN;
  return Number.isFinite(quando) && agora - quando <= JANELA_DA_NOVIDADE_MS;
}

export function useCrmAlerts(): void {
  const orgId = useActiveOrg()?.orgId ?? null;
  const user = useUser();
  const visto = useRef(new Map<string, { dono: string | null; status: string | null }>());

  const onLead = useCallback(
    (payload: unknown) => {
      const { novo, antigo } = sides(payload);
      if (!novo) return;
      const title = str(novo.title) || "Lead";
      const pipelineId = str(novo.pipeline_id);
      const href = pipelineId ? `/app/pipelines/${pipelineId}` : "/app/kanban";
      const owner = str(novo.owner_user_id);
      const status = str(novo.status);
      const leadId = str(novo.id);
      // `antigo` só traz os campos quando a tabela tiver replica identity full; senão vale o último visto.
      const anterior = leadId ? visto.current.get(leadId) : undefined;
      const ownerAntes = antigo && "owner_user_id" in antigo ? str(antigo.owner_user_id) : anterior?.dono;
      const statusAntes = antigo && "status" in antigo ? str(antigo.status) : anterior?.status;
      if (leadId) visto.current.set(leadId, { dono: owner, status });
      const fechadoEm = str(novo.closed_at);

      if (ehNovidade(ownerAntes, owner, user.id, str(novo.assigned_at))) {
        entregarAviso({
          category: "lead_assigned",
          kind: "lead_assigned",
          title: "Lead atribuído a você",
          body: title,
          tag: str(novo.id) ?? undefined,
          href,
        });
      }
      if (owner === user.id && ehNovidade(statusAntes, status, "won", fechadoEm)) {
        entregarAviso({
          category: "lead_won",
          kind: "lead_won",
          title: "Lead ganho",
          body: title,
          tag: str(novo.id) ?? undefined,
          href,
        });
      }
      if (owner === user.id && ehNovidade(statusAntes, status, "lost", fechadoEm)) {
        entregarAviso({
          category: "lead_lost",
          kind: "lead_lost",
          title: "Lead perdido",
          body: title,
          tag: str(novo.id) ?? undefined,
          href,
        });
      }
    },
    [user.id],
  );

  const onNote = useCallback(
    (payload: unknown) => {
      const { novo } = sides(payload);
      if (!novo) return;
      const author = str(novo.created_by_user_id);
      if (author === user.id) return;
      const body = str(novo.body) ?? "";
      if (
        !mencaoAtingeUsuario(body, {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
        })
      ) {
        return;
      }
      const conversationId = str(novo.conversation_id);
      entregarAviso({
        category: "mention",
        kind: "mention",
        title: "Você foi mencionado",
        // O sino é LIDO por gente: o token com o id vira `@Ana Lima` aqui,
        // nunca o contrário (o casamento já aconteceu logo acima, no cru).
        body: textoLegivelDeMencao(body),
        tag: conversationId ?? undefined,
        href: conversationId ? `/app/inbox?id=${conversationId}` : "/app/inbox",
      });
    },
    [user.id, user.email, user.full_name],
  );

  useRealtimeChannel({
    name: orgId ? `alerts-leads-${orgId}` : "alerts-leads-disabled",
    postgresChanges: orgId
      ? {
          event: "UPDATE",
          schema: "public",
          table: "crm_leads",
          filter: `organization_id=eq.${orgId}`,
        }
      : undefined,
    onChange: onLead,
    enabled: !!orgId,
  });

  useRealtimeChannel({
    name: orgId ? `alerts-notes-${orgId}` : "alerts-notes-disabled",
    postgresChanges: orgId
      ? {
          event: "INSERT",
          schema: "public",
          table: "conversation_notes",
          filter: `organization_id=eq.${orgId}`,
        }
      : undefined,
    onChange: onNote,
    enabled: !!orgId,
  });
}
