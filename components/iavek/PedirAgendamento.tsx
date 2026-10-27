"use client";
/**
 * ia.vek v1.7.6 — "Pedir agendamento": o SDR (ou o vendedor) repassa cliente,
 * dia e hora desejados e uma observação; o ADMIN confirma no Meu dia. Não
 * reserva horário. Quem é admin continua marcando direto pela Agenda.
 *
 * ia.vek v1.9.3: o SDR DA LOJA MARCA direto (decisão do Rodrigo, 27/10): a
 * janela vira "Marcar agendamento", ele escolhe o VENDEDOR, e o compromisso
 * nasce confirmado — o vendedor é avisado no sino. Para os demais, igual.
 */
import { useEffect, useState } from "react";
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

interface Vendedor {
  id: string;
  nome: string;
}

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
  const [marcaDireto, setMarcaDireto] = useState(false);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [vendedorId, setVendedorId] = useState("");

  // v1.9.3: quem marca direto (SDR da loja) já sabe ao montar, para o botão
  // dizer "Marcar agendamento". Falhou a leitura: segue o pedido de sempre.
  useEffect(() => {
    let vivo = true;
    apiClient
      .get<{ data: { marca_direto: boolean; vendedores: Vendedor[] } }>("/api/v1/iavek/agenda-do-sdr")
      .then((r) => {
        if (!vivo) return;
        setMarcaDireto(Boolean(r.data?.marca_direto));
        setVendedores(r.data?.vendedores ?? []);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const alvo = quando ? new Date(quando).getTime() : NaN;
  const valido =
    Number.isFinite(alvo) &&
    alvo > abertoEm &&
    (!marcaDireto || (Boolean(vendedorId) && (Boolean(tipoId) || tipos.length <= 1)));

  async function abrir() {
    const agora = Date.now();
    setAbertoEm(agora);
    setQuando(paraCampoLocal(new Date(agora + 24 * 3600_000)));
    setObservacao("");
    setVendedorId("");
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
        ...(marcaDireto ? { vendedor_id: vendedorId } : {}),
      });
      toast.success(
        marcaDireto
          ? t("Agendamento marcado. O vendedor foi avisado.")
          : t("Pedido enviado. O administrador confirma o agendamento."),
      );
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
        {marcaDireto ? t("Marcar agendamento") : t("Pedir agendamento")}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{marcaDireto ? t("Marcar agendamento") : t("Pedir agendamento")}</DialogTitle>
            <DialogDescription>
              {marcaDireto
                ? t("Escolha o vendedor. O agendamento já fica confirmado e ele é avisado na hora.")
                : t(
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
            {marcaDireto && (
              <div className="space-y-1">
                <Label htmlFor="pedido-vendedor">{t("Vendedor")}</Label>
                <select
                  id="pedido-vendedor"
                  value={vendedorId}
                  onChange={(e) => setVendedorId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  data-testid="pedido-vendedor"
                >
                  <option value="">{t("Escolha o vendedor")}</option>
                  {vendedores.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tipos.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="pedido-tipo">{t("Tipo de atendimento")}</Label>
                <select
                  id="pedido-tipo"
                  value={tipoId}
                  onChange={(e) => setTipoId(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="">
                    {marcaDireto ? t("Escolha o tipo") : t("O administrador escolhe")}
                  </option>
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
              {marcaDireto ? t("Marcar") : t("Enviar pedido")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
