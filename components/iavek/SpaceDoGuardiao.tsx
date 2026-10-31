"use client";
/**
 * ia.vek v1.9.7 — o SPACE DO GUARDIÃO (opção B, Rodrigo 30/10): uma lista só,
 * por urgência, dos leads que o guardião passou aos vendedores, com filtro de
 * vendedor, o cronômetro das horas do ciclo e "Passar a outro vendedor" com
 * motivo (o mesmo POST do CRM-209). Objetivo: nenhum lead passa das 72h sem
 * um sim ou um não do cliente. Quem decide o que entra é o servidor.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { textoDoRestante } from "@/lib/iavek/cronometro-72h";
import { urgencia, type LinhaDoSpace } from "@/lib/iavek/space-do-guardiao";
import { cn } from "@/lib/utils";

interface Resposta {
  horas: number;
  linhas: LinhaDoSpace[];
  vendedores: Array<{ id: string; nome: string }>;
}

const CHAVE = ["iavek", "space-do-guardiao"] as const;
const SELECT = "h-9 w-full rounded-md border border-border bg-background px-2 text-sm";
const COR = {
  folga: "border-success-fg/30 bg-success-bg text-success-fg",
  atencao: "border-warning-fg/30 bg-warning-bg text-warning-fg",
  urgente: "border-error-fg/30 bg-error-bg text-error-fg",
} as const;

export function SpaceDoGuardiao() {
  const t = useT();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  const [trocando, setTrocando] = useState<LinhaDoSpace | null>(null);
  const [novo, setNovo] = useState("");
  const [motivo, setMotivo] = useState("");
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<{ data: Resposta }>("/api/v1/iavek/space-do-guardiao").then((r) => r.data),
    refetchInterval: 60_000,
  });

  const passar = useMutation({
    mutationFn: (l: LinhaDoSpace) =>
      apiClient.post("/api/v1/iavek/passagem", {
        lead_id: l.lead_id,
        tipo: "trocar_vendedor",
        vendedor_id: novo,
        motivo: motivo.trim(),
      }),
    onSuccess: () => {
      toast.success(t("Passagem feita."));
      setTrocando(null);
      void qc.invalidateQueries({ queryKey: ["iavek"] });
    },
    onError: showApiError,
  });

  function abrirTroca(l: LinhaDoSpace) {
    setNovo("");
    setMotivo("");
    setTrocando(l);
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || !data)
    return (
      <div className="space-y-2 p-6">
        <p className="text-sm text-muted-foreground">{t("Não foi possível carregar.")}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("Tentar de novo")}
        </Button>
      </div>
    );

  const linhas = data.linhas.filter((l) => !filtro || l.vendedor?.id === filtro);
  const ativos = data.linhas.filter((l) => l.estado !== "followup");
  const urgentes = ativos.filter(
    (l) => l.estado === "vencido" || (l.estado === "correndo" && Date.parse(l.fim_das_horas) - agora <= 6 * 3_600_000),
  ).length;
  const noFollowup = data.linhas.length - ativos.length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6" data-testid="space-do-guardiao">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("Space do guardião")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Os leads que você passou aos vendedores. O que vence primeiro fica no topo: nenhum lead passa das {horas}h sem um sim ou um não do cliente.").replace(
            "{horas}",
            String(data.horas),
          )}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label={t("Vendedor")}
          className={cn(SELECT, "w-auto min-w-56")}
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          data-testid="space-filtro-vendedor"
        >
          <option value="">{t("Todos os vendedores")}</option>
          {data.vendedores.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nome}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground" data-testid="space-resumo">
          {t("Com os vendedores")}: <strong className="text-foreground">{ativos.length}</strong> ·{" "}
          {t("Vencem em menos de 6h")}: <strong className="text-foreground">{urgentes}</strong> ·{" "}
          {t("Já no Follow-up")}: <strong className="text-foreground">{noFollowup}</strong>
        </p>
      </div>

      {linhas.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-6 text-sm text-muted-foreground">
          {t("Nenhum lead passado a vendedores por aqui.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("Cliente")}</th>
                <th className="px-3 py-2 font-medium">{t("Vendedor")}</th>
                <th className="px-3 py-2 font-medium">{t("Etapa")}</th>
                <th className="px-3 py-2 font-medium">{t("Prazo")}</th>
                <th className="px-3 py-2 font-medium">{t("Ações")}</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <Linha key={l.lead_id} l={l} agora={agora} onPassar={() => abrirTroca(l)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={trocando !== null} onOpenChange={(o) => !o && setTrocando(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Passar a outro vendedor")}</DialogTitle>
            <DialogDescription>
              {trocando?.cliente ?? t("Cliente sem nome")} · {t("hoje com")} {trocando?.vendedor?.nome ?? "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="space-novo-vendedor">{t("Novo vendedor")}</Label>
              <select
                id="space-novo-vendedor"
                className={SELECT}
                value={novo}
                onChange={(e) => setNovo(e.target.value)}
                data-testid="space-novo-vendedor"
              >
                <option value="">{t("Escolha o vendedor")}</option>
                {data.vendedores
                  .filter((v) => v.id !== trocando?.vendedor?.id)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="space-motivo">{t("Motivo (ex.: vendedor sem ação)")}</Label>
              <Input id="space-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="space-motivo" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTrocando(null)}>
              {t("Cancelar")}
            </Button>
            <Button
              disabled={!novo || motivo.trim().length < 3 || passar.isPending}
              onClick={() => trocando && passar.mutate(trocando)}
              data-testid="space-confirmar"
            >
              {passar.isPending ? t("Passando…") : t("Passar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Linha({ l, agora, onPassar }: { l: LinhaDoSpace; agora: number; onPassar: () => void }) {
  const t = useT();
  const restante = Date.parse(l.fim_das_horas) - agora;
  const { texto } = textoDoRestante(restante);
  const prazo =
    l.estado === "followup"
      ? { texto: t("Foi para o Follow-up"), classe: "border-border bg-muted text-muted-foreground" }
      : l.estado === "compromisso"
        ? { texto: t("Em compromisso"), classe: "border-border bg-surface text-foreground" }
        : restante <= 0
          ? { texto: t("venceu há {tempo}").replace("{tempo}", texto), classe: COR.urgente }
          : { texto: t("faltam {tempo}").replace("{tempo}", texto), classe: COR[urgencia(restante)] };
  return (
    <tr className="border-t border-border" data-testid="space-linha" data-estado={l.estado} data-lead-id={l.lead_id}>
      <td className="px-3 py-2 font-medium">{l.cliente ?? t("Cliente sem nome")}</td>
      <td className="px-3 py-2">{l.vendedor?.nome ?? "—"}</td>
      <td className="px-3 py-2">{l.etapa ?? "—"}</td>
      <td className="px-3 py-2">
        <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums", prazo.classe)} data-testid="space-prazo">
          {prazo.texto}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-2">
          {l.conversation_id && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/inbox?id=${l.conversation_id}`}>{t("Abrir conversa")}</Link>
            </Button>
          )}
          {l.pode_trocar ? (
            <Button size="sm" onClick={onPassar} data-testid="space-passar">
              {t("Passar a outro vendedor")}
            </Button>
          ) : l.estado !== "followup" ? (
            <span className="self-center text-xs text-muted-foreground">{t("Depois das 72h, só a gerência troca")}</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
