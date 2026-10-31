"use client";

import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { createContext, useContext } from "react";

import { AvisosDoCartao } from "@/components/iavek/AvisosDoCartao";
import { DadosDaCompraNoCard, DadosDaCompraNoCardContext } from "@/components/iavek/DadosDaCompraNoCard";
import { ConversaNoQuadroContext } from "@/components/iavek/conversa-no-quadro-contexto";
import { SeloIncompleto } from "@/components/iavek/CamposObrigatorios";
import { ResponsavelNoCartao } from "@/components/iavek/ResponsavelDoLead";
import { useNomeDoCarro } from "@/components/contacts/CampoDoCatalogo";
import { temAlvoParaAbrir } from "@/components/kanban/AbrirConversaDoLead";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import type { OwnerDisplay } from "@/lib/kanban/owner";
import type { Lead } from "@/lib/types/leads";
import { ChatCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/**
 * ia.vek v1.8.2 — o CARTÃO DO VENDEDOR (Pipeline e Funil).
 *
 * Pedido do Rodrigo, nesta ordem: nome do lead — responsável; último horário
 * falado; forma de pagamento (e troca); carro de interesse; e o botão GRANDE
 * "Abrir conversa", da largura do cartão (fácil de tocar no celular). O selo do
 * padrão da loja fica pequeno, na linha dos chips.
 *
 * Só onde a página liga o contexto (os dois quadros do ia.vek). Fora dele o
 * cartão segue o de sempre — e os testes do quadro upstream continuam valendo.
 */
export const CartaoIavekContext = createContext(false);

/** "IA", o nome do vendedor, ou "Sem dono". */
export function rotuloDoResponsavel(owner: OwnerDisplay, t: (s: string) => string): string {
  if (owner.kind === "ai") return t("IA");
  if (owner.kind === "user" || owner.name) return owner.name ?? t("Vendedor");
  return t("Sem dono");
}

/** "hoje 14:32", "ontem 09:10" ou "22/10 18:00" — no fuso de quem olha. */
export function quandoFalou(
  iso: string | null | undefined,
  idioma: string,
  t: (s: string) => string = (s) => s,
  agora: Date = new Date(),
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const hora = new Intl.DateTimeFormat(idioma, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const dia = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (dia(d) === dia(agora)) return `${t("hoje")} ${hora}`;
  if (dia(d) === dia(ontem)) return `${t("ontem")} ${hora}`;
  const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${ddmm} ${hora}`;
}

export function CorpoDoCartaoIavek({ lead, pipelineId }: { lead: Lead; pipelineId: string }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const abrirNoQuadro = useContext(ConversaNoQuadroContext);
  const campos = (lead.custom_fields ?? {}) as Record<string, unknown>;
  // v1.8.3: o campo guarda o id do produto; o cartão mostra o nome do catálogo.
  const carro = useNomeDoCarro(campos.carro_interesse);
  const { lojaDeCarros } = usePerfilDaEmpresa();
  const falou = quandoFalou(lead.conversa?.last_message_at ?? null, idioma, t);
  const naoLidas = lead.conversa?.unread ?? 0;
  // Há com quem conversar: conversa já existe, ou contato com quem iniciar.
  const podeAbrir = lead.conversa != null || temAlvoParaAbrir(lead.contact_id, lead.contact_phone);
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="mt-1 flex flex-col gap-1.5 text-xs" data-testid="cartao-iavek" data-lead-id={lead.id}>
      <p className="text-text-muted" data-testid="ultimo-horario">
        {falou ? (
          <>
            {t("Falou")}: <span className="font-medium text-text">{falou}</span>
          </>
        ) : (
          t("Ainda sem conversa")
        )}
      </p>
      {/* ia.vek v1.9.5 (CRM-196): responsável com a função, guardião e objetivo atual. */}
      {lojaDeCarros && (
        <ResponsavelNoCartao
          pipelineId={pipelineId}
          leadId={lead.id}
          donoId={lead.owner_user_id ?? null}
          guardiaoId={(lead as { sdr_user_id?: string | null }).sdr_user_id ?? null}
        />
      )}
      <DadosDaCompraNoCardContext.Provider value={{ ligado: true }}>
        <DadosDaCompraNoCard lead={lead} pipelineId={pipelineId} />
      </DadosDaCompraNoCardContext.Provider>
      <SeloIncompleto leadId={lead.id} />
      {/* ia.vek v1.9.8 (CRM-218): "sem tarefa" e "parado há N dias". */}
      <AvisosDoCartao lead={lead} />
      {lojaDeCarros && (
        <p className="truncate" data-testid="carro-de-interesse" title={carro ?? undefined}>
          <span className="text-text-muted">{t("Carro")}:</span>{" "}
          {carro ? <span className="font-medium text-text">{carro}</span> : <span className="text-text-muted">—</span>}
        </p>
      )}
      <button
        type="button"
        disabled={!podeAbrir || !abrirNoQuadro}
        onClick={(e) => {
          parar(e);
          abrirNoQuadro?.(lead.id);
        }}
        onPointerDown={parar}
        title={podeAbrir ? t("Abrir a conversa aqui, sem sair do quadro") : t("Este lead não tem contato: não há com quem conversar.")}
        className={cn(
          "mt-0.5 flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors",
          podeAbrir
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "cursor-not-allowed border border-dashed text-text-muted",
        )}
        data-testid="botao-abrir-conversa"
      >
        <ChatCircle size={16} aria-hidden />
        {podeAbrir ? t("Abrir conversa") : t("Sem contato")}
        {naoLidas > 0 && (
          <span
            className="rounded-full bg-primary-foreground px-1.5 text-[11px] font-bold text-primary tabular-nums"
            aria-label={`${naoLidas} ${t("sem ler")}`}
          >
            {naoLidas}
          </span>
        )}
      </button>
    </div>
  );
}
