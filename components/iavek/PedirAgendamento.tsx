"use client";
/**
 * ia.vek v1.7.6 — "Pedir agendamento": o SDR (ou o vendedor) repassa cliente,
 * dia e hora desejados e uma observação; o ADMIN confirma no Meu dia. Não
 * reserva horário. Quem é admin continua marcando direto pela Agenda.
 *
 * ia.vek v1.9.3: o SDR DA LOJA MARCA direto (decisão do Rodrigo, 27/10): a
 * janela vira "Marcar agendamento", ele escolhe o VENDEDOR, e o compromisso
 * nasce confirmado — o vendedor é avisado no sino.
 *
 * ia.vek v1.9.48: na LOJA, TODOS marcam assim (decisão de 06/11 e 10/11: "todos agendam, sem passo
 * intermediário"). Quem marca é o SERVIDOR que diz (`marca_direto` do /agenda-do-sdr); esta tela NÃO
 * olha a função de ninguém. O vendedor já vem escolhido como ele mesmo. Na clínica, segue o pedido.
 */
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useAuth } from "@/hooks/auth/AuthProvider";
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
import { type CamposDaPassagem } from "@/lib/iavek/passagem";
import { CamposDaPassagemForm, camposIniciais, camposParaEnviar } from "@/components/iavek/CamposDaPassagemForm";

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
  rotulo,
  contactId,
  conversationId,
  leadId,
  abrirAgora,
  aoFechar,
  aoEnviar,
}: {
  /** v1.9.18: o texto do botão. */
  rotulo?: string;
  contactId: string;
  conversationId?: string | null;
  leadId?: string | null;
  /** v1.9.20: aberta por quem chama, sem o botão (mover para Agendado sem horário). */
  abrirAgora?: boolean;
  aoFechar?: () => void;
  aoEnviar?: () => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [quando, setQuando] = useState("");
  const [abertoEm, setAbertoEm] = useState(0);
  const [tipoId, setTipoId] = useState("");
  const [observacao, setObservacao] = useState("");
  // v1.9.38 (CRM-256): título livre. `null` = segue o nome do tipo escolhido; texto = o que a pessoa
  // escreveu. Em branco, o compromisso nasce com o nome do tipo, como sempre.
  const [tituloEditado, setTituloEditado] = useState<string | null>(null);
  const [tipos, setTipos] = useState<TipoDeAtendimento[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [marcaDireto, setMarcaDireto] = useState(false);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [vendedorId, setVendedorId] = useState("");
  // v1.9.4 (CRM-209): a passagem por agendamento leva os 7 campos e o contexto.
  const [campos, setCampos] = useState<CamposDaPassagem>({});
  const [contexto, setContexto] = useState("");

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

  const titulo = tituloEditado ?? tipos.find((x) => x.id === tipoId)?.name ?? "";
  const alvo = quando ? new Date(quando).getTime() : NaN;
  const valido =
    Number.isFinite(alvo) &&
    alvo > abertoEm &&
    (!marcaDireto ||
      // ia.vek 0613 (CRM-255/257): marcar direto pede só o lead, o dia e a hora (o vendedor também);
      // o tipo, os campos e o contexto são opcionais (sem tipo, vale o primeiro ativo).
      Boolean(vendedorId));

  async function abrir() {
    const agora = Date.now();
    setAbertoEm(agora);
    setQuando(paraCampoLocal(new Date(agora + 24 * 3600_000)));
    setObservacao("");
    setTituloEditado(null);
    // v1.9.48: o vendedor que marca o próprio cliente já vem escolhido; os demais escolhem.
    setVendedorId(vendedores.some((v) => v.id === user.id) ? user.id : "");
    setContexto("");
    setAberto(true);
    if (marcaDireto && leadId) {
      apiClient
        .get<{ data: { campos: Record<string, unknown> } }>(`/api/v1/iavek/passagem?lead_id=${leadId}`)
        .then((r) => setCampos(camposIniciais(r.data?.campos)))
        .catch(() => setCampos({}));
    }
    try {
      const r = await apiClient.get<{ data: TipoDeAtendimento[] }>("/api/v1/agenda/tipos");
      setTipos((r.data ?? []).filter((x) => x.is_active !== false));
    } catch {
      setTipos([]);
    }
  }

  // v1.9.20: quem chama abre a janela, sem o botão.
  const abrirRef = useRef(abrir);
  useEffect(() => {
    abrirRef.current = abrir;
  });
  useEffect(() => {
    if (abrirAgora) void abrirRef.current();
  }, [abrirAgora]);

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
        ...(titulo.trim() ? { titulo: titulo.trim() } : {}),
        ...(marcaDireto ? { vendedor_id: vendedorId, campos: camposParaEnviar(campos), contexto: contexto.trim() } : {}),
      });
      toast.success(
        marcaDireto
          ? t("Agendamento marcado. O vendedor foi avisado.")
          : t("Pedido enviado. O administrador confirma o agendamento."),
      );
      setAberto(false);
      aoEnviar?.();
    } catch (e) {
      showApiError(e);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      {abrirAgora === undefined && (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => void abrir()}
        data-testid="pedir-agendamento"
      >
        {rotulo ?? (marcaDireto ? t("Marcar agendamento") : t("Pedir agendamento"))}
      </Button>
      )}
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) aoFechar?.();
        }}
      >
        <DialogContent className={marcaDireto ? "max-h-[90vh] overflow-y-auto sm:max-w-xl" : "sm:max-w-md"}>
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
                  onChange={(e) => {
                    setTipoId(e.target.value);
                    // Tipo novo, título novo: quem não escreveu nada segue o nome do tipo.
                    setTituloEditado(null);
                  }}
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
              <Label htmlFor="pedido-titulo">{t("Título")}</Label>
              <Input
                id="pedido-titulo"
                data-testid="pedido-titulo"
                value={titulo}
                maxLength={200}
                onChange={(e) => setTituloEditado(e.target.value)}
                placeholder={t("Em branco, vale o nome do tipo")}
              />
            </div>
            {marcaDireto && (
              <div className="space-y-1 rounded-md border border-border p-2">
                <p className="text-xs font-medium">{t("Para o vendedor (obrigatório)")}</p>
                <CamposDaPassagemForm valor={campos} aoMudar={setCampos} contexto={contexto} aoMudarContexto={setContexto} />
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
