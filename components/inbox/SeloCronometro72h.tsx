"use client";
import { useEffect, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { usePainelIavek } from "@/hooks/iavek/usePainelIavek";
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
 */
export function SeloCronometro72h({
  contactId,
  className,
}: {
  contactId: string | null | undefined;
  className?: string;
}) {
  const t = useT();
  const { data } = usePainelIavek(contactId);
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
    : t("{tempo} para agendar").replace("{tempo}", texto);

  return (
    <span
      data-testid="selo-cronometro-72h"
      data-cor={cor}
      title={t("Prazo das primeiras {horas}h do lead para agendar").replace(
        "{horas}",
        String(cronometro.horas),
      )}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums",
        CLASSES[cor],
        className,
      )}
    >
      <ClockCountdown size={12} aria-hidden />
      {rotulo}
    </span>
  );
}
