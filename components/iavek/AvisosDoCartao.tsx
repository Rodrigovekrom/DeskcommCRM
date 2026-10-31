"use client";

import { createContext, useContext } from "react";

import { useT } from "@/hooks/i18n/useT";
import { avisosDoCartao } from "@/lib/iavek/painel-do-pipeline";
import type { Lead } from "@/lib/types/leads";

/**
 * ia.vek v1.9.8 (CRM-218) — os AVISOS no cartão do lead: "sem tarefa" e
 * "parado há N dias". Quem liga é o Pipeline, passando os leads que têm tarefa
 * aberta (da rota do painel). Sem o contexto (`null`), o cartão não avisa nada:
 * sem saber das tarefas, "sem tarefa" seria um palpite.
 */
export const AvisosDoCartaoContext = createContext<{ comTarefa: ReadonlySet<string> } | null>(null);

export function AvisosDoCartao({ lead }: { lead: Lead }) {
  const t = useT();
  const ctx = useContext(AvisosDoCartaoContext);
  if (!ctx) return null;
  const avisos = avisosDoCartao(
    {
      status: lead.status,
      created_at: lead.created_at,
      stage_changed_at: lead.stage_changed_at ?? null,
      last_activity_at: lead.last_activity_at ?? null,
    },
    ctx.comTarefa.has(lead.id),
  );
  if (!avisos.semTarefa && avisos.paradoDias === null) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="avisos-do-cartao">
      {avisos.semTarefa && (
        <span
          className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
          data-testid="aviso-sem-tarefa"
        >
          {t("Sem tarefa")}
        </span>
      )}
      {avisos.paradoDias !== null && (
        <span
          className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
          data-testid="aviso-parado"
        >
          {avisos.paradoDias === 1
            ? t("Parado há 1 dia")
            : t("Parado há {dias} dias").replace("{dias}", String(avisos.paradoDias))}
        </span>
      )}
    </div>
  );
}
