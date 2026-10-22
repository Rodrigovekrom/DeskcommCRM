"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { DadosDaCompraNoCard, DadosDaCompraNoCardContext } from "@/components/iavek/DadosDaCompraNoCard";
import { PadraoDoLead } from "@/components/iavek/PadraoDoLead";
import { ChatThread } from "@/components/inbox/ChatThread";
import { Composer, type ComposerHandle } from "@/components/inbox/Composer";
import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { JanelaFechadaAviso } from "@/components/inbox/JanelaFechadaAviso";
import { NumeroForaDoAr } from "@/components/inbox/NumeroForaDoAr";
import { useProximoPassoObrigatorio } from "@/components/inbox/ProximoPassoObrigatorio";
import { RetentionNotice } from "@/components/inbox/RetentionNotice";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { isNotFound } from "@/hooks/inbox/useConversation";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { useMarkAsRead } from "@/hooks/inbox/useMarkAsRead";
import { OpenConversationProvider } from "@/hooks/notifications/OpenConversationContext";
import { apiClient } from "@/lib/api/client";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { estadoDaJanela } from "@/lib/channels/janela";
import { motivoDaJanelaFechada, motivoDoContato } from "@/lib/inbox/motivo-do-envio-bloqueado";
import type { Lead } from "@/lib/types/leads";
import type { Message as ConversationMensagem } from "@/lib/types/messaging";
import { CaretLeft, ChatCircle } from "@/lib/ui/icons";

/**
 * ia.vek v1.8.1 — a CONVERSA DENTRO DO QUADRO.
 *
 * Pedido do Rodrigo: no Kanban, abrir a conversa NÃO leva para a Entrada; abre
 * uma gaveta por cima do quadro só com a conversa, e dá para atender ali — o
 * vendedor fica na tela do funil, focado nos leads.
 *
 * ─── Mesmo atendimento, nenhum caminho novo ─────────────────────────────────
 *
 * A gaveta MONTA as peças da conversa da Entrada (`ConversationHeader`,
 * `ChatThread`, `Composer`, avisos de janela, número fora do ar e retenção) e
 * calcula o bloqueio pelas MESMAS funções (`estadoDaJanela`,
 * `motivoDaJanelaFechada`, `motivoDoContato`). Enviar é o `Composer` de sempre,
 * pela rota de sempre (`sent_via = crm`) — conta no Padrão da loja igual. Quem
 * pode assumir, transferir, pausar a IA ou fechar continua decidido pelo
 * cabeçalho e pelo servidor, por papel e por dono.
 *
 * ─── O quadro fica onde estava ──────────────────────────────────────────────
 *
 * A gaveta é sobreposta: o quadro continua montado embaixo, então fechar (X,
 * Esc, clique fora ou "Voltar" no celular) devolve a mesma rolagem, os mesmos
 * filtros e as mesmas colunas.
 */

export { ConversaNoQuadroContext } from "@/components/iavek/conversa-no-quadro-contexto";

