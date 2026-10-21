"use client";
import { useId, useMemo } from "react";
import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import type { LeadFilters } from "@/lib/kanban/filters";

/**
 * ia.vek v1.7.5: o "Kanban por vendedor" do gerente — um seletor bem visível no
 * topo do quadro para ver os atendimentos de uma pessoa da equipe.
 *
 * Não é um filtro novo: escreve no MESMO `filters.owner` do menu "Responsável"
 * da `FilterBar` (e na mesma query string), então os dois sempre concordam.
 * Só desenha; quem decide quais leads o gerente enxerga continua sendo a RLS.
 */
export function SeletorDeVendedor({
  filters,
  onChange,
}: {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
}) {
  const t = useT();
  const id = useId();
  const { data: members } = useAssignableMembers(true);
  const pessoas = useMemo(
    () =>
      [...(members ?? [])].sort((a, b) =>
        (a.full_name ?? "").localeCompare(b.full_name ?? "", "pt-BR"),
      ),
    [members],
  );
  const atual = !filters.owner || filters.owner === "any" ? "" : filters.owner;
  // Um dono que não é pessoa da lista (agente, "sem responsável") continua
  // escolhível: o seletor mostra a opção em vez de fingir "Todos".
  const foraDaLista = atual && !pessoas.some((m) => m.user_id === atual);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2"
      data-testid="seletor-de-vendedor"
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {t("Vendedor")}
      </label>
      <select
        id={id}
        value={atual}
        onChange={(e) => onChange({ ...filters, owner: e.target.value || "any" })}
        className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
      >
        <option value="">{t("Todos os vendedores")}</option>
        {pessoas.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.full_name ?? t("Sem nome")}
          </option>
        ))}
        {foraDaLista && (
          <option value={atual}>
            {atual === "unassigned" ? t("Sem responsável") : t("Outro responsável")}
          </option>
        )}
      </select>
    </div>
  );
}
