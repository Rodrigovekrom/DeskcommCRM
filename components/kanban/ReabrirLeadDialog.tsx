"use client";

/**
 * ia.vek v1.9.59.2: tirar o lead do Perdido (arrastar ou "Mover para a coluna" para uma etapa aberta) pede o
 * MOTIVO, em texto livre. Regra do Rodrigo: reabrir é livre para quem pode mover o card, e só pede o porquê, que
 * vai à linha do tempo do lead. O servidor confere de novo (`motivo_da_reabertura_obrigatorio`).
 *
 * A mesma janela serve para tirar o lead do VENDIDO (desfazer depois de vendido, `de="won"`): só o título e o
 * exemplo mudam.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

/** O mínimo e o máximo do motivo (o mesmo do `moveLeadSchema.motivo_reabertura`). */
export const MOTIVO_REABERTURA_MIN = 3;
export const MOTIVO_REABERTURA_MAX = 500;

export function motivoDeReaberturaValido(texto: string): boolean {
  const limpo = texto.trim();
  return limpo.length >= MOTIVO_REABERTURA_MIN && limpo.length <= MOTIVO_REABERTURA_MAX;
}

export function ReabrirLeadDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  de = "lost",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (motivo: string) => void;
  pending?: boolean;
  /** De onde o lead sai: do Perdido (padrão) ou do Vendido. */
  de?: "lost" | "won";
}) {
  const t = useT();
  const [motivo, setMotivo] = useState("");
  const valido = motivoDeReaberturaValido(motivo);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {de === "won" ? t("Por que este lead sai do Vendido?") : t("Por que este lead sai do Perdido?")}
          </DialogTitle>
          <DialogDescription>
            {t("Escreva o motivo. Ele fica registrado no histórico do lead.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="motivo-reabertura">{t("Motivo")}</Label>
          <Textarea
            id="motivo-reabertura"
            data-testid="motivo-reabertura"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={
              de === "won"
                ? t("Ex: O financiamento foi negado e a venda não fechou")
                : t("Ex: O cliente voltou a falar e quer ver o carro")
            }
            maxLength={MOTIVO_REABERTURA_MAX}
            rows={3}
            autoFocus
          />
          <div className="text-right text-[11px] text-muted-foreground tabular-nums">
            {motivo.length}/{MOTIVO_REABERTURA_MAX}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("Cancelar")}
          </Button>
          <Button
            data-testid="confirmar-reabertura"
            disabled={!valido || pending}
            onClick={() => {
              if (valido) onConfirm(motivo.trim());
            }}
          >
            {pending ? t("Salvando...") : t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
