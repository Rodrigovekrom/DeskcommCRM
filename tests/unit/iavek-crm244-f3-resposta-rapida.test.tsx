/**
 * ia.vek CRM-244, Fase 3 (teste F): "/" no campo da mensagem. Com respostas, a lista aparece e
 * filtra; sem respostas, "Criar resposta rápida"; o botão fica no TOPO nos dois casos. Enter ou
 * clique insere SEM enviar. As respostas criadas pelo "/" são de quem cria.
 */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { filtrarRespostas, TemplateMenu } from "@/components/inbox/composer/TemplateMenu";

const ler = (p: string) => readFileSync(p, "utf8");
const respostas = [
  { id: "1", title: "Saudação", body: "Oi!", shortcut: "oi", owner_user_id: "u" },
  { id: "2", title: "Fechamento", body: "Fechado!", shortcut: "fech", owner_user_id: "u" },
];

describe("F: o menu do '/'", () => {
  it("com respostas: o botão no topo, a lista abaixo, e filtra", () => {
    render(<TemplateMenu open query="fe" templates={respostas as never} onPick={() => {}} onClose={() => {}} onCriar={() => {}} />);
    const menu = screen.getByTestId("menu-respostas-rapidas");
    expect(menu.firstElementChild?.getAttribute("data-testid")).toBe("criar-resposta-rapida");
    expect(screen.getAllByTestId("resposta-rapida").map((b) => b.textContent)).toEqual(["FechamentoFechado!"]);
  });
  it("sem respostas: o botão 'Criar resposta rápida' no topo", () => {
    const onCriar = vi.fn();
    render(<TemplateMenu open query="" templates={[]} onPick={() => {}} onClose={() => {}} onCriar={onCriar} />);
    fireEvent.click(screen.getByTestId("criar-resposta-rapida"));
    expect(onCriar).toHaveBeenCalled();
    expect(screen.getByText("Você ainda não tem respostas rápidas.")).toBeTruthy();
  });
  it("o destacado pelas setas é marcado", () => {
    render(<TemplateMenu open query="" templates={respostas as never} onPick={() => {}} onClose={() => {}} ativo={1} />);
    expect(screen.getAllByTestId("resposta-rapida").map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  });
  it("filtra por nome e por atalho", () => {
    expect(filtrarRespostas(respostas as never, "OI").map((r) => r.id)).toEqual(["1"]);
    expect(filtrarRespostas(respostas as never, "").length).toBe(2);
  });
});

describe("F: Enter insere sem enviar; criar é pessoal", () => {
  it("com o menu aberto, Enter aplica a resposta destacada e NÃO chama o envio", () => {
    const c = ler("components/inbox/Composer.tsx");
    expect(c).toMatch(/if \(menuOpen\) \{\s*const escolhida = respostasFiltradas\[ativoValido\];\s*if \(escolhida\) applyTemplate\(escolhida\);\s*return;\s*\}\s*handleSubmit\(\);/);
  });
  it("a resposta criada pelo '/' é pessoal e entra no campo sem enviar", () => {
    const d = ler("components/inbox/composer/CriarRespostaRapida.tsx");
    expect(d).toMatch(/shared: false/);
    expect(d).toMatch(/onCriada\(r\.data\)/);
    expect(ler("components/inbox/Composer.tsx")).toMatch(/onCriada=\{applyTemplate\}/);
  });
});
