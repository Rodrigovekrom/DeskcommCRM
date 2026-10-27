import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENDA_DA_IA_PADRAO,
  PROMPT_BASE_CLINICA,
  comAgendaDaIa,
  lerAgendaDaIa,
  statusDaMarcacaoDaIa,
  textoDaConfirmacao,
} from "@/lib/iavek/agenda-da-ia";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const agenda = vi.hoisted(() => ({ modo: false }));
vi.mock("@/lib/iavek/perfil-da-empresa-servidor", () => ({
  agendaDaIaDaOrg: vi.fn(async () => ({ modo: agenda.modo, config: { marca_como: "pre_agendado" } })),
  modoAgendamentoDaOrg: vi.fn(async () => agenda.modo),
}));
const { iaAgendaSozinha } = await import("@/lib/mcp/tools/agendamento");
const { confirmarPeloWhatsApp } = await import("@/workers/iavek-confirmacao-da-agenda");

afterEach(() => {
  agenda.modo = false;
});

/** ia.vek v1.9.2 — a IA agendando, só no modo agendamento. */
describe("v1.9.2 — como a IA marca", () => {
  it("nasce PRÉ-AGENDADO (pending); 'agendado' vira confirmed", () => {
    expect(lerAgendaDaIa({})).toEqual(AGENDA_DA_IA_PADRAO);
    expect(AGENDA_DA_IA_PADRAO.marca_como).toBe("pre_agendado");
    expect(statusDaMarcacaoDaIa(lerAgendaDaIa({}))).toBe("pending");
    expect(statusDaMarcacaoDaIa({ marca_como: "agendado" })).toBe("confirmed");
    expect(lerAgendaDaIa({ iavek: { agenda_ia: { marca_como: "qualquer" } } })).toEqual(AGENDA_DA_IA_PADRAO);
  });

  it("gravar não apaga as outras chaves do ia.vek (perfil, nota…)", () => {
    const s = comAgendaDaIa({ iavek: { perfil: { nicho: "clinica", modo_agendamento: true } } }, { marca_como: "agendado" });
    expect(s).toEqual({ iavek: { perfil: { nicho: "clinica", modo_agendamento: true }, agenda_ia: { marca_como: "agendado" } } });
  });

  it("o handler de marcar: IA no modo usa a configuração; pessoa e fora do modo seguem o tipo", () => {
    const h = ler("app/api/v1/agenda/agendamentos/_handler.ts");
    expect(h).toContain('const agendaDaIa = ctx.actor.type !== "user" ? await agendaDaIaDaOrg(ctx.organization_id) : null;');
    expect(h).toMatch(/agendaDaIa\?\.modo\s*\?\s*statusDaMarcacaoDaIa\(agendaDaIa\.config\)\s*:\s*tipo\.requires_confirmation/);
  });
});

describe("v1.9.2 — a chave da IA é POR EMPRESA", () => {
  const ORG = "00000000-0000-4000-8000-000000000001";
  it("na loja (fora do modo) a IA não marca, mesmo com a variável do ambiente fora dos testes", async () => {
    const antes = { env: process.env.IAVEK_IA_AGENDA_SOZINHA, node: process.env.NODE_ENV };
    process.env.IAVEK_IA_AGENDA_SOZINHA = "1";
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      expect(await iaAgendaSozinha(ORG)).toBe(false);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = antes.node;
      if (antes.env === undefined) delete process.env.IAVEK_IA_AGENDA_SOZINHA;
      else process.env.IAVEK_IA_AGENDA_SOZINHA = antes.env;
    }
  });

  it("na clínica (modo agendamento) a IA marca", async () => {
    const antes = process.env.IAVEK_IA_AGENDA_SOZINHA;
    delete process.env.IAVEK_IA_AGENDA_SOZINHA;
    agenda.modo = true;
    try {
      expect(await iaAgendaSozinha(ORG)).toBe(true);
    } finally {
      if (antes !== undefined) process.env.IAVEK_IA_AGENDA_SOZINHA = antes;
    }
  });

  it("as três portas da IA (marcar, remarcar, cancelar) perguntam à empresa", () => {
    const f = ler("lib/mcp/tools/agendamento.ts");
    expect(f.match(/ctx\.actor\.type !== "user" && !\(await iaAgendaSozinha\(ctx\.organizationId\)\)/g)).toHaveLength(3);
    expect(f).not.toMatch(/iaAgendaSozinha\(\)/);
  });
});

describe("v1.9.2 — prompt-base e confirmação", () => {
  it("o prompt-base da clínica não fala de carro, troca, financiamento nem estoque", () => {
    expect(PROMPT_BASE_CLINICA).not.toMatch(/carro|ve[ií]culo|seminov|troca|financ|estoque|parcela/i);
    expect(PROMPT_BASE_CLINICA).toContain("crm_find_free_slots");
    expect(PROMPT_BASE_CLINICA).toMatch(/NUNCA: peça CPF/);
  });

  it("a confirmação diz procedimento, dia e hora no fuso da clínica", () => {
    const txt = textoDaConfirmacao({ nome: "Ana Souza", procedimento: "Limpeza de pele", inicio: new Date("2026-10-28T12:00:00Z"), fuso: "America/Sao_Paulo", idioma: "pt-BR" });
    expect(txt).toBe("Olá, Ana! Seu horário de Limpeza de pele está CONFIRMADO para quarta-feira, 28/10, às 09:00. Qualquer coisa, é só responder por aqui.");
  });

  it("fora do modo agendamento a confirmação não faz nada (a loja não manda mensagem a mais)", async () => {
    const r = await confirmarPeloWhatsApp({ organization_id: "org", entity_id: "ap", payload: {} });
    expect(r).toEqual({ status: "skipped", reason: "fora_do_modo_agendamento" });
  });

  it("o consumidor está registrado, ouve só appointment.confirmed e pula org parada", () => {
    expect(ler("lib/event-log/register-handlers.ts")).toContain("registerHandler(iavekConfirmacaoDaAgendaHandler);");
    const h = ler("workers/iavek-confirmacao-da-agenda.handler.ts");
    expect(h).toContain('events: ["appointment.confirmed"]');
    expect(h).toContain('naOrgParada: "pula"');
  });
});
