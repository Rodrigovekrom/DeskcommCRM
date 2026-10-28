"use client";
/**
 * ia.vek v1.9.5 — RESPONSÁVEL FÁCIL DE VER (CRM-196): no cartão do Pipeline,
 * quem é o responsável (nome e função na loja), o guardião quando é outra
 * pessoa, e o OBJETIVO ATUAL do lead (o próximo passo em aberto). Uma leitura
 * por funil para todos os cartões (`/api/v1/iavek/cartao`).
 */
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import type { ObjetivoDoLead, PessoaDoLead } from "@/lib/iavek/responsavel-do-lead";

interface DadosDosCartoes {
  pessoas: Record<string, PessoaDoLead>;
  objetivos: Record<string, ObjetivoDoLead>;
}

export function useDadosDosCartoes(pipelineId: string) {
  return useQuery({
    queryKey: ["iavek", "cartao", pipelineId],
    queryFn: () => apiClient.get<{ data: DadosDosCartoes }>(`/api/v1/iavek/cartao?pipeline_id=${pipelineId}`).then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** "Fulano (Vendedor)", ou só o nome quando a pessoa não tem função. O rótulo
 * da função é o da loja (ROTULO_DA_FUNCAO), como nas outras telas da loja. */
export function nomeComFuncao(p: PessoaDoLead | undefined): string | null {
  if (!p?.nome) return null;
  return p.funcao ? `${p.nome} (${p.funcao})` : p.nome;
}

export function ResponsavelNoCartao({
  pipelineId,
  leadId,
  donoId,
  guardiaoId,
}: {
  pipelineId: string;
  leadId: string;
  donoId: string | null;
  guardiaoId: string | null;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const { data } = useDadosDosCartoes(pipelineId);
  const dono = donoId ? nomeComFuncao(data?.pessoas[donoId]) : null;
  const guardiao = guardiaoId && guardiaoId !== donoId ? nomeComFuncao(data?.pessoas[guardiaoId]) : null;
  const objetivo = data?.objetivos[leadId];
  const quando = objetivo?.vence_em
    ? new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(objetivo.vence_em))
    : null;
  return (
    <div className="space-y-0.5" data-testid="responsavel-no-cartao">
      <p className="truncate" title={dono ?? undefined}>
        <span className="text-text-muted">{t("Responsável")}:</span>{" "}
        <span className="font-medium text-text" data-testid="responsavel-nome">
          {dono ?? (donoId ? "…" : t("Sem dono"))}
        </span>
        {guardiao && <span className="text-text-muted"> · {t("Guardião")}: {guardiao}</span>}
      </p>
      <p className="truncate" title={objetivo?.titulo} data-testid="objetivo-do-lead">
        <span className="text-text-muted">{t("Objetivo")}:</span>{" "}
        {objetivo ? (
          <span className="text-text">
            {objetivo.titulo}
            {quando ? ` · ${quando}` : ""}
          </span>
        ) : (
          <span className="text-text-muted">{t("sem próximo passo")}</span>
        )}
      </p>
    </div>
  );
}
