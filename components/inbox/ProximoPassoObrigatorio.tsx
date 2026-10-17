"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { buscarPainelIavek, chaveDoPainelIavek } from "@/hooks/iavek/usePainelIavek";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { apiClient } from "@/lib/api/client";
import {
  SOURCE_KIND_PROXIMO_PASSO,
  exigeProximoPasso,
  quandoPadrao,
} from "@/lib/iavek/proximo-passo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AcaoDeSaida = "fechar" | "arquivar" | "aviso";

interface Pedido {
  conversa: ConversationWithContact;
  acao: AcaoDeSaida;
  leadId: string | null;
  resolver: (seguir: boolean) => void;
}

/** `datetime-local` quer "AAAA-MM-DDTHH:mm" no fuso de quem preenche. */
function paraCampoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ia.vek v1.5: o próximo passo obrigatório (regra em `lib/iavek/proximo-passo.ts`).
 *
 * - `garantir(conversa, "fechar" | "arquivar")`: TRAVA. Se o humano dono da
 *   conversa não tem próximo passo aberto para o contato, abre o pedido e só
 *   devolve `true` depois de salvo; cancelar devolve `false` e a ação não segue.
 * - `avisarSaida(conversa)`: AVISO ao trocar de conversa, sem impedir a troca.
 *
 * Leitura que falha não trava ninguém: o pior caso é não cobrar uma vez, e
 * prender o atendente por causa de uma rede instável seria pior.
 */
export function useProximoPassoObrigatorio(): {
  garantir: (conversa: ConversationWithContact | null, acao: AcaoDeSaida) => Promise<boolean>;
  avisarSaida: (conversa: ConversationWithContact | null) => void;
  dialogo: ReactNode;
} {
  const { user } = useAuth();
  const qc = useQueryClient();
  const t = useT();
  const [pedido, setPedidoState] = useState<Pedido | null>(null);
  // O pedido aberto também vive numa ref: resolver a promessa é efeito, e não
  // pode morar dentro do atualizador de estado (que o React pode rodar 2x).
  const pedidoRef = useRef<Pedido | null>(null);
  const setPedido = useCallback((p: Pedido | null) => {
    pedidoRef.current = p;
    setPedidoState(p);
  }, []);
  const somenteLeitura = user.support?.access_mode === "support_readonly";

  const pendente = useCallback(
    async (conversa: ConversationWithContact | null) => {
      if (somenteLeitura || !conversa || !exigeProximoPasso(conversa, user.id)) return null;
      try {
        const painel = await qc.fetchQuery({
          queryKey: chaveDoPainelIavek(conversa.contact_id),
          queryFn: () => buscarPainelIavek(conversa.contact_id),
          staleTime: 0,
        });
        return painel.proximo_passo ? null : { leadId: painel.lead?.id ?? null };
      } catch {
        return null;
      }
    },
    [qc, somenteLeitura, user.id],
  );

  const garantir = useCallback(
    async (conversa: ConversationWithContact | null, acao: AcaoDeSaida) => {
      const falta = await pendente(conversa);
      if (!falta || !conversa) return true;
      return new Promise<boolean>((resolver) =>
        setPedido({ conversa, acao, leadId: falta.leadId, resolver }),
      );
    },
    [pendente, setPedido],
  );

  const avisarSaida = useCallback(
    (conversa: ConversationWithContact | null) => {
      void pendente(conversa).then((falta) => {
        if (!falta || !conversa) return;
        const nome = conversa.contacts?.name ?? t("este contato");
        toast.warning(
          t("Você saiu de {nome} sem marcar o próximo passo.").replace("{nome}", nome),
          {
            action: {
              label: t("Marcar agora"),
              onClick: () =>
                setPedido({ conversa, acao: "aviso", leadId: falta.leadId, resolver: () => {} }),
            },
          },
        );
      });
    },
    [pendente, setPedido, t],
  );

  const encerrar = useCallback(
    (seguir: boolean) => {
      const atual = pedidoRef.current;
      setPedido(null);
      atual?.resolver(seguir);
    },
    [setPedido],
  );

  const dialogo = pedido ? (
    <DialogoDoProximoPasso
      key={`${pedido.conversa.id}:${pedido.acao}`}
      pedido={pedido}
      userId={user.id}
      onSalvo={async () => {
        await qc.invalidateQueries({ queryKey: chaveDoPainelIavek(pedido.conversa.contact_id) });
        encerrar(true);
      }}
      onCancelar={() => encerrar(false)}
    />
  ) : null;

  return { garantir, avisarSaida, dialogo };
}

function DialogoDoProximoPasso({
  pedido,
  userId,
  onSalvo,
  onCancelar,
}: {
  pedido: Pedido;
  userId: string;
  onSalvo: () => Promise<void>;
  onCancelar: () => void;
}) {
  const t = useT();
  const [oQue, setOQue] = useState("");
  const [quando, setQuando] = useState(() => paraCampoLocal(quandoPadrao(new Date())));
  const [salvando, setSalvando] = useState(false);
  const salvou = useRef(false);

  const quandoData = new Date(quando);
  const valido = oQue.trim().length >= 3 && !Number.isNaN(quandoData.getTime());
  const nome = pedido.conversa.contacts?.name ?? t("este contato");

  async function salvar() {
    if (!valido || salvando) return;
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/tasks", {
        title: oQue.trim(),
        due_date: quandoData.toISOString(),
        contact_id: pedido.conversa.contact_id,
        lead_id: pedido.leadId,
        assigned_to: userId,
        source_kind: SOURCE_KIND_PROXIMO_PASSO,
      });
      salvou.current = true;
      toast.success(t("Próximo passo marcado."));
      await onSalvo();
    } catch {
      toast.error(t("Não consegui salvar o próximo passo. Tente de novo."));
      setSalvando(false);
    }
  }

  const explicacao =
    pedido.acao === "fechar"
      ? t("Antes de fechar a conversa com {nome}, diga o que acontece a seguir e quando.")
      : pedido.acao === "arquivar"
        ? t("Antes de arquivar a conversa com {nome}, diga o que acontece a seguir e quando.")
        : t("Diga o que acontece a seguir com {nome} e quando.");

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !salvou.current) onCancelar();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialogo-proximo-passo">
        <DialogHeader>
          <DialogTitle>{t("Próximo passo")}</DialogTitle>
          <DialogDescription>{explicacao.replace("{nome}", nome)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("O quê")}</span>
            <input
              autoFocus
              value={oQue}
              maxLength={255}
              onChange={(e) => setOQue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void salvar();
              }}
              placeholder={t("Ex.: ligar para confirmar o test drive")}
              data-testid="proximo-passo-oque"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-1 focus:ring-ring focus:outline-hidden"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t("Quando")}</span>
            <input
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
              data-testid="proximo-passo-quando"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-1 focus:ring-ring focus:outline-hidden"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancelar} disabled={salvando}>
            {pedido.acao === "aviso" ? t("Agora não") : t("Cancelar")}
          </Button>
          <Button
            onClick={() => void salvar()}
            disabled={!valido || salvando}
            data-testid="proximo-passo-salvar"
          >
            {salvando
              ? t("Salvando…")
              : pedido.acao === "aviso"
                ? t("Salvar")
                : t("Salvar e continuar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
