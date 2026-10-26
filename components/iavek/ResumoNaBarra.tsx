"use client";

import { SeloIncompleto, useCamposQueFaltam } from "@/components/iavek/CamposObrigatorios";
import { useNomeDoCarro } from "@/components/contacts/CampoDoCatalogo";
import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { useT } from "@/hooks/i18n/useT";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { camposSempreVisiveis, type CampoDaBarra } from "@/lib/iavek/barra-lateral";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { formatValorDoNegocio } from "@/lib/money";

/** O lead como a barra o recebe (rota crm-summary). */
export interface LeadDaBarra {
  id: string;
  updated_at?: string | null;
  custom_fields: Record<string, unknown> | null;
  etapa_nome: string | null;
  owner_kind?: string | null;
  owner_name?: string | null;
  guardiao_name?: string | null;
  tags?: string[] | null;
}

/**
 * ia.vek v1.8.2 — o topo SEMPRE VISÍVEL da barra lateral da conversa. A lista e
 * a ordem vêm de `CAMPOS_SEMPRE_VISIVEIS` (lib/iavek/barra-lateral.ts); o resto
 * da ficha fica em "Ver mais".
 */
export function ResumoNaBarra({
  nome,
  telefone,
  tagsDoContato,
  lead,
  observacoes,
}: {
  nome: string;
  telefone: string | null;
  tagsDoContato: string[];
  lead: LeadDaBarra | null;
  observacoes: Array<{ id: string; headline: string; body: string }>;
}) {
  const t = useT();
  const { lojaDeCarros } = usePerfilDaEmpresa();
  // v1.8.2 (bloco 6): o selo "Incompleto" do lead desta conversa.
  const { data: obrigatorios } = useCamposQueFaltam(lead ? [lead.id] : [], lead?.updated_at ?? "");
  const faltam = lead && obrigatorios?.ativo ? (obrigatorios.leads[lead.id] ?? []) : [];
  const campos = lead?.custom_fields ?? {};
  const texto = (k: string) => (typeof campos[k] === "string" && (campos[k] as string).trim() ? (campos[k] as string).trim() : null);
  const carro = useNomeDoCarro(campos.carro_interesse);
  const parcela = typeof campos.parcela_desejavel === "number" ? campos.parcela_desejavel : Number(campos.parcela_desejavel);
  const tags = [...new Set([...(lead?.tags ?? []), ...tagsDoContato])];

  function rotulo(k: CampoDaBarra): string {
    switch (k) {
      case "nome": return t("Nome");
      case "telefone": return t("Telefone");
      case "carro_interesse": return t("Carro de interesse");
      case "etapa": return t("Etapa do funil");
      case "vendedor": return t("Vendedor responsável");
      case "guardiao": return t("Guardião");
      case "forma_pagamento": return t("Forma de pagamento");
      case "parcela_desejavel": return t("Parcela desejável");
      case "tags": return t("Tags");
      case "observacoes": return t("Observações / contexto");
    }
  }

  function valor(k: CampoDaBarra): React.ReactNode {
    switch (k) {
      case "nome": return nome;
      case "telefone": return telefone ? phoneForDisplay(telefone) : null;
      case "carro_interesse": return carro;
      case "etapa": return lead?.etapa_nome ?? null;
      case "vendedor": return lead?.owner_kind === "ai" ? t("IA") : (lead?.owner_name ?? (lead ? t("Sem dono") : null));
      case "guardiao": return lead?.guardiao_name ?? null;
      case "forma_pagamento": {
        // Literais por opção: a chave de t() nunca é montada em runtime (cerca i18n).
        const ROTULO: Record<string, string> = { a_vista: t("À vista"), financiamento: t("Financiado"), consorcio: t("Consórcio") };
        return typeof campos.forma_pagamento === "string" ? (ROTULO[campos.forma_pagamento] ?? campos.forma_pagamento) : null;
      }
      case "parcela_desejavel":
        return Number.isFinite(parcela) && parcela > 0 ? formatValorDoNegocio(Math.round(parcela * 100), "BRL", { semCentavos: true }) : null;
      case "tags":
        return tags.length ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((tg) => <ChipDeEtiqueta key={tg} tag={tg} className="h-4 px-1.5 text-[10px]" />)}
          </span>
        ) : null;
      case "observacoes":
        return observacoes.length ? (
          <span className="flex flex-col gap-0.5">
            {observacoes.slice(0, 3).map((o) => (
              <span key={o.id} className="line-clamp-2" title={o.body}>{o.headline || o.body}</span>
            ))}
            {observacoes.length > 3 && <span className="text-muted-foreground">+{observacoes.length - 3}</span>}
          </span>
        ) : null;
    }
  }

  return (
    <div className="flex flex-col gap-2">
    {lead && faltam.length > 0 && <SeloIncompleto leadId={lead.id} faltam={faltam} />}
    <dl className="grid grid-cols-[minmax(0,7.5rem)_1fr] gap-x-2 gap-y-1.5 rounded-md border p-3 text-xs" data-testid="resumo-na-barra">
      {camposSempreVisiveis(lojaDeCarros).map((k) => {
        const v = valor(k);
        return (
          <div key={k} className="contents" data-campo={k}>
            <dt className="text-muted-foreground">{rotulo(k)}</dt>
            <dd className="min-w-0 break-words font-medium">{v ?? <span className="font-normal text-muted-foreground">—</span>}</dd>
          </div>
        );
      })}
    </dl>
    </div>
  );
}
