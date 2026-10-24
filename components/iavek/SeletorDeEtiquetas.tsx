"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { PontoDaEtiqueta } from "@/components/tags/PontoDaEtiqueta";
import { Input } from "@/components/ui/input";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { X } from "@/lib/ui/icons";

/**
 * ia.vek v1.8.3 — as etiquetas do lead no "Editar campos" viram SELETOR.
 *
 * Era um campo de texto ("separadas por vírgula"): o vendedor digitava um nome
 * que não existia, a escrita recusava (só o admin cria etiqueta, v1.7.6) e o
 * Salvar INTEIRO falhava, levando junto carro, parcela e o resto. Agora quem
 * não é admin só escolhe do que existe (`/api/v1/tags/existentes`, a mesma
 * régua da recusa); o admin segue podendo criar digitando e apertando Enter.
 */
export function useEtiquetasExistentes() {
  return useQuery({
    queryKey: ["iavek", "etiquetas-existentes"],
    queryFn: () => apiClient.get<{ data: string[] }>("/api/v1/tags/existentes").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

const normal = (s: string) => s.trim().toLowerCase();

/** As sugestões: existentes que ainda não estão no lead e casam com o termo (puro, testável). */
export function sugestoesDeEtiqueta(
  existentes: readonly string[],
  escolhidas: readonly string[],
  termo: string,
  limite = 12,
): string[] {
  const ja = new Set(escolhidas.map(normal));
  const n = normal(termo);
  return existentes.filter((e) => !ja.has(normal(e)) && (!n || normal(e).includes(n))).slice(0, limite);
}

export function SeletorDeEtiquetas({
  id,
  valor,
  onChange,
}: {
  id: string;
  valor: string[];
  onChange: (tags: string[]) => void;
}) {
  const t = useT();
  const podeCriar = useActiveOrg()?.role === "admin";
  const { data, isError } = useEtiquetasExistentes();
  // Resposta que não é lista (rota antiga, erro mascarado) vira "nenhuma": a tela não cai.
  const existentes = Array.isArray(data) ? data : [];
  const [termo, setTermo] = useState("");
  const sugestoes = sugestoesDeEtiqueta(existentes, valor, termo);
  const existe = (s: string) => existentes.find((e) => normal(e) === normal(s));

  function acrescentar(tag: string) {
    const limpa = tag.trim();
    if (!limpa || valor.some((v) => normal(v) === normal(limpa))) return;
    onChange([...valor, limpa]);
    setTermo("");
  }

  const termoNovo = termo.trim() && !existe(termo);

  return (
    <div className="space-y-2" data-testid="seletor-de-etiquetas">
      <div className="flex flex-wrap gap-1">
        {valor.length > 0 ? (
          valor.map((tag) => (
            <ChipDeEtiqueta key={tag} tag={tag} className="h-6 gap-1 px-2 text-xs">
              <button
                type="button"
                onClick={() => onChange(valor.filter((v) => v !== tag))}
                aria-label={`${t("Remover tag")} ${tag}`}
                className="rounded-sm hover:text-destructive"
              >
                <X size={12} weight="bold" aria-hidden />
              </button>
            </ChipDeEtiqueta>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("Nenhuma etiqueta.")}</span>
        )}
      </div>
      <Input
        id={id}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Enter nunca envia o formulário daqui: escolhe a etiqueta.
          e.preventDefault();
          const achada = existe(termo);
          if (achada) acrescentar(achada);
          else if (podeCriar) acrescentar(termo);
          else if (sugestoes.length === 1) acrescentar(sugestoes[0]!);
        }}
        placeholder={t("Buscar etiqueta…")}
        className="h-8 text-sm"
      />
      {isError && <p className="text-xs text-error-fg">{t("Não foi possível carregar as etiquetas.")}</p>}
      {sugestoes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sugestoes.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => acrescentar(tag)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-solid hover:text-foreground"
            >
              <PontoDaEtiqueta tag={tag} />+ {tag}
            </button>
          ))}
        </div>
      )}
      {termoNovo &&
        (podeCriar ? (
          <p className="text-xs text-muted-foreground">{t("Enter cria a etiqueta nova.")}</p>
        ) : (
          sugestoes.length === 0 && (
            <p className="text-xs text-muted-foreground" data-testid="so-admin-cria">
              {t("Só o administrador cria etiquetas novas. Escolha uma etiqueta da lista.")}
            </p>
          )
        ))}
    </div>
  );
}
