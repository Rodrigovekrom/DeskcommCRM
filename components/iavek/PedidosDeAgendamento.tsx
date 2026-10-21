"use client";
/**
 * ia.vek v1.7.6 — o bloco "Pedidos de agendamento" do Meu dia.
 *
 * O ADMIN vê os pedidos pendentes da loja e decide: Confirmar (um clique, com
 * o dia e a hora do pedido), Remarcar (confirma em outro horário) ou Recusar
 * (com motivo). Quem não é admin vê os PRÓPRIOS pedidos e em que pé estão.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";

export interface PedidoDaLista {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  quando: string;
  event_type_id: string | null;
  observacao: string | null;
  origem: "pessoa" | "ia";
  status: "pendente" | "confirmado" | "recusado" | "cancelado";
  motivo_da_recusa: string | null;
  contato_nome: string | null;
  pedido_por_nome: string | null;
}

interface TipoDeAtendimento {
  id: string;
  name: string;
  is_active?: boolean;
}

const CHAVE = ["iavek", "pedidos-de-agendamento"] as const;

function quandoLegivel(iso: string, idioma: string): string {
  return new Date(iso).toLocaleString(idioma, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function PedidosDeAgendamento() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: () =>
      apiClient
        .get<{ data: { pedidos: PedidoDaLista[]; pode_decidir: boolean } }>(
          "/api/v1/iavek/pedidos-de-agendamento",
        )
        .then((r) => r.data),
    refetchInterval: 60_000,
  });
  const { data: tipos } = useQuery({
    queryKey: ["iavek", "tipos-de-atendimento"],
    queryFn: () =>
      apiClient
        .get<{ data: TipoDeAtendimento[] }>("/api/v1/agenda/tipos")
        .then((r) => (r.data ?? []).filter((x) => x.is_active !== false)),
    enabled: Boolean(data?.pode_decidir),
  });
  if (!data) return null;
  const podeDecidir = data.pode_decidir;
  const pedidos = podeDecidir ? data.pedidos.filter((p) => p.status === "pendente") : data.pedidos;
  if (!podeDecidir && pedidos.length === 0) return null;

  const recarregar = () => void qc.invalidateQueries({ queryKey: CHAVE });

  return (
    <section
      className="rounded-lg border border-border bg-background p-3"
      data-testid="bloco-pedidos-de-agendamento"
    >
      <h2 className="text-sm font-semibold">
        {podeDecidir ? t("Pedidos de agendamento") : t("Meus pedidos de agendamento")}{" "}
        <span className="text-muted-foreground">({pedidos.length})</span>
      </h2>
      {pedidos.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t("Nenhum pedido esperando.")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {pedidos.map((p) => (
            <LinhaDoPedido
              key={p.id}
              pedido={p}
              podeDecidir={podeDecidir}
              tipos={tipos ?? []}
              onMudou={recarregar}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaDoPedido({
  pedido,
  podeDecidir,
  tipos,
  onMudou,
}: {
  pedido: PedidoDaLista;
  podeDecidir: boolean;
  tipos: TipoDeAtendimento[];
  onMudou: () => void;
}) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [modo, setModo] = useState<"nada" | "remarcar" | "recusar">("nada");
  const [tipoId, setTipoId] = useState(pedido.event_type_id ?? "");
  const [novoQuando, setNovoQuando] = useState(paraCampoLocal(new Date(pedido.quando)));
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function decidir(corpo: Record<string, unknown>, sucesso: string) {
    setEnviando(true);
    try {
      await apiClient.post(`/api/v1/iavek/pedidos-de-agendamento/${pedido.id}`, corpo);
      toast.success(sucesso);
      setModo("nada");
      onMudou();
    } catch (e) {
      showApiError(e);
    } finally {
      setEnviando(false);
    }
  }

  const confirmar = (startsAt?: string) =>
    decidir(
      {
        acao: "confirmar",
        ...(tipoId ? { event_type_id: tipoId } : {}),
        ...(startsAt ? { starts_at: startsAt } : {}),
      },
      startsAt ? t("Agendamento remarcado e confirmado.") : t("Agendamento confirmado."),
    );

  return (
    <li className="space-y-2 py-2 text-sm" data-testid="pedido-de-agendamento">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{pedido.contato_nome ?? t("Cliente")}</div>
          <div className="text-xs text-muted-foreground">
            {quandoLegivel(pedido.quando, idioma)}
            {pedido.pedido_por_nome ? ` · ${t("pedido por")} ${pedido.pedido_por_nome}` : ""}
          </div>
          {pedido.observacao && <div className="text-xs">{pedido.observacao}</div>}
          {!podeDecidir && (
            <div className="text-xs text-muted-foreground">
              {pedido.status === "pendente"
                ? t("Aguardando o administrador")
                : pedido.status === "confirmado"
                  ? t("Confirmado")
                  : pedido.status === "recusado"
                    ? t("Recusado")
                    : t("Cancelado")}
              {pedido.motivo_da_recusa ? `: ${pedido.motivo_da_recusa}` : ""}
            </div>
          )}
        </div>
        {podeDecidir && modo === "nada" && (
          <div className="flex flex-wrap items-center gap-2">
            {!pedido.event_type_id && (
              <select
                aria-label={t("Tipo de atendimento")}
                value={tipoId}
                onChange={(e) => setTipoId(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="">{t("Tipo…")}</option>
                {tipos.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              onClick={() => void confirmar()}
              disabled={enviando || !tipoId}
              data-testid="confirmar-pedido"
            >
              {t("Confirmar")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setModo("remarcar")}
              disabled={enviando}
            >
              {t("Remarcar")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setModo("recusar")}
              disabled={enviando}
            >
              {t("Recusar")}
            </Button>
          </div>
        )}
      </div>
      {podeDecidir && modo === "remarcar" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="datetime-local"
            aria-label={t("Novo dia e hora")}
            value={novoQuando}
            onChange={(e) => setNovoQuando(e.target.value)}
            className="h-8 w-auto text-xs"
          />
          <Button
            size="sm"
            onClick={() => void confirmar(new Date(novoQuando).toISOString())}
            disabled={enviando || !tipoId || !novoQuando}
          >
            {t("Confirmar neste horário")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModo("nada")}>
            {t("Cancelar")}
          </Button>
        </div>
      )}
      {podeDecidir && modo === "recusar" && (
        <div className="space-y-2">
          <textarea
            aria-label={t("Motivo da recusa")}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full rounded-md border border-border bg-background p-2 text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => void decidir({ acao: "recusar", motivo }, t("Pedido recusado."))}
              disabled={enviando || motivo.trim().length < 3}
            >
              {t("Recusar pedido")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setModo("nada")}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
