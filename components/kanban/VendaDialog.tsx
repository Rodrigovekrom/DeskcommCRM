"use client";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hojeNaLoja, type VendaDaLoja } from "@/lib/iavek/venda-da-loja";
import { parseReaisToCents } from "@/lib/money";

/**
 * ia.vek v1.9.12 — o valor final e a data ao marcar vendido, na loja de carros.
 * Não grava nada sozinho: devolve os dados para o caminho que abriu a janela (o
 * arrasto ou o botão) levá-los NA MESMA escrita que fecha. Cancelou, não vendeu.
 */
interface VendaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O valor do lead hoje, sugerido como valor final. */
  valorSugeridoCents: number | null | undefined;
  /** v1.9.20: ao corrigir uma venda, a data já gravada. */
  dataSugerida?: string;
  onConfirmar: (venda: VendaDaLoja) => void;
  isPending?: boolean;
}

function centsParaTexto(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

export function VendaDialog({ open, onOpenChange, valorSugeridoCents, dataSugerida, onConfirmar, isPending = false }: VendaDialogProps) {
  const t = useT();
  const hoje = hojeNaLoja();
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje);

  useEffect(() => {
    if (!open) return;
    setValor(centsParaTexto(valorSugeridoCents));
    setData(dataSugerida ?? hojeNaLoja());
  }, [open, valorSugeridoCents, dataSugerida]);

  const valorCents = parseReaisToCents(valor.trim());
  const valido = valorCents !== null && valorCents > 0 && data !== "" && data <= hoje;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="venda-dialog">
        <DialogHeader>
          <DialogTitle>{t("Dados da venda")}</DialogTitle>
          <DialogDescription>
            {t("Informe quanto o carro foi vendido e em que dia. É isso que entra nos relatórios.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="venda-valor">{t("Valor final (R$)")}</Label>
            <Input
              id="venda-valor"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="venda-data">{t("Data da venda")}</Label>
            <Input id="venda-data" type="date" max={hoje} value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button
            type="button"
            disabled={!valido || isPending}
            onClick={() => {
              if (valido) onConfirmar({ valor_cents: valorCents, data });
            }}
          >
            {t("Confirmar venda")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
