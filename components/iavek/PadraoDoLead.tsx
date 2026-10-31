"use client";

import { createContext, useContext } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import type { ItemAvaliado } from "@/lib/iavek/padrao-da-loja";
import { cn } from "@/lib/utils";

export interface AvaliacaoDoLead {
  itens: ItemAvaliado[];
  pendentes: number;
  fora: number;
  fotos: number;
  videos: number;
}
interface RespostaDoPadrao {
  ativo: boolean;
  leads: Record<string, AvaliacaoDoLead>;
}

export const chaveDoPadraoDoLead = (leadId: string) => ["iavek", "padrao", "lead", leadId] as const;

/**
 * ia.vek v1.8.0 — o PADRÃO DA LOJA no atendimento (checklist SEM IA).
 *
 * Mostra o que o admin definiu e onde o lead está: feito, pendente ou fora do
 * padrão (prazo vencido). A marcação de 1 toque é do vendedor; o servidor só a
 * aceita quando a conversa já tem a mídia mínima. Nada é enviado ao cliente.
 * Padrão desligado pelo admin: o bloco nem aparece.
 */
export function PadraoDoLead({ leadId }: { leadId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: chaveDoPadraoDoLead(leadId),
    queryFn: () => apiClient.get<ApiSuccess<RespostaDoPadrao>>(`/api/v1/iavek/padrao/leads?ids=${leadId}`).then((r) => r.data),
  });
  const marcar = useMutation({
    mutationFn: (args: { itemId: string; feito: boolean }) =>
      apiClient.post("/api/v1/iavek/padrao/marcar", { lead_id: leadId, item_id: args.itemId, feito: args.feito }),
    onError: showApiError,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chaveDoPadraoDoLead(leadId) });
      void qc.invalidateQueries({ queryKey: ["iavek", "padrao", "carteira"] });
    },
  });
  const av = data?.ativo ? data.leads?.[leadId] : undefined;
  if (!av) return null;

  const rotulo = { feito: t("Feito"), pendente: t("Pendente"), fora_do_padrao: t("Fora do padrão") } as const;
  return (
    <div className="space-y-2 text-xs" data-testid="padrao-do-lead">
      <p className="text-text-muted">
        {t("Enviados nesta conversa")}: {av.fotos} {t("foto(s)")} · {av.videos} {t("vídeo(s)")}
      </p>
      <ul className="space-y-1.5">
        {av.itens.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-2" data-testid={`item-do-padrao-${i.id}`}>
            <div className="min-w-0">
              <p className="font-medium">{i.nome}</p>
              <p
                className={cn(
                  i.situacao === "feito" && "text-emerald-700",
                  i.situacao === "pendente" && "text-text-muted",
                  i.situacao === "fora_do_padrao" && "font-semibold text-red-700",
                )}
                data-testid="situacao-do-item"
              >
                {rotulo[i.situacao]}
                {i.bloqueio && i.situacao !== "feito" ? ` — ${i.bloqueio}` : ""}
              </p>
            </div>
            {i.tipo === "marcacao" && (
              <button
                type="button"
                className="shrink-0 rounded-md border px-2 py-0.5 disabled:opacity-50"
                disabled={marcar.isPending || (i.situacao !== "feito" && Boolean(i.bloqueio))}
                onClick={() => marcar.mutate({ itemId: i.id, feito: i.situacao !== "feito" })}
                data-testid={`marcar-${i.id}`}
              >
                {i.situacao === "feito" ? t("Desfazer") : t("Marcar feito")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** O mapa lead → avaliação da carteira, para o selo do cartão no Pipeline. */
export const PadraoNoCardContext = createContext<Record<string, AvaliacaoDoLead> | null>(null);

/** O selo no cartão: "faltam N" (pendente) ou "fora do padrão" (vencido). */
export function SeloDoPadrao({ leadId }: { leadId: string }) {
  const t = useT();
  const mapa = useContext(PadraoNoCardContext);
  const av = mapa?.[leadId];
  if (!av || av.pendentes === 0) return null;
  const fora = av.fora > 0;
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5",
        fora ? "border-red-300 bg-red-50 font-semibold text-red-800" : "border-amber-300 bg-amber-50 text-amber-900",
      )}
      title={av.itens.filter((i) => i.situacao !== "feito").map((i) => i.nome).join(" · ")}
      data-testid="selo-do-padrao"
    >
      {fora ? t("Fora do padrão") : `${t("Padrão: faltam")} ${av.pendentes}`}
    </span>
  );
}

interface ForaDoPadraoResposta {
  ativo: boolean;
  vendedores: Array<{ vendedor_id: string; nome: string | null; leads: Array<{ lead_id: string; titulo: string; itens: string[] }> }>;
}

/**
 * ia.vek v1.8.0 (A2) — "Fora do padrão" no Meu dia do gerente: por vendedor,
 * os leads com item VENCIDO e quais itens. Só nomes — nenhum texto de conversa.
 * Padrão desligado: o bloco não aparece.
 */
export function ForaDoPadrao() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["iavek", "padrao", "fora"],
    queryFn: () => apiClient.get<ApiSuccess<ForaDoPadraoResposta>>("/api/v1/iavek/padrao/fora").then((r) => r.data),
    refetchInterval: 120_000,
  });
  if (!data?.ativo) return null;
  const total = data.vendedores.reduce((s, v) => s + v.leads.length, 0);
  return (
    <section className="rounded-lg border p-4 bg-surface/90 backdrop-blur" data-testid="fora-do-padrao">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Fora do padrão")}</h2>
        <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{total}</span>
      </div>
      {data.vendedores.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Todos os atendimentos estão no padrão.")}</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {data.vendedores.map((v) => (
            <li key={v.vendedor_id} data-testid="vendedor-fora-do-padrao">
              <p className="font-medium">
                {v.nome ?? "—"} <span className="text-muted-foreground">({v.leads.length})</span>
              </p>
              <ul className="ml-4 list-disc text-xs text-muted-foreground">
                {v.leads.map((l) => (
                  <li key={l.lead_id}>
                    <a className="underline" href={`/app/pipeline`}>
                      {l.titulo}
                    </a>
                    : {l.itens.join(", ")}
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
