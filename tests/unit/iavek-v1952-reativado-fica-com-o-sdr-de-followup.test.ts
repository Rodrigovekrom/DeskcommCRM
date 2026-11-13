import { describe, expect, it } from "vitest";

import { sdrDeFollowupQueCuidava } from "@/lib/iavek/passagem-servidor";

/** ia.vek v1.9.52 (CRM-254, resposta 1): o reativado fica com o SDR de Follow-up que cuidava (dono e guardião). */
function db(linha: unknown) {
  return { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha }) }) }) }) }) } as never;
}
const LEAD = { organization_id: "o1", owner_user_id: "u1" };

describe("quem fica com o reativado", () => {
  it("o dono do Follow-up é SDR de Follow-up ativo -> é ELE", async () => {
    expect(await sdrDeFollowupQueCuidava(db({ role: "agent", revoked_at: null, interface_settings: { funcao: "sdr_followup" } }), LEAD)).toBe("u1");
  });
  it("o dono é SDR comum (a regra de antes: o guardião) -> null", async () => {
    expect(await sdrDeFollowupQueCuidava(db({ role: "agent", revoked_at: null, interface_settings: { funcao: "sdr" } }), LEAD)).toBeNull();
  });
  it("SDR de Follow-up REVOGADO, ou gerente com a função, não conta", async () => {
    expect(await sdrDeFollowupQueCuidava(db({ role: "agent", revoked_at: "2026-11-01", interface_settings: { funcao: "sdr_followup" } }), LEAD)).toBeNull();
    expect(await sdrDeFollowupQueCuidava(db({ role: "manager", revoked_at: null, interface_settings: { funcao: "sdr_followup" } }), LEAD)).toBeNull();
  });
  it("lead do Follow-up sem dono -> null (a regra de antes)", async () => {
    expect(await sdrDeFollowupQueCuidava(db(null), { organization_id: "o1", owner_user_id: null })).toBeNull();
  });
});
