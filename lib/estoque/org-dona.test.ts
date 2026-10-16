import { describe, expect, it } from "vitest";

import { altimusDaOrg, escolherOrgDona, settingsComAltimus } from "./org-dona";

describe("org-dona do estoque do Altimus", () => {
  it("lê a marca em settings.integracoes.altimus; ausente ou inválida é null", () => {
    expect(altimusDaOrg({ integracoes: { altimus: { ativa: true } } })).toEqual({ ativa: true });
    expect(altimusDaOrg({})).toBeNull();
    expect(altimusDaOrg(null)).toBeNull();
    expect(altimusDaOrg({ integracoes: { altimus: { ativa: "sim" } } })).toBeNull();
  });

  it("grava a marca sem perder as outras chaves nem as outras integrações", () => {
    const antes = { esteira: { ativa: false }, integracoes: { outra: { x: 1 } } };
    expect(settingsComAltimus(antes, { ativa: true })).toEqual({
      esteira: { ativa: false },
      integracoes: { outra: { x: 1 }, altimus: { ativa: true } },
    });
  });

  it("escolhe a marcada; recusa duas; única sem marca é a transição; desligada é respeitada", () => {
    const on = { integracoes: { altimus: { ativa: true } } };
    const off = { integracoes: { altimus: { ativa: false } } };
    expect(
      escolherOrgDona([
        { id: "a", settings: {} },
        { id: "b", settings: on },
      ]),
    ).toEqual({ tipo: "marcada", orgId: "b" });
    expect(
      escolherOrgDona([
        { id: "a", settings: on },
        { id: "b", settings: on },
      ]),
    ).toEqual({
      tipo: "mais_de_uma",
      orgIds: ["a", "b"],
    });
    expect(escolherOrgDona([{ id: "a", settings: {} }])).toEqual({
      tipo: "unica_sem_marca",
      orgId: "a",
    });
    expect(escolherOrgDona([{ id: "a", settings: off }])).toEqual({ tipo: "nenhuma" });
    expect(
      escolherOrgDona([
        { id: "a", settings: {} },
        { id: "b", settings: {} },
      ]),
    ).toEqual({ tipo: "nenhuma" });
  });
});
