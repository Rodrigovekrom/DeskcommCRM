"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import type { Lado, LadosDoFunil } from "@/lib/iavek/lados-do-funil";

/**
 * ia.vek v1.9.3 — "Etapas de cada função" em Configurações › Atendimento (só
 * na loja). O admin diz de quem é cada etapa do funil padrão: no Pipeline, o
 * SDR vê só as dele, o vendedor só as dele, e "Ambos" aparece para os dois
 * (cada um com os seus leads). Nenhuma marcada: o Pipeline de sempre.
 */
interface Etapa {
  id: string;
  name: string;
  lado: Lado | null;
}

export function LadosDoFunilConfig() {
  const { lojaDeCarros, modo_agendamento } = usePerfilDaEmpresa();
  return lojaDeCarros && !modo_agendamento ? <LadosDoFunilDaLoja /> : null;
}

function LadosDoFunilDaLoja() {
  const t = useT();
  const qc = useQueryClient();
  const { activeOrg } = useAuth();
  const ehAdmin = activeOrg?.role === "admin";
  const chave = ["iavek", "lados-do-funil"];
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ funil: { id: string; name: string } | null; etapas: Etapa[] }>>("/api/v1/iavek/lados-do-funil")
        .then((r) => r.data),
  });
  const gravar = useMutation({
    mutationFn: (lados: LadosDoFunil) =>
      apiClient.patch("/api/v1/iavek/lados-do-funil", { pipeline_id: data?.funil?.id, lados }),
    onError: showApiError,
    onSettled: () => void qc.invalidateQueries({ queryKey: chave }),
  });
  if (!data?.funil) return null;

  function trocar(etapaId: string, valor: string) {
    const lados: LadosDoFunil = {};
    for (const e of data?.etapas ?? []) {
      const lado = e.id === etapaId ? valor : e.lado;
      if (lado === "sdr" || lado === "vendedor" || lado === "ambos") lados[e.id] = lado;
    }
    gravar.mutate(lados);
  }

  return (
    <section className="space-y-3 rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="lados-do-funil-config">
      <div>
        <h2 className="text-sm font-semibold">{t("Etapas de cada função")}</h2>
        <p className="text-xs text-muted-foreground">
          {t(
            "No Pipeline, o guardião vê só as etapas do guardião e o vendedor só as do vendedor, cada um com os próprios leads. \"Os dois\" aparece para ambos. Sem nenhuma marcada, todos veem o funil inteiro.",
          )}
        </p>
      </div>
      <p className="text-xs font-medium">
        {t("Funil")}: {data.funil.name}
      </p>
      <ul className="space-y-1">
        {data.etapas.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{e.name}</span>
            <select
              className="h-8 w-40 rounded-md border bg-background px-2 text-sm"
              value={e.lado ?? ""}
              disabled={!ehAdmin || gravar.isPending}
              onChange={(ev) => trocar(e.id, ev.target.value)}
              data-testid={`lado-${e.id}`}
            >
              <option value="">{t("Nenhum")}</option>
              <option value="sdr">{t("Guardião")}</option>
              <option value="vendedor">{t("Vendedor")}</option>
              <option value="ambos">{t("Os dois")}</option>
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}
