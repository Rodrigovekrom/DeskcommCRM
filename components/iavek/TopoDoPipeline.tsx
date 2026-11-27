"use client";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { cn } from "@/lib/utils";

/** A escolha de cada aparelho: o topo do Pipeline aberto ou recolhido no celular. */
export const CHAVE_DO_TOPO = "iavek.pipeline.topo";

/** Valor guardado (não é texto da tela). */
const ABERTO = "aberto";
const RECOLHIDO = "recolhido";

/** Sem escolha guardada (ou sem armazenamento), o topo nasce RECOLHIDO no celular (CRM-549). */
export function topoGuardadoAberto(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_TOPO) === ABERTO;
  } catch {
    return false;
  }
}

export function guardarTopo(aberto: boolean): void {
  try {
    window.localStorage.setItem(CHAVE_DO_TOPO, aberto ? ABERTO : RECOLHIDO);
  } catch {
    /* sem armazenamento: a escolha vale só nesta aba */
  }
}

/** O estado do topo, lido do aparelho depois de montar (o servidor não conhece o localStorage). */
export function useTopoDoPipeline() {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    setAberto(topoGuardadoAberto());
  }, []);
  const alternar = useCallback(() => {
    setAberto((a) => {
      guardarTopo(!a);
      return !a;
    });
  }, []);
  return { aberto, alternar };
}

/**
 * O nome do vendedor escolhido no seletor (o mesmo `filters.owner`), para a linha recolhida (Lupa 111347, b). Lê a
 * MESMA consulta do SeletorDeVendedor (["team", "assignable"]): não há pedido a mais. Sem escolha: null.
 */
export function useNomeDoVendedorEscolhido(owner: string | undefined): string | null {
  const t = useT();
  const escolhido = owner && owner !== "any" ? owner : null;
  const { data: membros } = useAssignableMembers(Boolean(escolhido));
  if (!escolhido) return null;
  if (escolhido === "unassigned") return t("Sem responsável");
  const membro = (membros ?? []).find((m) => m.user_id === escolhido);
  if (!membro) return membros ? t("Outro responsável") : "…";
  return membro.full_name ?? t("Sem nome");
}

/**
 * ia.vek CRM-549 (Rodrigo 27/11: "celular recolhido, PC aberto como está") — o botão que abre e fecha o topo do
 * Pipeline. Só existe abaixo do `md` (768px): no PC ele não aparece. Com o topo recolhido, os selos dizem o que está
 * filtrando: o NOME do vendedor escolhido e "busca" (Lupa 111347, b).
 */
export function BotaoDoTopo({
  aberto,
  alternar,
  vendedor,
  comBusca,
}: {
  aberto: boolean;
  alternar: () => void;
  vendedor: string | null;
  comBusca: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={alternar}
      aria-expanded={aberto}
      aria-controls="topo-do-pipeline"
      className="inline-flex items-center gap-1 rounded-md border bg-surface px-3 py-1.5 text-sm font-medium md:hidden"
      data-testid="botao-do-topo"
    >
      {t("Filtros e números")}
      {vendedor && (
        <span className="max-w-32 truncate rounded-full bg-accent px-1.5 text-xs text-accent-foreground" data-testid="topo-vendedor">
          {vendedor}
        </span>
      )}
      {comBusca && (
        <span className="rounded-full bg-accent px-1.5 text-xs text-accent-foreground" data-testid="topo-com-busca">
          {t("busca")}
        </span>
      )}
      <ChevronDown aria-hidden className={cn("size-4 transition-transform", aberto && "rotate-180")} />
    </button>
  );
}

/**
 * O bloco que recolhe (contadores, seletor, busca e a faixa da compra futura; as faixas de sem dono e de pedidos de
 * ajuda ficam SEMPRE visíveis, fora dele: Lupa 111347, a). No PC (`md:contents`) o envoltório some do layout e os
 * filhos ficam no `gap-3` da página, como sempre estiveram; no celular, recolhido, o bloco fica escondido.
 */
export function TopoRecolhivel({ aberto, children }: { aberto: boolean; children: ReactNode }) {
  return (
    <div
      id="topo-do-pipeline"
      className={cn("flex flex-col gap-3 md:contents", !aberto && "max-md:hidden")}
      data-testid="topo-do-pipeline"
      data-aberto={aberto ? "" : undefined}
    >
      {children}
    </div>
  );
}
