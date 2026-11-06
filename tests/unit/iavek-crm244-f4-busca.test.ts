/**
 * ia.vek CRM-244, Fase 4 (teste G): buscar "José" acha o card em qualquer coluna, por nome,
 * telefone e carro; mostra a quantidade e o botão de limpar; os totais em R$ seguem do funil inteiro.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyFilters, casaBusca } from "@/lib/kanban/filters";

const ler = (p: string) => readFileSync(p, "utf8");
const lead = (p: Record<string, unknown>) => ({ title: "", description: null, contact_phone: undefined, ...p }) as never;

describe("G: a busca", () => {
  it("nome sem acento nem maiúscula: 'jose' e 'JOSÉ' acham 'José da Silva'", () => {
    expect(casaBusca(lead({ title: "José da Silva" }), "jose")).toBe(true);
    expect(casaBusca(lead({ title: "José da Silva" }), "JOSÉ")).toBe(true);
    expect(casaBusca(lead({ title: "Ana" }), "jose")).toBe(false);
  });
  it("telefone por dígitos, com ou sem o 55 e com máscara", () => {
    const l = lead({ title: "Ana", contact_phone: "+5511987654321" });
    expect(casaBusca(l, "98765")).toBe(true);
    expect(casaBusca(l, "(11) 98765-4321")).toBe(true);
    expect(casaBusca(l, "5511987654321")).toBe(true);
    expect(casaBusca(l, "12")).toBe(false); // menos de 3 dígitos não busca telefone
  });
  it("carro de interesse pelo nome do catálogo", () => {
    const l = lead({ title: "Ana", custom_fields: { carro_interesse: "id-do-onix" } });
    expect(casaBusca(l, "onix", () => "Chevrolet Onix 2022")).toBe(true);
    expect(casaBusca(l, "civic", () => "Chevrolet Onix 2022")).toBe(false);
  });
  it("applyFilters usa a busca nova e o contexto do carro", () => {
    const leads = [lead({ id: "1", title: "José", stage_id: "a" }), lead({ id: "2", title: "Ana", stage_id: "b", contact_phone: "11999990000" })];
    expect(applyFilters(leads, { search: "jose" }).map((l: { id: string }) => l.id)).toEqual(["1"]);
    expect(applyFilters(leads, { search: "99999" }).map((l: { id: string }) => l.id)).toEqual(["2"]);
  });
});

describe("G: quantidade, limpar e totais do funil inteiro", () => {
  it("as duas telas mostram a quantidade e o limpar; o Pipeline ganha o campo de busca", () => {
    expect(ler("app/app/pipeline/_client.tsx")).toMatch(/<BuscaDoQuadro valor=\{filtros\.search \?\? ""\}/);
    expect(ler("app/app/pipelines/[id]/_client.tsx")).toMatch(/<ResultadoDaBusca encontrados=\{filteredLeads\.length\}/);
  });
  it("os totais em R$ das colunas saem do funil inteiro, não do resultado da busca", () => {
    for (const p of ["app/app/pipeline/_client.tsx", "app/app/pipelines/[id]/_client.tsx"]) expect(ler(p)).toMatch(/leadsDosTotais=\{data\.leads\}/);
    const col = ler("components/kanban/StageColumn.tsx");
    expect(col).toMatch(/const baseDoTotal = leadsDoTotal \?\? leads;/);
    expect(col).toMatch(/const totais = somaPorMoeda\(baseDoTotal,/);
  });
});
