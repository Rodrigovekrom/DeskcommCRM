import { describe, expect, it } from "vitest";

import { primeiroEnvioAssume } from "@/lib/iavek/funcoes";
import { etapasDoLado } from "@/lib/iavek/lados-do-funil";
import {
  aplicarConversaNoQuadro,
  compararLeads,
  ehColunaDaIa,
  esperandoDesde,
  manterOrdem,
  tempoDeEspera,
  ultimaDoLead,
} from "@/lib/iavek/ordem-do-quadro";
import { lerPreferenciasDoPipeline } from "@/lib/iavek/preferencias-de-tela";

const lead = (id: string, o: Record<string, unknown> = {}) =>
  ({ id, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", value_cents: 0, status: "open", contact_id: `c${id}`, conversa: null, ...o }) as never;
const conv = (last_inbound_at: string | null, ultima_resposta_humana_em: string | null = null) => ({
  id: "x", preview: null, last_message_at: null, unread: 0, last_inbound_at, ultima_resposta_humana_em,
});

describe("v1.9.18: ordem do quadro", () => {
  it("mensagem do lead sobe; sem mensagem, vale a chegada", () => {
    const a = lead("a", { conversa: conv("2026-11-04T10:00:00Z") });
    const b = lead("b", { conversa: conv("2026-11-04T11:00:00Z") });
    const novo = lead("n", { created_at: "2026-11-04T12:00:00Z" });
    expect([a, b, novo].sort(compararLeads("ultima_mensagem")).map((l: { id: string }) => l.id)).toEqual(["n", "b", "a"]);
    expect(ultimaDoLead(novo)).toBe(Date.parse("2026-11-04T12:00:00Z"));
  });
  it("as outras ordens", () => {
    const a = lead("a", { value_cents: 100, last_activity_at: "2026-11-03T00:00:00Z" });
    const b = lead("b", { value_cents: 900, last_activity_at: "2026-11-01T00:00:00Z" });
    expect([a, b].sort(compararLeads("maior_valor")).map((l: { id: string }) => l.id)).toEqual(["b", "a"]);
    expect([a, b].sort(compararLeads("parado")).map((l: { id: string }) => l.id)).toEqual(["b", "a"]);
    const venc = { a: "2026-11-01T00:00:00Z", b: "2026-11-05T00:00:00Z" };
    expect([b, a].sort(compararLeads("tarefa_atrasada", venc)).map((l: { id: string }) => l.id)).toEqual(["a", "b"]);
  });
  it("congelada, ninguém pula de lugar; quem chegou vai para o fim", () => {
    expect(manterOrdem([{ id: "n" }, { id: "b" }, { id: "a" }], ["a", "b"]).map((x) => x.id)).toEqual(["a", "b", "n"]);
  });
  it("a preferência antiga começa na ordem nova; a escolhida fica", () => {
    expect(lerPreferenciasDoPipeline({ ordem: "chegada" }).ordem).toBe("ultima_mensagem");
    expect(lerPreferenciasDoPipeline({ ordem: "chegada", v: 2 }).ordem).toBe("chegada");
  });
});

describe("v1.9.18: marca de nova mensagem", () => {
  const t = "2026-11-04T10:00:00Z";
  it("só resposta de pessoa pelo sistema apaga", () => {
    expect(esperandoDesde(lead("a", { conversa: conv(t) }), "Negociando")).toBe(Date.parse(t));
    expect(esperandoDesde(lead("a", { conversa: conv(t, "2026-11-04T11:00:00Z") }), "Negociando")).toBeNull();
    expect(esperandoDesde(lead("a", { conversa: conv("2026-11-04T12:00:00Z", "2026-11-04T11:00:00Z") }), "Negociando")).not.toBeNull();
  });
  it("não aparece na coluna da IA nem em lead fechado", () => {
    expect(ehColunaDaIa("IA Atendendo")).toBe(true);
    expect(esperandoDesde(lead("a", { conversa: conv(t) }), "IA Atendendo")).toBeNull();
    expect(esperandoDesde(lead("a", { status: "won", conversa: conv(t) }), "Vendido")).toBeNull();
  });
  it("tempo de espera", () => {
    expect(tempoDeEspera(12 * 60_000)).toBe("12 min");
    expect(tempoDeEspera(3 * 3_600_000)).toBe("3 h");
    expect(tempoDeEspera(2 * 86_400_000)).toBe("2 d");
  });
  it("o tempo real atualiza só o lead daquele contato", () => {
    const leads = [lead("a"), lead("b")] as never[];
    const r = aplicarConversaNoQuadro(leads, { id: "c1", contact_id: "ca", last_inbound_at: t }) as Array<{ id: string; conversa: { last_inbound_at?: string } | null }>;
    expect(r[0]!.conversa?.last_inbound_at).toBe(t);
    expect(r[1]!.conversa).toBeNull();
    expect(aplicarConversaNoQuadro(leads, { id: "c9", contact_id: "zz" })).toBe(leads);
  });
});

describe("v1.9.18: funções", () => {
  it("o vendedor vê depois do Suporte IA até o fim", () => {
    const etapas = ["IA Atendendo", "Suporte IA", "Em atendimento", "Agendado", "Vendido", "Perdido"].map((name, i) => ({ id: `${i}`, name, position: i }));
    expect(etapasDoLado(etapas, {}, "vendedor").map((e) => e.name)).toEqual(["Em atendimento", "Agendado", "Vendido", "Perdido"]);
    expect(etapasDoLado(etapas, {}, "sdr")).toHaveLength(6);
    expect(etapasDoLado(etapas.filter((e) => e.name !== "Suporte IA"), {}, "vendedor")).toHaveLength(5);
  });
  it("primeiro envio assume, menos para o vendedor", () => {
    expect(primeiroEnvioAssume("vendedor", "agent")).toBe(false);
    for (const f of ["sdr", "suporte", "gerente", "apoio"]) expect(primeiroEnvioAssume(f, "agent")).toBe(true);
    expect(primeiroEnvioAssume(null, "admin")).toBe(true);
    expect(primeiroEnvioAssume(null, "agent")).toBe(false);
    expect(primeiroEnvioAssume("analista_ficha", "agent")).toBe(false);
  });
});

describe("v1.9.18: o menu de mover não abre o cartão", () => {
  it("o clique e a tecla param no invólucro do menu, que abre em portal", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("components/kanban/mover-no-quadro.tsx", "utf8");
    expect(fonte).toMatch(/onClick=\{parar\}\s+onKeyDown=\{parar\}\s+onPointerDown=\{parar\}/);
  });
});
