"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { VendaDialog } from "@/components/kanban/VendaDialog";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { apiClient } from "@/lib/api/client";
import { corrigeVenda } from "@/lib/iavek/funcoes";
import { FUSO_DA_LOJA } from "@/lib/iavek/venda-da-loja";
import type { VendaDaLoja } from "@/lib/iavek/venda-da-loja";
import type { Lead } from "@/lib/types/leads";

/** ia.vek v1.9.19 (CRM-234): gerente e admin corrigem valor e data de lead vendido. */
export function CorrigirVenda({ lead }: { lead: Lead }) {
  const t = useT();
  const qc = useQueryClient();
  const { activeOrg } = useAuth();
  const { lojaDeCarros } = usePerfilDaEmpresa();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const funcao = activeOrg?.interface_settings?.funcao;
  if (lead.status !== "won" || !lojaDeCarros || !corrigeVenda(funcao, activeOrg?.role)) return null;
  const dataAtual = lead.closed_at
    ? new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_DA_LOJA }).format(new Date(lead.closed_at))
    : undefined;

  async function salvar(venda: VendaDaLoja) {
    setSalvando(true);
    try {
      await apiClient.patch(`/api/v1/leads/${lead.id}/venda`, { venda });
      toast.success(t("Venda corrigida."));
      setAberto(false);
      void qc.invalidateQueries({
        predicate: (q) => JSON.stringify(q.queryKey).includes(lead.pipeline_id),
      });
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mb-3">
      <Button size="sm" variant="outline" onClick={() => setAberto(true)} data-testid="corrigir-venda">
        {t("Corrigir valor e data da venda")}
      </Button>
      <VendaDialog
        open={aberto}
        onOpenChange={setAberto}
        valorSugeridoCents={lead.value_cents}
        {...(dataAtual ? { dataSugerida: dataAtual } : {})}
        isPending={salvando}
        onConfirmar={(venda) => void salvar(venda)}
      />
    </div>
  );
}
