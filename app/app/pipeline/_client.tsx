"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { CartaoIavekContext } from "@/components/iavek/CartaoIavek";
import { DadosDaCompraNoCardContext } from "@/components/iavek/DadosDaCompraNoCard";
import { usePreferenciasDoPipeline, VistaDoPipeline } from "@/components/iavek/VistaDoPipeline";
import { PadraoNoCardContext, type AvaliacaoDoLead } from "@/components/iavek/PadraoDoLead";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useBoard } from "@/hooks/kanban/useBoard";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";

interface LeadSemDono {
  id: string;
  titulo: string;
  cliente: string | null;
  chegou_em: string;
}

/** A janela que junta os eventos do tempo real antes de buscar o quadro de novo. */
const AGRUPAR_EVENTOS_MS = 1_500;

/**
 * ia.vek v1.7.7 — o Pipeline do vendedor.
 *
 * Em cima, "Chegaram agora — sem dono": os leads novos que ninguém assumiu, os
 * mais novos primeiro, com o total e o botão "Assumir". Embaixo, o Kanban SÓ
 * da carteira de quem está conectado (dono = eu, filtrado no servidor), com o
 * lead mais novo no topo de cada etapa e a troca / forma de pagamento no
 * cartão. Arrastar entre etapas é o mesmo do quadro de sempre (etapa de perda
 * pede o motivo); criar etapa não existe aqui — as etapas são do admin.
 */
export function CarteiraClient({ pipelineId, nomeDoFunil }: { pipelineId: string; nomeDoFunil: string }) {
  const t = useT();
  const { data, isLoading, error, pulses, realtimeStatus, dataUpdatedAt } = useBoard(pipelineId, {
    escopo: "carteira",
    agruparEventosMs: AGRUPAR_EVENTOS_MS,
  });
  // v1.7.9: a vista de cada um (ordem, colunas recolhidas/ocultas) — 0587.
  const { prefs, gravar } = usePreferenciasDoPipeline();
  // v1.8.0: o padrão da loja da carteira (selo no cartão). Desligado: mapa vazio.
  const qcPadrao = useQueryClient();
  const { data: padrao } = useQuery({
    queryKey: ["iavek", "padrao", "carteira", pipelineId],
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ ativo: boolean; leads: Record<string, AvaliacaoDoLead> }>>(
          `/api/v1/iavek/padrao/leads?pipeline_id=${pipelineId}&escopo=carteira`,
        )
        .then((r) => r.data),
  });
  useEffect(() => {
    if (dataUpdatedAt) void qcPadrao.invalidateQueries({ queryKey: ["iavek", "padrao", "carteira", pipelineId] });
  }, [dataUpdatedAt, pipelineId, qcPadrao]);

  return (
    <div
      className="flex h-[calc(100dvh-3.5rem-var(--space-6)-max(var(--space-6),var(--rodape-ocupado,0px)))] min-h-[28rem] flex-col gap-3"
      data-realtime-status={realtimeStatus.toLowerCase()}
      data-testid="pipeline-do-vendedor"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Pipeline")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Sua carteira no funil")} <strong>{nomeDoFunil}</strong>
          {data ? ` — ${data.leads.length} ${data.leads.length === 1 ? t("cliente") : t("clientes")}` : ""}
        </p>
      </header>

      <FaixaSemDono pipelineId={pipelineId} quadroAtualizadoEm={dataUpdatedAt} />

      {data && <VistaDoPipeline etapas={data.stages} prefs={prefs} gravar={gravar} />}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {t("Não consegui carregar a sua carteira.")}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">{t("Carregando…")}</div>
      ) : (
        <PadraoNoCardContext.Provider value={padrao?.ativo ? padrao.leads : null}>
        <DadosDaCompraNoCardContext.Provider value={{ ligado: true }}>
        <CartaoIavekContext.Provider value={true}>
          <KanbanBoard
            pipelineId={pipelineId}
            stages={data.stages}
            leads={data.leads}
            pulses={pulses}
            pipeline={data.pipeline}
            ordem={prefs.ordem}
            etapasOcultas={new Set(prefs.ocultas)}
            etapasRecolhidas={new Set(prefs.recolhidas)}
            onAbrirEtapa={(id) => gravar({ ...prefs, recolhidas: prefs.recolhidas.filter((x) => x !== id) })}
          />
        </CartaoIavekContext.Provider>
        </DadosDaCompraNoCardContext.Provider>
        </PadraoNoCardContext.Provider>
      )}
    </div>
  );
}

function FaixaSemDono({ pipelineId, quadroAtualizadoEm }: { pipelineId: string; quadroAtualizadoEm: number }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const qc = useQueryClient();
  const chave = ["board", pipelineId, "sem-dono"] as const;
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ total: number; itens: LeadSemDono[] }>>(`/api/v1/iavek/pipeline/sem-dono?pipeline_id=${pipelineId}`)
        .then((r) => r.data),
    // Rede de segurança: o tempo real já invalida (ver o efeito abaixo).
    refetchInterval: 60_000,
  });

  // O tempo real chega pelo quadro (o mesmo canal do funil): quando o quadro
  // recarrega, a faixa acompanha — sem um segundo canal aberto por aba.
  useEffect(() => {
    if (quadroAtualizadoEm) void qc.invalidateQueries({ queryKey: chave });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave é derivada de pipelineId
  }, [quadroAtualizadoEm, pipelineId, qc]);

  const assumir = useMutation({
    mutationFn: (leadId: string) => apiClient.post(`/api/v1/iavek/pipeline/assumir`, { lead_id: leadId }),
    onError: (erro) => {
      showApiError(erro);
      void qc.invalidateQueries({ queryKey: chave });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", pipelineId] }),
  });

  const total = data?.total ?? 0;
  if (!data || total === 0) return null;
  const formatar = new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="rounded-lg border border-accent/40 bg-accent/5 p-3" data-testid="faixa-sem-dono" aria-label={t("Chegaram agora — sem dono")}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Chegaram agora — sem dono")}</h2>
        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-foreground" data-testid="contador-sem-dono">
          {total}
        </span>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {data.itens.map((l) => (
          <li key={l.id} className="flex w-56 shrink-0 flex-col gap-1 rounded-md border bg-surface p-2 text-sm" data-testid="lead-sem-dono">
            <span className="truncate font-medium">{l.cliente ?? l.titulo}</span>
            <span className="text-xs text-muted-foreground">
              {t("Chegou")} {formatar.format(new Date(l.chegou_em))}
            </span>
            <Button
              size="sm"
              disabled={assumir.isPending}
              onClick={() => assumir.mutate(l.id)}
              data-testid="assumir-lead"
            >
              {t("Assumir")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
