"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { AvisosDoCartaoContext } from "@/components/iavek/AvisosDoCartao";
import { CartaoIavekContext } from "@/components/iavek/CartaoIavek";
import { DadosDaCompraNoCardContext } from "@/components/iavek/DadosDaCompraNoCard";
import { usePreferenciasDoPipeline, VistaDoPipeline } from "@/components/iavek/VistaDoPipeline";
import { usePreCarregarRespostas } from "@/hooks/inbox/useMessageTemplates";
import { SemRespostaPorVendedor } from "@/components/iavek/SemRespostaPorVendedor";
import { BuscaDoQuadro, useNomeDoCarroDaBusca } from "@/components/iavek/BuscaDoQuadro";
import { PadraoNoCardContext, type AvaliacaoDoLead } from "@/components/iavek/PadraoDoLead";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { SeletorDeVendedor } from "@/components/kanban/SeletorDeVendedor";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useBoard } from "@/hooks/kanban/useBoard";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { recorteDaFuncao } from "@/lib/iavek/painel-do-pipeline";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { VISOES, ehVisao, funisDaVisao, type Visao } from "@/lib/iavek/painel-do-pipeline";
import { applyFilters, type LeadFilters } from "@/lib/kanban/filters";
import { cn } from "@/lib/utils";

interface LeadSemDono {
  id: string;
  titulo: string;
  cliente: string | null;
  chegou_em: string;
}

/** A janela que junta os eventos do tempo real antes de buscar o quadro de novo. */
const AGRUPAR_EVENTOS_MS = 1_500;

/** As partes da tela que o servidor resolveu: os funis e o recorte de quem olha. */
export interface FunilDaTela {
  id: string;
  nome: string;
}

const CHAVE_DA_VISAO = "iavek.pipeline.visao";

function visaoGuardada(): Visao {
  try {
    const v = window.localStorage.getItem(CHAVE_DA_VISAO);
    return ehVisao(v) ? v : "novos";
  } catch {
    return "novos";
  }
}

/**
 * ia.vek v1.7.7 — o Pipeline do vendedor. v1.9.8 (CRM-218): UM funil na tela.
 *
 * Por dentro continuam os dois funis (entrada das 72h e follow-up da esteira,
 * com o clone entre eles); na tela, o botão Novos / Follow-up / Todos escolhe
 * qual aparece — em "Todos", os dois lado a lado, cada um com o seu quadro
 * (arrastar só dentro do mesmo funil: a passagem entre eles é da esteira).
 * Em cima, os contadores fixos da carteira (ou da loja, para a gerência), e no
 * cartão os avisos "sem tarefa" e "parado há N dias".
 *
 * Quem tem carteira (guardião, Suporte IA, vendedor) vê só os leads dele, nas
 * etapas do lado dele; gerente e admin, a loja inteira. É APRESENTAÇÃO: o que
 * cada um pode abrir continua decidido pelo papel e pela RLS.
 */
