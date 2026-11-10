import type { AvailabilitySchedule } from "@/lib/schemas/routing";

/**
 * ia.vek v1.9.38 (CRM-255): o HORÁRIO DA LOJA, oferecido na grade de quem marca quando a pessoa ainda
 * não publicou a própria jornada — na LOJA (sem modo agendamento). Antes a tela travava com "A jornada
 * de atendimento ainda não foi publicada" e não deixava escolher o dia.
 *
 * De onde veio o horário (Fenômenos Car): seg–sex 9h às 18h, sáb 9h às 14h, domingo fechado —
 * `fenomenos/memoria-org-fenomenos-v4.md` (linha 6, a memória da organização que a IA usa) e o cofre
 * `04-CLIENTES/fenomenos.md` ("Horário rígido: seg-sex 9h-18h, sáb 9h-14h, dom fechado").
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
  windows: [
    { dow: 1, start: "09:00", end: "18:00" },
    { dow: 2, start: "09:00", end: "18:00" },
    { dow: 3, start: "09:00", end: "18:00" },
    { dow: 4, start: "09:00", end: "18:00" },
    { dow: 5, start: "09:00", end: "18:00" },
    { dow: 6, start: "09:00", end: "14:00" },
  ],
}) as AvailabilitySchedule;
