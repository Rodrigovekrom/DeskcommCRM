"use client";

import { createContext, useContext, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useEditLead } from "@/hooks/kanban/useUpdateLead";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";

/**
 * ia.vek v1.7.7 — a faixa "dados da compra" no cartão do Pipeline do vendedor.
 *
 * Mostra, sem abrir a conversa, se o cliente tem carro na TROCA e como quer
 * pagar (À vista / Financiado / Consórcio). Os valores moram nos campos do lead
 * que já existem desde a v1.5 (`custom_fields.tem_troca`,
 * `custom_fields.forma_pagamento`, e as fotos da troca em `troca_fotos`).
 *
 * Só aparece onde a página liga o contexto (o Pipeline do vendedor): o quadro
 * "Funis" continua com o cartão de altura fixa de sempre.
 *
 * Marcar é 2 toques (P2): "Troca?" alterna sim/não; o chip de pagamento abre as
 * três opções. Grava por `PATCH /api/v1/leads/:id` com SÓ a chave mudada — o
 * servidor faz o merge atômico (`fn_lead_anotar_campos`, migration 0502).
 */
export const DadosDaCompraNoCardContext = createContext<{ ligado: boolean }>({ ligado: false });

export const FORMAS_DE_PAGAMENTO = [
  { value: "a_vista", label: "À vista" },
  { value: "financiamento", label: "Financiado" },
  { value: "consorcio", label: "Consórcio" },
] as const;

export function rotuloDaFormaDePagamento(valor: unknown): string | null {
  return FORMAS_DE_PAGAMENTO.find((f) => f.value === valor)?.label ?? null;
}

/** Tem troca: marcado "sim", ou com fotos do carro da troca já escolhidas. */
export function temTroca(campos: Record<string, unknown> | null | undefined): boolean | null {
  const c = campos ?? {};
  if (c.tem_troca === true) return true;
  if (Array.isArray(c.troca_fotos) && c.troca_fotos.length > 0) return true;
  if (c.tem_troca === false) return false;
  return null;
}

/** "Novo": chegou nas últimas 24 h, ou tem mensagem do cliente sem ler. */
export function ehNovo(lead: Lead, agora: number = Date.now()): boolean {
  const naoLidas = (lead as { conversa?: { unread?: number } | null }).conversa?.unread ?? 0;
  if (naoLidas > 0) return true;
  const criado = new Date(lead.created_at).getTime();
  return Number.isFinite(criado) && agora - criado < 24 * 3600 * 1000;
}

export function DadosDaCompraNoCard({ lead, pipelineId }: { lead: Lead; pipelineId: string }) {
  const { ligado } = useContext(DadosDaCompraNoCardContext);
  if (!ligado) return null;
  return <Faixa lead={lead} pipelineId={pipelineId} />;
}

function Faixa({ lead, pipelineId }: { lead: Lead; pipelineId: string }) {
  const t = useT();
  const editar = useEditLead(pipelineId);
  const [escolhendo, setEscolhendo] = useState(false);
  const campos = (lead.custom_fields ?? {}) as Record<string, unknown>;
  const troca = temTroca(campos);
  // Literais por opção: a chave de t() nunca é montada em runtime (cerca i18n).
  const ROTULO: Record<string, string> = {
    a_vista: t("À vista"),
    financiamento: t("Financiado"),
    consorcio: t("Consórcio"),
  };
  const pagamento = typeof campos.forma_pagamento === "string" ? (ROTULO[campos.forma_pagamento] ?? null) : null;

  const gravar = (chave: string, valor: unknown) =>
    editar.mutate({ leadId: lead.id, patch: { custom_fields: { [chave]: valor } } });

  // O clique não pode virar arrasto nem abrir o dossiê.
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  const novo = ehNovo(lead);
  return (
    <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-1 text-[11px]" data-testid="dados-da-compra" onClick={parar}>
      {novo && (
        <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-accent-foreground" data-testid="selo-novo">
          {t("Novo")}
        </span>
      )}
      <button
        type="button"
        disabled={editar.isPending}
        onClick={() => gravar("tem_troca", troca !== true)}
        aria-pressed={troca === true}
        title={t("Tem carro na troca? (toque para alternar)")}
        className={cn(
          "rounded-full border px-2 py-0.5",
          troca === true ? "border-accent bg-accent/10 font-medium text-text" : "border-dashed text-text-muted",
        )}
        data-testid="chip-troca"
      >
        {troca === true ? t("Troca") : troca === false ? t("Sem troca") : t("Troca?")}
      </button>
      {escolhendo ? (
        FORMAS_DE_PAGAMENTO.map((f) => (
          <button
            key={f.value}
            type="button"
            disabled={editar.isPending}
            onClick={() => {
              gravar("forma_pagamento", f.value);
              setEscolhendo(false);
            }}
            className="rounded-full border px-2 py-0.5 hover:bg-accent/10"
            data-testid={`opcao-pagamento-${f.value}`}
          >
            {ROTULO[f.value]}
          </button>
        ))
      ) : (
        <button
          type="button"
          onClick={() => setEscolhendo(true)}
          title={t("Como quer pagar? (toque para escolher)")}
          className={cn(
            "rounded-full border px-2 py-0.5",
            pagamento ? "border-accent bg-accent/10 font-medium text-text" : "border-dashed text-text-muted",
          )}
          data-testid="chip-pagamento"
        >
          {pagamento ?? t("Pagamento?")}
        </button>
      )}
    </div>
  );
}
