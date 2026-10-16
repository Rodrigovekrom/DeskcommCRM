/**
 * HORAS ÚTEIS (ia.vek D3 — esteira de vendas da Fenômenos).
 *
 * As tarefas de ligação vencem "em 1 hora útil", a cobrança vem "2 horas úteis
 * depois", e a segunda cobrança "1 dia útil depois". O CRM não tinha essa conta:
 * as tarefas venciam em dias corridos e os fluxos esperavam em milissegundos.
 *
 * Puro (sem banco, sem relógio global): recebe o instante e o horário comercial,
 * devolve instante. O fuso é o da organização; domingo e dias sem janela não contam.
 * Feriado não entra nesta versão (anotado; o CRM só tem feriados de Portugal).
 */

/** "HH:MM" de abertura e fechamento de um dia. */
export type Janela = readonly [string, string];

export interface HorarioComercial {
  fuso: string;
  /** Chave = dia da semana (0 = domingo … 6 = sábado). Dia ausente = fechado. */
  dias: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, Janela>>;
}

/** O da Fenômenos (prompt da Daiane): seg–sex 9h–18h, sáb 9h–14h, domingo fechado. */
export const HORARIO_PADRAO: HorarioComercial = {
  fuso: "America/Sao_Paulo",
  dias: {
    1: ["09:00", "18:00"],
    2: ["09:00", "18:00"],
    3: ["09:00", "18:00"],
    4: ["09:00", "18:00"],
    5: ["09:00", "18:00"],
    6: ["09:00", "14:00"],
  },
};

const MIN = 60_000;

interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  diaDaSemana: number;
}

function partesLocais(instante: Date, fuso: string): PartesLocais {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day), diaDaSemana: dias[p.weekday!] ?? 0 };
}

/** Diferença (ms) entre o relógio local do fuso e UTC naquele instante. */
function deslocamento(instante: Date, fuso: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return comoUtc - (instante.getTime() - instante.getMilliseconds());
}

/** O instante (UTC) em que o relógio local do fuso marca aquela data e hora. */
export function instanteLocal(ano: number, mes: number, dia: number, hhmm: string, fuso: string): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const ingenuo = Date.UTC(ano, mes - 1, dia, h, m);
  let t = ingenuo - deslocamento(new Date(ingenuo), fuso);
  t = ingenuo - deslocamento(new Date(t), fuso); // segunda passada: atravessa troca de horário
  return new Date(t);
}

function janelaDoDia(instante: Date, h: HorarioComercial): { inicio: Date; fim: Date } | null {
  const p = partesLocais(instante, h.fuso);
  const j = h.dias[p.diaDaSemana as 0];
  if (!j) return null;
  return { inicio: instanteLocal(p.ano, p.mes, p.dia, j[0], h.fuso), fim: instanteLocal(p.ano, p.mes, p.dia, j[1], h.fuso) };
}

/** Meia-noite local do dia seguinte ao do instante. */
function inicioDoProximoDia(instante: Date, fuso: string): Date {
  const p = partesLocais(instante, fuso);
  const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + 1));
  return instanteLocal(amanha.getUTCFullYear(), amanha.getUTCMonth() + 1, amanha.getUTCDate(), "00:00", fuso);
}

/** Até quantos dias à frente procurar janela (cobre feriado longo + domingo). */
const TETO_DE_DIAS = 30;

/**
 * `inicio` + `horas` úteis. Fora do expediente, a contagem começa na próxima
 * abertura: uma tarefa criada no sábado às 15h com "1 hora útil" vence segunda às 10h.
 */
export function somarHorasUteis(inicio: Date, horas: number, h: HorarioComercial = HORARIO_PADRAO): Date {
  let restante = Math.max(0, Math.round(horas * 60)) * MIN;
  let cursor = new Date(inicio);
  for (let i = 0; i <= TETO_DE_DIAS; i += 1) {
    const j = janelaDoDia(cursor, h);
    if (j && cursor < j.fim) {
      const de = cursor < j.inicio ? j.inicio : cursor;
      const disponivel = j.fim.getTime() - de.getTime();
      if (restante <= disponivel) return new Date(de.getTime() + restante);
      restante -= disponivel;
    }
    cursor = inicioDoProximoDia(cursor, h.fuso);
  }
  return cursor;
}

/** Quantas horas úteis há entre `a` e `b` (0 se `b` ≤ `a`). */
export function horasUteisEntre(a: Date, b: Date, h: HorarioComercial = HORARIO_PADRAO): number {
  if (b <= a) return 0;
  let total = 0;
  let cursor = new Date(a);
  for (let i = 0; i <= 400 && cursor < b; i += 1) {
    const j = janelaDoDia(cursor, h);
    if (j) {
      const de = Math.max(cursor.getTime(), j.inicio.getTime());
      const ate = Math.min(b.getTime(), j.fim.getTime());
      if (ate > de) total += ate - de;
    }
    cursor = inicioDoProximoDia(cursor, h.fuso);
  }
  return total / (60 * MIN);
}

/** O instante está dentro do expediente? */
export function dentroDoExpediente(instante: Date, h: HorarioComercial = HORARIO_PADRAO): boolean {
  const j = janelaDoDia(instante, h);
  return j !== null && instante >= j.inicio && instante < j.fim;
}

/** Fechamento do expediente do dia do instante (null se o dia é fechado). */
export function fimDoExpediente(instante: Date, h: HorarioComercial = HORARIO_PADRAO): Date | null {
  return janelaDoDia(instante, h)?.fim ?? null;
}
