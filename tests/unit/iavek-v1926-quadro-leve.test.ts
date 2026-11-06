/**
 * ia.vek v1.9.26 — o quadro passa primeiro e chega mais leve.
 *
 * (1) Na tela de quadro, os pedidos que não desenham o cartão esperam o board (com teto de tempo).
 * (2) O board não leva `source_metadata` (registro interno que nenhuma tela do quadro lê).
 * (3) Os pedidos que desenham o cartão NÃO esperam: ordem escolhida, painel, cores das etiquetas e
 *     a lista de membros (de onde sai o nome do responsável no cartão).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TETO_MS,
  __reiniciarVezDoQuadro,
  abrirVezDoQuadro,
  liberarDepoisDoQuadro,
  podeSeguir,
  telaDeQuadro,
} from "@/lib/iavek/vez-do-quadro";

const ler = (p: string) => readFileSync(p, "utf8");

describe("a vez do quadro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __reiniciarVezDoQuadro();
  });
  afterEach(() => {
    __reiniciarVezDoQuadro();
    vi.useRealTimers();
  });

  it("só as telas de quadro esperam", () => {
    expect(telaDeQuadro("/app/pipeline")).toBe(true);
    expect(telaDeQuadro("/app/pipelines/0b6c1c2e-1111-4a4a-9b9b-222233334444")).toBe(true);
    expect(telaDeQuadro("/app/pipelines")).toBe(false);
    expect(telaDeQuadro("/app/meu-dia")).toBe(false);
    expect(telaDeQuadro("/app/inbox")).toBe(false);
    expect(telaDeQuadro("/app/leads/abc")).toBe(false);
  });

  it("o board chegando libera; o teto libera se o board nunca vier", () => {
    expect(podeSeguir()).toBe(true);
    abrirVezDoQuadro();
    expect(podeSeguir()).toBe(false);
    liberarDepoisDoQuadro();
    expect(podeSeguir()).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // liberar desarma o teto

    abrirVezDoQuadro();
    vi.advanceTimersByTime(TETO_MS - 1);
    expect(podeSeguir()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(podeSeguir()).toBe(true);
  });
});

describe("quem espera e quem não espera", () => {
  const ESPERAM: Array<[string, RegExp]> = [
    ["components/shell/SinoPessoal.tsx", /enabled:\s*Boolean\(activeOrg\)\s*&&\s*depoisDoQuadro/],
    ["components/iavek/AvisoDeVenda.tsx", /enabled:\s*ligado\s*&&\s*depoisDoQuadro/],
    ["hooks/inbox/useConversationCounts.ts", /enabled:\s*!!orgId\s*&&\s*depoisDoQuadro/],
    ["hooks/atendimento/useSinalDePresenca.ts", /if \(!ativo \|\| !depoisDoQuadro\) return;/],
    ["hooks/voice/useVoiceCallSession.ts", /if \(!orgId \|\| !depoisDoQuadro\) return;/],
  ];
  for (const [arquivo, re] of ESPERAM) {
    it(`${arquivo} espera o board`, () => {
      expect(ler(arquivo)).toMatch(re);
    });
  }

  it("o board libera a espera quando chega ou falha", () => {
    const fonte = ler("hooks/kanban/useBoard.ts");
    expect(fonte).toMatch(/query\.isSuccess\s*\|\|\s*query\.isError/);
    expect(fonte).toMatch(/liberarDepoisDoQuadro\(\)/);
  });

  it("o que desenha o cartão NÃO espera (responsável, cores, ordem, painel)", () => {
    for (const arquivo of [
      "hooks/inbox/useAssignableMembers.ts",
      "components/tags/CoresDasEtiquetas.tsx",
      "components/iavek/VistaDoPipeline.tsx",
      "app/app/pipeline/_client.tsx",
    ]) {
      expect(ler(arquivo), arquivo).not.toMatch(/depoisDoQuadro|vez-do-quadro/);
    }
  });
});

describe("o board chega sem o registro interno", () => {
  it("source_metadata sai da resposta (e só da resposta)", () => {
    const rota = ler("app/api/v1/pipelines/[id]/board/route.ts");
    expect(rota).toMatch(/leads:\s*semCamposInternos\(leadsDoQuadro\)/);
    expect(rota).toMatch(/const \{ source_metadata: _interno, \.\.\.resto \}/);
  });

  it("nenhuma tela do quadro lê source_metadata do lead", () => {
    for (const arquivo of [
      "components/kanban/KanbanBoard.tsx",
      "components/kanban/KanbanCard.tsx",
      "app/app/pipeline/_client.tsx",
      "app/app/pipelines/[id]/_client.tsx",
      "hooks/kanban/useBoard.ts",
    ]) {
      expect(ler(arquivo), arquivo).not.toMatch(/source_metadata/);
    }
  });
});
