import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_B, GOV_CONV_AGENT_B, GOV_MANAGER, GOV_ADMIN, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * ia.vek v1.8.2 (migration 0588) — o vendedor NÃO arquiva conversa, nem pela
 * REST direta com o próprio JWT (a policy de update da conversa é de agent).
 * Gerente e admin arquivam; o serviço (sem sessão) segue livre.
 */
const status = () => lastLine(sql(`select status from public.conversations where id = '${GOV_CONV_AGENT_B}';`));
const voltaParaAberta = () => sql(`update public.conversations set status = 'open' where id = '${GOV_CONV_AGENT_B}';`);

beforeAll(() => {
  seedGov();
  voltaParaAberta();
});

describe("arquivar conversa: só gerente e admin", () => {
  it("o vendedor (dono da conversa) é recusado pelo banco", () => {
    expect(() =>
      writeCountAs(GOV_AGENT_B, `update public.conversations set status = 'archived' where id = '${GOV_CONV_AGENT_B}'`),
    ).toThrow(/Só gerente ou admin arquiva/);
    expect(status()).not.toBe("archived");
  });

  it("o vendedor continua podendo mudar outros status (ex.: fechar)", () => {
    expect(writeCountAs(GOV_AGENT_B, `update public.conversations set status = 'closed' where id = '${GOV_CONV_AGENT_B}'`)).toBe(1);
    voltaParaAberta();
  });

  it("o gerente arquiva", () => {
    expect(writeCountAs(GOV_MANAGER, `update public.conversations set status = 'archived' where id = '${GOV_CONV_AGENT_B}'`)).toBe(1);
    expect(status()).toBe("archived");
    voltaParaAberta();
  });

  it("o admin arquiva", () => {
    expect(writeCountAs(GOV_ADMIN, `update public.conversations set status = 'archived' where id = '${GOV_CONV_AGENT_B}'`)).toBe(1);
    voltaParaAberta();
  });

  it("o serviço (sem sessão de usuário) arquiva — crons e workers não mudam", () => {
    sql(`update public.conversations set status = 'archived' where id = '${GOV_CONV_AGENT_B}';`);
    expect(status()).toBe("archived");
    voltaParaAberta();
  });
});
