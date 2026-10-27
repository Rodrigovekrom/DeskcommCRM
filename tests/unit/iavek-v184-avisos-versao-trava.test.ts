import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ehNovidade } from "@/hooks/notifications/useCrmAlerts";
import { ROTULO_DA_VERSAO } from "@/lib/iavek/versao";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** ia.vek v1.8.4 — pontos que o Maestro achou testando a v1.8.3 no canário. */
describe("v1.8.4 — avisos do lead só quando algo mudou", () => {
  const agora = Date.parse("2026-10-26T12:00:00.000Z");
  const ha = (s: number) => new Date(agora - s * 1000).toISOString();

  it("salvar a ficha de um lead que já era meu NÃO repete 'Lead atribuído a você'", () => {
    // 1º evento: lead nunca visto, atribuído há uma hora → sem aviso
    expect(ehNovidade(undefined, "eu", "eu", ha(3600), agora)).toBe(false);
    // eventos seguintes do mesmo Salvar: dono visto = eu → sem aviso
    expect(ehNovidade("eu", "eu", "eu", ha(3600), agora)).toBe(false);
  });
  it("atribuição de verdade avisa uma vez", () => {
    expect(ehNovidade("outro", "eu", "eu", ha(1), agora)).toBe(true);
    expect(ehNovidade(null, "eu", "eu", ha(1), agora)).toBe(true);
    expect(ehNovidade(undefined, "eu", "eu", ha(30), agora)).toBe(true);
  });
  it("lead de outra pessoa nunca avisa", () => {
    expect(ehNovidade(undefined, "outro", "eu", ha(1), agora)).toBe(false);
  });
  it("ganho/perdido seguem a mesma régua (closed_at)", () => {
    expect(ehNovidade(undefined, "won", "won", ha(7200), agora)).toBe(false);
    expect(ehNovidade("open", "won", "won", ha(1), agora)).toBe(true);
    expect(ehNovidade("won", "won", "won", ha(1), agora)).toBe(false);
  });
});

describe("v1.8.4 — rodapé com o número certo", () => {
  it("a versão em vigor (v1.9.2)", () => {
    expect(ROTULO_DA_VERSAO).toBe("ia.vek CRM v1.9.3");
  });
});

describe("v1.8.4 — a janela da trava diz onde preencher", () => {
  it("cada um dos 7 rótulos da 0590 tem dica", () => {
    const f = ler("components/iavek/TravaDosCamposDialog.tsx");
    for (const rotulo of [
      "Contexto completo",
      "Tags de acompanhamento",
      "Fase do funil",
      "Guardião responsável",
      "Vendedor responsável",
      "Carro de interesse",
      "Parcela desejável",
    ]) {
      expect(f, rotulo).toContain(`"${rotulo}": t(`);
    }
    expect(f).toContain("Descrição do lead (20 letras ou mais)");
  });
});