export function CarteiraClient({
  entrada,
  followup,
}: {
  entrada: FunilDaTela;
  followup: FunilDaTela | null;
}) {
  const t = useT();
  // v1.9.18: a tela segue a função VISTA: a do vínculo, ou a do "Ver como" de quem administra.
  // O servidor segue valendo o papel real; o "Ver como" só recorta.
  const { activeOrg, verComo, verComoPronto } = useAuth();
  const vista = recorteDaFuncao(activeOrg?.interface_settings?.funcao);
  const recorte = vista.tipo;
  const ehVendedor = vista.tipo === "carteira" && vista.lado === "vendedor";
  const comBotao = followup !== null && !ehVendedor;
  const [visao, setVisao] = useState<Visao>("novos");
  useEffect(() => {
    if (comBotao) setVisao(visaoGuardada());
  }, [comBotao]);
  const escolher = (v: Visao) => {
    setVisao(v);
    try {
      window.localStorage.setItem(CHAVE_DA_VISAO, v);
    } catch {
      /* sem armazenamento: a escolha vale só nesta aba */
    }
  };
  const visaoEfetiva: Visao = comBotao && followup ? visao : "novos";
  const funis = funisDaVisao(visaoEfetiva, { entrada: entrada.id, followup: followup?.id ?? null }).map((id) =>
    id === entrada.id ? { ...entrada, rotulo: t("Novos") } : { ...followup!, rotulo: t("Follow-up") },
  );

  // v1.7.9: a vista de cada um (ordem, colunas recolhidas/ocultas) — 0587.
  const { prefs, gravar } = usePreferenciasDoPipeline();
  // CRM-244 (Fase 3): as respostas do "/" prontas antes de abrir a conversa.
  usePreCarregarRespostas();
  const painel = usePainelDoPipeline(verComo, verComoPronto);
  const comTarefa = useMemo(() => new Set(painel.data?.com_tarefa ?? []), [painel.data]);
  // A gerência já escolhia o vendedor no quadro dela (v1.7.5): o mesmo seletor vem
  // para a visão da loja, no MESMO filtro de responsável. Os contadores não
  // mudam com ele (são fixos, da loja).
  const [filtros, setFiltros] = useState<LeadFilters>({ owner: "any" });
  // CRM-244 (Fase 4): cada parte do quadro diz quantos a busca achou; a soma vira "N encontrados".
  const [achados, setAchados] = useState<Record<string, number>>({});
  const aoAchar = useCallback((funilId: string, n: number) => setAchados((a) => (a[funilId] === n ? a : { ...a, [funilId]: n })), []);
  const encontrados = funis.reduce((soma, f) => soma + (achados[f.id] ?? 0), 0);

  return (
    <div
      className="flex h-[calc(100dvh-3.5rem-var(--space-6)-max(var(--space-6),var(--rodape-ocupado,0px)))] min-h-[28rem] flex-col gap-3"
      data-testid="pipeline-do-vendedor"
      data-visao={visaoEfetiva}
      data-recorte={recorte}
    >
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{ehVendedor ? t("Meus leads") : t("Pipeline")}</h1>
          <p className="text-sm text-muted-foreground">
            {recorte === "loja" ? t("Todos os leads da loja") : t("Sua carteira")}
          </p>
        </div>
        {comBotao && followup && <BotaoDaVisao visao={visaoEfetiva} escolher={escolher} />}
      </header>

      <ContadoresDoPipeline contadores={painel.data?.contadores ?? null} />

      {recorte === "loja" && <SeletorDeVendedor filters={filtros} onChange={setFiltros} />}
      <BuscaDoQuadro valor={filtros.search ?? ""} onChange={(v) => setFiltros((f) => ({ ...f, search: v }))} encontrados={encontrados} />

      {/* v1.9.18: o vendedor nunca vê a faixa de sem dono nem o Assumir. */}
      {recorte === "carteira" && !ehVendedor && visaoEfetiva !== "followup" && (
        // O painel recarrega a cada evento do quadro; a faixa vai junto.
        <FaixaSemDono pipelineId={entrada.id} quadroAtualizadoEm={painel.dataUpdatedAt} />
      )}

      {activeOrg?.interface_settings?.funcao === "sdr" && visaoEfetiva !== "followup" && (
        <FaixaDePedidosDeAjuda pipelineId={entrada.id} />
      )}

      {/* ia.vek v1.9.45 (CRM-294): o mês previsto passou e ninguém agiu; o gerente decide. */}
      {(activeOrg?.role === "manager" || activeOrg?.role === "admin") && <FaixaCompraFuturaVencida />}

      <AvisosDoCartaoContext.Provider value={painel.data ? { comTarefa } : null}>
        {funis.length === 1 ? (
          <QuadroDoFunil
            key={funis[0]!.id}
            funil={funis[0]!}
            recorte={recorte}
            filtros={filtros}
            prefs={prefs}
            gravar={gravar}
            aoAtualizar={painel.recarregar}
            aoAchar={aoAchar}
          />
        ) : (
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto" data-testid="visao-todos">
            {funis.map((f, i) => (
              <section
                key={f.id}
                className={cn("flex min-h-0 shrink-0 flex-col gap-2", i > 0 && "border-l-2 border-dashed border-border pl-3")}
                data-testid={`parte-${f.id === entrada.id ? "novos" : "followup"}`}
              >
                <QuadroDoFunil
                  funil={f}
                  recorte={recorte}
                  filtros={filtros}
                  prefs={prefs}
                  gravar={gravar}
                  aoAtualizar={painel.recarregar}
                  aoAchar={aoAchar}
                  comTitulo
                />
              </section>
            ))}
          </div>
        )}
      </AvisosDoCartaoContext.Provider>
    </div>
  );
}

function BotaoDaVisao({ visao, escolher }: { visao: Visao; escolher: (v: Visao) => void }) {
  const t = useT();
  const rotulos: Record<Visao, string> = { novos: t("Novos"), followup: t("Follow-up"), todos: t("Todos") };
  return (
    <div role="radiogroup" aria-label={t("Qual funil ver")} className="inline-flex rounded-md border bg-surface p-0.5" data-testid="botao-da-visao">
      {VISOES.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={visao === v}
          onClick={() => escolher(v)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            visao === v ? "bg-primary text-primary-foreground" : "text-text-muted hover:text-text",
          )}
          data-testid={`visao-${v}`}
        >
          {rotulos[v]}
        </button>
      ))}
    </div>
  );
}

