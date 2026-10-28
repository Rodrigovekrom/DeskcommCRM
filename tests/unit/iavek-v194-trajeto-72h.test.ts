import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOTIVOS_DE_DESISTENCIA,
  MOTIVOS_DE_PERDA,
  camposQueFaltam,
  dentroDoPrazo,
  passagemSchema,
  podeTrocarVendedor,
} from "@/lib/iavek/passagem";
import { ETAPAS_QUE_TRAVAM } from "@/lib/iavek/campos-obrigatorios";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** ia.vek v1.9.4 — o trajeto do lead em 72h (CRM-209, decisões do Rodrigo de 27/10). */
describe("v1.9.4 — os campos da passagem (a trava)", () => {
  const completos = {
    carro_interesse: "Onix 2022",
    cidade: "Sorocaba",
    forma_pagamento: "financiamento",
    entrada_reais: 0,
    tem_troca: false,
    prazo_compra: "0_7",
  };

  it("com os 7 campos não falta nada (entrada 0 = sem entrada vale)", () => {
    expect(camposQueFaltam(completos)).toEqual([]);
  });

  it("aponta o que falta, e a troca pede modelo e ano", () => {
    expect(camposQueFaltam({})).toHaveLength(6);
    expect(camposQueFaltam({ ...completos, tem_troca: true })).toEqual(["Troca: modelo e ano"]);
    expect(camposQueFaltam({ ...completos, tem_troca: "true", troca_modelo: "Gol", troca_ano: 2015 })).toEqual([]);
    expect(camposQueFaltam({ ...completos, cidade: "  " })).toEqual(["Cidade / região"]);
  });

  it("negociar exige contexto, objeção e próximo passo; devolver exige motivo da lista", () => {
    const lead = "11111111-1111-4111-8111-111111111111";
    const vend = "22222222-2222-4222-8222-222222222222";
    expect(passagemSchema.safeParse({ tipo: "negociar", lead_id: lead, vendedor_id: vend, contexto: "curto", objecao: "preço", proximo_passo: { o_que: "ligar", quando: "2026-10-30T12:00:00Z" } }).success).toBe(false);
    expect(passagemSchema.safeParse({ tipo: "negociar", lead_id: lead, vendedor_id: vend, contexto: "Cliente quer Onix 2022, financiado", objecao: "preço", proximo_passo: { o_que: "ligar", quando: "2026-10-30T12:00:00Z" } }).success).toBe(true);
    expect(passagemSchema.safeParse({ tipo: "devolver", lead_id: lead, motivo: "Qualquer", feito: "liguei 3 vezes", proximo_passo_sugerido: "whats" }).success).toBe(false);
    expect(passagemSchema.safeParse({ tipo: "devolver", lead_id: lead, motivo: MOTIVOS_DE_DESISTENCIA[0], feito: "liguei 3 vezes", proximo_passo_sugerido: "whats" }).success).toBe(true);
    expect(passagemSchema.safeParse({ tipo: "trocar_vendedor", lead_id: lead, vendedor_id: vend, motivo: "" }).success).toBe(false);
  });

  it("as listas aprovadas", () => {
    expect(MOTIVOS_DE_DESISTENCIA).toEqual(["Não responde", "Sem entrada", "Ficha reprovada", "Carro indisponível", "Parcela não cabe", "Quer outro modelo", "Outro"]);
    expect(MOTIVOS_DE_PERDA).toEqual(["Comprou em outra loja", "Desistiu da compra", "Sem crédito", "Longe demais", "Só pesquisando", "Preço"]);
  });
});

describe("v1.9.4 — quem troca o vendedor", () => {
  it("o guardião troca a qualquer momento DENTRO das 72h; depois, só o administrador", () => {
    expect(podeTrocarVendedor({ souGuardiao: true, souAdmin: false, dentroDas72h: true })).toBe(true);
    expect(podeTrocarVendedor({ souGuardiao: true, souAdmin: false, dentroDas72h: false })).toBe(false);
    expect(podeTrocarVendedor({ souGuardiao: false, souAdmin: true, dentroDas72h: false })).toBe(true);
    expect(podeTrocarVendedor({ souGuardiao: false, souAdmin: false, dentroDas72h: true })).toBe(false);
  });

  it("as 72h são corridas desde o nascimento do lead", () => {
    const agora = new Date("2026-10-30T12:00:00Z");
    expect(dentroDoPrazo("2026-10-27T13:00:00Z", agora)).toBe(true);
    expect(dentroDoPrazo("2026-10-27T11:00:00Z", agora)).toBe(false);
  });

  it("quem perde o lead é avisado, com o nome do cliente (ele não lê mais o lead)", () => {
    const r = ler("app/api/v1/iavek/passagem/route.ts");
    expect(r).toContain('tipo: "lead_retirado",');
    expect(r).toContain("contato_nome: await nomeDoCliente(admin, orgId, lead.contact_id, t)");
    expect(r).toContain('"Depois das 72h, só o administrador troca o vendedor."');
  });
});

describe("v1.9.4 — a marcação do SDR passa pela trava", () => {
  it("só marca com os 7 campos e o contexto; o lead vai para Agendado e o resumo fica gravado", () => {
    const r = ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts");
    expect(r).toContain("const faltam = camposQueFaltam(campos);");
    expect(r).toContain("if ((passagem.contexto ?? \"\").length < CONTEXTO_MINIMO) faltam.push(ROTULO_DO_CONTEXTO);");
    expect(r).toContain('await moverParaAEtapaDaPassagem(admin, ctxDoSdr, lido, "agendamento");');
    expect(r).toContain('tipo: "agendamento",');
  });
});

describe("v1.9.4 — a trava ao mover olha o funil novo (0596)", () => {
  it("as etapas de compromisso do funil novo, sem a Troca arquivada", () => {
    expect(ETAPAS_QUE_TRAVAM).toEqual(["agendado-video", "qualificado", "ligacao-de-video", "ficha-feita", "ficha-aprovada", "venda-100-web", "vendido"]);
    const m = ler("supabase/migrations/20261028020000_0596_iavek_trajeto_72h.sql");
    for (const t of ["'lead_devolvido'", "'lead_retirado'", "'lead_reativado'", "'ficha-feita'"]) expect(m).toContain(t);
    const b = ler("supabase/baseline.sql");
    const ultima = b.slice(b.lastIndexOf("add constraint notificacoes_tipo_check"));
    expect(ultima.slice(0, ultima.indexOf("));"))).toContain("'lead_reativado'");
  });
});

describe("v1.9.4 — a esteira: 72h acabou, follow-up e reativação", () => {
  it("só leads nascidos depois de `desde` (não varre os antigos de uma vez)", () => {
    expect(ler("lib/esteira/config.ts")).toContain("desde: z.string().datetime({ offset: true }).optional(),");
    expect(ler("lib/esteira/rodada.ts")).toContain("(desde === null || Date.parse(l.created_at) >= desde)");
  });

  it("no follow-up o dono é o guardião; quem reativa volta ao SDR com um novo ciclo", () => {
    const d = ler("lib/esteira/deps-reais.ts");
    expect(d).toContain("...(guardiao ? { owner_user_id: guardiao, owner_kind: \"user\", owner_agent_id: null } : {}),");
    expect(d).toContain("async reativar(lead) {");
    const rd = ler("lib/esteira/rodada.ts");
    expect(rd).toContain("const novo = deps.reativar ? await deps.reativar(lead) : null;");
    const s = ler("lib/iavek/passagem-servidor.ts");
    expect(s).toContain("esteira_inicio: agora");
    expect(s).toContain('tipo: "lead_reativado",');
  });
});
