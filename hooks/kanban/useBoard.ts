"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ehEcoLocal } from "@/lib/kanban/local-echo";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { aplicarConversaNoQuadro } from "@/lib/iavek/ordem-do-quadro";
import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";
import { apiClient } from "@/lib/api/client";
import type { BoardData } from "@/lib/kanban/types";
import { liberarDepoisDoQuadro } from "@/lib/iavek/vez-do-quadro";

/**
 * Fetch board via API route (NOT direct supabase-js).
 *
 * Why: the auth cookie `sb-deskcomm-auth` is httpOnly so the browser Supabase
 * client cannot read it — auth.uid() ends up null, RLS hides the pipeline,
 * and PostgREST returns PGRST116. Routing through /api/v1/pipelines/[id]/board
 * uses the server-side cookie reader, identical to every other authed query.
 */
async function fetchBoard(pipelineId: string, escopo?: EscopoDoQuadro, verComo?: string | null): Promise<BoardData> {
  const res = await apiClient.get<{ data: BoardData }>(
    `/api/v1/pipelines/${pipelineId}/board${escopo ? `?escopo=${escopo}${verComo ? `&ver_como=${verComo}` : ""}` : ""}`,
  );
  // apiClient unwraps { data, meta } envelope already in some helpers;
  // ours returns the parsed JSON literally. Handle both shapes safely.
  if (res && typeof res === "object" && "data" in res) {
    return (res as { data: BoardData }).data;
  }
  return res as unknown as BoardData;
}

/**
 * Quanto tempo o card fica marcado como "acabou de chegar".
 *
 * NÃO é para bater com `--duration-slow` (320ms) do CSS, e a diferença é
 * DELIBERADA: com movimento normal a animação dura os 320ms e o resto da
 * janela é invisível; com `prefers-reduced-motion` o fundo estático fica os
 * 1200ms inteiros, que é o que torna a alternativa perceptível — 320ms de
 * fundo estático ninguém vê. Alinhar os dois números "para consertar a
 * divergência" apaga a pista de acessibilidade.
 */
const PULSE_MS = 1_200;

/** O id do lead dentro do payload do postgres_changes (new, ou old no delete). */
function idDoEvento(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { new?: { id?: unknown }; old?: { id?: unknown } };
  const id = p.new?.id ?? p.old?.id;
  return typeof id === "string" ? id : null;
}

/**
 * A CHAVE DE CACHE DO QUADRO — uma só, e exportada.
 *
 * `useMotivosDePerdaDoFunil` lê o quadro pela cache em vez de buscar de novo. Com
 * a chave escrita como literal nos dois lados, mudar a daqui faria aquele hook
 * devolver `[]` em silêncio — a janela de perder voltaria ao padrão do produto,
 * que é exatamente o defeito da #918, e os testes continuariam verdes porque
 * cada um escreve a sua própria literal.
 */
export function chaveDoQuadro(pipelineId: string | null) {
  return ["board", pipelineId] as const;
}

/**
 * ia.vek v1.7.7: `"carteira"` = só os leads de que quem pede é dono (o Pipeline
 * do vendedor). A chave de cache COMEÇA pela do quadro (`["board", id, …]`), de
 * propósito: toda invalidação por `["board", id]` alcança as duas, e quem
 * atualiza o cache otimista usa `setQueriesData` com o prefixo.
 */
export type EscopoDoQuadro = "carteira";

export function chaveDaCarteira(pipelineId: string | null) {
  return ["board", pipelineId, "carteira"] as const;
}

export interface OpcoesDoQuadro {
  escopo?: EscopoDoQuadro;
  /**
   * Agrupa os eventos do tempo real numa janela (ms) antes de buscar de novo.
   * Sem isso, cada lead que muda dispara um refetch do quadro inteiro em cada
   * aba aberta — com o pool pequeno, a rajada de leads novos vira fila.
   */
  agruparEventosMs?: number;
  /** v1.9.18: a função do "Ver como" de quem administra; só recorta a apresentação. */
  verComo?: string | null;
  /** v1.9.18: espera saber o "Ver como" antes de baixar o quadro. */
  esperar?: boolean;
}