/** Os 4 contadores fixos (CRM-218). Enquanto carrega, o lugar fica reservado (a tela não pula). */
function ContadoresDoPipeline({ contadores }: { contadores: ContadoresDoPainel | null }) {
  const t = useT();
  const itens: Array<{ chave: keyof ContadoresDoPainel; rotulo: string; alerta: boolean }> = [
    { chave: "tarefas_hoje", rotulo: t("Tarefas de hoje"), alerta: false },
    { chave: "atrasadas", rotulo: t("Atrasadas"), alerta: true },
    { chave: "sem_tarefa", rotulo: t("Sem tarefa"), alerta: true },
    { chave: "visitas_hoje", rotulo: t("Visitas de hoje"), alerta: false },
  ];
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="contadores-do-pipeline">
      {itens.map((it) => {
        const valor = contadores?.[it.chave];
        return (
          <li
            key={it.chave}
            className={cn(
              "flex flex-col rounded-lg border bg-surface px-3 py-2",
              it.alerta && (valor ?? 0) > 0 && "border-warning/50 bg-warning/5",
            )}
            data-testid={`contador-${it.chave}`}
          >
            <span className="text-xs text-text-muted">{it.rotulo}</span>
            <span className="text-2xl font-semibold tabular-nums">{valor ?? "—"}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface ContadoresDoPainel {
  tarefas_hoje: number;
  atrasadas: number;
  sem_tarefa: number;
  visitas_hoje: number;
}

function usePainelDoPipeline(verComo: string | null, pronto: boolean) {
  const qc = useQueryClient();
  const chave = ["iavek", "pipeline", "painel", verComo] as const;
  const { data, dataUpdatedAt } = useQuery({
    queryKey: chave,
    enabled: pronto,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ contadores: ContadoresDoPainel; com_tarefa: string[] }>>(`/api/v1/iavek/pipeline/painel${verComo ? `?ver_como=${verComo}` : ""}`)
        .then((r) => r.data),
    // Rede de segurança: o quadro já pede recarga quando o tempo real chega.
    refetchInterval: 60_000,
  });
  const recarregar = useCallback(() => void qc.invalidateQueries({ queryKey: chave }), [qc]); // eslint-disable-line react-hooks/exhaustive-deps -- chave fixa
  return { data, dataUpdatedAt, recarregar };
}

/** Um funil na tela: o quadro (da carteira ou da loja), a vista e o selo do padrão. */
function QuadroDoFunil({
  funil,
  recorte,
  filtros,
  prefs,
  gravar,
  aoAtualizar,
  aoAchar,
  comTitulo = false,
}: {
  funil: FunilDaTela & { rotulo: string };
  recorte: "carteira" | "loja";
  filtros: LeadFilters;
  prefs: ReturnType<typeof usePreferenciasDoPipeline>["prefs"];
  gravar: ReturnType<typeof usePreferenciasDoPipeline>["gravar"];
  aoAtualizar: () => void;
  aoAchar?: (funilId: string, n: number) => void;
  comTitulo?: boolean;
}) {
  const t = useT();
  const pipelineId = funil.id;
  const { verComo, verComoPronto } = useAuth();
  const { data, isLoading, error, pulses, realtimeStatus, dataUpdatedAt } = useBoard(pipelineId, {
    ...(recorte === "carteira" ? { escopo: "carteira" as const } : {}),
    verComo: recorte === "carteira" ? verComo : null,
    esperar: !verComoPronto,
    agruparEventosMs: AGRUPAR_EVENTOS_MS,
  });
  // v1.8.0: o padrão da loja da carteira (selo no cartão). Desligado: mapa vazio.
  const qcPadrao = useQueryClient();
  const escopoDoPadrao = recorte === "carteira" ? "carteira" : "funil";
  const { data: padrao } = useQuery({
    queryKey: ["iavek", "padrao", escopoDoPadrao, pipelineId],
    // O selo do padrão é da carteira; a visão da loja não o pede.
    enabled: recorte === "carteira",
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ ativo: boolean; leads: Record<string, AvaliacaoDoLead> }>>(
          `/api/v1/iavek/padrao/leads?pipeline_id=${pipelineId}&escopo=carteira`,
        )
        .then((r) => r.data),
  });
  // CRM-244 (Fase 4): a busca acha por nome, telefone e carro (o catálogo só é lido quando há busca).
  const nomeDoCarro = useNomeDoCarroDaBusca(Boolean(filtros.search?.trim()));
  const leads = useMemo(() => (data ? applyFilters(data.leads, filtros, { nomeDoCarro }) : []), [data, filtros, nomeDoCarro]);
  useEffect(() => {
    aoAchar?.(pipelineId, leads.length);
  }, [aoAchar, pipelineId, leads.length]);
  // ia.vek v1.9.16: só quando o quadro RECARREGA. Na primeira carga o selo e o painel
  // acabaram de ser pedidos, e pedir de novo só dobrava a abertura da tela.
  const cargaAnterior = useRef<{ funil: string; em: number } | null>(null);
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const anterior = cargaAnterior.current;
    cargaAnterior.current = { funil: pipelineId, em: dataUpdatedAt };
    if (anterior?.funil !== pipelineId) return;
    void qcPadrao.invalidateQueries({ queryKey: ["iavek", "padrao", escopoDoPadrao, pipelineId] });
    aoAtualizar();
  }, [dataUpdatedAt, pipelineId, qcPadrao, escopoDoPadrao, aoAtualizar]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-realtime-status={realtimeStatus.toLowerCase()} data-funil={pipelineId}>
      <div className="flex flex-wrap items-center gap-2">
        {comTitulo && (
          <h2 className="text-sm font-semibold" data-testid="titulo-da-parte">
            {funil.rotulo} <span className="font-normal text-text-muted">— {funil.nome}</span>
          </h2>
        )}
        {!comTitulo && (
          <p className="text-sm text-muted-foreground">
            {t("Funil")} <strong>{funil.nome}</strong>
            {data ? ` — ${leads.length} ${leads.length === 1 ? t("cliente") : t("clientes")}` : ""}
          </p>
        )}
        {data && <VistaDoPipeline etapas={data.stages} prefs={prefs} gravar={gravar} />}
        {data && <SemRespostaPorVendedor leads={leads} stages={data.stages} />}
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
          {t("Não consegui carregar a sua carteira.")}
        </div>
      ) : isLoading || !data ? (
        <div className="flex flex-1 animate-pulse items-center justify-center text-muted-foreground">{t("Carregando…")}</div>
      ) : (
        <PadraoNoCardContext.Provider value={padrao?.ativo ? padrao.leads : null}>
        <DadosDaCompraNoCardContext.Provider value={{ ligado: true }}>
        <CartaoIavekContext.Provider value={true}>
          <KanbanBoard
            pipelineId={pipelineId}
            stages={data.stages}
            leads={leads}
            leadsDosTotais={data.leads}
            pulses={pulses}
            pipeline={data.pipeline}
            ordem={prefs.ordem}
            etapasOcultas={new Set(prefs.ocultas)}
            etapasRecolhidas={new Set(prefs.recolhidas)}
            onAbrirEtapa={(id) => gravar({ ...prefs, recolhidas: prefs.recolhidas.filter((x) => x !== id) })}
          />
        </CartaoIavekContext.Provider>
        </DadosDaCompraNoCardContext.Provider>
        </PadraoNoCardContext.Provider>
      )}
    </div>
  );
}

