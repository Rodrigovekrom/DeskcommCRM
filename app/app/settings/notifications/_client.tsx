"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState, useSyncExternalStore } from "react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useNotificationPermission } from "@/hooks/notifications/useNotificationPermission";
import {
  NOTIFY_UI_CATEGORIES,
  assinarPrefs,
  getPrefsSnapshot,
  getPrefsSnapshotDoServidor,
  gravarCanal,
  type NotifyCategory,
  type NotifyChannelPref,
} from "@/lib/notifications/prefs";

const LABELS: Record<NotifyCategory, string> = {
  message: "Nova mensagem",
  lead_assigned: "Lead atribuído a você",
  lead_won: "Lead ganho",
  lead_lost: "Lead perdido",
  mention: "Você foi mencionado",
  call_inbound: "Ligação recebida",
};

export function NotificationPrefsClient() {
  const t = useT();
  const { permission, request } = useNotificationPermission();
  const prefs = useSyncExternalStore(assinarPrefs, getPrefsSnapshot, getPrefsSnapshotDoServidor);
  const denied = permission === "denied";
  const unsupported = permission === "unsupported";

  async function onToggle(category: NotifyCategory, channel: NotifyChannelPref, on: boolean) {
    if (channel === "push" && on) {
      if (permission !== "granted") {
        const next = await request();
        if (next !== "granted") return;
      }
    }
    gravarCanal(category, channel, on);
  }

  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="px-4 py-3 text-left font-medium">{t("Categoria")}</th>
            <th className="px-4 py-3 text-center font-medium">Email</th>
            <th className="px-4 py-3 text-center font-medium">In-app</th>
            <th className="px-4 py-3 text-center font-medium">Push</th>
          </tr>
        </thead>
        <tbody>
          {NOTIFY_UI_CATEGORIES.map((cat) => (
            <tr key={cat} className="border-b last:border-0">
              <td className="px-4 py-3">
                {t(LABELS[cat])}
                {cat === "message" && denied ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      "O navegador bloqueou as notificações. Libere-as nas configurações do site e recarregue.",
                    )}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3 text-center">
                <Switch checked={false} disabled aria-label={`${t(LABELS[cat])} via email`} />
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={prefs[cat].in_app}
                  onCheckedChange={(on) => void onToggle(cat, "in_app", on)}
                  aria-label={`${t(LABELS[cat])} via in_app`}
                />
              </td>
              <td className="px-4 py-3 text-center">
                <Switch
                  checked={prefs[cat].push}
                  disabled={denied || unsupported}
                  onCheckedChange={(on) => void onToggle(cat, "push", on)}
                  aria-label={`${t(LABELS[cat])} via push`}
                  data-testid={cat === "message" ? (prefs.message.push ? "alerts-toggle" : "alerts-enable") : undefined}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* ia.vek CRM-530: o botão de teste, para ver e ouvir o aviso no celular na hora. */}
      {permission === "granted" ? <EnviarTeste /> : null}
    </Card>
  );
}

function EnviarTeste() {
  const t = useT();
  const [estado, setEstado] = useState<"" | "enviando" | "enviado" | "nenhum" | "espere" | "falhou">("");
  async function enviar() {
    setEstado("enviando");
    try {
      const r = await fetch("/api/v1/notifications/push/teste", { method: "POST" });
      if (r.status === 429) return setEstado("espere");
      const j = (await r.json()) as { data?: { enviados?: number } };
      setEstado(r.ok ? ((j.data?.enviados ?? 0) > 0 ? "enviado" : "nenhum") : "falhou");
    } catch {
      setEstado("falhou");
    }
  }
  const frase: Record<typeof estado, string> = {
    "": t("Feche ou minimize o CRM em 5 segundos para ver o aviso chegar."),
    enviando: t("Enviando…"),
    enviado: t("Teste enviado. Se não chegou, confira o som das notificações do navegador no celular."),
    nenhum: t("Nenhum aparelho seu está inscrito. Ative o aviso neste aparelho primeiro."),
    espere: t("Espere um minuto para enviar outro teste."),
    falhou: t("Não consegui enviar o teste agora."),
  };
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground" data-testid="push-teste-frase">{frase[estado]}</p>
      <button
        type="button"
        className="rounded-md border px-3 py-1.5"
        disabled={estado === "enviando"}
        onClick={() => {
          setTimeout(() => void enviar(), 5000);
          setEstado("enviando");
        }}
        data-testid="push-teste"
      >
        {t("Enviar um teste")}
      </button>
    </div>
  );
}
