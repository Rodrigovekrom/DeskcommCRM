import { describe, expect, it } from "vitest";

import { snoozeAte, snoozeSchema } from "@/lib/schemas/snooze";

describe("snoozeSchema", () => {
  it("aceita duration_hours 1, 3 e 24", () => {
    expect(snoozeSchema.safeParse({ duration_hours: 1 }).success).toBe(true);
    expect(snoozeSchema.safeParse({ duration_hours: 3 }).success).toBe(true);
    expect(snoozeSchema.safeParse({ duration_hours: 24 }).success).toBe(true);
  });
  it("rejeita valores fora do enum fechado", () => {
    expect(snoozeSchema.safeParse({ duration_hours: 0 }).success).toBe(false);
    expect(snoozeSchema.safeParse({ duration_hours: 5 }).success).toBe(false);
    expect(snoozeSchema.safeParse({ duration_hours: -1 }).success).toBe(false);
  });
  it("rejeita string em vez de number", () => {
    expect(snoozeSchema.safeParse({ duration_hours: "1" }).success).toBe(false);
  });
});

describe("snoozeSchema — data e horário (ia.vek v1.7.6)", () => {
  const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();
  it("aceita uma data futura com fuso, em até 90 dias", () => {
    expect(snoozeSchema.safeParse({ until: daqui(2 * 3600_000) }).success).toBe(true);
    expect(snoozeSchema.safeParse({ until: daqui(89 * 86_400_000) }).success).toBe(true);
  });
  it("recusa passado, mais de 90 dias, data sem fuso e as duas formas juntas", () => {
    expect(snoozeSchema.safeParse({ until: daqui(-60_000) }).success).toBe(false);
    expect(snoozeSchema.safeParse({ until: daqui(91 * 86_400_000) }).success).toBe(false);
    expect(snoozeSchema.safeParse({ until: "2030-01-01T10:00:00" }).success).toBe(false);
    expect(snoozeSchema.safeParse({ until: daqui(3600_000), duration_hours: 1 }).success).toBe(
      false,
    );
  });
  it("snoozeAte devolve a data escolhida ou agora + horas", () => {
    const alvo = daqui(5 * 3600_000);
    expect(snoozeAte({ until: alvo })).toBe(alvo);
    expect(snoozeAte({ duration_hours: 3 }, 0)).toBe(new Date(3 * 3600_000).toISOString());
  });
});