export function ConversaNoQuadro({
  lead,
  nomeDaEtapa,
  pipelineId,
  onFechar,
}: {
  lead: Lead;
  nomeDaEtapa: string;
  pipelineId: string;
  onFechar: () => void;
}) {
  const t = useT();
  // A conversa que a gaveta mostra: a do quadro, ou a que acabou de ser iniciada
  // aqui, ou a outra que a aba "Número" do Transferir mandou abrir.
  const [conversaEscolhida, setConversaEscolhida] = useState<string | null>(null);
  const conversaId = conversaEscolhida ?? lead.conversa?.id ?? null;
  const telefone = lead.contact_phone ? phoneForDisplay(lead.contact_phone) : null;

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-none md:w-[min(46rem,92vw)]"
        data-testid="conversa-no-quadro"
      >
        <div className="flex flex-col gap-1 border-b border-border px-3 py-2 pr-12">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1 px-2 md:hidden"
              onClick={onFechar}
              data-testid="voltar-ao-quadro"
            >
              <CaretLeft size={16} aria-hidden />
              {t("Quadro")}
            </Button>
            <SheetTitle className="min-w-0 truncate text-base font-semibold">{lead.title}</SheetTitle>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="conversa-no-quadro-linha">
            {telefone ? `${telefone} · ` : ""}
            {t("Etapa")}: <strong className="font-medium text-foreground">{nomeDaEtapa}</strong>
            {conversaId && (
              <>
                {" · "}
                <Link
                  href={`/app/inbox?id=${conversaId}`}
                  className="underline underline-offset-2 hover:text-foreground"
                  data-testid="abrir-na-entrada"
                >
                  {t("abrir na Entrada")}
                </Link>
              </>
            )}
          </p>
          {/* Troca e forma de pagamento, os mesmos chips do cartão (2 toques). */}
          <DadosDaCompraNoCardContext.Provider value={{ ligado: true }}>
            <DadosDaCompraNoCard lead={lead} pipelineId={pipelineId} />
          </DadosDaCompraNoCardContext.Provider>
          {/* O padrão da loja (v1.8.0): some sozinho quando o admin o desligou.
              No celular fica de fora: a tela é da conversa (medido em 390×844,
              o checklist deixava ~150px de histórico). O selo continua no
              cartão e a marcação, na ficha da Entrada. */}
          <div className="hidden md:block">
            <div className="max-h-40 overflow-y-auto rounded-md border px-2 py-1.5 empty:hidden">
              <PadraoDoLead leadId={lead.id} />
            </div>
          </div>
        </div>

        {conversaId ? (
          <PainelDaConversa key={conversaId} conversaId={conversaId} onAbrirConversa={setConversaEscolhida} />
        ) : (
          <SemConversa lead={lead} onIniciada={setConversaEscolhida} />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** O intervalo que pega a troca de dono feita por outra pessoa, sem tempo real próprio. */
const RECARGA_DA_CONVERSA_MS = 20_000;

function PainelDaConversa({ conversaId, onAbrirConversa }: { conversaId: string; onAbrirConversa: (id: string) => void }) {
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const supportReadonly = user.support?.access_mode === "support_readonly";
  // A chave começa por "conversations": toda ação do cabeçalho (assumir,
  // devolver, pausar a IA, fechar) já invalida essa família, e a gaveta
  // acompanha sem precisar conhecer cada uma.
  const q = useQuery({
    queryKey: ["conversations", "no-quadro", conversaId],
    retry: false,
    refetchInterval: RECARGA_DA_CONVERSA_MS,
    queryFn: () =>
      apiClient.get<{ data: ConversationWithContact }>(`/api/v1/conversations/${conversaId}`).then((r) => r.data),
  });
  const conversa = q.data ?? null;
  const composerRef = useRef<ComposerHandle | null>(null);
  const [respondendo, setRespondendo] = useState<ConversationMensagem | null>(null);
  const { garantir, dialogo } = useProximoPassoObrigatorio();

  useMarkAsRead(conversa?.id ?? null, conversa?.unread_count_for_assignee ?? 0);

  // Mensagem nova na conversa (tempo real do ChatThread) atualiza também o
  // cartão: a prévia e o "sem ler" do quadro moram em ["board", …].
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const desfazer = qc.getQueryCache().subscribe((ev) => {
      const k = ev.query.queryKey;
      if (ev.type !== "updated" || k[0] !== "messages" || k[1] !== conversaId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ queryKey: ["board"] }), 800);
    });
    return () => {
      desfazer();
      if (timer) clearTimeout(timer);
    };
  }, [qc, conversaId]);

  // A janela vence sozinha com a gaveta aberta — o mesmo relógio da Entrada.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!conversa) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {q.isPending
          ? t("Carregando…")
          : isNotFound(q.error)
            ? t("Conversa não encontrada ou fora do seu acesso.")
            : t("Não foi possível abrir a conversa.")}
      </div>
    );
  }

  const provider = conversa.channel_sessions?.provider ?? null;
  const janela = estadoDaJanela(provider, conversa.last_inbound_at ?? null, agora);
  const motivoDaJanela = motivoDaJanelaFechada(janela, conversa.channel_sessions?.provider, t);
  const blockedReason = motivoDoContato(conversa.contacts, t);

  return (
    <OpenConversationProvider conversationId={conversa.id}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="painel-da-conversa">
        <ConversationHeader
          conversation={conversa}
          onAbrirConversa={onAbrirConversa}
          antesDeEncerrar={(acao) => garantir(conversa, acao)}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatThread
            conversationId={conversa.id}
            searchTerm=""
            provider={provider}
            onResponder={setRespondendo}
            dono={{ userId: conversa.assigned_to_user_id ?? null, nome: conversa.assigned_to_user_name ?? null }}
            contatoId={conversa.contacts?.id ?? null}
          />
        </div>
        <RetentionNotice conversationId={conversa.id} />
        {conversa.contacts?.id && (
          <NumeroForaDoAr
            conversationId={conversa.id}
            channelSessionId={conversa.channel_session_id}
            contactId={conversa.contacts.id}
            contactPhone={conversa.contacts.phone_number ?? null}
            onAbrirConversa={onAbrirConversa}
          />
        )}
        {motivoDaJanela && (
          <JanelaFechadaAviso conversationId={conversa.id} provider={provider} motivo={motivoDaJanela} />
        )}
        <Composer
          ref={composerRef}
          conversationId={conversa.id}
          blockedReason={supportReadonly ? "Acompanhamento somente leitura" : blockedReason}
          janelaFechada={motivoDaJanela}
          disabled={conversa.status === "closed"}
          contactName={conversa.contacts?.name ?? null}
          respondendo={respondendo}
          onCancelarResposta={() => setRespondendo(null)}
          currentContactId={conversa.contact_id}
          rascunho={null}
          initialDraft=""
        />
      </div>
      {dialogo}
    </OpenConversationProvider>
  );
}

