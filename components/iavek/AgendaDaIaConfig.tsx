"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import type { ApiSuccess } from "@/lib/api/wrappers";
import type { AgendaDaIa, MarcaComo } from "@/lib/iavek/agenda-da-ia";

/**
 * ia.vek v1.9.2 — "A IA marca como" em Configurações › Atendimento. SÓ no modo
 * agendamento (fora dele a IA faz pedido, como na loja, e o bloco nem aparece).
 * Junto, o prompt-base da clínica para o admin copiar no agente.
 */
export function AgendaDaIaConfig() {
  const { modo_agendamento } = usePerfilDaEmpresa();
  return modo_agendamento ? <AgendaDaIaDaClinica /> : null;
}

function AgendaDaIaDaClinica() {
  const t = useT();
  const qc = useQueryClient();
  const [copiado, setCopiado] = useState(false);
  const chave = ["iavek", "agenda-ia"];
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ modo_agendamento: boolean; config: AgendaDaIa; prompt_base: string | null }>>("/api/v1/iavek/agenda-ia")
        .then((r) => r.data),
  });
  const gravar = useMutation({
    mutationFn: (marca_como: MarcaComo) => apiClient.patch("/api/v1/iavek/agenda-ia", { marca_como }),
    onError: showApiError,
    onSettled: () => void qc.invalidateQueries({ queryKey: chave }),
  });
  return (
    <section className="space-y-3 rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="agenda-da-ia-config">
      <h2 className="text-sm font-semibold">{t("A IA agenda na agenda da clínica")}</h2>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("A IA marca como")}</span>
        <select
          className="h-9 w-64 rounded-md border bg-background px-2"
          value={data?.config.marca_como ?? "pre_agendado"}
          disabled={!data || gravar.isPending}
          onChange={(e) => gravar.mutate(e.target.value as MarcaComo)}
          data-testid="ia-marca-como"
        >
          <option value="pre_agendado">{t("Pré-agendado (a clínica confirma)")}</option>
          <option value="agendado">{t("Agendado 100%")}</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          "Pré-agendado: o horário fica reservado em amarelo e, quando a clínica confirma, a cliente recebe a confirmação pelo WhatsApp. Agendado 100%: já entra confirmado, em verde.",
        )}
      </p>
      {data?.prompt_base && (
        <details className="text-xs" data-testid="prompt-base-clinica">
          <summary className="cursor-pointer font-medium">{t("Prompt-base da clínica (para colar no agente de IA)")}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-2">{data.prompt_base}</pre>
          <button
            type="button"
            className="mt-2 rounded-md border px-2 py-1"
            onClick={() => {
              void copyToClipboard(data.prompt_base ?? "").then((ok) => setCopiado(ok));
            }}
          >
            {copiado ? t("Copiado") : t("Copiar")}
          </button>
        </details>
      )}
    </section>
  );
}
