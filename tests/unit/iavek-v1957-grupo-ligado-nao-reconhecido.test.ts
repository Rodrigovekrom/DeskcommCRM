/**
 * ia.vek v1.9.57 (card "Registrar aviso de grupo ligado que não foi reconhecido"; Maestro 153024). O descarte da
 * mensagem de grupo que não casa segue IGUAL; o que muda é o REGISTRO, só para a org que tem grupo ligado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
const info = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: (...a: unknown[]) => info(...a), error: vi.fn(), debug: vi.fn() } }));

import { parecidoComLigado, registrarDescarteDeGrupo, zerarContagemDeDescartes } from "@/lib/grupos/descarte";
import { gravarMensagemDeGrupo, type EntradaDeGrupo, type IngestDeGrupoDb } from "@/lib/grupos/ingest";

const LIGADO = { groupChatId: "120363012345678901@g.us", channelSessionId: "sessao-a" };
const T0 = Date.parse("2026-11-14T15:00:00Z");

beforeEach(() => {
  warn.mockClear();
  info.mockClear();
  zerarContagemDeDescartes();
});

describe("v1.9.57: o grupo parecido com um LIGADO", () => {
  it("o mesmo id por OUTRA sessão = parecido (outra_sessao)", () => {
    expect(parecidoComLigado(LIGADO.groupChatId, "sessao-b", [LIGADO])?.motivo).toBe("outra_sessao");
  });
  it("os mesmos dígitos em outro formato = parecido (id_em_outro_formato)", () => {
    expect(parecidoComLigado("5511999999999-120363012345678901@g.us", "sessao-a", [LIGADO])?.motivo).toBe("id_em_outro_formato");
  });
  it("outro grupo qualquer = não parecido; id curto nunca casa", () => {
    expect(parecidoComLigado("120363099999999999@g.us", "sessao-a", [LIGADO])).toBeNull();
    expect(parecidoComLigado("123@g.us", "sessao-a", [{ groupChatId: "123@g.us", channelSessionId: "sessao-a" }])).toBeNull();
  });
});

describe("v1.9.57: o registro do descarte", () => {
  it("a org SEM grupo ligado: nada (segue calado, como hoje)", () => {
    expect(registrarDescarteDeGrupo("org-1", "120363099999999999@g.us", "sessao-a", [], T0)).toBe("nada");
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("parecido com um ligado: warn NA HORA, com hash e nunca o id cru", () => {
    expect(registrarDescarteDeGrupo("org-1", LIGADO.groupChatId, "sessao-b", [LIGADO], T0)).toBe("aviso");
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg, campos] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe("grupo_habilitado_nao_reconhecido");
    expect(campos).toMatchObject({ organization_id: "org-1", motivo: "outra_sessao", mesma_sessao: false });
    expect(JSON.stringify(campos)).not.toContain("120363012345678901");
    expect(String(campos.chat_hash)).toMatch(/^[0-9a-f]{10}$/);
  });

  it("outro grupo: só conta; 1 linha info por org a cada 10 min (mensagens e grupos distintos)", () => {
    for (let i = 0; i < 5; i++) registrarDescarteDeGrupo("org-1", `12036309999999999${i % 2}@g.us`, "sessao-a", [LIGADO], T0 + i * 1000);
    expect(info).not.toHaveBeenCalled();
    registrarDescarteDeGrupo("org-1", "120363099999999990@g.us", "sessao-a", [LIGADO], T0 + 10 * 60_000);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![1]).toMatchObject({ organization_id: "org-1", mensagens: 6, grupos_distintos: 2 });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("v1.9.57: a entrada do grupo não muda", () => {
  const entrada: EntradaDeGrupo = {
    organizationId: "org-1",
    channelSessionId: "sessao-b",
    groupChatId: LIGADO.groupChatId,
    direction: "inbound",
    externalId: "ext-1",
    type: "text",
    body: "oi",
    mediaUrl: null,
    mediaMime: null,
    sentAt: "2026-11-14T15:00:00Z",
    remetente: null,
    rawType: null,
  };
  const base = (): IngestDeGrupoDb => ({
    grupoLigado: async () => null,
    criarContatoDoGrupo: async () => "c",
    criarConversaDoGrupo: async () => "v",
    vincular: async () => {},
    inserirMensagem: async () => "ok",
    reabrirSeFechada: async () => {},
    marcarConversa: async () => {},
  });

  it("não casou: segue 'grupo_desligado' e registra (o ligado em outra sessão = warn)", async () => {
    const db = { ...base(), gruposHabilitadosDaOrg: async () => [LIGADO] };
    expect(await gravarMensagemDeGrupo(db, entrada)).toBe("grupo_desligado");
    expect(warn.mock.calls[0]![0]).toBe("grupo_habilitado_nao_reconhecido");
  });

  it("a leitura dos ligados FALHA: segue 'grupo_desligado', sem lançar", async () => {
    const db = { ...base(), gruposHabilitadosDaOrg: async () => { throw new Error("banco fora"); } };
    await expect(gravarMensagemDeGrupo(db, entrada)).resolves.toBe("grupo_desligado");
  });

  it("sem o método (o fake de antes): segue 'grupo_desligado', calado", async () => {
    expect(await gravarMensagemDeGrupo(base(), entrada)).toBe("grupo_desligado");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("v1.9.57 (Lupa 153452): o warn do parecido tem limite", () => {
  it("50 mensagens do MESMO grupo parecido em 1 min = 1 warn; depois de 10 min, 1 de novo, com a contagem do intervalo", () => {
    for (let i = 0; i < 50; i++) registrarDescarteDeGrupo("org-1", LIGADO.groupChatId, "sessao-b", [LIGADO], T0 + i * 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({ mensagens_no_intervalo: 1 });
    registrarDescarteDeGrupo("org-1", LIGADO.groupChatId, "sessao-b", [LIGADO], T0 + 10 * 60_000);
    expect(warn).toHaveBeenCalledTimes(2);
    // as 49 seguintes à 1ª + esta = 50
    expect(warn.mock.calls[1]![1]).toMatchObject({ mensagens_no_intervalo: 50 });
  });

  it("o limite é por (org, grupo, motivo): outra org avisa à parte", () => {
    registrarDescarteDeGrupo("org-1", LIGADO.groupChatId, "sessao-b", [LIGADO], T0);
    registrarDescarteDeGrupo("org-2", LIGADO.groupChatId, "sessao-b", [LIGADO], T0);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
