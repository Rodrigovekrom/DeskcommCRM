"use client";
import { useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DotsThree, PencilSimple, Users } from "@/lib/ui/icons";
import { useWinLead, useEditLead } from "@/hooks/kanban/useUpdateLead";
import { useBulkAction } from "@/hooks/kanban/useBulkAction";
import { usePropostaEnviadaDoLead } from "@/hooks/kanban/usePropostaEnviadaDoLead";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import { useFuncaoVistaOpcional, usePermission } from "@/hooks/auth/AuthProvider";
import { trocaResponsavel } from "@/lib/iavek/funcoes";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { LoseLeadDialog } from "./LoseLeadDialog";
import { VendaDialog } from "./VendaDialog";
import { MoveToOtherPipelineDialog } from "./MoveToOtherPipelineDialog";
import { EditLeadDialog } from "./EditLeadDialog";
import type { Lead } from "@/lib/types/leads";

interface KanbanCardActionsProps {
  lead: Lead;
  pipelineId: string;
}

export function KanbanCardActions({ lead, pipelineId }: KanbanCardActionsProps) {
  const t = useT();
  const [loseOpen, setLoseOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // ia.vek v1.9.12: na loja de carros, a venda pede valor final e data.
  const [vendaOpen, setVendaOpen] = useState(false);
  const { lojaDeCarros } = usePerfilDaEmpresa();
  const winMutation = useWinLead(pipelineId);
  const editMutation = useEditLead(pipelineId);
  // Excluir um card é a mesma ação da barra de seleção, com um id só: mesma
  // rota, mesmo gate de papel, mesmo evento e auditoria.
  const bulk = useBulkAction(pipelineId);
  // D10: só consulta quando o diálogo de excluir abre — não é gasto em toda
  // renderização do card.
  const { data: propostaEnviada } = usePropostaEnviadaDoLead(lead.id, deleteOpen);
  // spec 13 §4: escrita no funil é agent+ — viewer não reatribui (a rota
  // PATCH também recusa; aqui é só não oferecer o que seria negado).
  const canAssign = usePermission("pipeline.move_card");
  // ia.vek CRM-244 (Fase 1, decisão do Rodrigo): trocar o responsável é de guardião, gerente e
  // admin. O vendedor não vê a opção (o PATCH também recusa: `responsavel_so_gestao`). Lê a
  // função VISTA, para o "Ver como vendedor" mostrar o que o vendedor vê.
  const funcaoVista = useFuncaoVistaOpcional();
  const podeTrocarResponsavel = canAssign && trocaResponsavel(funcaoVista);
  const { data: members } = useAssignableMembers(podeTrocarResponsavel);
  // A rota já devolve só agente ativo e não arquivado — é o picker.
  const { data: agents } = useAssignableAgents(podeTrocarResponsavel);
  // ia.vek CRM-244 (Fase 1): busca por nome na lista do responsável.
  const [busca, setBusca] = useState("");
  // A lista é controlada aqui. Sem isto, o quadro que se mexe sob o mouse parado (o selo
  // "Incompleto" chega depois, em lotes, e empurra os cartões) fechava a lista no meio da busca.
  const [listaAberta, setListaAberta] = useState(false);
  const fecharLista = () => {
    setListaAberta(false);
    setBusca("");
  };
  const casa = (nome: string | null | undefined) => contemONome(nome, busca);
  const membrosVistos = (members ?? []).filter((m) => casa(m.full_name));
  const agentesVistos = (agents ?? []).filter((a) => casa(a.name));

  const reassignToUser = (ownerUserId: string | null) => {
    if (ownerUserId === lead.owner_user_id) return;
    editMutation.mutate({ leadId: lead.id, patch: { owner_user_id: ownerUserId } });
  };

  /** Transferir para um agente: o handler zera o dono humano e deriva owner_kind. */
  const reassignToAgent = (agentId: string) => {
    if (agentId === lead.owner_agent_id) return;
    editMutation.mutate({ leadId: lead.id, patch: { owner_agent_id: agentId } });
  };

  const clearOwner = () => {
    if (lead.owner_user_id === null && lead.owner_agent_id === null) return;
    editMutation.mutate({
      leadId: lead.id,
      patch: lead.owner_agent_id ? { owner_agent_id: null } : { owner_user_id: null },
    });
  };

  return (
    /*
      A BARREIRA DE CLIQUE DO CARD — `display: contents`, não uma caixa.
      O card inteiro tem `onClick={handleClick}`
      (`components/kanban/KanbanCard.tsx`), e `decidirClique` NÃO inspeciona o
      alvo: qualquer clique que suba até lá abre o dossiê do lead. Os três
      diálogos daqui e o menu são renderizados em PORTAL, e portal do React
      propaga evento pela ÁRVORE REACT — ou seja, pelo card. Medido em jsdom
      antes desta linha: clicar no overlay da confirmação de excluir — o gesto
      padrão de desistir — abria o dossiê ATRÁS de uma janela que nem fecha (o
      `AlertDialog` não fecha por clique fora, de propósito).
      `display: contents` não cria caixa: o layout do card não muda, e a árvore
      React passa a interceptar os cliques de todo overlay portado daqui.
      Vigiado por `tests/unit/kanban-card-excluir.test.tsx`, com o controle
      positivo de que clicar no CARD continua abrindo o dossiê.
    */
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu onOpenChange={(aberto) => !aberto && fecharLista()}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            // Visível por padrão e escondido até o hover SÓ onde existe hover:
            // no toque não há hover, e `opacity-0` deixava o menu inalcançável.
            // Mesmo padrão de `components/inbox/MessageBubble.tsx`.
            className="h-7 w-7 shrink-0 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("Ações do lead")}
          >
            <DotsThree size={16} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            onSelect={() => {
              setEditOpen(true);
            }}
          >
            <PencilSimple size={14} className="mr-2" /> {t("Editar")}
          </DropdownMenuItem>
          {podeTrocarResponsavel && (
            <DropdownMenuSub
              open={listaAberta}
              // Abre pelo Radix (clique ou ponteiro); fecha SÓ por ação de quem usa: Esc, escolher
              // alguém ou fechar o menu. O "ponteiro saiu do item" não fecha: quando o quadro desce
              // sob o mouse parado, o ponteiro cai em outro item, que toma o foco do campo, e a lista
              // fechava no meio da busca (medido no canário duas vezes).
              onOpenChange={(aberto) => {
                if (aberto) setListaAberta(true);
              }}
            >
              <DropdownMenuSubTrigger data-testid="menu-responsavel">
                <Users size={14} className="mr-2" /> {t("Responsável")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
                <div className="sticky top-0 z-10 bg-popover p-1">
                  <input
                    type="search"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    // O menu do Radix usa as teclas para navegar e para a busca por letra:
                    // aqui a tecla é do campo (só Esc e as setas seguem para o menu).
                    onKeyDown={(e) => {
                      if (e.key === "Escape") fecharLista();
                      else if (!["ArrowDown", "ArrowUp"].includes(e.key)) e.stopPropagation();
                    }}
                    placeholder={t("Buscar por nome")}
                    aria-label={t("Buscar responsável por nome")}
                    data-testid="busca-responsavel"
                    className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-hidden focus:border-accent"
                    autoFocus
                  />
                </div>
                <DropdownMenuItem
                  disabled={
                    editMutation.isPending ||
                    (lead.owner_user_id === null && lead.owner_agent_id === null)
                  }
                  onSelect={clearOwner}
                >
                  {t("Sem responsável")}
                </DropdownMenuItem>
                {membrosVistos.length > 0 && <DropdownMenuSeparator />}
                {membrosVistos.map((m) => (
                  <DropdownMenuItem
                    key={m.user_id}
                    disabled={editMutation.isPending || m.user_id === lead.owner_user_id}
                    onSelect={() => reassignToUser(m.user_id)}
                  >
                    {m.full_name ?? t("Sem nome")}
                  </DropdownMenuItem>
                ))}
                {agentesVistos.length > 0 && <DropdownMenuSeparator />}
                {agentesVistos.map((a) => (
                  <DropdownMenuItem
                    key={a.agent_id}
                    disabled={editMutation.isPending || a.agent_id === lead.owner_agent_id}
                    onSelect={() => reassignToAgent(a.agent_id)}
                  >
                    {a.name}
                    {a.version_number != null && (
                      <span className="ml-1.5 font-mono text-[10px] text-text-muted">
                        v{a.version_number}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
                {busca.trim() !== "" && membrosVistos.length === 0 && agentesVistos.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-text-muted">{t("Ninguém com esse nome.")}</p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem
            disabled={winMutation.isPending}
            onSelect={() => {
              if (lojaDeCarros) setVendaOpen(true);
              else winMutation.mutate({ leadId: lead.id });
            }}
          >
            {t("Marcar como ganho")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setLoseOpen(true);
            }}
          >
            {t("Marcar como perdido")}
          </DropdownMenuItem>
          {/*
            `canAssign` já É `usePermission("pipeline.move_card")` — a MESMA
            permissão que `POST /api/v1/leads/[id]/clone` exige no servidor
            (`requireRole("agent")`). Mostrar o item a quem o servidor
            recusaria seria prometer o que não se cumpre.
          */}
          {canAssign && (
            <DropdownMenuItem
              onSelect={() => {
                setMoveOpen(true);
              }}
            >
              {t("Levar para outro funil")}
            </DropdownMenuItem>
          )}
          {canAssign && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-error-fg"
                disabled={bulk.isPending}
                onSelect={() => {
                  setDeleteOpen(true);
                }}
              >
                {t("Excluir")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        `AlertDialog`, e não `Dialog`: é o padrão que
        `docs/doctrine/destrutivo-pede-confirmacao.md` (§Como aplicar) fixa para
        o clique que apaga trabalho, o mesmo de `DeleteFollowupFlowButton`. A
        diferença não é cosmética — o `Dialog` comum fecha ao clicar fora, e
        fechar por engano é justamente o gesto que a confirmação existe para
        impedir.
      */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{`${t("Excluir")} "${lead.title}"?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "O card sai do funil com o histórico de atividades. O contato e as conversas continuam. Esta ação não pode ser desfeita.",
              )}
              {propostaEnviada && (
                <>
                  {" "}
                  {t("O negócio some; a proposta")} {String(propostaEnviada.numero).padStart(4, "0")}/
                  {propostaEnviada.ano} {t("continua em Propostas")}.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
            {/*
              `preventDefault` porque o `AlertDialogAction` fecha o diálogo no
              próprio clique: sem ele a janela sumiria ANTES de o servidor
              responder, e um erro chegaria sobre uma tela que já diz "pronto".
              Quem fecha é o `onSuccess`; quem impede o envio em dobro enquanto
              isso é o `disabled`.
            */}
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={bulk.isPending}
              onClick={(e) => {
                e.preventDefault();
                bulk.mutate(
                  { action: "delete", lead_ids: [lead.id], params: {} },
                  { onSuccess: () => setDeleteOpen(false) },
                );
              }}
            >
              {t("Excluir")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VendaDialog
        open={vendaOpen}
        onOpenChange={setVendaOpen}
        valorSugeridoCents={lead.value_cents}
        isPending={winMutation.isPending}
        onConfirmar={(venda) => {
          setVendaOpen(false);
          winMutation.mutate({ leadId: lead.id, venda });
        }}
      />
      <LoseLeadDialog
        open={loseOpen}
        onOpenChange={setLoseOpen}
        leadId={lead.id}
        pipelineId={pipelineId}
      />
      <MoveToOtherPipelineDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        leadId={lead.id}
        pipelineId={pipelineId}
      />
      <EditLeadDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={lead}
        pipelineId={pipelineId}
      />
    </span>
  );
}

/** ia.vek CRM-244: busca por nome sem diferença de maiúscula nem acento ("jose" acha "José"). */
export function contemONome(nome: string | null | undefined, busca: string): boolean {
  const limpo = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const b = limpo(busca);
  return b === "" || limpo(nome ?? "").includes(b);
}
