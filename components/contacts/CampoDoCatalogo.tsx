"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import { formatCents } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "@/lib/ui/icons";

/**
 * ia.vek v1.5: o campo do funil do tipo `catalog_product` — o CARRO DE
 * INTERESSE ligado ao catálogo. Grava no `custom_fields` só o `id` do produto;
 * nome, marca e preço vêm do catálogo na hora de mostrar (o preço muda com o
 * estoque do Altimus, e uma cópia gravada no lead mentiria).
 *
 * O catálogo é lido inteiro (a rota devolve até 500 itens) e filtrado aqui: a
 * loja tem dezenas de carros, e buscar a cada tecla no servidor não compensa.
 */
interface ProdutoDoCampo {
  id: string;
  codigo: string | null;
  nome: string;
  marca: string | null;
  preco_cents: number | null;
  moeda: string | null;
  ativo: boolean;
}

export function useCatalogoDoCampo(ligado: boolean) {
  return useQuery({
    queryKey: ["iavek", "catalogo-do-campo"],
    queryFn: () =>
      apiClient.get<{ data: ProdutoDoCampo[] }>("/api/v1/products").then((r) => r.data),
    enabled: ligado,
    staleTime: 5 * 60_000,
  });
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filtrarCatalogo(
  produtos: ProdutoDoCampo[],
  termo: string,
  limite = 8,
): ProdutoDoCampo[] {
  const partes = normalizar(termo).split(/\s+/).filter(Boolean);
  const ativos = produtos.filter((p) => p.ativo);
  if (partes.length === 0) return ativos.slice(0, limite);
  return ativos
    .filter((p) => {
      const alvo = normalizar(`${p.nome} ${p.marca ?? ""} ${p.codigo ?? ""}`);
      return partes.every((parte) => alvo.includes(parte));
    })
    .slice(0, limite);
}

export function CampoDoCatalogo({
  id,
  valor,
  onChange,
  disabled,
}: {
  id: string;
  valor: unknown;
  onChange: (produtoId: string | null) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { data: produtos, isError } = useCatalogoDoCampo(true);
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const escolhido = useMemo(
    () =>
      typeof valor === "string" ? ((produtos ?? []).find((p) => p.id === valor) ?? null) : null,
    [produtos, valor],
  );
  const opcoes = useMemo(() => filtrarCatalogo(produtos ?? [], termo), [produtos, termo]);

  if (typeof valor === "string" && valor && !aberto) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
        data-testid="carro-escolhido"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {escolhido ? escolhido.nome : produtos ? t("Carro fora do catálogo") : t("Carregando…")}
          </div>
          {escolhido && (
            <div className="truncate text-xs text-muted-foreground">
              {[escolhido.marca, escolhido.codigo].filter(Boolean).join(" · ")}
              {escolhido.preco_cents != null &&
                ` · ${formatCents(escolhido.preco_cents, escolhido.moeda ?? "BRL")}`}
            </div>
          )}
        </div>
        {!disabled && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAberto(true)}
            >
              {t("Trocar")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              aria-label={t("Limpar o carro de interesse")}
              onClick={() => onChange(null)}
            >
              <X size={14} aria-hidden />
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Input
        id={id}
        value={termo}
        autoFocus={aberto}
        disabled={disabled}
        placeholder={t("Buscar no catálogo (modelo, marca ou código)…")}
        onChange={(e) => setTermo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAberto(false);
        }}
      />
      {isError && <p className="text-xs text-error-fg">{t("Não consegui ler o catálogo.")}</p>}
      {!disabled && (termo.trim() !== "" || aberto) && (
        <ul className="max-h-56 overflow-y-auto rounded-md border border-border" role="listbox">
          {opcoes.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("Nenhum carro encontrado.")}
            </li>
          ) : (
            opcoes.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === valor}
                  className="flex w-full flex-col items-start px-2 py-1.5 text-left text-sm hover:bg-surface-elevated"
                  onClick={() => {
                    onChange(p.id);
                    setTermo("");
                    setAberto(false);
                  }}
                >
                  <span className="font-medium">{p.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {[p.marca, p.codigo].filter(Boolean).join(" · ")}
                    {p.preco_cents != null && ` · ${formatCents(p.preco_cents, p.moeda ?? "BRL")}`}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
