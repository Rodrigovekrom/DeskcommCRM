"use client";

import * as React from "react";

import { useT } from "@/hooks/i18n/useT";
import { minutoDoDia } from "@/lib/agenda/grade-interativa";

/**
 * ia.vek v1.9.1 — as 4 CORES DA AGENDA no modo agendamento (clínica).
 *
 *   Agendado 100%  (verde)    = compromisso confirmado (ou realizado)
 *   Pré-agendado   (amarelo)  = compromisso aguardando confirmação
 *   Ausência       (cinza)    = bloqueio da pessoa (Dias bloqueados)
 *   Livre          (azul)     = horário que o motor oferece para marcar
 *
 * Fora do modo agendamento (a loja), NADA disto aparece: a grade segue a de
 * sempre, com a cor de cada pessoa. Quem decide é o contexto abaixo, que a
 * grade só liga quando o perfil da empresa tem `modo_agendamento`.
 */

export type AusenciaDaGrade = {
  /** Dia de calendário (yyyy-MM-dd) no fuso da agenda. */
  dia: string;
  /** Minutos desde 00:00 no fuso da agenda. */
  inicioMin: number;
  fimMin: number;
  pessoaId: string;
  motivo: string | null;
};

export const CoresDaAgendaContext = React.createContext<{ ativo: boolean; ausencias: readonly AusenciaDaGrade[] }>({
  ativo: false,
  ausencias: [],
});

export const useCoresDaAgenda = () => React.useContext(CoresDaAgendaContext);

/** As cores, num lugar só (a legenda e a grade leem daqui). */
export const COR_DO_ESTADO = {
  agendado: { fundo: "rgb(220 252 231)", borda: "rgb(34 197 94)" }, // verde
  pre_agendado: { fundo: "rgb(254 243 199)", borda: "rgb(245 158 11)" }, // amarelo
  ausencia: { fundo: "rgb(228 228 231)", borda: "rgb(161 161 170)" }, // cinza
  livre: { fundo: "rgb(224 242 254)", borda: "rgb(56 189 248)" }, // azul
} as const;

/** O fundo do compromisso pelo estado; `null` = não pinta (cancelado, faltou: fica como sempre). */
export function corDoCompromisso(situacao: string): { fundo: string; borda: string } | null {
  if (situacao === "confirmed" || situacao === "completed") return COR_DO_ESTADO.agendado;
  if (situacao === "pending") return COR_DO_ESTADO.pre_agendado;
  return null;
}

/**
 * v1.9.1 (ajuste): o horário oferecido que COBRE a célula — para o azul pintar o
 * horário inteiro (60 min = duas células), e não só a célula de início. Clicar
 * em qualquer parte do azul marca aquele horário (o instante PUBLICADO, nunca um
 * calculado). Escolhe o que começa mais tarde entre os que cobrem.
 */
export function horarioQueCobre<H extends { instante: string }>(
  publicados: readonly H[],
  celulaMinuto: number,
  duracaoMin: number,
  fuso: string,
): H | null {
  let escolhido: H | null = null;
  let melhor = Number.NEGATIVE_INFINITY;
  for (const h of publicados) {
    const m = minutoDoDia(h.instante, fuso);
    if (m <= celulaMinuto && celulaMinuto < m + duracaoMin && m > melhor) {
      melhor = m;
      escolhido = h;
    }
  }
  return escolhido;
}

/** Converte as exceções da agenda (`calendar_availability_exceptions`) nas faixas cinzas da grade. */
export function ausenciasDasExcecoes(
  excecoes: ReadonlyArray<{
    user_id: string;
    exception_date: string;
    is_unavailable: boolean;
    start_minute: number;
    end_minute: number;
    reason: string | null;
  }>,
  pessoasNaGrade: ReadonlySet<string>,
): AusenciaDaGrade[] {
  return excecoes
    .filter((e) => e.is_unavailable && pessoasNaGrade.has(e.user_id))
    .map((e) => ({
      dia: e.exception_date,
      inicioMin: e.start_minute,
      fimMin: e.end_minute,
      pessoaId: e.user_id,
      motivo: e.reason,
    }));
}

export function LegendaDaAgenda() {
  const t = useT();
  const itens: Array<[keyof typeof COR_DO_ESTADO, string]> = [
    ["agendado", t("Agendado 100%")],
    ["pre_agendado", t("Pré-agendado")],
    ["ausencia", t("Ausência")],
    ["livre", t("Livre")],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-xs" data-testid="legenda-da-agenda">
      {itens.map(([chave, rotulo]) => (
        <li key={chave} className="flex items-center gap-1.5" data-estado={chave}>
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border"
            style={{ backgroundColor: COR_DO_ESTADO[chave].fundo, borderColor: COR_DO_ESTADO[chave].borda }}
          />
          {rotulo}
        </li>
      ))}
    </ul>
  );
}

/** As faixas cinzas de ausência de um dia (abaixo dos compromissos e dos blocos livres). */
export function CamadaDeAusencias({
  dia,
  primeiraHora,
  ultimaHora,
  pixelsDe,
  nomeDaPessoa,
}: {
  dia: string;
  primeiraHora: number;
  ultimaHora: number;
  pixelsDe: (minutos: number) => number;
  nomeDaPessoa: (id: string) => string | undefined;
}) {
  const t = useT();
  const { ativo, ausencias } = useCoresDaAgenda();
  if (!ativo) return null;
  const doDia = ausencias.filter((a) => a.dia === dia);
  const topo = primeiraHora * 60;
  const fundo = (ultimaHora + 1) * 60;
  return (
    <>
      {doDia.map((a, i) => {
        const de = Math.max(a.inicioMin, topo);
        const ate = Math.min(a.fimMin, fundo);
        if (ate <= de) return null;
        const nome = nomeDaPessoa(a.pessoaId);
        return (
          <div
            key={`${a.pessoaId}-${a.inicioMin}-${i}`}
            data-testid="ausencia-na-grade"
            title={[t("Ausência"), nome, a.motivo].filter(Boolean).join(" · ")}
            className="pointer-events-none absolute inset-x-0 z-0 overflow-hidden border-l-[3px] px-1.5 text-[10px] font-medium text-text-muted"
            style={{
              top: pixelsDe(de - topo),
              height: pixelsDe(ate - de),
              backgroundColor: COR_DO_ESTADO.ausencia.fundo,
              borderLeftColor: COR_DO_ESTADO.ausencia.borda,
            }}
          >
            {t("Ausência")}
            {nome ? ` · ${nome}` : ""}
          </div>
        );
      })}
    </>
  );
}
