"use client";

import { createContext, useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { cn } from "@/lib/utils";

/**
 * ia.vek v1.8.2 — CAMPOS OBRIGATÓRIOS na tela (bloco 6). Quem diz o que falta é
 * o banco (`fn_iavek_campos_que_faltam`); aqui só se mostra. Interruptor
 * desligado: nada aparece.
 */
interface RespostaDosLeads {
  ativo: boolean;
  leads: Record<string, string[]>;
}

export function useCamposQueFaltam(ids: string[], versao = "") {
  const chave = [...ids].sort().join(",");
  return useQuery({
    // `versao` muda quando um lead do quadro muda (campo, tag, dono): o selo acompanha.
    queryKey: ["iavek", "obrigatorios", "leads", chave, versao],
    enabled: ids.length > 0,
    placeholderData: (anterior) => anterior,
    queryFn: () =>
      apiClient.get<ApiSuccess<RespostaDosLeads>>(`/api/v1/iavek/obrigatorios/leads?ids=${chave}`).then((r) => r.data),
  });
}

/** O mapa lead → o que falta, para o selo do cartão no quadro. */
export const IncompletosNoCardContext = createContext<Record<string, string[]> | null>(null);

/** O selo "Incompleto (faltam N)"; passar o mouse ou tocar mostra quais. */
export function SeloIncompleto({ leadId, faltam: faltamProp }: { leadId: string; faltam?: string[] }) {
  const t = useT();
  const mapa = useContext(IncompletosNoCardContext);
  const faltam = faltamProp ?? mapa?.[leadId] ?? [];
  if (faltam.length === 0) return null;
  const lista = faltam.join(" · ");
  return (
    <details className="group text-[11px]" data-testid="selo-incompleto" onClick={(e) => e.stopPropagation()}>
      <summary
        className="inline-flex cursor-pointer list-none rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900"
        title={lista}
      >
        {t("Incompleto")} ({t("faltam")} {faltam.length})
      </summary>
      <p className="mt-1 text-text-muted" data-testid="o-que-falta">
        {lista}
      </p>
    </details>
  );
}

interface IncompletosResposta {
  ativo: boolean;
  vendedores: Array<{ vendedor_id: string; nome: string | null; leads: Array<{ lead_id: string; titulo: string; faltam: string[] }> }>;
}

/** "Leads incompletos" no Meu dia do gerente: por vendedor, só nomes. */
export function LeadsIncompletos() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["iavek", "obrigatorios", "incompletos"],
    queryFn: () => apiClient.get<ApiSuccess<IncompletosResposta>>("/api/v1/iavek/obrigatorios/incompletos").then((r) => r.data),
    refetchInterval: 120_000,
  });
  if (!data?.ativo) return null;
  const total = data.vendedores.reduce((s, v) => s + v.leads.length, 0);
  return (
    <section className="rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="leads-incompletos">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Leads incompletos")}</h2>
        <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{total}</span>
      </div>
      {data.vendedores.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Todos os leads estão com os campos obrigatórios.")}</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {data.vendedores.map((v) => (
            <li key={v.vendedor_id} data-testid="vendedor-com-incompletos">
              <p className="font-medium">
                {v.nome ?? "—"} <span className="text-muted-foreground">({v.leads.length})</span>
              </p>
              <ul className="ml-4 list-disc text-xs text-muted-foreground">
                {v.leads.slice(0, 20).map((l) => (
                  <li key={l.lead_id}>
                    {l.titulo}: {l.faltam.join(", ")}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Configurações (só admin): "Exigir campos obrigatórios". */
export function CamposObrigatoriosConfig() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["iavek", "obrigatorios", "config"],
    queryFn: () => apiClient.get<ApiSuccess<{ ativo: boolean }>>("/api/v1/iavek/obrigatorios").then((r) => r.data),
  });
  const gravar = useMutation({
    mutationFn: (ativo: boolean) => apiClient.patch("/api/v1/iavek/obrigatorios", { ativo }),
    onError: showApiError,
    onSettled: () => void qc.invalidateQueries({ queryKey: ["iavek", "obrigatorios"] }),
  });
  const ativo = data?.ativo === true;
  return (
    <section className="space-y-2 rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="campos-obrigatorios-config">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={ativo}
          disabled={!data || gravar.isPending}
          onChange={(e) => gravar.mutate(e.target.checked)}
          data-testid="exigir-campos-obrigatorios"
        />
        {t("Exigir campos obrigatórios")}
      </label>
      <p className={cn("text-xs", "text-muted-foreground")}>
        {t(
          "Ligado: o lead só vai para Agendamento, Ligação de vídeo feita, Lead qualificado, Troca ou Vendido com contexto, tags, fase, guardião, vendedor, carro de interesse e parcela desejável. A entrada do lead nunca trava.",
        )}
      </p>
    </section>
  );
}

/** Busca o que falta nos leads do quadro e publica para os cartões. */
export function ComIncompletos({ leads, children }: { leads: Array<{ id: string; updated_at?: string | null }>; children: React.ReactNode }) {
  const versao = leads.reduce((m, l) => ((l.updated_at ?? "") > m ? (l.updated_at ?? "") : m), "");
  const { data } = useCamposQueFaltam(
    leads.map((l) => l.id),
    versao,
  );
  return <IncompletosNoCardContext.Provider value={data?.ativo ? data.leads : null}>{children}</IncompletosNoCardContext.Provider>;
}
