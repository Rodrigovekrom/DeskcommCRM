"use client";
import { createContext, useContext, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/i18n/useT";
import { formatValorDoNegocio, MOEDA_PADRAO } from "@/lib/money";
import type { Lead } from "@/lib/types/leads";

export interface ColunaDoMenu {
  id: string;
  nome: string;
  quantidade: number;
  totalCents: number;
}

export const MoverNoQuadroContext = createContext<{
  colunas: ColunaDoMenu[];
  mover: (lead: Lead, etapaId: string) => void;
  congelar: (sim: boolean) => void;
} | null>(null);

/** ia.vek v1.9.18: "Mover para a coluna:", a alternativa segura ao arrasto. */
export function MoverParaColuna({ lead }: { lead: Lead }) {
  const t = useT();
  const ctx = useContext(MoverNoQuadroContext);
  const [aberto, setAberto] = useState(false);
  if (!ctx) return null;
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    // O menu abre em portal, mas o evento do React sobe pela árvore dos componentes: sem
    // parar o clique e a tecla aqui, escolher uma coluna também abria o dossiê do cartão.
    <div
      className="flex justify-end"
      onClick={parar}
      onKeyDown={parar}
      onPointerDown={parar}
      onMouseDown={parar}
      onTouchStart={parar}
    >
      <DropdownMenu
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          ctx.congelar(v);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 px-2 text-xs md:h-7"
            onClick={parar}
            data-testid="mover-para-coluna"
          >
            {t("Mover para a coluna:")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
          {ctx.colunas.map((c) => (
            <DropdownMenuItem
              key={c.id}
              disabled={c.id === lead.stage_id}
              className="min-h-11 justify-between gap-3 md:min-h-8"
              onSelect={() => ctx.mover(lead, c.id)}
              data-testid="coluna-do-menu"
            >
              <span className="truncate">
                {c.id === lead.stage_id ? "✓ " : ""}
                {c.nome}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {c.quantidade} · {formatValorDoNegocio(c.totalCents, MOEDA_PADRAO, { semCentavos: true })}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
