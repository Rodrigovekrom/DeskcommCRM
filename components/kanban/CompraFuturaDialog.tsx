"use client";

/**
 * ia.vek v1.9.45 (CRM-294): levar o lead para a Compra futura pede o MÊS e o ANO previstos (obrigatório,
 * decisão do Rodrigo em 11/11). O campo não deixa escolher mês passado; o banco confere de novo.
 * Sete dias antes do mês, o mesmo vendedor ganha uma tarefa de ligar.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";

/** "AAAA-MM" do mês atual, no fuso de São Paulo (o mesmo do banco). */
export function mesAtual(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(agora);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

export function mesValido(mes: string, agora: Date = new Date()): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) && mes >= mesAtual(agora);
}

export function CompraFuturaDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (mes: string | null) => void;
  pending?: boolean;
}) {
  const t = useT();
  const [mes, setMes] = useState("");
  const minimo = mesAtual();
  // o mês é OPCIONAL (Rodrigo, 11/11): vazio pode; preenchido, não pode estar no passado
  const valido = mes === "" || mesValido(mes);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Compra futura")}</DialogTitle>
          <DialogDescription>
            {t("O cliente quer comprar mais para frente. Se souber, anote o mês e o ano previstos (opcional).")}
          </DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium" htmlFor="compra-futura-mes">
          {t("Mês e ano previstos (opcional)")}
        </label>
        <input
          id="compra-futura-mes"
          data-testid="compra-futura-mes"
          type="month"
          min={minimo}
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
        />
        {mes && !valido ? (
          <p role="alert" className="text-xs text-destructive">
            {t("O mês previsto não pode estar no passado.")}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button disabled={!valido || pending} onClick={() => onConfirm(mes || null)}>
            {t("Confirmar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
