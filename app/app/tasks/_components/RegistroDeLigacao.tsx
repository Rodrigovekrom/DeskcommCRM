"use client";

/**
 * "Registrar ligação" (ia.vek D3): os 3 campos da tarefa de ligação da esteira.
 * Concluir uma ligação passa por aqui em vez do clique simples, porque o
 * próximo passo mexe no negócio (retentativa, agendamento, retorno, perda).
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { ROTULO_DO_MOTIVO_CANONICO } from "@/lib/schemas/leads";
import { MOTIVOS_SEM_INTERESSE } from "@/lib/esteira/registro-de-ligacao";
import type { Tarefa } from "@/lib/tarefas/tipos";

type Proximo = "agendou" | "retornar" | "sem_interesse";

export function RegistroDeLigacao({
  tarefa,
  aoFechar,
  aoRegistrar,
}: {
  tarefa: Tarefa | null;
  aoFechar: () => void;
  aoRegistrar: () => void;
}) {
  const t = useT();
  const [atendeu, setAtendeu] = useState<"sim" | "nao" | "">("");
  const [resumo, setResumo] = useState("");
  const [proximo, setProximo] = useState<Proximo | "">("");
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const precisaData = atendeu === "sim" && (proximo === "agendou" || proximo === "retornar");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!tarefa) return;
    setErro(null);
    if (atendeu === "") return setErro(t("Diga se o cliente atendeu."));
    if (resumo.trim().length < 3) return setErro(t("Escreva o resumo da ligação em uma frase."));
    if (atendeu === "sim" && proximo === "") return setErro(t("Escolha o próximo passo."));
    if (precisaData && !dia) return setErro(t("Escolha a data."));
    if (atendeu === "sim" && proximo === "sem_interesse" && !motivo) return setErro(t("Escolha o motivo."));

    const corpo: Record<string, unknown> = { atendeu: atendeu === "sim", resumo: resumo.trim() };
    if (atendeu === "sim") {
      if (proximo === "sem_interesse") {
        corpo.proximo = { tipo: "sem_interesse", motivo, ...(detalhe.trim() ? { detalhe: detalhe.trim() } : {}) };
      } else {
        corpo.proximo = { tipo: proximo, data: new Date(`${dia}T${hora || "10:00"}:00`).toISOString() };
      }
    }
    setEnviando(true);
    try {
      const r = await fetch(`/api/v1/tasks/${tarefa.id}/ligacao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!r.ok) {
        setErro(json?.error?.message ?? t("Não deu para registrar a ligação."));
        return;
      }
      aoRegistrar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={tarefa !== null} onOpenChange={(aberto) => (!aberto ? aoFechar() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Registrar ligação")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" data-testid="registro-de-ligacao">
          <p className="text-sm text-muted-foreground">{tarefa?.title}</p>

          <div className="space-y-1.5">
            <Label>{t("O cliente atendeu?")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={atendeu === "sim" ? "default" : "outline"} onClick={() => setAtendeu("sim")}>
                {t("Atendeu")}
              </Button>
              <Button type="button" variant={atendeu === "nao" ? "default" : "outline"} onClick={() => setAtendeu("nao")}>
                {t("Não atendeu")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ligacao-resumo">{t("Resumo em uma frase")}</Label>
            <Textarea
              id="ligacao-resumo"
              rows={2}
              maxLength={280}
              value={resumo}
              onChange={(e) => setResumo(e.target.value)}
              placeholder={atendeu === "nao" ? t("Ex.: caixa postal") : t("Ex.: quer ver o carro no sábado com a esposa")}
            />
          </div>

          {atendeu === "nao" ? (
            <p className="text-xs text-muted-foreground">
              {t("Se esta for a primeira tentativa, o sistema cria mais uma ligação ainda hoje.")}
            </p>
          ) : null}

          {atendeu === "sim" ? (
            <div className="space-y-1.5">
              <Label htmlFor="ligacao-proximo">{t("Próximo passo")}</Label>
              <Select value={proximo} onValueChange={(v) => setProximo(v as Proximo)}>
                <SelectTrigger id="ligacao-proximo">
                  <SelectValue placeholder={t("Escolha")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agendou">{t("Agendou visita ou vídeo")}</SelectItem>
                  <SelectItem value="retornar">{t("Retornar em outra data")}</SelectItem>
                  <SelectItem value="sem_interesse">{t("Não tem interesse")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {precisaData ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ligacao-dia">{t("Data")}</Label>
                <Input id="ligacao-dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ligacao-hora">{t("Horário")}</Label>
                <Input id="ligacao-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              </div>
            </div>
          ) : null}

          {atendeu === "sim" && proximo === "sem_interesse" ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ligacao-motivo">{t("Motivo")}</Label>
                <Select value={motivo} onValueChange={setMotivo}>
                  <SelectTrigger id="ligacao-motivo">
                    <SelectValue placeholder={t("Escolha")} />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_SEM_INTERESSE.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(ROTULO_DO_MOTIVO_CANONICO[m])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                aria-label={t("Detalhe do motivo")}
                maxLength={200}
                value={detalhe}
                onChange={(e) => setDetalhe(e.target.value)}
                placeholder={t("Detalhe (opcional)")}
              />
            </div>
          ) : null}

          {erro ? (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          ) : null}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" disabled={enviando} onClick={aoFechar}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando ? t("Salvando…") : t("Registrar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
