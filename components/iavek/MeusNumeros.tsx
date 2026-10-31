"use client";
/**
 * ia.vek v1.9.3 — "Meus números": os resultados SÓ de quem está conectado
 * (CRM-207/208). O servidor decide de quem são (o usuário da sessão) e qual
 * visão (SDR ou vendedor). O rank entre vendedores fica para a fase 2.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { formatCentsBRL } from "@/lib/money";
import type { NumerosDoSdr, NumerosDoVendedor, Periodo } from "@/lib/iavek/meus-numeros";
import { cn } from "@/lib/utils";

interface Resposta {
  periodo: Periodo;
  numeros: NumerosDoSdr | NumerosDoVendedor;
}

const ROTULO_DO_PERIODO: Record<Periodo, string> = { hoje: "Hoje", "7d": "7 dias", "30d": "30 dias" };

function Cartao({ rotulo, valor, id }: { rotulo: string; valor: string | number; id: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3" data-testid={`numero-${id}`}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

export function MeusNumeros() {
  const t = useT();
  const { user } = useAuth();
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["iavek", "meus-numeros", user.id, periodo],
    queryFn: () =>
      apiClient.get<{ data: Resposta }>(`/api/v1/iavek/meus-numeros?periodo=${periodo}`).then((r) => r.data),
  });
  const n = data?.numeros;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5" data-testid="meus-numeros">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t("Meus números")}</h1>
          <p className="text-sm text-muted-foreground">{t("Só os seus resultados. Ninguém mais vê esta tela com os seus dados.")}</p>
        </div>
        <div className="flex gap-1" role="group" aria-label={t("Período")}>
          {(["hoje", "7d", "30d"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={p === periodo ? "default" : "outline"}
              onClick={() => setPeriodo(p)}
              aria-pressed={p === periodo}
              data-testid={`periodo-${p}`}
            >
              {t(ROTULO_DO_PERIODO[p])}
            </Button>
          ))}
        </div>
      </header>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : isError || !n ? (
        <div className="rounded-md border border-border p-4 text-sm">
          <p>{t("Não consegui carregar os seus números agora.")}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>
            {t("Tentar de novo")}
          </Button>
        </div>
      ) : n.visao === "sdr" ? (
        <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4")} data-visao="sdr">
          <Cartao id="leads-comigo" rotulo={t("Leads comigo (abertos)")} valor={n.leads_comigo} />
          <Cartao id="ligacoes" rotulo={t("Ligações")} valor={n.ligacoes} />
          <Cartao id="agendamentos-marcados" rotulo={t("Agendamentos que marquei")} valor={n.agendamentos_marcados} />
          <Cartao id="pedidos" rotulo={t("Pedidos (confirmados)")} valor={`${n.pedidos_feitos} (${n.pedidos_confirmados})`} />
          <Cartao id="compareceram" rotulo={t("Compareceram")} valor={n.compareceram} />
          <Cartao id="nao-vieram" rotulo={t("Não vieram")} valor={n.nao_vieram} />
          <Cartao id="vendidos" rotulo={t("Vendidos")} valor={n.vendidos} />
        </div>
      ) : (
        <div className="space-y-4" data-visao="vendedor">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cartao id="carteira" rotulo={t("Carteira (abertos)")} valor={n.carteira_aberta} />
            <Cartao id="agendamentos" rotulo={t("Agendamentos")} valor={n.agendamentos} />
            <Cartao id="compareceram" rotulo={t("Compareceram")} valor={n.compareceram} />
            <Cartao id="nao-vieram" rotulo={t("Não vieram")} valor={n.nao_vieram} />
            <Cartao id="propostas" rotulo={t("Propostas enviadas")} valor={n.propostas_enviadas} />
            <Cartao id="vendas" rotulo={t("Vendas")} valor={n.vendas} />
            <Cartao id="valor-vendido" rotulo={t("Valor vendido")} valor={formatCentsBRL(n.valor_vendido_cents)} />
            <Cartao id="perdas" rotulo={t("Perdas")} valor={n.perdas} />
          </div>
          {n.motivos_de_perda.length > 0 && (
            <section className="rounded-md border border-border p-3 bg-surface/90 backdrop-blur" data-testid="motivos-de-perda">
              <h2 className="text-sm font-semibold">{t("Por que perdi")}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {n.motivos_de_perda.map((m) => (
                  <li key={m.motivo} className="flex justify-between gap-2">
                    <span className="truncate">{m.motivo}</span>
                    <span className="tabular-nums text-muted-foreground">{m.total}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
