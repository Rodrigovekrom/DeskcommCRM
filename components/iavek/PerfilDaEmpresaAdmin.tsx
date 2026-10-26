"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import type { NichoDaEmpresa, PerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";

/**
 * ia.vek v1.9.0 — o PERFIL DA EMPRESA na tela da organização do admin da
 * plataforma: tipo (loja de carros ou clínica) e o modo agendamento. A loja que
 * recebe o estoque do Altimus não muda de tipo (a rota recusa e a tela avisa).
 */
export function PerfilDaEmpresaAdmin({ organizationId }: { organizationId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const chave = ["admin", "tenants", organizationId, "perfil-iavek"];
  const url = `/api/v1/admin/tenants/${organizationId}/perfil-iavek`;
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ perfil: PerfilDaEmpresa; recebe_estoque: boolean }>>(url)
        .then((r) => r.data),
  });
  const gravar = useMutation({
    mutationFn: (perfil: PerfilDaEmpresa) => apiClient.patch(url, perfil),
    onError: showApiError,
    onSettled: () => void qc.invalidateQueries({ queryKey: chave }),
  });
  const perfil = data?.perfil;
  const ocupado = !perfil || gravar.isPending;

  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="perfil-da-empresa">
      <h2 className="text-sm font-semibold">{t("Perfil ia.vek")}</h2>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("Tipo de empresa")}</span>
        <select
          className="h-9 rounded-md border bg-background px-2"
          value={perfil?.nicho ?? "loja_de_carros"}
          disabled={ocupado}
          onChange={(e) => perfil && gravar.mutate({ ...perfil, nicho: e.target.value as NichoDaEmpresa })}
          data-testid="perfil-nicho"
        >
          <option value="loja_de_carros">{t("Loja de carros")}</option>
          <option value="clinica">{t("Clínica")}</option>
        </select>
      </label>
      {data?.recebe_estoque && (
        <p className="text-xs text-muted-foreground">
          {t("Esta organização recebe o estoque do Altimus: ela continua loja de carros.")}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={perfil?.modo_agendamento === true}
          disabled={ocupado}
          onChange={(e) => perfil && gravar.mutate({ ...perfil, modo_agendamento: e.target.checked })}
          data-testid="perfil-modo-agendamento"
        />
        {t("Modo agendamento")}
      </label>
      <p className="text-xs text-muted-foreground">
        {t(
          "Ligado: a agenda passa a ser a da empresa (profissionais, horários e estados com cores) e, nas próximas versões, a IA marca horário. Desligado: nada muda.",
        )}
      </p>
    </section>
  );
}
