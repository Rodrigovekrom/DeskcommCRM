"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Clock } from "@/lib/ui/icons";
import { useSnoozeConversation } from "@/hooks/inbox/useSnoozeConversation";
import { SNOOZE_MAX_DIAS } from "@/lib/schemas/snooze";

interface Props {
  conversationId: string;
  snoozeUntil: string | null;
  disabled?: boolean;
}

const DURATIONS: Array<{ hours: 1 | 3 | 24; label: string }> = [
  { hours: 1, label: "Em 1 hora" },
  { hours: 3, label: "Em 3 horas" },
  { hours: 24, label: "Em 24 horas" },
];

/** O valor que o `<input type="datetime-local">` entende, no fuso de quem olha. */
function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isSnoozeActive(snoozeUntil: string | null): boolean {
  return snoozeUntil != null && new Date(snoozeUntil).getTime() > Date.now();
}

export function SnoozeButton({ conversationId, snoozeUntil, disabled }: Props) {
  const t = useT();
  const { snooze, cancel } = useSnoozeConversation();
  const isActive = isSnoozeActive(snoozeUntil);
  const isPending = snooze.isPending || cancel.isPending;
  // ia.vek v1.7.6: lembrete em data e horário escolhidos.
  const [escolhendo, setEscolhendo] = useState(false);
  const [quando, setQuando] = useState("");
  // O "agora" é fixado ao abrir o diálogo (render não pode ler o relógio).
  const [aberturaEm, setAberturaEm] = useState(0);
  const alvo = quando ? new Date(quando) : null;
  const limite = aberturaEm + SNOOZE_MAX_DIAS * 86_400_000;
  const valido =
    alvo != null &&
    !Number.isNaN(alvo.getTime()) &&
    alvo.getTime() > aberturaEm &&
    alvo.getTime() <= limite;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || isPending}
            className="flex items-center gap-1"
          >
            <Clock size={12} weight="regular" aria-hidden />
            {isActive ? t("Lembrete ativo") : t("Lembrar")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isActive ? (
            <DropdownMenuItem onClick={() => cancel.mutate({ conversation_id: conversationId })}>
              {t("Cancelar lembrete")}
            </DropdownMenuItem>
          ) : (
            DURATIONS.map((d) => (
              <DropdownMenuItem
                key={d.hours}
                onClick={() =>
                  snooze.mutate({ conversation_id: conversationId, duration_hours: d.hours })
                }
              >
                {t(d.label)}
              </DropdownMenuItem>
            ))
          )}
          {!isActive && (
            <DropdownMenuItem
              data-testid="lembrete-data-e-horario"
              onClick={() => {
                const agora = Date.now();
                setAberturaEm(agora);
                setQuando(paraCampoLocal(new Date(agora + 24 * 3600_000)));
                setEscolhendo(true);
              }}
            >
              {t("Data e horário…")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={escolhendo} onOpenChange={setEscolhendo}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Lembrar em data e horário")}</DialogTitle>
            <DialogDescription>
              {t("Você recebe o aviso nesse momento se o lead não tiver respondido.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`lembrete-quando-${conversationId}`}>{t("Quando")}</Label>
            <Input
              id={`lembrete-quando-${conversationId}`}
              type="datetime-local"
              value={quando}
              min={paraCampoLocal(new Date(aberturaEm))}
              max={paraCampoLocal(new Date(limite))}
              onChange={(e) => setQuando(e.target.value)}
            />
            {quando && !valido && (
              <p className="text-xs text-destructive">
                {t("Escolha um momento no futuro, em até 90 dias.")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscolhendo(false)}>
              {t("Cancelar")}
            </Button>
            <Button
              disabled={!valido || snooze.isPending}
              onClick={() => {
                if (!alvo || !valido || alvo.getTime() <= Date.now()) return;
                snooze.mutate(
                  { conversation_id: conversationId, until: alvo.toISOString() },
                  { onSuccess: () => setEscolhendo(false) },
                );
              }}
            >
              {t("Salvar lembrete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
