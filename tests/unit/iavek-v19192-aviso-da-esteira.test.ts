import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn(async () => ({ error: null }));
let jaAvisou = 0;
vi.mock("@/lib/iavek/avisos-da-proposta", () => ({ membrosComPapel: vi.fn(async () => ["g", "a"]) }));

import { esteiraFalhou, esteiraRodou, zerarContaDaEsteira } from "@/lib/esteira/aviso-de-parada";

const admin = () => {
  const c = { select: () => c, eq: () => c, gte: async () => ({ count: jaAvisou }) };
  return { from: () => ({ ...c, insert }) } as never;
};

describe("v1.9.19.2: aviso da esteira parada", () => {
  beforeEach(() => {
    insert.mockClear();
    jaAvisou = 0;
    zerarContaDaEsteira();
  });
  it("uma ou duas falhas não avisam; a terceira avisa gerente e admin", async () => {
    await esteiraFalhou(admin(), "o");
    await esteiraFalhou(admin(), "o");
    expect(insert).not.toHaveBeenCalled();
    await esteiraFalhou(admin(), "o");
    expect(insert).toHaveBeenCalledTimes(1);
    const linhas = (insert.mock.calls[0] as unknown as [Array<{ user_id: string; dados: { evento: string } }>])[0];
    expect(linhas.map((l) => l.user_id)).toEqual(["g", "a"]);
    expect(linhas[0]!.dados.evento).toBe("esteira_parada");
  });
  it("seguir falhando não repete; já avisou hoje, não avisa", async () => {
    for (let i = 0; i < 6; i++) await esteiraFalhou(admin(), "o");
    expect(insert).toHaveBeenCalledTimes(1);
    insert.mockClear();
    zerarContaDaEsteira();
    jaAvisou = 1;
    for (let i = 0; i < 3; i++) await esteiraFalhou(admin(), "o");
    expect(insert).not.toHaveBeenCalled();
  });
  it("uma rodada boa zera a conta; depois do aviso, diz que voltou", async () => {
    await esteiraFalhou(admin(), "o");
    await esteiraFalhou(admin(), "o");
    await esteiraRodou(admin(), "o");
    await esteiraFalhou(admin(), "o");
    expect(insert).not.toHaveBeenCalled();
    await esteiraFalhou(admin(), "o");
    await esteiraFalhou(admin(), "o");
    await esteiraRodou(admin(), "o");
    const ultima = insert.mock.calls.at(-1) as unknown as [Array<{ dados: { evento: string } }>];
    expect(ultima[0][0]!.dados.evento).toBe("esteira_voltou");
  });
});
