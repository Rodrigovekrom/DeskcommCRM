/**
 * v1.9.55 (CRM-172, decisão do Rodrigo 13/11; respostas A/B/C/D): o padrão de atendimento novo. Cada tipo nos limites
 * EXATOS, o papel (o relógio do SDR na chegada, o do vendedor no dono) e o "não se aplica". Sem IA, só leitura.
 * O horário: o padrão (seg–sex 9h–18h, sáb 9h–14h, America/Sao_Paulo). 11/11/2026 é uma quarta.
 */
import { describe, expect, it } from "vitest";

import { avaliarLead, resumo, type PadraoDaLoja } from "@/lib/iavek/padrao-da-loja";

const ETAPAS = new Map([["e1", 1000]]);
const item = (extra: Partial<PadraoDaLoja["itens"][number]>): PadraoDaLoja["itens"][number] => ({
  id: "x",
  nome: "x",
  tipo: "marcacao",
  papel: "sdr",
  minutos: null,
  minimo_de_fotos: 0,
  minimo_de_videos: 0,
  campo: null,
  ate_etapa: null,
  horas: null,
  ...extra,
});
const padrao = (...itens: PadraoDaLoja["itens"]): PadraoDaLoja => ({ ativo: true, itens });
const lead = (created: string, assigned: string | null = null) => ({ stage_id: "e1", created_at: created, assigned_at: assigned, custom_fields: {} });
const Z = (s: string) => Date.parse(s);
const sem = { fotos: 0, videos: 0 };

describe("v1.9.55: responder em até 7 minutos (a 1ª resposta de GENTE; só no horário da loja)", () => {
  const p = padrao(item({ id: "r", tipo: "resposta", minutos: 7 }));
  const chegou = "2026-11-11T13:00:00Z"; // quarta, 10h em São Paulo (no expediente)

  it("respondeu em 7 min cravados: feito; em 7 min e 1 s: fora do padrão", () => {
    const [ok] = avaliarLead(p, lead(chegou), sem, ETAPAS, Z("2026-11-11T14:00:00Z"), { primeiraRespostaDeGente: Z("2026-11-11T13:07:00Z") });
    expect(ok!.situacao).toBe("feito");
    const [tarde] = avaliarLead(p, lead(chegou), sem, ETAPAS, Z("2026-11-11T14:00:00Z"), { primeiraRespostaDeGente: Z("2026-11-11T13:07:01Z") });
    expect(tarde!.situacao).toBe("fora_do_padrao");
  });

  it("sem resposta: pendente até o 7º minuto; depois, fora do padrão", () => {
    expect(avaliarLead(p, lead(chegou), sem, ETAPAS, Z("2026-11-11T13:07:00Z"), {})[0]!.situacao).toBe("pendente");
    expect(avaliarLead(p, lead(chegou), sem, ETAPAS, Z("2026-11-11T13:07:01Z"), {})[0]!.situacao).toBe("fora_do_padrao");
  });

  it("lead às 23h: o relógio só começa na abertura do dia seguinte (9h)", () => {
    const tardeDaNoite = "2026-11-12T02:00:00Z"; // quarta 23h em São Paulo
    // quinta 9h05 (12:05Z) ainda está no prazo; quinta 9h07 + 1 s já não
    expect(avaliarLead(p, lead(tardeDaNoite), sem, ETAPAS, Z("2026-11-12T12:05:00Z"), {})[0]!.situacao).toBe("pendente");
    expect(avaliarLead(p, lead(tardeDaNoite), sem, ETAPAS, Z("2026-11-12T12:07:01Z"), {})[0]!.situacao).toBe("fora_do_padrao");
    // respondeu às 8h da manhã (antes de abrir): conta como feito
    expect(
      avaliarLead(p, lead(tardeDaNoite), sem, ETAPAS, Z("2026-11-12T13:00:00Z"), { primeiraRespostaDeGente: Z("2026-11-12T11:00:00Z") })[0]!
        .situacao,
    ).toBe("feito");
  });
});

