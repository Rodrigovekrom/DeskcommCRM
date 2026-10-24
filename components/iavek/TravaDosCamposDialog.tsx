"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import type { TravaDaLoja } from "@/hooks/kanban/useMoveCard";

/**
 * ia.vek v1.8.3 — a recusa da TRAVA DOS CAMPOS OBRIGATÓRIOS (0590) vira janela.
 *
 * Até a v1.8.2 ela chegava como toast vermelho com "ID: …": dizia que deu
 * errado, mas não o que fazer. Aqui a pessoa vê a lista do que falta e um botão
 * que abre a ficha do lead já nos campos. O cartão volta para onde estava (o
 * rollback do mover); depois de preencher, é só arrastar de novo.
 */
export function TravaDosCamposDialog({
  trava,
  onOpenChange,
  onPreencher,
}: {
  trava: TravaDaLoja | null;
  onOpenChange: (aberto: boolean) => void;
  onPreencher: (leadId: string) => void;
}) {
  const t = useT();
  return (
    <Dialog open={trava !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="trava-dos-campos">
        <DialogHeader>
          <DialogTitle>{t("Faltam campos obrigatórios")}</DialogTitle>
          <DialogDescription>
            {t("Para avançar este lead, preencha antes:")}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(trava?.faltam ?? []).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Agora não")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (trava) onPreencher(trava.leadId);
            }}
          >
            {t("Preencher agora")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
