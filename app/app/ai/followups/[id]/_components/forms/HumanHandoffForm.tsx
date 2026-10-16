"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

import type { ConfigOf } from "./shared";

/**
 * O nó `human_handoff` (ia.vek D3) — "Passar para humano". Faz o MESMO handoff
 * da IA: a IA para de responder ao cliente, os follow-ups pendentes são
 * cancelados e a Central recebe um aviso crítico. O motivo vira o texto do aviso.
 */
export function HumanHandoffForm({
  config,
  onChange,
}: {
  config: ConfigOf<"human_handoff">;
  onChange: (c: ConfigOf<"human_handoff">) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label htmlFor="human-handoff-motivo">{t("Motivo (vai no aviso da Central)")}</Label>
      <Textarea
        id="human-handoff-motivo"
        rows={3}
        maxLength={200}
        value={config.motivo}
        placeholder={t("ex.: fim das 72 h sem agendamento — a equipe assume")}
        onChange={(e) => onChange({ motivo: e.target.value })}
      />
      <p className="text-xs text-text-muted">
        {t("A IA para de responder este cliente, os follow-ups pendentes são cancelados e a equipe recebe o aviso. Nenhuma mensagem é enviada ao cliente.")}
      </p>
    </div>
  );
}