export function useBoard(pipelineId: string | null, opcoes: OpcoesDoQuadro = {}) {
  const qc = useQueryClient();
  const { escopo, agruparEventosMs = 0, verComo = null, esperar = false } = opcoes;
  const queryKey = escopo ? [...chaveDaCarteira(pipelineId), verComo] : chaveDoQuadro(pipelineId);
  const agrupador = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * ia.vek v1.9.51 (Maestro 011542, CPU): com a aba ESCONDIDA, o evento do tempo real só MARCA o quadro como velho
   * (sem ir ao banco); ao VOLTAR a aba, ele recarrega UMA vez e, até o dado novo chegar, `atualizandoAoVoltar` avisa a
   * tela (que não mostra o velho como se fosse atual). MEDIDO no canário: com a aba escondida, o quadro e o painel
   * recarregavam 44 + 44 vezes em 11 min, sem ninguém olhando. O que AVISA a pessoa (som, contador, notificação de
   * mensagem nova e de lead passado, título da aba) NÃO passa por aqui e segue na hora.
   */
  const pendenteAoVoltar = useRef(false);
  const [atualizandoAoVoltar, setAtualizandoAoVoltar] = useState(false);
  const recarregar = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      pendenteAoVoltar.current = true;
      void qc.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      return;
    }
    void qc.invalidateQueries({ queryKey, exact: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave é derivada de pipelineId/escopo/verComo
  }, [qc, pipelineId, escopo, verComo]);
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState !== "visible" || !pendenteAoVoltar.current) return;
      pendenteAoVoltar.current = false;
      setAtualizandoAoVoltar(true);
      void qc.refetchQueries({ queryKey, exact: true }).finally(() => setAtualizandoAoVoltar(false));
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave é derivada de pipelineId/escopo/verComo
  }, [qc, pipelineId, escopo, verComo]);

  /**
   * Cards que acabaram de mudar POR EVENTO REMOTO — o pulso da Wave 3.
   *
   * Só entra aqui o que veio de fora: a própria ação já tem feedback (o card se
   * move sob o cursor) e pulsar nela seria ruído com cara de novidade. Cada id
   * sai sozinho depois de PULSE_MS: o pulso acontece UMA vez e cessa, em vez de
   * virar destaque persistente.
   */
  const [pulses, setPulses] = useState<Map<string, number>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const query = useQuery({
    queryKey,
    queryFn: () => fetchBoard(pipelineId as string, escopo, verComo),
    enabled: !!pipelineId && !esperar,
  });
  // ia.vek v1.9.26: o board chegou (ou falhou): os pedidos que não desenham o cartão seguem.
  const chegou = query.isSuccess || query.isError;
  useEffect(() => {
    if (chegou) liberarDepoisDoQuadro();
  }, [chegou]);

  const onChange = useCallback(
    (payload: unknown) => {
      // ia.vek v1.9.51 (CPU): `exact`: o tempo real recarrega SÓ este quadro. Sem ele, a chave ["board", id] casava como
      // prefixo a faixa sem dono (["board", id, "sem-dono"]) e a carteira do mesmo funil, que iam ao banco a cada evento
      // (a faixa já recarrega pelo próprio efeito, quando o quadro recarrega: ia 2 vezes).
      // Conservative: invalidate the board on any change. Optimistic patches
      // arrive faster via useMoveCard's onMutate; this just reconciles
      // cross-user changes within ~250ms.
      if (agruparEventosMs > 0) {
        if (!agrupador.current) {
          agrupador.current = setTimeout(() => {
            agrupador.current = null;
            recarregar();
          }, agruparEventosMs);
        }
      } else {
        recarregar();
      }

      const leadId = idDoEvento(payload);
      // Janela, não marca gasta por evento: uma ação minha chega aqui em DUAS
      // parcelas (o movimento e o carimbo de `last_activity_at` da atividade).
      if (!leadId || ehEcoLocal(leadId)) return;

      // CONTADOR, não booleano. Com um Set, o segundo evento remoto no mesmo
      // card dentro da janela não mudava nada: o id já estava lá, a classe
      // nunca saía do elemento e a animação CSS não reinicia sem a classe
      // sair — pior, o timeout do primeiro evento apagava tudo no meio do
      // segundo. Chegava coisa de fora e a tela não dizia nada, que é o pecado
      // que esta peça existe para matar.
      setPulses((atual) => {
        const proximo = new Map(atual);
        proximo.set(leadId, (proximo.get(leadId) ?? 0) + 1);
        return proximo;
      });

      // Cada evento reinicia a contagem: a janela é do ÚLTIMO evento.
      const anterior = timers.current.get(leadId);
      if (anterior) clearTimeout(anterior);
      timers.current.set(
        leadId,
        setTimeout(() => {
          timers.current.delete(leadId);
          setPulses((atual) => {
            if (!atual.has(leadId)) return atual;
            const proximo = new Map(atual);
            proximo.delete(leadId);
            return proximo;
          });
        }, PULSE_MS),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave é derivada de pipelineId/escopo
    [qc, pipelineId, escopo, agruparEventosMs, recarregar],
  );

  // O STATUS DO CANAL NÃO PODE SER DESCARTADO. `useRealtimeChannel` calcula
  // SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED e, sem atribuir o retorno,
  // esse valor morria na linha seguinte — enquanto ele é o único que separa
  // DUAS FAMÍLIAS INTEIRAS de causa: "a assinatura morreu" e "nada aconteceu"
  // têm exatamente a mesma aparência na tela, que é silêncio.
  //
  // Assinatura que morre calada é peça sem sinal de vida: o "log morto" do
  // checklist do sistema vivo, na versão cara, porque a tela continua parecendo
  // certa enquanto o board já não escuta mais nada.
  const { status: realtimeStatus, ultimaEntrega } = useRealtimeChannel({
    name: pipelineId ? `kanban-${pipelineId}${escopo ? `-${escopo}` : ""}` : "kanban-disabled",
    postgresChanges: pipelineId
      ? {
          event: "*",
          schema: "public",
          table: "crm_leads",
          filter: `pipeline_id=eq.${pipelineId}`,
        }
      : undefined,
    onChange,
    enabled: !!pipelineId,
  });

  // ia.vek v1.9.5 (CRM-179): a PRÉVIA DA ÚLTIMA MENSAGEM no cartão muda sem
  // recarregar. A prévia mora na CONVERSA (`last_message_preview`), não no
  // lead — então o canal acima, que escuta `crm_leads`, nunca a via. Este
  // escuta as conversas da empresa (a RLS entrega só as que a pessoa vê) e
  // recarrega o quadro quando a conversa de um cliente DESTE quadro muda,
  // juntando a rajada de mensagens numa leitura só.
  const orgDoQuadro = (query.data as BoardData | undefined)?.pipeline?.organization_id ?? null;
  const contatosDoQuadro = useRef<Set<string>>(new Set());
  useEffect(() => {
    contatosDoQuadro.current = new Set(
      ((query.data as BoardData | undefined)?.leads ?? [])
        .map((l) => (l as { contact_id?: string | null }).contact_id)
        .filter((c): c is string => Boolean(c)),
    );
  }, [query.data]);
  const agrupadorDaConversa = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aoMudarAConversa = useCallback(
    (payload: unknown) => {
      const nova = (payload as { new?: { id?: string; contact_id?: string | null } } | null)?.new;
      if (!nova?.contact_id || !contatosDoQuadro.current.has(nova.contact_id)) return;
      // ia.vek v1.9.18: o cartão sobe na hora, com o que o tempo real trouxe; baixar o
      // quadro inteiro levava segundos. A recarga abaixo só reconcilia, sem pressa.
      if (nova.id) {
        const conversa = nova as Parameters<typeof aplicarConversaNoQuadro>[1];
        qc.setQueryData<BoardData>(queryKey, (atual) =>
          atual ? { ...atual, leads: aplicarConversaNoQuadro(atual.leads, conversa) } : atual,
        );
      }
      if (agrupadorDaConversa.current) return;
      agrupadorDaConversa.current = setTimeout(() => {
        agrupadorDaConversa.current = null;
        recarregar();
      }, Math.max(agruparEventosMs, 30_000));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave é derivada de pipelineId/escopo
    [qc, pipelineId, escopo, agruparEventosMs, recarregar],
  );
  useRealtimeChannel({
    name: pipelineId && orgDoQuadro ? `kanban-conversas-${pipelineId}${escopo ? `-${escopo}` : ""}` : "kanban-conversas-disabled",
    postgresChanges: orgDoQuadro
      ? { event: "UPDATE", schema: "public", table: "conversations", filter: `organization_id=eq.${orgDoQuadro}` }
      : undefined,
    onChange: aoMudarAConversa,
    enabled: !!pipelineId && !!orgDoQuadro,
  });
  useEffect(
    () => () => {
      if (agrupadorDaConversa.current) clearTimeout(agrupadorDaConversa.current);
    },
    [],
  );

  // Timers pendentes morrem com o componente — senão um setState chega depois
  // do unmount e o React reclama (e o Map de timers vaza).
  useEffect(() => {
    const pendentes = timers.current;
    return () => {
      for (const t of pendentes.values()) clearTimeout(t);
      pendentes.clear();
      if (agrupador.current) clearTimeout(agrupador.current);
    };
  }, []);

  // A REDE DE SEGURANÇA. Sem ela, um canal que para de entregar deixa o board
  // congelado num passado que parece presente — e nem voltar para a aba
  // conserta. A assinatura é a contagem de leads mais o maior `updated_at`: é
  // sensível a exatamente o que o canal deveria ter trazido (lead novo, lead
  // movido, lead editado) e barata de calcular a cada verificação.
  const seguranca = useRefetchDeSeguranca<BoardData>({
    queryKey,
    assinatura: (d) => {
      const leads = d?.leads ?? [];
      let maior = "";
      for (const l of leads) {
        const u = (l as { updated_at?: string }).updated_at ?? "";
        if (u > maior) maior = u;
      }
      return `${leads.length}:${maior}`;
    },
    ultimaEntrega,
    enabled: !!pipelineId,
  });

  return { ...query, pulses, realtimeStatus, seguranca, atualizandoAoVoltar };
}
