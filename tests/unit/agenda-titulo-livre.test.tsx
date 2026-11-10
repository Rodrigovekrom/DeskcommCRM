import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { GradeDaAgenda } from "@/components/agenda/GradeDaAgenda";
import { renderCompromissos } from "@/lib/agent-engine/agent/compromissos-do-contato";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

/**
 * ia.vek v1.9.38 (CRM-256): "pode criar do jeito que quiser" (Rodrigo, 10/11).
 *
 * O "Novo agendamento" ganhou o campo TÍTULO: nasce com o nome do tipo (quem
 * não mexe marca como antes, em toda organização) e quem quer escreve outro.
 * A coluna `calendar_appointments.title` e a API já existiam; faltava a tela.
 *
 * O caminho inteiro de um título próprio, ponta a ponta:
 *   tela → POST (`title`) → handler grava `input.title ?? tipo.name`
 *   → a Agenda lê `title` → a grade mostra → o "Meu dia" mostra → a IA lê.
 */
const TITULO = "Test drive do Corolla na casa do cliente";

describe("a tela de marcar tem o Título, preenchido pelo tipo e editável", () => {
  const tela = readFileSync("app/app/agenda/_client.tsx", "utf8");

  it("o campo existe e só na criação (remarcar não muda o título)", () => {
    const bloco = tela.slice(tela.indexOf("{!remarcandoId ? ("), tela.indexOf("<PainelDeMarcacao"));
    expect(bloco).toContain('data-testid="titulo-do-compromisso"');
    expect(bloco).toContain("setTituloEditado(e.target.value)");
  });

  it("nasce com o nome do tipo, e trocar de tipo volta a seguir o tipo", () => {
    expect(tela).toContain('const titulo = tituloEditado ?? tipo?.nome ?? "";');
    const troca = tela.slice(tela.indexOf("escolherTipo(opcao.id);"), tela.indexOf("escolherTipo(opcao.id);") + 400);
    expect(troca).toContain("setTituloEditado(null);");
  });

  it("o POST manda o título; em branco fica fora (o servidor usa o nome do tipo)", () => {
    const inicio = tela.indexOf("return marcar");
    const bloco = tela.slice(inicio, tela.indexOf(".then((r) => {", inicio));
    expect(bloco).toContain("title: titulo.trim() || undefined,");
  });

  it("a rota aceita e o handler grava o título próprio, com o tipo como reserva", () => {
    const rota = readFileSync("app/api/v1/agenda/agendamentos/route.ts", "utf8");
    const handler = readFileSync("app/api/v1/agenda/agendamentos/_handler.ts", "utf8");
    expect(rota).toContain("title: z.string().min(1).max(200).optional()");
    expect(handler).toContain("title: input.title ?? tipo.name,");
  });
});

describe("o título próprio aparece onde o compromisso aparece", () => {
  it("a Agenda lê a coluna title (não o nome do tipo) para a grade", () => {
    const pagina = readFileSync("app/app/agenda/page.tsx", "utf8");
    expect(pagina).toMatch(/\.select\(\s*"id, revision, title,/);
    expect(pagina).toContain('titulo: a.title ?? "Agendamento"');
  });

  it("a grade mostra o título que a pessoa escreveu", () => {
    render(
      createElement(IdiomaProvider, {
        locale: "pt-BR",
        children: createElement(GradeDaAgenda, {
          visao: "dia",
          ancora: new Date("2026-11-12T12:00:00"),
          agora: new Date("2026-11-12T08:00:00"),
          fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
          pessoas: [{ id: "p1", nome: "Ana", trilha: 1 }],
          agendamentos: [
            {
              id: "ag-1",
              titulo: TITULO,
              responsavelId: "p1",
              comeca: "2026-11-12T10:00:00",
              termina: "2026-11-12T11:00:00",
              origem: "ui",
              situacao: "confirmed",
            },
          ],
        }),
      }),
    );
    expect(screen.getAllByText(TITULO).length).toBeGreaterThan(0);
  });

  it("o Meu dia (agenda do vendedor, aberta a partir do lead) lista pelo título", () => {
    const rota = readFileSync("app/api/v1/iavek/meu-dia/route.ts", "utf8");
    const tela = readFileSync("components/iavek/MeuDia.tsx", "utf8");
    expect(rota).toMatch(/from\("calendar_appointments"\)\s*\.select\(`id, title, starts_at/);
    expect(tela).toContain("${x.title}");
  });

  it("a IA enxerga o título próprio no bloco de compromissos do contato", () => {
    const bloco = renderCompromissos([
      {
        id: "ag-1",
        title: TITULO,
        starts_at: "2026-11-12T13:00:00.000Z",
        ends_at: "2026-11-12T14:00:00.000Z",
        status: "confirmed",
      } as never,
    ]);
    expect(bloco).toContain(TITULO);
    expect(bloco).not.toContain("Outro (livre)");
  });
});
