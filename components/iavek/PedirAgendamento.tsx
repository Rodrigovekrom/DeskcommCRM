"use client";
/**
 * ia.vek v1.7.6 — "Pedir agendamento": o SDR (ou o vendedor) repassa cliente,
 * dia e hora desejados e uma observação; o ADMIN confirma no Meu dia. Não
 * reserva horário. Quem é admin continua marcando direto pela Agenda.
 */
import { useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
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
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

interface TipoDeAtendimento {
  id: string;
  name: string;
  is_active?: boolean;
}

function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function PedirAgendamento({
  contactId,
  conversationId,
  leadId,
}: {
  contactId: string;
  conversationId?: string | null;
  leadId?: string | null;
}) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [quando, setQuando] = useState("");
  const [abertoEm, setAbertoEm] = useState(0);
  const [tipoId, setTipoId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [tipos, setTipos] = useState<TipoDeAtendimento[]>([]);
  const [enviando, setEnviando] = useState(false);

  const alvo = quando ? new Date(quando).getTime() : NaN;
  const valido = Number.isFinite(alvo) && alvo > abertoEm;

  async function abrir() {
    const agora = Date.now();
    setAbertoEm(agora);
    setQuando(paraCampoLocal(new Date(agora + 24 * 3600_000)));
    setObservacao("");
    setAberto(true);
    try {
      const r = await apiClient.get<{ data: TipoDeAtendimento[] }>("/api/v1/agenda/tipos");
      setTipos((r.data ?? []).filter((x) => x.is_active !== false));
    } catch {
      setTipos([]);
    }
  }

  async function enviar() {
    if (!valido) return;
    setEnviando(true);
    try {
      await apiClient.post("/api/v1/iavek/pedidos-de-agendamento", {
        contact_id: contactId,
        ...(leadId ? { lead_id: leadId } : {}),
        ...(conversationId ? { conversation_id: conversationId } : {}),
        quando: new Date(quando).toISOString(),
        ...(tipoId ? { event_type_id: tipoId } : {}),
        ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
      });
      toast.success(t("Pedido enviado. O administrador confirma o agendamento."));
      setAberto(false);
    } catch (e) {
      showApiError(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => void abrir()}
        data-testid="pedir-agendamento"
      >
        {t("Pedir agendamento")}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Pedir agendamento")}</DialogTitle>
            <DialogDescription>
              {t(
                "O administrador recebe o pedido e confirma o agendamento. Nada fica reservado até lá.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pedido-quando">{t("Dia e hora desejados")}</Label>
              <Input
                id="pedido-quando"
                type="datetime-local"
                value={quando}
                min={paraCampoLocal(new Date(abertoEm))}
                onChange={(e) => setQuando(e.target.value)}
              />
            </div>
            {tipos.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="pedido-tipo">{t("Tipo de atendimento")}</Label>
                <select
                  id="pedido-tipo"
                  value={tipoId}
                  onChange={(e) => setTipoId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">{t("O administrador escolhe")}</option>
                  {tipos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="pedido-observacao">{t("Observação")}</Label>
              <textarea
                id="pedido-observacao"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                maxLength={1000}
                rows={3}
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              {t("Cancelar")}
            </Button>
            <Button
              onClick={() => void enviar()}
              disabled={!valido || enviando}
              data-testid="enviar-pedido"
            >
              {t("Enviar pedido")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