describe("v1.9.55: confirmar a visita na véspera (saída de GENTE no dia anterior)", () => {
  const p = padrao(item({ id: "c", tipo: "confirmacao" }));
  const visita = Z("2026-11-13T18:00:00Z"); // sexta 15h em São Paulo; o dia começa 13/11 03:00Z

  it("sem visita: não se aplica (não conta como pendente)", () => {
    const itens = avaliarLead(p, lead("2026-11-11T13:00:00Z"), sem, ETAPAS, Z("2026-11-12T12:00:00Z"), { visita: null });
    expect(itens[0]!.situacao).toBe("nao_se_aplica");
    expect(resumo(itens)).toEqual({ pendentes: 0, fora: 0 });
  });

  it("confirmada na véspera: feito", () => {
    const [i] = avaliarLead(p, lead("2026-11-11T13:00:00Z"), sem, ETAPAS, Z("2026-11-13T20:00:00Z"), { visita: { inicio: visita, confirmadaNaVespera: true } });
    expect(i!.situacao).toBe("feito");
  });

  it("não confirmada: pendente na véspera; fora do padrão quando chega o DIA da visita (fuso da loja)", () => {
    const f = { visita: { inicio: visita, confirmadaNaVespera: false } };
    expect(avaliarLead(p, lead("2026-11-11T13:00:00Z"), sem, ETAPAS, Z("2026-11-13T02:59:59Z"), f)[0]!.situacao).toBe("pendente");
    expect(avaliarLead(p, lead("2026-11-11T13:00:00Z"), sem, ETAPAS, Z("2026-11-13T03:00:00Z"), f)[0]!.situacao).toBe("fora_do_padrao");
  });
});

describe("v1.9.55: ficha completa e visita agendada (prazo em horas)", () => {
  it("a ficha: feita = feito; vazia passadas 24 h = fora; antes = pendente", () => {
    const p = padrao(item({ id: "f", tipo: "ficha", horas: 24 }));
    const c = "2026-11-11T13:00:00Z";
    expect(avaliarLead(p, lead(c), sem, ETAPAS, Z("2026-11-12T12:59:00Z"), { fichaCompleta: false })[0]!.situacao).toBe("pendente");
    expect(avaliarLead(p, lead(c), sem, ETAPAS, Z("2026-11-12T13:00:01Z"), { fichaCompleta: false })[0]!.situacao).toBe("fora_do_padrao");
    expect(avaliarLead(p, lead(c), sem, ETAPAS, Z("2026-11-13T13:00:00Z"), { fichaCompleta: true })[0]!.situacao).toBe("feito");
    // o fato ausente (não deu para ler) NUNCA conta como feito
    expect(avaliarLead(p, lead(c), sem, ETAPAS, Z("2026-11-13T13:00:00Z"), {})[0]!.situacao).toBe("fora_do_padrao");
  });

  it("a visita agendada em 48 h", () => {
    const p = padrao(item({ id: "a", tipo: "agendamento", horas: 48 }));
    const c = "2026-11-11T13:00:00Z";
    expect(avaliarLead(p, lead(c), sem, ETAPAS, Z("2026-11-13T13:00:01Z"), { temVisita: false })[0]!.situacao).toBe("fora_do_padrao");
    expect(avaliarLead(p, lead(c), sem, ETAPAS, Z("2026-11-13T13:00:01Z"), { temVisita: true })[0]!.situacao).toBe("feito");
  });
});

describe("v1.9.55: o PAPEL do item muda o relógio", () => {
  it("o do SDR corre desde a chegada; o do vendedor, desde que ele virou dono", () => {
    const p = padrao(item({ id: "s", tipo: "ficha", papel: "sdr", horas: 24 }), item({ id: "v", tipo: "ficha", papel: "vendedor", horas: 24 }));
    // chegou 11/11 13:00Z, o vendedor virou dono 12/11 13:00Z; agora 12/11 14:00Z
    const itens = avaliarLead(p, lead("2026-11-11T13:00:00Z", "2026-11-12T13:00:00Z"), sem, ETAPAS, Z("2026-11-12T14:00:00Z"), { fichaCompleta: false });
    expect(itens.find((i) => i.id === "s")!.situacao).toBe("fora_do_padrao");
    expect(itens.find((i) => i.id === "v")!.situacao).toBe("pendente");
    expect(itens.map((i) => i.papel)).toEqual(["sdr", "vendedor"]);
  });

  it("o item sem papel gravado (padrão de antes) é do vendedor", async () => {
    const { padraoDaLojaSchema } = await import("@/lib/iavek/padrao-da-loja");
    const lido = padraoDaLojaSchema.parse({
      ativo: true,
      itens: [{ id: "antigo", nome: "Item antigo", tipo: "marcacao", minimo_de_fotos: 0, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 }],
    });
    expect(lido.itens[0]!.papel).toBe("vendedor");
    expect(lido.itens[0]!.minutos).toBeNull();
  });
});

