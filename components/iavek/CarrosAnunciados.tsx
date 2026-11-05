"use client";
import { useQuery } from "@tanstack/react-query";

import { useCatalogoDoCampo, nomeDoCarro } from "@/components/contacts/CampoDoCatalogo";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { LinhaDoRelatorio } from "@/lib/iavek/carro-do-anuncio";
import { formatCentsBRL } from "@/lib/money";

/** ia.vek v1.9.24 (CRM-195): leads, vendas e valor por carro anunciado, últimos 30 dias. */
export function CarrosAnunciados() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["iavek", "relatorio", "carros-anunciados", 30],
    queryFn: () =>
      apiClient
        .get<{ data: { dias: number; total_leads: number; linhas: LinhaDoRelatorio[] } }>(
          "/api/v1/iavek/relatorios/carros-anunciados?dias=30",
        )
        .then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const { data: catalogo } = useCatalogoDoCampo(Boolean(data?.linhas.length));
  if (!data) return null;
  if (data.linhas.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("Nenhum lead com carro do anúncio nos últimos 30 dias.")}</p>;
  }
  return (
    <table className="w-full text-sm" data-testid="carros-anunciados">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-normal">{t("Carro do anúncio")}</th>
          <th className="py-1 text-right font-normal">{t("Leads")}</th>
          <th className="py-1 text-right font-normal">{t("Vendas")}</th>
          <th className="py-1 text-right font-normal">{t("Valor vendido")}</th>
        </tr>
      </thead>
      <tbody>
        {data.linhas.slice(0, 15).map((l) => (
          <tr key={l.carro_id} className="border-t border-border">
            <td className="max-w-[14rem] truncate py-1.5">{(() => {
              // undefined = o catálogo ainda está chegando; "" = o carro não está mais nele.
              const nome = nomeDoCarro(l.carro_id, catalogo);
              return nome === undefined ? "…" : nome || t("Carro fora do catálogo");
            })()}</td>
            <td className="py-1.5 text-right tabular-nums">{l.leads}</td>
            <td className="py-1.5 text-right tabular-nums">{l.vendas}</td>
            <td className="py-1.5 text-right tabular-nums">{formatCentsBRL(l.valor_vendido_cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
