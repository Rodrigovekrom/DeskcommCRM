"use client";
import { useSyncExternalStore } from "react";

import { useT } from "@/hooks/i18n/useT";
import { tempoDeEspera } from "@/lib/iavek/ordem-do-quadro";

/** Um relógio só para o quadro inteiro: centenas de cartões, um intervalo. */
let agora = Date.now();
const quem = new Set<() => void>();
let relogio: ReturnType<typeof setInterval> | null = null;
function assinar(f: () => void) {
  quem.add(f);
  relogio ??= setInterval(() => {
    agora = Date.now();
    for (const g of quem) g();
  }, 30_000);
  return () => {
    quem.delete(f);
    if (quem.size === 0 && relogio) {
      clearInterval(relogio);
      relogio = null;
    }
  };
}

/** ia.vek v1.9.18: mensagem do lead sem resposta, com o tempo de espera. */
export function MarcaDeNovaMensagem({ desde }: { desde: number }) {
  const t = useT();
  const instante = useSyncExternalStore(assinar, () => agora, () => desde);
  return (
    <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400" data-testid="marca-nova-mensagem">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
      {t("Nova mensagem")} · {t("sem resposta há")} {tempoDeEspera(Math.max(instante, Date.now()) - desde)}
    </p>
  );
}
