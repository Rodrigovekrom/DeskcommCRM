"use client";
/**
 * ia.vek CRM-530: o CONVITE para ativar o aviso no celular, no 1º acesso de cada APARELHO.
 *
 * Por que um convite, e não "ligado de fábrica": o navegador EXIGE o clique da pessoa para permitir notificações. O que
 * dá para fazer é perguntar na hora certa, uma vez, no próprio aparelho.
 *
 * Aparece só quando:
 *   - a pessoa atende (agent+, o `podeAtender` da casca);
 *   - a instalação tem o push ligado (o GET /api/v1/notifications/push diz `enabled`, isto é, o par VAPID existe). Sem
 *     ele, convidar seria prometer o que não chega;
 *   - a permissão do navegador ainda está em "default" (nunca respondida);
 *   - a pessoa não clicou "Agora não" nos últimos 7 dias, NESTE aparelho (localStorage; sem ele, aparece de novo, o lado
 *     inofensivo).
 * No iPhone fora da Tela de Início, o push não funciona (a Apple exige o app instalado, iOS 16.4+): o convite troca o
 * botão pelo passo "Compartilhar › Adicionar à Tela de Início".
 */
import { useEffect, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useNotificationPermission } from "@/hooks/notifications/useNotificationPermission";

const CHAVE_ADIADO = "push.convite.adiado_ate";
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function lerAdiado(): number {
  try {
    return Number(window.localStorage.getItem(CHAVE_ADIADO) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function adiar(): void {
  try {
    window.localStorage.setItem(CHAVE_ADIADO, String(Date.now() + SETE_DIAS_MS));
  } catch {
    // sem localStorage, o convite volta no próximo acesso: o lado inofensivo
  }
}

/** iPhone/iPad fora da Tela de Início: lá o push só existe com o CRM instalado. */
export function iphoneSemInstalar(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios) return false;
  const instalado =
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return !instalado;
}

export function ConviteDoCelular({ podeAtender }: { podeAtender: boolean }) {
  const t = useT();
  const { permission, request } = useNotificationPermission();
  const [pushLigado, setPushLigado] = useState(false);
  const [escondido, setEscondido] = useState(true);

  useEffect(() => {
    if (!podeAtender) return;
    setEscondido(lerAdiado() > Date.now());
    let vivo = true;
    void fetch("/api/v1/notifications/push")
      .then((r) => r.json())
      .then((j: { data?: { enabled?: boolean } }) => {
        if (vivo) setPushLigado(j?.data?.enabled === true);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [podeAtender]);

  const iphone = iphoneSemInstalar();
  // No iPhone sem instalar, `Notification` nem existe: a permissão vem 'unsupported', e o passo de instalar é o convite.
  const deveMostrar =
    podeAtender && pushLigado && !escondido && (permission === "default" || (iphone && permission === "unsupported"));
  if (!deveMostrar) return null;

  return (
    <div
      role="region"
      aria-label={t("Aviso no celular")}
      data-testid="convite-do-celular"
      className="mb-4 flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p>
        {iphone
          ? t("Para ser avisado no iPhone quando um cliente seu escrever: toque em Compartilhar e depois em Adicionar à Tela de Início. Depois, abra o CRM por lá.")
          : t("Quer ser avisado no celular quando um cliente seu escrever?")}
      </p>
      <div className="flex gap-2">
        {!iphone && (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground"
            onClick={() => {
              void request().then(() => setEscondido(true));
            }}
          >
            {t("Ativar")}
          </button>
        )}
        <button
          type="button"
          className="rounded-md border px-3 py-1.5"
          onClick={() => {
            adiar();
            setEscondido(true);
          }}
        >
          {t("Agora não")}
        </button>
      </div>
    </div>
  );
}
