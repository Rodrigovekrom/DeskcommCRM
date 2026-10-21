import { z } from "zod";

/** ia.vek v1.7.6: o lembrete personalizado vai até 90 dias à frente. */
export const SNOOZE_MAX_DIAS = 90;

const porDuracao = z
  .object({ duration_hours: z.union([z.literal(1), z.literal(3), z.literal(24)]) })
  .strict();

/**
 * ia.vek v1.7.6: além de 1h, 3h e 24h, uma data e horário escolhidos (ISO com
 * fuso). Precisa estar no futuro e a no máximo 90 dias.
 */
const porData = z
  .object({ until: z.string().datetime({ offset: true }) })
  .strict()
  .refine(
    ({ until }) => {
      const alvo = new Date(until).getTime();
      const agora = Date.now();
      return alvo > agora && alvo <= agora + SNOOZE_MAX_DIAS * 86_400_000;
    },
    { message: "A data precisa estar no futuro, em até 90 dias.", path: ["until"] },
  );

export const snoozeSchema = z.union([porDuracao, porData]);
export type SnoozeInput = z.infer<typeof snoozeSchema>;

/** Quando o lembrete vence, para qualquer uma das duas formas. */
export function snoozeAte(input: SnoozeInput, agora = Date.now()): string {
  return "until" in input
    ? new Date(input.until).toISOString()
    : new Date(agora + input.duration_hours * 3600_000).toISOString();
}
