"use client";
import { format, type Locale } from "date-fns";
import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { usePainelIavek } from "@/hooks/iavek/usePainelIavek";
import { cn } from "@/lib/utils";

/**
 * ia.vek v1.5: o ACOMPANHAMENTO do funil inteiro, na ficha do lead — etapa,
 * quem é o dono (IA, pessoa ou ninguém), o próximo passo e a linha de "entrou"
 * até "comprou" ou "não comprou (motivo)". Só lê: mover etapa e editar campos
 * seguem na seção "Negócio e dados da compra".
 */
export interface LeadDoAcompanhamento {
  id: string;
  title: string;
  status: string;
  created_at?: string;
  closed_at?: string | null;
  lost_reason?: string | null;
  won_reason?: string | null;
  owner_kind?: string | null;
  owner_name?: string | null;
  funil_nome: string | null;
  etapa_nome: string | null;
}

export interface ConversaDoAcompanhamento {
  assignee_kind: string | null;
  assigned_to_user_name?: string | null;
}

function dataCurta(
  iso: string | null | undefined,
  locale: Locale,
  padrao = "dd/MM/yy",
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, padrao, { locale });
}

export function AcompanhamentoDoLead({
  lead,
  conversa,
  contactId,
}: {
  lead: LeadDoAcompanhamento | null;
  conversa: ConversaDoAcompanhamento;
  contactId: string | null;
}) {
  const t = useT();
  const locale = useLocaleDeData();
  const { data: painel } = usePainelIavek(contactId);

  const quemAtende =
    conversa.assignee_kind === "ai"
      ? t("IA atendendo")
      : conversa.assigned_to_user_name
        ? conversa.assigned_to_user_name
        : t("Ninguém assumiu");

  const donoDoNegocio = !lead
    ? null
    : lead.owner_kind === "ai"
      ? t("IA")
      : lead.owner_name
        ? lead.owner_name
        : t("Sem dono");

  const passo = painel?.proximo_passo ?? null;

  const linhas: Array<{ marca: "inicio" | "agora" | "ganhou" | "perdeu"; texto: string }> = [];
  if (lead) {
    const entrou = dataCurta(lead.created_at, locale);
    if (entrou)
      linhas.push({ marca: "inicio", texto: t("Entrou em {data}").replace("{data}", entrou) });
    if (lead.status === "won") {
      linhas.push({
        marca: "ganhou",
        texto:
          t("Comprou em {data}").replace("{data}", dataCurta(lead.closed_at, locale) ?? "—") +
          (lead.won_reason ? ` · ${lead.won_reason}` : ""),
      });
    } else if (lead.status === "lost") {
      linhas.push({
        marca: "perdeu",
        texto:
          t("Não comprou em {data}").replace("{data}", dataCurta(lead.closed_at, locale) ?? "—") +
          ` · ${lead.lost_reason ? lead.lost_reason : t("motivo não informado")}`,
      });
    } else {
      linhas.push({
        marca: "agora",
        texto: t("Agora em {etapa}").replace("{etapa}", lead.etapa_nome ?? "—"),
      });
    }
  }

  return (
    <div className="mt-2 space-y-2 text-xs" data-testid="acompanhamento-do-lead">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t("Funil")}</dt>
        <dd className="truncate">
          {lead ? `${lead.funil_nome ?? "—"} · ${lead.etapa_nome ?? "—"}` : t("Sem negócio aberto")}
        </dd>
        <dt className="text-muted-foreground">{t("Atendimento")}</dt>
        <dd className="truncate">{quemAtende}</dd>
        {donoDoNegocio && (
          <>
            <dt className="text-muted-foreground">{t("Dono do negócio")}</dt>
            <dd className="truncate">{donoDoNegocio}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t("Próximo passo")}</dt>
        <dd
          className={cn("min-w-0", !passo && "text-warning-fg")}
          data-testid="acompanhamento-proximo-passo"
        >
          {passo
            ? `${passo.title}${passo.due_date ? ` · ${dataCurta(passo.due_date, locale, "dd/MM HH:mm")}` : ""}`
            : t("Nenhum marcado")}
        </dd>
      </dl>
      {linhas.length > 0 && (
        <ol className="space-y-1 border-l border-border pl-3" data-testid="acompanhamento-linha">
          {linhas.map((l, i) => (
            <li key={i} className="relative">
              <span
                aria-hidden
                className={cn(
                  "absolute top-1 -left-[17px] h-2 w-2 rounded-full border",
                  l.marca === "ganhou" && "border-success-fg bg-success-fg",
                  l.marca === "perdeu" && "border-error-fg bg-error-fg",
                  l.marca === "agora" && "border-accent bg-accent",
                  l.marca === "inicio" && "border-border-strong bg-background",
                )}
              />
              {l.texto}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
