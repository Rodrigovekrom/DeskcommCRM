import { lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";

/**
 * ia.vek v1.7.6 — capacidade por horário da agenda da loja.
 *
 * Decisão do dono do produto (21/10/2026): a loja tem 7 vendedores e atende
 * mais de 10 pessoas ao mesmo tempo, então a agenda NÃO trava horário: vários
 * agendamentos no mesmo horário são permitidos (para a IA, o SDR e o admin).
 * O admin pode, se quiser, pôr um teto: `organizations.settings.iavek.
 * agenda_capacidade_por_horario` (inteiro ≥ 1). Sem número = sem limite.
 *
 * A capacidade conta COMPROMISSOS (e eventos do Google) que cruzam o horário.
 * Bloqueio de data (exceção "indisponível") continua bloqueando sempre: é o
 * admin dizendo "neste dia não".
 */
export const CAPACIDADE_MAXIMA = 1000;

/**
 * `null` = sem limite (o padrão da loja).
 *
 * v1.9.1: no MODO AGENDAMENTO (clínica) é 1 por pessoa, sempre — uma cliente
 * por horário com cada profissional. O banco garante o mesmo
 * (`trg_iavek_agenda_sem_duplo`, migration 0594); aqui é o motor de horários
 * não oferecer o que o banco recusaria.
 */
export function capacidadePorHorario(settings: unknown): number | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  if (lerPerfilDaEmpresa(settings).modo_agendamento) return 1;
  const iavek = (settings as Record<string, unknown>).iavek;
  if (!iavek || typeof iavek !== "object") return null;
  const v = (iavek as Record<string, unknown>).agenda_capacidade_por_horario;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > CAPACIDADE_MAXIMA) return null;
  return v;
}

/** O horário ainda cabe mais um? (`cruzam` = quantos compromissos já o cruzam) */
export function cabeMaisUm(cruzam: number, capacidade: number | null): boolean {
  return capacidade === null || cruzam < capacidade;
}
