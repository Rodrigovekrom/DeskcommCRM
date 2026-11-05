"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { chaveDoPainelIavek, usePainelIavek } from "@/hooks/iavek/usePainelIavek";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

/**
 * ia.vek v1.9.23: "Manter em negociação" — segura o lead nas 72h por mais 72h, renovável.
 * Aparece só onde há relógio e para quem pode (dono, guardião, gerente, admin).
 */
export function BotaoManterEmNegociacao({ contactId }: { contactId: string | null | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = usePainelIavek(contactId);
  const manter = useMutation({
    mutationFn: (leadId: string) => apiClient.post("/api/v1/iavek/esteira/manter", { lead_id: leadId }),
    onError: (erro) => showApiError(erro),
    onSettled: () => qc.invalidateQueries({ queryKey: chaveDoPainelIavek(contactId) }),
  });
  if (!data?.cronometro || !data.pode_manter || !data.lead) return null;
  const leadId = data.lead.id;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 px-2 text-[11px]"
      disabled={manter.isPending}
      onClick={() => manter.mutate(leadId)}
      data-testid="manter-em-negociacao"
      title={t("Segura o lead por mais 72h antes de ir para o follow-up. Pode renovar.")}
    >
      {t("Manter em negociação")}
    </Button>
  );
}