describe("v1.9.55: os fatos de um lead, a partir do que o servidor buscou em lote (fatosDoLead)", () => {
  const H = { fuso: "America/Sao_Paulo", dias: { 1: ["09:00", "18:00"] } } as const;
  const chegou = "2026-11-11T13:00:00Z";

  it("a 1ª resposta de gente conta só a partir da CHEGADA do lead", async () => {
    const { fatosDoLead } = await import("@/lib/iavek/padrao-da-loja-servidor");
    const f = fatosDoLead({ created_at: chegou }, { respostas: [Z("2026-11-10T13:00:00Z"), Z("2026-11-11T13:05:00Z")], visitas: [], fichaCompleta: null, horario: H as never, agora: Z("2026-11-11T14:00:00Z") });
    expect(f.primeiraRespostaDeGente).toBe(Z("2026-11-11T13:05:00Z"));
  });

  it("visita: só a criada DEPOIS do lead conta para 'agendou'; a que vale é a próxima, senão a mais recente", async () => {
    const { fatosDoLead } = await import("@/lib/iavek/padrao-da-loja-servidor");
    const antiga = { inicio: Z("2026-11-01T18:00:00Z"), criada: Z("2026-10-30T12:00:00Z") };
    expect(fatosDoLead({ created_at: chegou }, { respostas: [], visitas: [antiga], fichaCompleta: null, agora: Z("2026-11-12T12:00:00Z") }).temVisita).toBe(false);
    const nova = { inicio: Z("2026-11-13T18:00:00Z"), criada: Z("2026-11-11T15:00:00Z") };
    const f = fatosDoLead({ created_at: chegou }, { respostas: [], visitas: [antiga, nova], fichaCompleta: null, agora: Z("2026-11-12T12:00:00Z") });
    expect(f.temVisita).toBe(true);
    expect(f.visita!.inicio).toBe(nova.inicio);
  });

  it("confirmada na véspera = saída de gente no DIA ANTERIOR ao da visita (fuso da loja); no próprio dia não conta", async () => {
    const { fatosDoLead } = await import("@/lib/iavek/padrao-da-loja-servidor");
    const visita = { inicio: Z("2026-11-13T18:00:00Z"), criada: Z("2026-11-11T15:00:00Z") }; // sexta 15h SP
    const base = { visitas: [visita], fichaCompleta: null, horario: H as never, agora: Z("2026-11-12T12:00:00Z") };
    // quinta 12/11 às 20h SP (23:00Z): é a véspera
    expect(fatosDoLead({ created_at: chegou }, { ...base, respostas: [Z("2026-11-12T23:00:00Z")] }).visita!.confirmadaNaVespera).toBe(true);
    // sexta 13/11 às 8h SP (11:00Z): já é o dia da visita, não a véspera
    expect(fatosDoLead({ created_at: chegou }, { ...base, respostas: [Z("2026-11-13T11:00:00Z")] }).visita!.confirmadaNaVespera).toBe(false);
    // quinta 12/11 às 0h05 SP (03:05Z): véspera, logo no começo
    expect(fatosDoLead({ created_at: chegou }, { ...base, respostas: [Z("2026-11-12T03:05:00Z")] }).visita!.confirmadaNaVespera).toBe(true);
  });

  it("a ficha vem do banco como está (null = não deu para ler; não vira 'feito')", async () => {
    const { fatosDoLead } = await import("@/lib/iavek/padrao-da-loja-servidor");
    expect(fatosDoLead({ created_at: chegou }, { respostas: [], visitas: [], fichaCompleta: null, agora: 0 }).fichaCompleta).toBeNull();
  });
});
