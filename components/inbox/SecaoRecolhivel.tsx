"use client";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { usePainelRecolhido } from "@/hooks/inbox/usePainelRecolhido";
import { CaretDown, CaretRight } from "@/lib/ui/icons";

/**
 * ia.vek v1.5: seção da ficha do lead que se recolhe e se abre de novo, com o
 * estado lembrado por usuário (mesmo mecanismo dos painéis da v1.4).
 */
export function SecaoRecolhivel({
  id,
  titulo,
  extra,
  testId,
  children,
}: {
  /** Estável: é a chave do estado lembrado. */
  id: string;
  titulo: string;
  /** Algo ao lado do título (ex.: o selo do cronômetro), visível mesmo recolhida. */
  extra?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const { recolhido, alternar } = usePainelRecolhido(`ficha-secao:${id}`, user?.id);
  return (
    <section data-testid={testId} data-secao={id} data-recolhida={recolhido ? "sim" : "nao"}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={!recolhido}
          className="-ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs font-semibold text-text hover:bg-surface-elevated focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          {recolhido ? (
            <CaretRight size={12} className="shrink-0 text-text-muted" aria-hidden />
          ) : (
            <CaretDown size={12} className="shrink-0 text-text-muted" aria-hidden />
          )}
          <h3 className="truncate">{titulo}</h3>
        </button>
        {extra}
      </div>
      {!recolhido && children}
    </section>
  );
}
