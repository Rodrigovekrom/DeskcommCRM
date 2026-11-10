import type { AvailabilitySchedule } from "@/lib/schemas/routing";

/**
 * ia.vek v1.9.38 (CRM-255): o HORÁRIO DA LOJA, oferecido na grade de quem marca quando a pessoa ainda
 * não publicou a própria jornada — na LOJA (sem modo agendamento). Antes a tela travava com "A jornada
 * de atendimento ainda não foi publicada" e não deixava escolher o dia.
 *
 * ia.vek v1.9.40 (Rodrigo, 10/11: "nenhuma trava de agendamento"): 24h, todos os dias, das 00:00 às 23:59.
 * O "24:00" não passa no esquema da jornada (`lib/schemas/routing.ts`, HHMM vai até 23:59). Antes (v1.9.38)
 * era o horário da Fenômenos (seg–sex 9h–18h, sáb 9h–14h, domingo fechado). É a mesma regra que a
 * produção recebeu por dado em 10/11 (jornada-24h.sh): aqui ela vale também para quem entrar depois.
 *
 * ⚠️ Só a GRADE usa isto (`app/api/v1/agenda/horarios-livres`). NÃO é gravado em
 * `attendant_availability`: a mesma coluna decide a distribuição automática de conversas
 * (`lib/routing/eligibility.ts`, onde `windows` vazio = sempre dentro do horário), e publicar a
 * jornada tiraria a pessoa da distribuição fora do expediente. A IA também continua presa à jornada
 * publicada, como antes.
 *
 * `dow` segue a régua de `scheduleWindowSchema`: 0 = domingo … 6 = sábado.
 */
export const JORNADA_DA_LOJA: AvailabilitySchedule = Object.freeze({
  timezone: "America/Sao_Paulo",
  windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "00:00", end: "23:59" })),
}) as AvailabilitySchedule;
