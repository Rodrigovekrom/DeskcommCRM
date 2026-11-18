"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import { chaveDoPainelIavek, usePainelIavek } from "@/hooks/iavek/usePainelIavek";
import { apiClient } from "@/lib/api/client";
import { corDoCronometro, textoDoRestante } from "@/lib/iavek/cronometro-72h";
import { ClockCountdown } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

const CLASSES = {
  verde: "border-success-fg/30 bg-success-bg text-success-fg",
  ambar: "border-warning-fg/30 bg-warning-bg text-warning-fg",
  vermelho: "border-error-fg/30 bg-error-bg text-error-fg",
} as const;

/**
 * ia.vek v1.5: o selo das primeiras 72h do lead novo, com a cor pelo tempo que
 * falta. Some sozinho quando o lead entra numa coluna de compromisso, fecha ou
 * sai do funil de entrada (a rota devolve `cronometro: null`).
 *
 * ia.vek CRM-536 (decisão 3A do Rodrigo): com `clicavel` (o painel das 72h), o PRÓPRIO relógio é o "Manter por mais
 * 72h", para quem pode manter (`pode_manter`, a MESMA regra da rota: o dono, o guardião, o gerente e o admin). Ele
 * pergunta antes e chama a mesma rota do antigo botão "Manter em negociação". Para os outros, fica só leitura. Quem
 * decide é a rota (403 para quem não pode); a tela só não oferece.
 */
export function SeloCronometro72h({
  contactId,
  className,
  clicavel = false,
}: {
  contactId: string | null | undefined;
  className?: string;
  clicavel?: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data } = usePainelIavek(contactId);
  const [perguntando, setPerguntando] = useState(false);
  const manter = useMutation({
    mutationFn: (leadId: string) =>
      apiClient.post("/api/v1/iavek/esteira/manter", { lead_id: leadId }),
    onError: (erro) => showApiError(erro),
    onSettled: () => qc.invalidateQueries({ queryKey: chaveDoPainelIavek(contactId) }),
  });
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const cronometro = data?.cronometro;
  if (!cronometro) return null;

  const restante = new Date(cronometro.fim_em).getTime() - agora;
  const cor = corDoCronometro(restante);
  const { texto, vencido } = textoDoRestante(restante);
  const rotulo = vencido
    ? t("72h vencidas há {tempo}").replace("{tempo}", texto)
    : cronometro.mantido_ate
      ? t("Mantido em negociação: {tempo}").replace("{tempo}", texto)
      : cronometro.respondeu_em
        ? t("Cliente respondeu: {tempo}").replace("{tempo}", texto)
        : t("{tempo} para agendar").replace("{tempo}", texto);

  const classes = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums",
    CLASSES[cor],
    className,
  );
  const prazo = t("Prazo das primeiras {horas}h do lead para agendar").replace(
    "{horas}",
    String(cronometro.horas),
  );
  const leadId = data?.lead?.id ?? null;

  if (!clicavel || !data?.pode_manter || !leadId) {
    return (
      <span data-testid="selo-cronometro-72h" data-cor={cor} title={prazo} className={classes}>
        <ClockCountdown size={12} aria-hidden />
        {rotulo}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        data-testid="selo-cronometro-72h"
        data-cor={cor}
        data-clicavel="true"
        title={`${prazo}. ${t("Toque para manter por mais {horas}h.").replace("{horas}", String(cronometro.horas))}`}
        className={cn(
          classes,
          "cursor-pointer hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
        disabled={manter.isPending}
        onClick={() => setPerguntando(true)}
      >
        <ClockCountdown size={12} aria-hidden />
        {rotulo}
      </button>
      <AlertDialog open={perguntando} onOpenChange={setPerguntando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Manter por mais {horas}h?").replace("{horas}", String(cronometro.horas))}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Segura o lead por mais 72h antes de ir para o follow-up. Pode renovar.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction data-testid="confirmar-manter" onClick={() => manter.mutate(leadId)}>
              {t("Manter")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
