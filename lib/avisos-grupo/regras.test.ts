import { describe, expect, it } from "vitest";
import { configDoAvisoGrupo, decidirAviso, textoDoAviso } from "./regras";

const cfg = { espacamento_segundos: 60, teto_diario: 3 };
const agora = new Date("2026-10-16T13:00:00Z");

describe("aviso no grupo", () => {
  it("prefixo por tipo, sem duplicar, com teto de tamanho", () => {
    expect(textoDoAviso("comemoracao", "Juliana agendou sábado 9h30")).toBe("🎉 Juliana agendou sábado 9h30");
    expect(textoDoAviso("urgente", "🚨 já com prefixo")).toBe("🚨 já com prefixo");
    expect(textoDoAviso("observacao", "x".repeat(2000)).length).toBe(1000);
  });
  it("espaçamento: adia até liberar; teto: pula", () => {
    expect(decidirAviso({ agora, ultimoEnvio: null, enviadosHoje: 0, cfg })).toEqual({ tipo: "enviar" });
    expect(decidirAviso({ agora, ultimoEnvio: new Date(agora.getTime() - 20_000), enviadosHoje: 1, cfg })).toEqual({
      tipo: "adiar",
      ate: new Date(agora.getTime() + 40_000),
    });
    expect(decidirAviso({ agora, ultimoEnvio: new Date(agora.getTime() - 61_000), enviadosHoje: 2, cfg })).toEqual({ tipo: "enviar" });
    expect(decidirAviso({ agora, ultimoEnvio: null, enviadosHoje: 3, cfg })).toEqual({ tipo: "teto_atingido" });
  });
  it("config: só grupo válido; padrões de espaçamento e teto", () => {
    const sessao = "00000000-0000-4000-8000-000000000001";
    expect(configDoAvisoGrupo({})).toBeNull();
    expect(configDoAvisoGrupo({ aviso_grupo: { channel_session_id: sessao, group_chat_id: "5515999@c.us" } })).toBeNull();
    expect(configDoAvisoGrupo({ aviso_grupo: { channel_session_id: sessao, group_chat_id: "120363-99@g.us" } })).toMatchObject({
      espacamento_segundos: 60,
      teto_diario: 30,
    });
  });
});
