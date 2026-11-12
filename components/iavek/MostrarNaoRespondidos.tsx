"use client";
import { useT } from "@/hooks/i18n/useT";
import type { MostrarDoPipeline } from "@/lib/iavek/filtro-nao-respondidos";

// valores das preferências (não é texto da tela)
const SO_NAO_RESPONDIDOS: MostrarDoPipeline = "nao_respondidos";
const TODOS: MostrarDoPipeline = "todos";

/**
 * ia.vek v1.9.50 — o botão do topo do Pipeline: "Não respondidos (N) | Todos (M)", e o aviso
 * "mostrando N de M (só os não respondidos)" quando o filtro está ligado. O padrão é "Não respondidos";
 * a escolha é gravada nas preferências de tela de cada pessoa.
 */
export function MostrarNaoRespondidos({
  mostrar,
  naoRespondidos,
  todos,
  onMudar,
}: {
  mostrar: MostrarDoPipeline;
  naoRespondidos: number;
  todos: number;
  onMudar: (m: MostrarDoPipeline) => void;
}) {
  const t = useT();
  const opcao = (valor: MostrarDoPipeline, rotulo: string, n: number) => (
    <button
      type="button"
      role="radio"
      aria-checked={mostrar === valor}
      className={`px-3 py-1 text-sm ${mostrar === valor ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
      onClick={() => mostrar !== valor && onMudar(valor)}
      data-testid={`mostrar-${valor}`}
    >
      {rotulo} (<span className="tabular-nums">{n}</span>)
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="mostrar-nao-respondidos">
      <div role="radiogroup" aria-label={t("Mostrar")} className="flex overflow-hidden rounded-md border divide-x">
        {opcao(SO_NAO_RESPONDIDOS, t("Não respondidos"), naoRespondidos)}
        {opcao(TODOS, t("Todos"), todos)}
      </div>
      {mostrar === SO_NAO_RESPONDIDOS && (
        <span className="text-xs text-muted-foreground" data-testid="aviso-mostrando">
          {t("mostrando")} <span className="tabular-nums">{naoRespondidos}</span> {t("de")}{" "}
          <span className="tabular-nums">{todos}</span> ({t("só os não respondidos")})
        </span>
      )}
    </div>
  );
}

/** A marca do cartão do lead aberto sem conversa nenhuma: ninguém falou com ele ainda. */
export function MarcaSemConversa() {
  const t = useT();
  return (
    <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400" data-testid="marca-sem-conversa">
      <span className="h-2 w-2 shrink-0 rounded-full border border-amber-500" aria-hidden />
      {t("sem conversa")}
    </p>
  );
}
