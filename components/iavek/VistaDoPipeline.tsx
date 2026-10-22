"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { PIPELINE_PADRAO, type PreferenciasDoPipeline } from "@/lib/iavek/preferencias-de-tela";

const CHAVE = ["iavek", "preferencias", "pipeline"] as const;

/** As preferências de visualização do Pipeline de quem está conectado (0587). */
export function usePreferenciasDoPipeline() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<ApiSuccess<PreferenciasDoPipeline>>("/api/v1/iavek/preferencias/pipeline").then((r) => r.data),
  });
  const gravar = useMutation({
    mutationFn: (novo: PreferenciasDoPipeline) => apiClient.put("/api/v1/iavek/preferencias/pipeline", novo),
    // Otimista: a vista muda na hora; erro desfaz e avisa.
    onMutate: async (novo) => {
      await qc.cancelQueries({ queryKey: CHAVE });
      const antes = qc.getQueryData<PreferenciasDoPipeline>(CHAVE);
      qc.setQueryData(CHAVE, novo);
      return { antes };
    },
    onError: (erro, _novo, ctx) => {
      if (ctx?.antes) qc.setQueryData(CHAVE, ctx.antes);
      showApiError(erro);
    },
  });
  const prefs = data ?? PIPELINE_PADRAO;
  return { prefs, gravar: (novo: PreferenciasDoPipeline) => gravar.mutate(novo) };
}

/**
 * ia.vek v1.7.9 — a barra da VISTA do Pipeline: ordenar (chegada / atividade
 * recente) e o menu "Colunas" (recolher ou ocultar cada etapa). Só
 * visualização, por pessoa; as etapas continuam as do admin.
 */
export function VistaDoPipeline({
  etapas,
  prefs,
  gravar,
}: {
  etapas: Array<{ id: string; name: string }>;
  prefs: PreferenciasDoPipeline;
  gravar: (novo: PreferenciasDoPipeline) => void;
}) {
  const t = useT();
  const alternar = (lista: "ocultas" | "recolhidas", id: string) => {
    const atual = new Set(prefs[lista]);
    if (atual.has(id)) atual.delete(id);
    else atual.add(id);
    const outra = lista === "ocultas" ? "recolhidas" : "ocultas";
    gravar({ ...prefs, [lista]: [...atual], [outra]: prefs[outra].filter((x) => x !== id) });
  };
  const escondidas = prefs.ocultas.filter((id) => etapas.some((e) => e.id === id)).length;

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="vista-do-pipeline">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("Ordenar")}</span>
        <select
          className="rounded-md border px-2 py-1"
          value={prefs.ordem}
          onChange={(e) => gravar({ ...prefs, ordem: e.target.value as PreferenciasDoPipeline["ordem"] })}
          aria-label={t("Ordenar")}
          data-testid="ordem-do-pipeline"
        >
          <option value="chegada">{t("Mais novos primeiro")}</option>
          <option value="atividade">{t("Atividade recente")}</option>
        </select>
      </label>
      <details className="relative" data-testid="menu-colunas">
        <summary className="cursor-pointer rounded-md border px-2 py-1">
          {t("Colunas")}
          {escondidas > 0 ? ` (${escondidas} ${t("ocultas")})` : ""}
        </summary>
        <ul className="absolute z-20 mt-1 w-72 space-y-1 rounded-md border bg-surface p-2 shadow-lg">
          {etapas.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{e.name}</span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className={`rounded-md border px-1.5 text-xs ${prefs.recolhidas.includes(e.id) ? "bg-accent text-accent-foreground" : ""}`}
                  aria-pressed={prefs.recolhidas.includes(e.id)}
                  onClick={() => alternar("recolhidas", e.id)}
                  data-testid={`recolher-${e.id}`}
                >
                  {t("Recolher")}
                </button>
                <button
                  type="button"
                  className={`rounded-md border px-1.5 text-xs ${prefs.ocultas.includes(e.id) ? "bg-accent text-accent-foreground" : ""}`}
                  aria-pressed={prefs.ocultas.includes(e.id)}
                  onClick={() => alternar("ocultas", e.id)}
                  data-testid={`ocultar-${e.id}`}
                >
                  {t("Ocultar")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
