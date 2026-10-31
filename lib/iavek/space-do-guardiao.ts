/**
 * ia.vek v1.9.7 — o SPACE DO GUARDIÃO (opção B escolhida pelo Rodrigo, 30/10).
 *
 * Uma lista única, por urgência, de TODOS os leads que o guardião passou aos
 * vendedores, com o cronômetro das 72h e a ação do CRM-209 ("Passar a outro
 * vendedor", com motivo). Objetivo do Rodrigo: nenhum lead passa das 72h sem
 * um sim ou um não do cliente.
 *
 * O relógio é o MESMO da trava do CRM-209 e da esteira: as horas do ciclo
 * (`settings.esteira.entrada.horas`, 72) contadas do nascimento do lead no
 * funil de entrada (`nascimentoDoLead`). Aqui ficam só as regras puras: o
 * estado de cada linha e a ordem.
 */
export type EstadoNoSpace =
  /** No funil de entrada, fora do compromisso: o relógio corre. */
  | "correndo"
  /** Passou das horas e ainda não foi para o Follow-up (a esteira passa na próxima rodada). */
  | "vencido"
  /** Numa etapa de compromisso (ex.: Negociando): fica com o vendedor, não vai ao Follow-up. */
  | "compromisso"
  /** Já está no funil de Follow-up (as horas venceram sem um sim ou um não). */
  | "followup";

export interface LinhaDoSpace {
  lead_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  cliente: string | null;
  vendedor: { id: string; nome: string } | null;
  etapa: string | null;
  estado: EstadoNoSpace;
  /** Quando as horas acabam (ou acabaram). */
  fim_das_horas: string;
  /** O guardião ainda pode passar a outro vendedor (dentro das horas, fora do Follow-up). */
  pode_trocar: boolean;
}

export function estadoNoSpace(args: {
  noFollowup: boolean;
  emCompromisso: boolean;
  fimDasHoras: number;
  agora: number;
}): EstadoNoSpace {
  if (args.noFollowup) return "followup";
  if (args.emCompromisso) return "compromisso";
  return args.agora >= args.fimDasHoras ? "vencido" : "correndo";
}

const PESO: Record<EstadoNoSpace, number> = { vencido: 0, correndo: 1, compromisso: 2, followup: 3 };

/**
 * A ordem da lista: primeiro o que já venceu e ainda não foi para o Follow-up
 * (precisa de ação agora), depois o que vence primeiro, depois os em
 * compromisso, e por último os que já foram para o Follow-up (o mais recente
 * no topo da seção).
 */
export function ordenarPorUrgencia<T extends Pick<LinhaDoSpace, "estado" | "fim_das_horas">>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    const p = PESO[a.estado] - PESO[b.estado];
    if (p !== 0) return p;
    const fa = Date.parse(a.fim_das_horas);
    const fb = Date.parse(b.fim_das_horas);
    return a.estado === "followup" ? fb - fa : fa - fb;
  });
}

/** Faixa de urgência para a cor (a mesma régua do selo das 72h: 24h e 6h). */
export function urgencia(restanteMs: number): "folga" | "atencao" | "urgente" {
  if (restanteMs > 24 * 3_600_000) return "folga";
  if (restanteMs > 6 * 3_600_000) return "atencao";
  return "urgente";
}