/**
 * Lead sem conversa: a gaveta diz isso e oferece iniciar pela MESMA rota do
 * "Abrir conversa" de sempre (`open-with-contact`), que reaproveita a conversa
 * do contato quando existe e só cria a que falta. Quando não dá, diz por quê.
 */
function SemConversa({ lead, onIniciada }: { lead: Lead; onIniciada: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [iniciando, setIniciando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const telefone = lead.contact_phone?.trim() ?? "";

  let motivo: string | null = null;
  if (!lead.contact_id && !telefone) motivo = t("Este lead não tem contato: não há com quem conversar.");
  else if (!telefone) motivo = t("Sem telefone no contato: cadastre um telefone para abrir a conversa.");

  async function iniciar() {
    if (motivo || iniciando) return;
    setIniciando(true);
    setErro(null);
    try {
      const r = await apiClient.post<{ data: { conversation_id: string } }>("/api/v1/conversations/open-with-contact", {
        contact_id: lead.contact_id || undefined,
        phone_number: telefone,
      });
      await qc.invalidateQueries({ queryKey: ["board"] });
      onIniciada(r.data.conversation_id);
    } catch (e) {
      setErro(e instanceof Error && e.message ? t(e.message) : t("Não foi possível abrir a conversa."));
    } finally {
      setIniciando(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="sem-conversa">
      <ChatCircle size={36} weight="thin" className="text-text-subtle" aria-hidden />
      <p className="text-sm font-medium">{t("Este lead ainda não tem conversa.")}</p>
      {motivo ? (
        <p className="text-xs text-muted-foreground" data-testid="motivo-sem-conversa">
          {motivo}
        </p>
      ) : (
        <Button size="sm" onClick={() => void iniciar()} disabled={iniciando} data-testid="iniciar-conversa">
          {iniciando ? t("Abrindo…") : t("Iniciar conversa")}
        </Button>
      )}
      {erro && (
        <p className="text-xs text-destructive" role="alert" data-testid="erro-iniciar-conversa">
          {erro}
        </p>
      )}
    </div>
  );
}
