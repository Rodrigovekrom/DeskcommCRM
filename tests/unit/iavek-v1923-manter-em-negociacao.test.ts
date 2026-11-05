import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cronometroDoLead, manterAteDoLead } from "@/lib/iavek/cronometro-72h";

const ENTRADA = { pipeline_id: "p", horas: 72, etapas_de_compromisso: ["agendado"] };
const HORA = 3_600_000;
const base = { status: "open", pipeline_id: "p", stage_id: "novo", created_at: "2026-11-01T12:00:00.000Z" };

describe("v1.9.23: o relógio mostra o 'Manter em negociação'", () => {
  it("sem manter, o prazo é o de sempre", () => {
    const c = cronometroDoLead(base, ENTRADA)!;
    expect(Date.parse(c.fim_em) - Date.parse(c.inicio)).toBe(72 * HORA);
    expect(c.mantido_ate).toBeUndefined();
  });
  it("mantido além do prazo, o fim é o do manter", () => {
    const ate = "2026-11-06T12:00:00.000Z";
    const c = cronometroDoLead({ ...base, source_metadata: { esteira_manter_ate: ate } }, ENTRADA)!;
    expect(c.fim_em).toBe(ate);
    expect(c.mantido_ate).toBe(ate);
  });
  it("cliente que respondeu depois do prazo: o relógio vai até 72h depois da resposta", () => {
    const resposta = "2026-11-04T18:00:00.000Z";
    const c = cronometroDoLead(base, ENTRADA, resposta)!;
    expect(c.fim_em).toBe("2026-11-07T18:00:00.000Z");
    expect(c.respondeu_em).toBe(resposta);
  });
  it("resposta de antes do ciclo não mexe no prazo; qualquer resposta dentro dele empurra, como na esteira", () => {
    const dentro = cronometroDoLead(base, ENTRADA, "2026-11-01T13:00:00.000Z")!;
    expect(dentro.fim_em).toBe("2026-11-04T13:00:00.000Z");
    const c = cronometroDoLead(base, ENTRADA, "2026-10-31T12:00:00.000Z")!;
    expect(Date.parse(c.fim_em) - Date.parse(c.inicio)).toBe(72 * HORA);
    expect(c.respondeu_em).toBeUndefined();
  });
  it("valor estranho é ignorado", () => {
    expect(manterAteDoLead({ source_metadata: { esteira_manter_ate: "ontem" } })).toBeNull();
  });
});

describe("v1.9.23: a rota", () => {
  const rota = readFileSync("app/api/v1/iavek/esteira/manter/route.ts", "utf8");
  it("confere quem pode pela sessão e só depois grava", () => {
    expect(rota).toMatch(/requireSupportWrite/);
    expect(rota.indexOf("createClient()")).toBeLessThan(rota.indexOf("createAdminClient()"));
    expect(rota).toMatch(/lead\.owner_user_id === eu[\s\S]*lead\.sdr_user_id === eu/);
    expect(rota).toMatch(/iavek\.lead_mantido_em_negociacao/);
  });
});
