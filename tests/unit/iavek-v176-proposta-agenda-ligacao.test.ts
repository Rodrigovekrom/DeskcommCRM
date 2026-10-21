/**
 * ia.vek v1.7.6 — as regras puras da aprovação de proposta, do pedido de
 * agendamento, da agenda sem trava e da ligação só para contato próprio.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { partesNoFuso } from "@/lib/agenda/fuso";
import { horariosLivres, type JornadaDaAgenda, type Slot } from "@/lib/agenda/horarios-livres";
import { cabeMaisUm, capacidadePorHorario } from "@/lib/iavek/capacidade-da-agenda";
import { exigirContatoProprioParaLigar } from "@/lib/iavek/contato-proprio";
import {
  pedidoDeAgendamentoSchema,
  podeDecidir,
  quandoValido,
} from "@/lib/iavek/pedidos-de-agendamento";
import {
  aprovaProposta,
  motivoDaDevolucao,
  podePedirAprovacao,
  podeSerDevolvida,
  podeSerEnviada,
} from "@/lib/iavek/proposta-do-vendedor";
import { iaAgendaSozinha } from "@/lib/mcp/tools/agendamento";

describe("aprovação de proposta pelo gerente", () => {
  it("gerente e admin aprovam; vendedor (agent) não", () => {
    expect(aprovaProposta("admin")).toBe(true);
    expect(aprovaProposta("manager")).toBe(true);
    expect(aprovaProposta("agent")).toBe(false);
    expect(aprovaProposta("viewer")).toBe(false);
  });

  it("o fluxo: rascunho → aguardando → (aprovar e enviar | devolver)", () => {
    expect(podePedirAprovacao("rascunho")).toBe(true);
    expect(podePedirAprovacao("aguardando_aprovacao")).toBe(false);
    expect(podePedirAprovacao("enviada")).toBe(false);
    expect(podeSerEnviada("rascunho")).toBe(true);
    expect(podeSerEnviada("aguardando_aprovacao")).toBe(true);
    expect(podeSerEnviada("enviada")).toBe(false);
    expect(podeSerDevolvida("aguardando_aprovacao")).toBe(true);
    expect(podeSerDevolvida("rascunho")).toBe(false);
  });

  it("devolver exige motivo escrito (3 a 500 caracteres)", () => {
    expect(motivoDaDevolucao("  ok  ")).toBeNull();
    expect(motivoDaDevolucao("Preço errado no item 2")).toBe("Preço errado no item 2");
    expect(motivoDaDevolucao("x".repeat(501))).toBeNull();
    expect(motivoDaDevolucao(undefined)).toBeNull();
  });
});

describe("pedido de agendamento", () => {
  const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();
  it("dia e hora no futuro, em até 180 dias", () => {
    expect(quandoValido(daqui(3600_000))).toBe(true);
    expect(quandoValido(daqui(-60_000))).toBe(false);
    expect(quandoValido(daqui(181 * 86_400_000))).toBe(false);
  });
  it("o corpo traz cliente, quando e observação; nada de campo solto", () => {
    const c = "11111111-1111-4111-8111-111111111111";
    expect(
      pedidoDeAgendamentoSchema.safeParse({ contact_id: c, quando: daqui(3600_000) }).success,
    ).toBe(true);
    expect(
      pedidoDeAgendamentoSchema.safeParse({
        contact_id: c,
        quando: daqui(3600_000),
        status: "confirmado",
      }).success,
    ).toBe(false);
    expect(pedidoDeAgendamentoSchema.safeParse({ contact_id: c, quando: "amanhã" }).success).toBe(
      false,
    );
  });
  it("só o pendente se decide", () => {
    expect(podeDecidir("pendente")).toBe(true);
    expect(podeDecidir("confirmado")).toBe(false);
    expect(podeDecidir("recusado")).toBe(false);
  });
  it("a IA ainda não agenda sozinha (registra pedido)", () => {
    const antes = process.env.IAVEK_IA_AGENDA_SOZINHA;
    delete process.env.IAVEK_IA_AGENDA_SOZINHA;
    expect(iaAgendaSozinha()).toBe(false);
    if (antes !== undefined) process.env.IAVEK_IA_AGENDA_SOZINHA = antes;
  });
});

describe("a agenda da loja não trava horário", () => {
  const SP = "America/Sao_Paulo";
  const JORNADA: JornadaDaAgenda = {
    timezone: SP,
    windows: [{ dow: 1, start: "09:00", end: "12:00" }],
  };
  const TIPO = {
    duracaoMin: 60,
    bufferAntesMin: 0,
    bufferDepoisMin: 0,
    avisoMinimoMin: 0,
    janelaDias: 60,
  };
  // Segunda 09/03/2026, 10h em SP = 13h UTC: dois compromissos já ali.
  const ocupados = [
    { inicio: new Date("2026-03-09T13:00:00Z"), fim: new Date("2026-03-09T14:00:00Z") },
    { inicio: new Date("2026-03-09T13:00:00Z"), fim: new Date("2026-03-09T14:00:00Z") },
  ];
  const horas = (s: Slot[]) => s.map((x) => partesNoFuso(x.inicio, SP).hora);
  const base = {
    jornada: JORNADA,
    excecoes: [],
    ocupados,
    tipo: TIPO,
    de: new Date("2026-03-09T00:00:00Z"),
    ate: new Date("2026-03-09T23:59:59Z"),
    agora: new Date("2026-03-01T12:00:00Z"),
  };

  it("sem capacidade (o padrão da loja), o horário com compromissos continua livre", () => {
    expect(horas(horariosLivres({ ...base, capacidade: null }))).toEqual([9, 10, 11]);
  });
  it("capacidade 3 ainda cabe; capacidade 2 lota às 10h", () => {
    expect(horas(horariosLivres({ ...base, capacidade: 3 }))).toEqual([9, 10, 11]);
    expect(horas(horariosLivres({ ...base, capacidade: 2 }))).toEqual([9, 11]);
  });
  it("sem o campo, vale o produto (um por pessoa)", () => {
    expect(horas(horariosLivres(base))).toEqual([9, 11]);
  });
  it("bloqueio de data bloqueia sempre, mesmo sem limite", () => {
    const comBloqueio = horariosLivres({
      ...base,
      capacidade: null,
      excecoes: [{ data: "2026-03-09", indisponivel: true, inicioMinuto: 0, fimMinuto: 1440 }],
    });
    expect(comBloqueio).toEqual([]);
  });
  it("a capacidade lida das configurações: inteiro de 1 a 1000, senão sem limite", () => {
    expect(capacidadePorHorario({})).toBeNull();
    expect(capacidadePorHorario({ iavek: { agenda_capacidade_por_horario: 7 } })).toBe(7);
    expect(capacidadePorHorario({ iavek: { agenda_capacidade_por_horario: 0 } })).toBeNull();
    expect(capacidadePorHorario({ iavek: { agenda_capacidade_por_horario: "7" } })).toBeNull();
    expect(cabeMaisUm(10, null)).toBe(true);
    expect(cabeMaisUm(6, 7)).toBe(true);
    expect(cabeMaisUm(7, 7)).toBe(false);
  });
});

describe("ligar: só para lead/cliente seu (o admin, para qualquer um)", () => {
  function banco(leads: number, conversas: number) {
    const consulta = (n: number) => {
      const q = {
        select: () => q,
        eq: () => q,
        or: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ count: n, error: null }).then(ok),
      };
      return q;
    };
    return {
      from: (t: string) => consulta(t === "crm_leads" ? leads : conversas),
    } as unknown as SupabaseClient;
  }
  const args = { orgId: "o", contatoId: "c", userId: "u", requestId: "r" };

  it("vendedor dono (ou guardião) do lead do contato: liga", async () => {
    expect(await exigirContatoProprioParaLigar(banco(1, 0), { ...args, role: "agent" })).toBeNull();
  });
  it("vendedor com a conversa do contato atribuída: liga", async () => {
    expect(await exigirContatoProprioParaLigar(banco(0, 1), { ...args, role: "agent" })).toBeNull();
  });
  it("contato de outra pessoa: 403, também para o gerente", async () => {
    expect(
      (await exigirContatoProprioParaLigar(banco(0, 0), { ...args, role: "agent" }))?.status,
    ).toBe(403);
    expect(
      (await exigirContatoProprioParaLigar(banco(0, 0), { ...args, role: "manager" }))?.status,
    ).toBe(403);
  });
  it("admin liga para qualquer um", async () => {
    expect(await exigirContatoProprioParaLigar(banco(0, 0), { ...args, role: "admin" })).toBeNull();
  });
});
