import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { quandoFalou, rotuloDoResponsavel } from "@/components/iavek/CartaoIavek";
import { CAMPOS_SEMPRE_VISIVEIS } from "@/lib/iavek/barra-lateral";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** ia.vek v1.8.2 — cartão, janela central, barra enxuta e "vendedor não arquiva". */
describe("v1.8.2 — cartão do vendedor", () => {
  const agora = new Date(2026, 9, 24, 15, 0);
  it("último horário falado: hoje / ontem / dd/mm", () => {
    expect(quandoFalou(new Date(2026, 9, 24, 14, 32).toISOString(), "pt-BR", (s) => s, agora)).toBe("hoje 14:32");
    expect(quandoFalou(new Date(2026, 9, 23, 9, 10).toISOString(), "pt-BR", (s) => s, agora)).toBe("ontem 09:10");
    expect(quandoFalou(new Date(2026, 9, 22, 18, 0).toISOString(), "pt-BR", (s) => s, agora)).toBe("22/10 18:00");
    expect(quandoFalou(null, "pt-BR")).toBeNull();
  });

  it("responsável: nome do vendedor, IA ou Sem dono", () => {
    const t = (s: string) => s;
    expect(rotuloDoResponsavel({ kind: "user", name: "Ana", agentVersion: null }, t)).toBe("Ana");
    expect(rotuloDoResponsavel({ kind: "ai", name: "Venda.IA", agentVersion: 3 }, t)).toBe("IA");
    expect(rotuloDoResponsavel({ kind: null, name: null, agentVersion: null }, t)).toBe("Sem dono");
  });

  it("os dois quadros (Pipeline e Funil) ligam o cartão novo", () => {
    expect(ler("app/app/pipeline/_client.tsx")).toContain("<CartaoIavekContext.Provider value={true}>");
    expect(ler("app/app/pipelines/[id]/_client.tsx")).toContain("<CartaoIavekContext.Provider value={true}>");
  });
});

describe("v1.8.2 — janela central", () => {
  it("é um Dialog central (~80% no desktop, tela cheia no celular), com a barra lateral da Entrada", () => {
    const f = ler("components/iavek/ConversaNoQuadro.tsx");
    expect(f).toContain('from "@/components/ui/dialog"');
    expect(f).not.toContain('from "@/components/ui/sheet"');
    expect(f).toMatch(/md:w-\[80vw\]/);
    expect(f).toMatch(/md:h-\[80dvh\]/);
    expect(f).toContain("<CRMSidePanel conversation={conversa} />");
  });
});

describe("v1.8.2 — barra lateral enxuta", () => {
  it("a lista do que fica sempre visível mora num lugar só, na ordem pedida", () => {
    expect([...CAMPOS_SEMPRE_VISIVEIS]).toEqual([
      "nome",
      "telefone",
      "carro_interesse",
      "etapa",
      "vendedor",
      "guardiao",
      "forma_pagamento",
      "parcela_desejavel",
      "tags",
      "observacoes",
    ]);
  });

  it("o resto da ficha fica em 'Ver mais', fechado por padrão", () => {
    const f = ler("components/inbox/CRMSidePanel.tsx");
    expect(f).toContain("const [verMais, setVerMais] = useState(verMaisInicial);");
    expect(f).toContain("verMaisInicial = false");
    expect(f).not.toMatch(/<CRMSidePanel[^>]*verMaisInicial/);
    const i = f.indexOf("{verMais && (");
    expect(i).toBeGreaterThan(0);
    for (const secao of ['id="cliente"', 'id="acompanhamento"', 'id="demandas"', 'id="dados-da-compra"', 'id="atividade"', 'id="acervo"']) {
      expect(f.indexOf(secao)).toBeGreaterThan(i);
    }
  });
});

describe("v1.8.2 — vendedor não arquiva", () => {
  it("a rota exige gerente para 'archived' e o botão só aparece de gerente para cima", () => {
    const rota = ler("app/api/v1/conversations/[id]/route.ts");
    expect(rota).toMatch(/input\.status === "archived"\)\s*\{\s*const gerente = await requireRole\("manager"/);
    const cab = ler("components/inbox/ConversationHeader.tsx");
    expect(cab).toMatch(/const podeArquivar =[\s\S]{0,160}ROLE_RANK\.manager/);
  });

  it("o banco recusa (migration 0588 no baseline, antes da VARREDURA anon)", () => {
    const b = ler("supabase/baseline.sql");
    const bloco = b.indexOf("-- ---- ia.vek: vendedor não arquiva conversa (migration 0588) ----");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(b.indexOf("-- ---- VARREDURA anon:"));
    expect(b).toContain("create trigger trg_iavek_so_gerente_arquiva");
  });
});

describe("v1.8.2 — campos obrigatórios", () => {
  it("o interruptor nasce DESLIGADO e só o admin grava", async () => {
    const { lerConfigDosObrigatorios, comConfigDosObrigatorios } = await import("@/lib/iavek/campos-obrigatorios");
    expect(lerConfigDosObrigatorios(null)).toEqual({ ativo: false });
    expect(lerConfigDosObrigatorios({ iavek: { campos_obrigatorios: { ativo: "sim" } } })).toEqual({ ativo: false });
    expect(lerConfigDosObrigatorios(comConfigDosObrigatorios({ iavek: { x: 1 } }, { ativo: true }))).toEqual({ ativo: true });
    const rota = ler("app/api/v1/iavek/obrigatorios/route.ts");
    expect(rota).toMatch(/PATCH[\s\S]*requireSupportWrite[\s\S]*requireRole\("admin"/);
  });

  it("o bloco do gerente é de gerente para cima e não leva texto de conversa", () => {
    const rota = ler("app/api/v1/iavek/obrigatorios/incompletos/route.ts");
    expect(rota).toContain('requireRole("manager"');
    expect(rota).not.toMatch(/messages|body|preview/);
  });

  it("a recusa do banco (PT422) vira 422 com o que falta nas rotas de mover", async () => {
    const { recusaDeMotivoDaPerdaPeloBanco } = await import("@/lib/leads/motivo-da-perda");
    expect(recusaDeMotivoDaPerdaPeloBanco({ code: "PT422", message: "Faltam campos obrigatórios: Carro de interesse" })).toEqual({
      codigo: "iavek_campos_obrigatorios",
      mensagem: "Faltam campos obrigatórios: Carro de interesse",
    });
  });

  it("a trava só olha sessão de pessoa, o interruptor e as 5 etapas de compromisso (0590 no baseline)", () => {
    const b = ler("supabase/baseline.sql");
    const i = b.indexOf("-- ---- ia.vek: campos obrigatórios do lead (migration 0590) ----");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(b.indexOf("-- ---- VARREDURA anon:"));
    const bloco = b.slice(i, b.indexOf("-- ---- VARREDURA anon:"));
    expect(bloco).toContain("if auth.uid() is null or new.stage_id is not distinct from old.stage_id then");
    expect(bloco).toContain("s.slug in ('agendado-video', 'ligacao-de-video', 'qualificado', 'troca', 'vendido')");
    expect(bloco).toContain("'campos_obrigatorios'->>'ativo')::boolean, false)");
  });
});
