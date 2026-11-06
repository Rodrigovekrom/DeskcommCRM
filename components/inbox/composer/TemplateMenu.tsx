"use client";
import { useT } from "@/hooks/i18n/useT";
import type { MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { cn } from "@/lib/utils";

/** Estado do slash-menu a partir do texto do composer. Puro (testável). */
export function resolveSlash(text: string): { open: boolean; query: string } {
  if (!text.startsWith("/")) return { open: false, query: "" };
  const rest = text.slice(1);
  if (/\s/.test(rest)) return { open: false, query: "" };
  return { open: true, query: rest };
}

/** As respostas que casam com o que se digitou depois da "/" (título ou atalho). Puro. */
export function filtrarRespostas(templates: readonly MessageTemplate[], query: string): MessageTemplate[] {
  const q = query.toLowerCase();
  return templates.filter((tpl) => tpl.title.toLowerCase().includes(q) || (tpl.shortcut ?? "").toLowerCase().includes(q));
}

interface Props {
  open: boolean;
  query: string;
  templates: MessageTemplate[];
  onPick: (t: MessageTemplate) => void;
  onClose: () => void;
  /** ia.vek CRM-244 (Fase 3): "Criar resposta rápida", no topo, com ou sem respostas. */
  onCriar?: () => void;
  /** O item destacado pelas setas: Enter insere ESTE (sem enviar). */
  ativo?: number;
}

export function TemplateMenu({ open, query, templates, onPick, onClose: _onClose, onCriar, ativo = 0 }: Props) {
  const t = useT();
  if (!open) return null;
  const filtered = filtrarRespostas(templates, query);
  return (
    <div
      className="absolute bottom-14 left-3 z-20 max-h-64 w-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
      role="listbox"
      aria-label={t("Templates de script")}
      data-testid="menu-respostas-rapidas"
    >
      {onCriar && (
        <button
          type="button"
          className="sticky top-0 z-10 mb-1 flex w-full items-center gap-1.5 rounded-md border border-dashed bg-popover px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted"
          // `onMouseDown` + preventDefault: o campo não perde o foco antes do clique valer.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCriar}
          data-testid="criar-resposta-rapida"
        >
          + {t("Criar resposta rápida")}
        </button>
      )}
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {templates.length === 0 ? t("Você ainda não tem respostas rápidas.") : t("Nenhuma resposta com esse nome.")}
        </div>
      ) : (
        filtered.map((tpl, i) => (
          <button
            key={tpl.id}
            type="button"
            role="option"
            aria-selected={i === ativo}
            className={cn(
              "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-muted",
              i === ativo && "bg-muted",
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(tpl)}
            data-testid="resposta-rapida"
          >
            <span className="text-sm font-medium">{tpl.title}</span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{tpl.body}</span>
          </button>
        ))
      )}
    </div>
  );
}
