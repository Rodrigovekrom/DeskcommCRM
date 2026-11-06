"use client";
/**
 * ia.vek CRM-244 (Fase 2): no cabeçalho, quantos cartões estão SEM RESPOSTA, por responsável.
 * Gerente e admin veem cada vendedor; o vendedor vê só o dele, porque o quadro dele só tem os dele.
 * A régua é a MESMA da marca do cartão (`esperandoDesde`): conta só o que está na tela.
 */
import { useMemo } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { esperandoDesde } from "@/lib/iavek/ordem-do-quadro";
import type { Lead } from "@/lib/types/leads";

export function contarSemRespostaPorDono(
  leads: ReadonlyArray<Pick<Lead, "status" | "conversa" | "owner_user_id" | "stage_id">>,
  nomeDaEtapa: (stageId: string) => string | null | undefined,
): Map<string | null, number> {
  const porDono = new Map<string | null, number>();
  for (const l of leads) {
    if (esperandoDesde(l, nomeDaEtapa(l.stage_id)) === null) continue;
    const dono = l.owner_user_id ?? null;
    porDono.set(dono, (porDono.get(dono) ?? 0) + 1);
  }
  return porDono;
}

export function SemRespostaPorVendedor({ leads, stages }: { leads: Lead[]; stages: Array<{ id: string; name: string }> }) {
  const t = useT();
  const { data: membros } = useAssignableMembers(true);
  const porDono = useMemo(() => {
    const nomes = new Map(stages.map((s) => [s.id, s.name] as const));
    return contarSemRespostaPorDono(leads, (id) => nomes.get(id));
  }, [leads, stages]);
  if (porDono.size === 0) return null;
  const nomeDe = (id: string | null) =>
    id === null ? t("Sem responsável") : (membros?.find((m) => m.user_id === id)?.full_name ?? t("Sem nome"));
  const linhas = [...porDono].sort(([, a], [, b]) => b - a);
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="sem-resposta-por-vendedor">
      <span className="font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">{t("Sem resposta")}</span>
      {linhas.map(([id, n]) => (
        <span key={id ?? "sem-dono"} data-testid="sem-resposta-do-vendedor" className="tabular-nums">
          {nomeDe(id)} <strong>{n}</strong>
        </span>
      ))}
    </p>
  );
}
