"use client";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DragDropContext, useKeyboardSensor, type DropResult } from "@hello-pangea/dnd";
import { useT } from "@/hooks/i18n/useT";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoard } from "@/hooks/kanban/useBoard";
import { useMoveCard, type RecusaDeCampos, type RetomadaPendente, type TravaDaLoja } from "@/hooks/kanban/useMoveCard";
import { useRenameStage } from "@/hooks/kanban/useRenameStage";
import { CamposObrigatoriosDialog } from "./CamposObrigatoriosDialog";
import { TravaDosCamposDialog } from "@/components/iavek/TravaDosCamposDialog";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAtRiskLeads } from "@/hooks/leads/useAtRiskLeads";
import { useReactivations } from "@/hooks/leads/useReactivations";
import { midpoint } from "@/lib/kanban/fractional-indexing";
import type { Lead } from "@/lib/types/leads";
import type { Pipeline, Stage } from "@/lib/kanban/types";
import { StageColumn } from "./StageColumn";
import { nivelDaEtapa } from "@/lib/kanban/tom-da-etapa";
import { LeadDossier } from "./LeadDossier";
import { RetomarComoNovoNegocioDialog } from "./RetomarComoNovoNegocioDialog";
import { usePerfilDaEmpresa } from "@/hooks/iavek/usePerfilDaEmpresa";
import { VendaDialog } from "./VendaDialog";
import { toast } from "sonner";
import { MoverNoQuadroContext, type ColunaDoMenu } from "./mover-no-quadro";
import { useSensorDoArrasto } from "./sensor-do-arrasto";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { compararLeads, ehColunaDaIa, manterOrdem, type OrdemDoQuadro } from "@/lib/iavek/ordem-do-quadro";
import { LoseLeadDialog } from "./LoseLeadDialog";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { ConversaNoQuadro, ConversaNoQuadroContext } from "@/components/iavek/ConversaNoQuadro";
import { CartaoIavekContext } from "@/components/iavek/CartaoIavek";
import { ComIncompletos } from "@/components/iavek/CamposObrigatorios";

interface KanbanBoardProps {
  pipelineId: string;
  /** Optional override: if provided, skips internal useBoard fetch. */
  stages?: Stage[];
  leads?: Lead[];
  pipeline?: Pipeline;
  selectedIds?: string[];
  /**
   * Ids que chegaram por evento remoto, quando o board recebe os dados de fora.
   *
   * Quem assina o realtime é quem chama `useBoard` com o pipeline — e nesta
   * página é o _client, não este componente (aqui `useBoard(null)` fica
   * desligado por causa do `useExternal`). Sem esta prop o pulso nasce no lugar
   * certo e morre na fronteira: o dado vem por prop e o sinal ficava para trás.
   */
  pulses?: Map<string, number>;
  onSelectionChange?: (ids: string[]) => void;
  /** Lead a abrir já na montagem (deep link `?lead=` — ver o dossiê abaixo). */
  leadInicial?: string | null;
  /**
   * `manager`+ pode renomear a etapa direto no cabeçalho da coluna — mesmo
   * corte de papel da rota (`PATCH .../stages/:stageId`, `requireRole("manager")`).
   * `viewer`/`agent` também abrem este board (ele não é rota manager-only),
   * então o cabeçalho fica só leitura para eles.
   */
  podeRenomearEtapa?: boolean;
  /**
   * ia.vek v1.7.7: `"chegada"` = o mais NOVO no topo de cada coluna (o Pipeline
   * do vendedor). O padrão segue a posição manual (`position_in_stage`).
   */
  ordem?: "posicao" | OrdemDoQuadro;
  /**
   * ia.vek v1.7.9 — só VISUALIZAÇÃO, por pessoa: etapas que não aparecem e
   * etapas recolhidas (uma faixa estreita com nome e contagem). Não muda dado.
   */
  etapasOcultas?: ReadonlySet<string>;
  etapasRecolhidas?: ReadonlySet<string>;
  onAbrirEtapa?: (stageId: string) => void;
}

