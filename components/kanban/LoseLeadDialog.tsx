"use client";
import { useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLoseLead } from "@/hooks/kanban/useUpdateLead";
import { useMotivosDePerdaDoFunil } from "@/hooks/kanban/useMotivosDePerdaDoFunil";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import { opcoesDeMotivoDePerda } from "@/lib/leads/motivos-de-perda-do-funil";

interface LoseLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  pipelineId: string;
  /** ia.vek v1.9.18: a perda foi gravada. */
  aoPerder?: () => void;
}

const MAX_LEN = 500;

export function LoseLeadDialog({
  aoPerder,
  open,
  onOpenChange,
  leadId,
  pipelineId,
}: LoseLeadDialogProps) {
  const t = useT();
  const [reasonCode, setReasonCode] = useState<string>("");
  const [otherText, setOtherText] = useState("");
  const mutation = useLoseLead(pipelineId);

  // O funil deste card manda na lista: o que ele tem cadastrado substitui o
  // padrão do produto — ver lib/leads/motivos-de-perda-do-funil.ts.
  const cadastrados = useMotivosDePerdaDoFunil(pipelineId);
  const opcoes = useMemo(() => opcoesDeMotivoDePerda(cadastrados), [cadastrados]);

  const observacao = otherText.trim();
  // ia.vek v1.9.43 (Rodrigo, 11/11): o MOTIVO gravado é SEMPRE o escolhido na lista (inclusive "Outro", que é
  // canônico: `other`). O texto livre virou OBSERVAÇÃO: nunca é o motivo, nunca bloqueia o Confirmar e vai
  // para a atividade da perda e para source_metadata.perda_observacao. Antes, "Outro" + texto gravava o
  // TEXTO como motivo, o gatilho fn_validate_lost_reason_required recusava (22023) e o Confirmar travava.
  const finalReason = reasonCode;
  const disabled = !reasonCode || observacao.length > MAX_LEN || mutation.isPending;

  const handleSubmit = async () => {
    if (disabled) return;
    try {
      await mutation.mutateAsync({ leadId, lostReason: finalReason, ...(observacao ? { observacao } : {}) });
      aoPerder?.();
      setReasonCode("");
      setOtherText("");
      onOpenChange(false);
    } catch {
      // error already toasted
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Marcar como perdido")}</DialogTitle>
          <DialogDescription>
            {t("Informe o motivo. Essa informação ajuda a melhorar o funil.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Label>{t("Motivo")}</Label>
          <div className="grid grid-cols-1 gap-1.5">
            {opcoes.map((opcao) => (
              <label
                key={opcao.valor}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="radio"
                  name="lost-reason"
                  value={opcao.valor}
                  checked={reasonCode === opcao.valor}
                  onChange={(e) => setReasonCode(e.target.value)}
                />
                <span>{opcao.doFunil ? opcao.valor : t(rotuloDoMotivoDePerda(opcao.valor))}</span>
              </label>
            ))}
          </div>
          {/* v1.9.43: a observação vale para QUALQUER motivo e é sempre opcional. */}
          <div className="grid gap-1.5">
            <Label htmlFor="lost-reason-other">{t("Observação (opcional)")}</Label>
            <Textarea
              id="lost-reason-other"
              data-testid="observacao-da-perda"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder={t("Ex: Cliente desistiu por X motivo")}
              maxLength={MAX_LEN}
              rows={3}
            />
            <div className="text-right text-[11px] text-muted-foreground tabular-nums">
              {otherText.length}/{MAX_LEN}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t("Cancelar")}
          </Button>
          <Button onClick={handleSubmit} disabled={disabled}>
            {mutation.isPending ? t("Salvando...") : t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
