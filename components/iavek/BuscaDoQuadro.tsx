"use client";
/**
 * ia.vek CRM-244 (Fase 4, teste G): a busca do quadro por nome, telefone e carro, em qualquer
 * coluna, com a QUANTIDADE encontrada e o botão de limpar. A regra mora em `casaBusca`
 * (lib/kanban/filters.ts); os totais em R$ seguem do funil inteiro (o quadro os recebe à parte).
 */
import { useCallback, useEffect, useState } from "react";

import { nomeDoCarro, useCatalogoDoCampo } from "@/components/contacts/CampoDoCatalogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import type { Lead } from "@/lib/types/leads";

/** O nome do carro de interesse de cada lead, para a busca (o catálogo que o cartão já lê, em cache). */
export function useNomeDoCarroDaBusca(ligado: boolean): (l: Lead) => string | null | undefined {
  const { data: produtos } = useCatalogoDoCampo(ligado);
  return useCallback(
    (l: Lead) => nomeDoCarro((l.custom_fields as Record<string, unknown> | null | undefined)?.carro_interesse, produtos) || null,
    [produtos],
  );
}

export function ResultadoDaBusca({ encontrados, onLimpar }: { encontrados: number; onLimpar: () => void }) {
  const t = useT();
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="resultado-da-busca">
      <span className="tabular-nums" data-testid="quantos-encontrados">
        {encontrados} {encontrados === 1 ? t("encontrado") : t("encontrados")}
      </span>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onLimpar} data-testid="limpar-busca">
        {t("Limpar busca")}
      </Button>
    </span>
  );
}

/** O campo da tela Pipeline (a tela de cada funil usa o da barra de filtros). */
export function BuscaDoQuadro({ valor, onChange, encontrados }: { valor: string; onChange: (v: string) => void; encontrados: number }) {
  const t = useT();
  const [texto, setTexto] = useState(valor);
  // Espera 250 ms de pausa, como a barra de filtros: não refaz o quadro a cada tecla.
  useEffect(() => {
    const id = setTimeout(() => texto !== valor && onChange(texto), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        placeholder={t("Buscar por nome, telefone ou carro…")}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="h-9 w-full sm:w-72"
        data-testid="busca-do-quadro"
      />
      {valor.trim() && (
        <ResultadoDaBusca
          encontrados={encontrados}
          onLimpar={() => {
            setTexto("");
            onChange("");
          }}
        />
      )}
    </div>
  );
}