function groupLeadsByStage(
  stages: Stage[],
  leads: Lead[],
  ordem: "posicao" | OrdemDoQuadro = "posicao",
  vencimentos?: Readonly<Record<string, string | null | undefined>>,
  congelada?: ReadonlyMap<string, readonly string[]> | null,
) {
  const map = new Map<string, Lead[]>();
  const nomes = new Map<string, string>();
  for (const stage of stages) {
    map.set(stage.id, []);
    nomes.set(stage.id, stage.name);
  }
  for (const lead of leads) {
    const bucket = map.get(lead.stage_id);
    if (bucket) bucket.push(lead);
  }
  for (const [stageId, list] of map) {
    if (ordem === "posicao") list.sort((a, b) => a.position_in_stage - b.position_in_stage);
    // ia.vek v1.9.18: na coluna da IA, por chegada; ainda não há sinal de "pediu um humano".
    else list.sort(compararLeads(ehColunaDaIa(nomes.get(stageId)) ? "chegada" : ordem, vencimentos));
    const anterior = congelada?.get(stageId);
    if (anterior) map.set(stageId, manterOrdem(list, anterior));
  }
  return map;
}

const SENSORES_DO_QUADRO = [useSensorDoArrasto, useKeyboardSensor];

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
      {[0, 1, 2].map((c) => (
        <div
          key={c}
          className="flex w-80 shrink-0 flex-col gap-2 rounded-lg border border-border bg-surface-elevated p-3"
        >
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function KanbanBoard({
  pipelineId,
  stages: stagesProp,
  leads: leadsProp,
  pipeline: pipelineProp,
  selectedIds,
  pulses: pulsesProp,
  onSelectionChange,
  leadInicial,
  podeRenomearEtapa = false,
  ordem = "posicao",
  etapasOcultas,
  etapasRecolhidas,
  onAbrirEtapa,
}: KanbanBoardProps) {
  const t = useT();
  const useExternal = stagesProp !== undefined && leadsProp !== undefined;
  const queryResult = useBoard(useExternal ? null : pipelineId);
  const renameStage = useRenameStage(pipelineId);
  // A RECUSA DE CAMPOS ABRE DIÁLOGO, não toast (issue #1536): o 422 traz em
  // `details.faltando` o que falta, o diálogo coleta, e o reenvio leva os
  // valores NA MESMA escrita que muda a etapa. O hook é o MESMO de antes —
  // esta opção só troca o destino do erro.
  const [recusaDeCampos, setRecusaDeCampos] = useState<RecusaDeCampos | null>(null);
  const [retomada, setRetomada] = useState<RetomadaPendente | null>(null);
  // ia.vek v1.7.7: soltar o cartão numa etapa de PERDA pede o motivo (a mesma
  // janela do "Perder" do menu do cartão) em vez de tentar mover e levar recusa.
  const [perdaPendente, setPerdaPendente] = useState<string | null>(null);
  const { lojaDeCarros } = usePerfilDaEmpresa();
  const [vendaPendente, setVendaPendente] = useState<{
    args: { leadId: string; stageId: string; positionInStage: number; expectedUpdatedAt: string };
    valorCents: number | null;
  } | null>(null);
  // ia.vek v1.8.3: a trava da loja (0590) abre a janela do que falta.
  const [travaDaLoja, setTravaDaLoja] = useState<TravaDaLoja | null>(null);
  const [focarCampos, setFocarCampos] = useState(false);
  const moveCard = useMoveCard(pipelineId, {
    onCamposFaltando: setRecusaDeCampos,
    onRetomada: setRetomada,
    onTravaDaLoja: setTravaDaLoja,
  });
  const { data: members } = useAssignableMembers(true);
  const ownerNames = useMemo(
    () => new Map((members ?? []).map((m) => [m.user_id, m.full_name])),
    [members],
  );
  // Esfriando vem do MESMO radar que alimenta /app/radar — o board não
  // reclassifica nada (contrato §3.3). `em_voo` fica de fora: a IA já prometeu
  // voltar, então não há decisão pendente para o humano.
  const { data: atRisk } = useAtRiskLeads();
  // As propostas vivas vêm da MESMA forma que o risco: uma lista por org, que o
  // card consome sem saber de onde veio. Ver o cabeçalho da rota.
  const { data: propostasVivas } = useReactivations();
  const reactivations = useMemo(() => {
    const m = new Map<string, { proposalId: string; expiresAt: string }>();
    for (const p of propostasVivas ?? []) {
      m.set(p.lead_id, { proposalId: p.proposal_id, expiresAt: p.expires_at });
    }
    return m;
  }, [propostasVivas]);
  const coolingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of atRisk?.items ?? []) {
      if (item.pipeline_id !== pipelineId) continue;
      if (item.risk === "em_risco" || item.risk === "critico") ids.add(item.id);
    }
    return ids;
  }, [atRisk, pipelineId]);
  // A tag canônica do pipeline é a ÚNICA que fica no card (como ponto de 6px);
  // as outras saem para o hover. Já existe em settings — não inventa campo.
  const canonicalTags = useMemo(() => {
    const raw = (pipelineProp ?? queryResult.data?.pipeline)?.settings?.canonical_tags;
    return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
  }, [pipelineProp, queryResult.data?.pipeline]);

  // O dossiê é do BOARD e não da página: ele precisa do lead inteiro e do nome
  // do estágio, que só existem aqui depois do agrupamento.
  //
  // `leadInicial` é o deep link: até aqui o dossiê SÓ abria por clique, então
  // nenhuma outra tela do produto conseguia apontar para um lead específico —
  // o histórico de captação tinha o id e nenhum lugar para levá-lo. Uma vez
  // aberto, o estado local manda (fechar não reabre pela URL).
  const [dossieId, setDossieId] = useState<string | null>(leadInicial ?? null);
  // ia.vek v1.8.1: a conversa do lead numa gaveta sobre o quadro (sem ir à
  // Entrada). Abrir pelo dossiê fecha o dossiê: um painel por vez.
  const [conversaDoLeadId, setConversaDoLeadId] = useState<string | null>(null);
  const cartaoIavek = useContext(CartaoIavekContext);
  const abrirConversaNoQuadro = useCallback((leadId: string) => {
    setDossieId(null);
    setConversaDoLeadId(leadId);
  }, []);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selectedLeadIds = useMemo(
    () => (selectedIds ? new Set(selectedIds) : internalSelected),
    [selectedIds, internalSelected],
  );

  const data = useExternal
    ? {
        pipeline: pipelineProp ?? ({} as Pipeline),
        stages: stagesProp,
        leads: leadsProp,
      }
    : queryResult.data;
  const isLoading = useExternal ? false : queryResult.isLoading;
  const isError = useExternal ? false : queryResult.isError;
  const error = useExternal ? null : queryResult.error;

  const leadDoDossie = dossieId
    ? (data?.leads.find((l) => l.id === dossieId) ?? null)
    : null;

  // ia.vek v1.9.18: só "tarefa mais atrasada" precisa dos vencimentos.
  const { data: dadosDosCartoes } = useQuery({
    queryKey: ["iavek", "cartao", pipelineId],
    enabled: ordem === "tarefa_atrasada",
    queryFn: () =>
      apiClient
        .get<{ data: { objetivos: Record<string, { vence_em?: string | null }> } }>(`/api/v1/iavek/cartao?pipeline_id=${pipelineId}`)
        .then((r) => r.data),
    staleTime: 60_000,
  });
  const vencimentos = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(dadosDosCartoes?.objetivos ?? {}).map(([id, o]) => [id, o.vence_em ?? null]),
      ),
    [dadosDosCartoes],
  );
  // Enquanto um cartão é arrastado, ou está com o menu de mover aberto, a ordem não muda.
  const [ordemCongelada, setOrdemCongelada] = useState<ReadonlyMap<string, readonly string[]> | null>(null);
  const grouped = useMemo(() => {
    if (!data) return null;
    return groupLeadsByStage(data.stages, data.leads, ordem, vencimentos, ordemCongelada);
  }, [data, ordem, vencimentos, ordemCongelada]);
  const congelar = useCallback(
    (sim: boolean) =>
      setOrdemCongelada(sim && grouped ? new Map([...grouped].map(([id, l]) => [id, l.map((x) => x.id)])) : null),
    [grouped],
  );

  // Um conjunto por vez, e não um card por vez: o board recebe o resultado do
  // gesto já resolvido pela coluna (um card, um intervalo, a etapa inteira). A
  // versão anterior só sabia alternar UM id, e é por isso que "selecionar tudo"
  // não existia — cada card exigia uma volta pelo estado.
  const handleSelectMany = useCallback(
    (leadIds: string[], marcar: boolean) => {
      const apply = (prev: Set<string>): Set<string> => {
        const next = new Set(prev);
        for (const id of leadIds) {
          if (marcar) next.add(id);
          else next.delete(id);
        }
        return next;
      };
      if (onSelectionChange) {
        onSelectionChange(Array.from(apply(selectedLeadIds)));
      } else {
        setInternalSelected((prev) => apply(prev));
      }
    },
    [onSelectionChange, selectedLeadIds],
  );

  // ia.vek v1.9.18: "Movido para [coluna]. Desfazer", por 8 segundos. Desfazer é outro
  // movimento, registrado como tal: nada é apagado. Em Vendido não há Desfazer.
  const leadsAtuais = useRef<Lead[]>([]);
  useEffect(() => {
    leadsAtuais.current = data?.leads ?? [];
  }, [data]);
  // ia.vek v1.9.19: um link do Meu dia ou do dossiê chega aqui com ?abrir=<lead>.
  const leadsDoQuadro = data?.leads;
  useEffect(() => {
    if (!leadsDoQuadro) return;
    const url = new URL(window.location.href);
    const alvo = url.searchParams.get("abrir");
    if (!alvo || !leadsDoQuadro.some((l) => l.id === alvo)) return;
    url.searchParams.delete("abrir");
    window.history.replaceState(null, "", url.toString());
    abrirConversaNoQuadro(alvo);
  }, [leadsDoQuadro, abrirConversaNoQuadro]);
  const avisarMovimento = useCallback(
    (lead: Lead, destino: Stage) => {
      const origem = { stageId: lead.stage_id, posicao: lead.position_in_stage };
      if (destino.is_won) {
        toast.success(`${t("Movido para")} ${destino.name}.`, { duration: 8000 });
        return;
      }
      toast(`${t("Movido para")} ${destino.name}.`, {
        duration: 8000,
        action: {
          label: t("Desfazer"),
          onClick: () => {
            const atual = leadsAtuais.current.find((l) => l.id === lead.id);
            moveCard.mutate({
              leadId: lead.id,
              stageId: origem.stageId,
              positionInStage: origem.posicao,
              expectedUpdatedAt: atual?.updated_at ?? lead.updated_at,
              via: "desfazer",
            });
          },
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moveCard é estável o bastante para o clique
    [t],
  );

  const moverPara = useCallback(
    (lead: Lead, etapa: Stage | undefined, positionInStage: number, via: "arrasto" | "botao") => {
      if (!etapa) return;
      const mudaDeEtapa = lead.stage_id !== etapa.id;
      if (etapa.is_lost && mudaDeEtapa && lead.status === "open") {
        setPerdaPendente(lead.id);
        return;
      }
      const args = {
        leadId: lead.id,
        stageId: etapa.id,
        positionInStage,
        expectedUpdatedAt: lead.updated_at,
        via,
      };
      // ia.vek v1.9.12: entrar na venda, na loja de carros, pede valor e data.
      if (lojaDeCarros && etapa.is_won && mudaDeEtapa && lead.status !== "won") {
        setVendaPendente({ args, valorCents: lead.value_cents ?? null });
        return;
      }
      moveCard.mutate(args, {
        onSuccess: () => {
          if (mudaDeEtapa) avisarMovimento(lead, etapa);
        },
      });
    },
    [moveCard, lojaDeCarros, avisarMovimento],
  );

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!data || !grouped) return;
      const { source, destination, draggableId } = result;
      if (!destination) return;
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        return;
      }

      const lead = data.leads.find((l) => l.id === draggableId);
      if (!lead) return;

      const destStageId = destination.droppableId;
      const etapaDeDestino = data.stages.find((s) => s.id === destStageId);
      const destList = (grouped.get(destStageId) ?? []).filter(
        (l) => l.id !== draggableId,
      );

      const before = destination.index > 0 ? destList[destination.index - 1] : null;
      const after =
        destination.index < destList.length ? destList[destination.index] : null;

      const newPosition = midpoint(
        before?.position_in_stage ?? null,
        after?.position_in_stage ?? null,
      );

      if (Number.isNaN(newPosition)) {
        // Collision — Wave 8 will handle global rebalance. For now, abort silently.
        return;
      }
      moverPara(lead, etapaDeDestino, newPosition, "arrasto");
    },
    [data, grouped, moverPara],
  );

  // O menu "Mover para a coluna:": a coluna vai ao topo do destino, com a mesma regra do arrasto.
  const colunasDoMenu = useMemo<ColunaDoMenu[]>(
    () =>
      data && grouped
        ? data.stages
            .filter((s) => !etapasOcultas?.has(s.id))
            .map((s) => {
              const lista = grouped.get(s.id) ?? [];
              return { id: s.id, nome: s.name, quantidade: lista.length, totalCents: lista.reduce((t2, l) => t2 + (l.value_cents ?? 0), 0) };
            })
        : [],
    [data, grouped, etapasOcultas],
  );
  const contextoDeMover = useMemo(
    () => ({
      colunas: colunasDoMenu,
      congelar,
      mover: (lead: Lead, etapaId: string) => {
        const etapa = data?.stages.find((s) => s.id === etapaId);
        const primeiro = (grouped?.get(etapaId) ?? [])[0];
        const pos = midpoint(null, primeiro?.position_in_stage ?? null);
        if (!Number.isNaN(pos)) moverPara(lead, etapa, pos, "botao");
      },
    }),
    [colunasDoMenu, congelar, data, grouped, moverPara],
  );

  if (isLoading) {
    return <BoardSkeleton />;
  }

  if (isError) {
    return (
      <Card className="m-4 p-6 text-sm text-text-muted">
        {t("Falha ao carregar o board.")}
        {error instanceof Error ? ` ${error.message}` : null}
      </Card>
    );
  }

  if (!data || !grouped) {
    return null;
  }

  if (data.stages.length === 0) {
    return (
      <Card className="m-4 p-6 text-sm text-text-muted">
        {t("Nenhum lead nesta pipeline ainda.")}
      </Card>
    );
  }

  const leadDaConversa = conversaDoLeadId
    ? (data.leads.find((l) => l.id === conversaDoLeadId) ?? null)
    : null;

  return (
    <ConversaNoQuadroContext.Provider value={abrirConversaNoQuadro}>
    {/* ia.vek v1.8.2: o selo "Incompleto" dos cartões, só no cartão do ia.vek. */}
    <ComIncompletos leads={cartaoIavek ? data.leads : []}>
    <MoverNoQuadroContext.Provider value={contextoDeMover}>
    <DragDropContext
      enableDefaultSensors={false}
      sensors={SENSORES_DO_QUADRO}
      onDragStart={() => congelar(true)}
      onDragEnd={(r) => {
        handleDragEnd(r);
        congelar(false);
      }}
    >
      {/* UM contêiner de rolagem só, nos dois eixos. Rolar cada coluna por
          conta própria seria o desenho "Trello", mas o @hello-pangea/dnd não
          suporta Droppable rolável dentro de outro contêiner rolável ("nested
          scroll containers are currently not supported") — o arraste perderia
          a rolagem automática. Com o quadro como único pai rolável, o arraste
          continua inteiro, e o cabeçalho de cada etapa fica preso em cima
          (`sticky` em StageColumn). `items-start` + `min-h-full` na coluna: a
          coluna curta ocupa a altura toda (dá para soltar card no vazio) e a
          comprida cresce com os cards, com o fundo acompanhando.
          Sem padding no ALTO, e é de propósito: o `sticky` prende o cabeçalho
          na borda do conteúdo do contêiner, então um `pt-4` deixava uma faixa
          de 16px acima dele por onde os cards apareciam rolando (medido no e2e
          "o quadro cabe na tela"). O respiro até os filtros vem do `gap-4` da
          página.
          ia.vek v1.8.2: as colunas moram num envelope (`min-h-full` +
          `items-stretch`) que tem a altura da coluna MAIS ALTA. Sem ele, a
          coluna curta parava na altura do contêiner: rolando uma etapa cheia
          para baixo, as outras ficavam só com o cabeçalho e não havia onde
          soltar o card (medido no canário: o arrasto caía no vazio). O quadro
          que rola é BLOCO, não flex: filho de flex é esticado até a altura do
          contêiner e não cresceria com os cards. O `pb-4` mora no envelope
          (border-box), senão somaria aos 100% e o quadro rolaria 16px à toa. */}
      <div
        className="min-h-0 flex-1 overflow-auto px-4"
        data-quadro-do-funil
      >
        <div className="flex min-h-full w-max items-stretch gap-3 pb-4" data-colunas-do-quadro>
        {data.stages.map((stage, indice) =>
          etapasOcultas?.has(stage.id) ? null : etapasRecolhidas?.has(stage.id) ? (
            // ia.vek v1.7.9: a etapa RECOLHIDA vira uma faixa estreita — nome,
            // contagem e o toque para abrir. Só visualização: o dado não muda.
            <button
              key={stage.id}
              type="button"
              onClick={() => onAbrirEtapa?.(stage.id)}
              className="coluna-da-etapa flex min-h-full w-12 shrink-0 flex-col items-center gap-2 rounded-lg border border-border py-3 text-xs"
              aria-label={`${t("Abrir a etapa")} ${stage.name}`}
              data-etapa-recolhida={stage.id}
            >
              <span className="rounded-full bg-surface px-1.5 tabular-nums">{grouped?.get(stage.id)?.length ?? 0}</span>
              <span className="font-semibold [writing-mode:vertical-rl]">{stage.name}</span>
            </button>
          ) : (
          <StageColumn
            key={stage.id}
            stage={stage}
            nivel={nivelDaEtapa(indice, data.stages.length)}
            leads={grouped.get(stage.id) ?? []}
            pipelineId={pipelineId}
            ownerNames={ownerNames}
            coolingIds={coolingIds}
            reactivations={reactivations}
            pulses={pulsesProp ?? queryResult.pulses}
            canonicalTags={canonicalTags}
            selectedLeadIds={selectedLeadIds}
            onSelectMany={handleSelectMany}
            onOpen={setDossieId}
            podeRenomear={podeRenomearEtapa}
            onRenomear={(nome) => renameStage.mutate({ stageId: stage.id, name: nome })}
          />
          ),
        )}
        </div>
      </div>
      {leadDoDossie && (
        <LeadDossier
          open
          onOpenChange={(v: boolean) => {
            if (!v) {
              setDossieId(null);
              setFocarCampos(false);
            }
          }}
          lead={leadDoDossie}
          focarCampos={focarCampos}
          pipelineId={pipelineId}
          fieldDefs={camposDoFunil(data.pipeline.settings ?? null)}
          stageName={
            data.stages.find((s) => s.id === leadDoDossie.stage_id)?.name ?? "—"
          }
          ownerNames={ownerNames}
        />
      )}

      <TravaDosCamposDialog
        trava={travaDaLoja}
        onOpenChange={(aberto) => {
          if (!aberto) setTravaDaLoja(null);
        }}
        onPreencher={(leadId) => {
          setTravaDaLoja(null);
          setFocarCampos(true);
          setDossieId(leadId);
        }}
      />
      <CamposObrigatoriosDialog
        open={recusaDeCampos !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setRecusaDeCampos(null);
        }}
        recusa={recusaDeCampos}
        isPending={moveCard.isPending}
        onConfirmar={({ customFields, wonReason }) => {
          if (!recusaDeCampos) return;
          const { args } = recusaDeCampos;
          setRecusaDeCampos(null);
          moveCard.mutate({
            ...args,
            customFields,
            ...(wonReason !== undefined ? { wonReason } : {}),
          });
        }}
      />
      <VendaDialog
        open={vendaPendente !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setVendaPendente(null);
        }}
        valorSugeridoCents={vendaPendente?.valorCents}
        isPending={moveCard.isPending}
        onConfirmar={(venda) => {
          if (!vendaPendente) return;
          const { args } = vendaPendente;
          setVendaPendente(null);
          moveCard.mutate({ ...args, venda }, {
            onSuccess: () => {
              const etapa = data?.stages.find((e) => e.id === args.stageId);
              const lead = data?.leads.find((l) => l.id === args.leadId);
              if (etapa && lead) avisarMovimento(lead, etapa);
            },
          });
        }}
      />
      {perdaPendente && (
        <LoseLeadDialog
          open
          onOpenChange={(v: boolean) => !v && setPerdaPendente(null)}
          leadId={perdaPendente}
          pipelineId={pipelineId}
          aoPerder={() => {
            const lead = data?.leads.find((l) => l.id === perdaPendente);
            const etapa = data?.stages.find((e) => e.is_lost);
            if (lead && etapa) avisarMovimento(lead, etapa);
          }}
        />
      )}
      {retomada && (
        <RetomarComoNovoNegocioDialog
          open
          onOpenChange={(v: boolean) => !v && setRetomada(null)}
          leadId={retomada.leadId}
          stageId={retomada.stageId}
          pipelineId={pipelineId}
        />
      )}
      {leadDaConversa && (
        <ConversaNoQuadro
          lead={leadDaConversa}
          pipelineId={pipelineId}
          nomeDaEtapa={data.stages.find((st) => st.id === leadDaConversa.stage_id)?.name ?? "—"}
          onFechar={() => setConversaDoLeadId(null)}
        />
      )}
    </DragDropContext>
    </MoverNoQuadroContext.Provider>
    </ComIncompletos>
    </ConversaNoQuadroContext.Provider>
  );
}