/** v1.9.21 (0609): quem pediu ajuda e não foi entregue. Só o guardião recebe a lista. */
function FaixaDePedidosDeAjuda({ pipelineId }: { pipelineId: string }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const qc = useQueryClient();
  const chave = ["iavek", "faixa-de-ajuda"] as const;
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ total: number; itens: Array<{ id: string; titulo: string; cliente: string | null; desde: string }> }>>(
          "/api/v1/iavek/pipeline/faixa-de-ajuda",
        )
        .then((r) => r.data),
    refetchInterval: 60_000,
  });
  const assumir = useMutation({
    mutationFn: (leadId: string) => apiClient.post("/api/v1/iavek/pipeline/faixa-de-ajuda", { lead_id: leadId }),
    onError: (erro) => showApiError(erro),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chave });
      void qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    },
  });
  const total = data?.total ?? 0;
  if (!data || total === 0) return null;
  const formatar = new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="rounded-lg border border-accent/40 bg-accent/5 p-3" data-testid="faixa-de-ajuda">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Pediram ajuda — sem dono")}</h2>
        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-foreground">{total}</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {data.itens.map((l) => (
          <li key={l.id} className="flex w-56 shrink-0 flex-col gap-1 rounded-md border bg-surface p-2 text-sm">
            <span className="truncate font-medium">{l.cliente ?? l.titulo}</span>
            <span className="text-xs text-muted-foreground">{formatar.format(new Date(l.desde))}</span>
            <Button size="sm" disabled={assumir.isPending} onClick={() => assumir.mutate(l.id)} data-testid="assumir-da-faixa">
              {t("Assumir")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FaixaSemDono({ pipelineId, quadroAtualizadoEm }: { pipelineId: string; quadroAtualizadoEm: number }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const qc = useQueryClient();
  const chave = ["board", pipelineId, "sem-dono"] as const;
  const { data } = useQuery({
    queryKey: chave,
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ total: number; itens: LeadSemDono[] }>>(`/api/v1/iavek/pipeline/sem-dono?pipeline_id=${pipelineId}`)
        .then((r) => r.data),
    // Rede de segurança: o tempo real já invalida (ver o efeito abaixo).
    refetchInterval: 60_000,
  });

  // O tempo real chega pelo quadro (o mesmo canal do funil): quando o quadro
  // recarrega, a faixa acompanha — sem um segundo canal aberto por aba.
  // ia.vek v1.9.16: a primeira carga do quadro não recarrega a faixa, que acabou de nascer.
  const cargaAnterior = useRef<{ funil: string; em: number } | null>(null);
  useEffect(() => {
    if (!quadroAtualizadoEm) return;
    const anterior = cargaAnterior.current;
    cargaAnterior.current = { funil: pipelineId, em: quadroAtualizadoEm };
    if (anterior?.funil === pipelineId) void qc.invalidateQueries({ queryKey: chave });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave é derivada de pipelineId
  }, [quadroAtualizadoEm, pipelineId, qc]);

  const assumir = useMutation({
    mutationFn: (leadId: string) => apiClient.post(`/api/v1/iavek/pipeline/assumir`, { lead_id: leadId }),
    onError: (erro) => {
      showApiError(erro);
      void qc.invalidateQueries({ queryKey: chave });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", pipelineId] }),
  });

  const total = data?.total ?? 0;
  if (!data || total === 0) return null;
  const formatar = new Intl.DateTimeFormat(idioma, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="rounded-lg border border-accent/40 bg-accent/5 p-3" data-testid="faixa-sem-dono" aria-label={t("Chegaram agora — sem dono")}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Chegaram agora — sem dono")}</h2>
        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-foreground" data-testid="contador-sem-dono">
          {total}
        </span>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {data.itens.map((l) => (
          <li key={l.id} className="flex w-56 shrink-0 flex-col gap-1 rounded-md border bg-surface p-2 text-sm" data-testid="lead-sem-dono">
            <span className="truncate font-medium">{l.cliente ?? l.titulo}</span>
            <span className="text-xs text-muted-foreground">
              {t("Chegou")} {formatar.format(new Date(l.chegou_em))}
            </span>
            <Button
              size="sm"
              disabled={assumir.isPending}
              onClick={() => assumir.mutate(l.id)}
              data-testid="assumir-lead"
            >
              {t("Assumir")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type CompraFuturaVencida = { id: string; titulo: string; cliente: string | null; mes: string; vendedor: string | null };

/** ia.vek v1.9.45 (CRM-294, condição 3): a Compra futura vencida, para o gerente. Some quando não há nenhuma. */
function FaixaCompraFuturaVencida() {
  const t = useT();
  const idioma = useTagDeIdioma();
  const { data } = useQuery({
    queryKey: ["iavek", "compra-futura", "vencidas"],
    queryFn: () =>
      apiClient
        .get<ApiSuccess<{ total: number; itens: CompraFuturaVencida[] }>>("/api/v1/iavek/compra-futura/vencidas")
        .then((r) => r.data),
    refetchInterval: 5 * 60_000,
  });
  const total = data?.total ?? 0;
  if (!data || total === 0) return null;
  const mesPorExtenso = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(idioma, { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className="rounded-lg border border-border bg-muted p-3" data-testid="faixa-compra-futura-vencida" aria-label={t("Compra futura vencida")}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Compra futura vencida")}</h2>
        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-accent-foreground" data-testid="contador-compra-futura-vencida">
          {total}
        </span>
        <span className="text-xs text-muted-foreground">{t("O mês previsto passou: reabra, mude o mês ou marque como perdido.")}</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {data.itens.map((l) => (
          <li key={l.id} className="flex w-56 shrink-0 flex-col gap-0.5 rounded-md border bg-surface p-2 text-sm" data-testid="lead-compra-futura-vencida">
            <span className="truncate font-medium">{l.cliente ?? l.titulo}</span>
            <span className="text-xs text-muted-foreground">
              {t("Previsto para")} {mesPorExtenso(l.mes)}
            </span>
            {l.vendedor ? <span className="truncate text-xs text-muted-foreground">{l.vendedor}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
