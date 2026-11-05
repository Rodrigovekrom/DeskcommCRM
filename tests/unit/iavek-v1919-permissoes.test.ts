import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { abreFunisEEntrada } from "@/lib/iavek/funcoes";
import { recusaDeMotivoDaPerdaPeloBanco } from "@/lib/leads/motivo-da-perda";

const ler = (f: string) => readFileSync(f, "utf8");

describe("v1.9.19: ajuste de permissões", () => {
  it("só a função vendedor sai de Funis e Entrada", () => {
    expect(abreFunisEEntrada("vendedor")).toBe(false);
    for (const f of ["sdr", "suporte", "gerente", "apoio", "analista_ficha", null, undefined]) {
      expect(abreFunisEEntrada(f)).toBe(true);
    }
  });
  it.each(["app/app/kanban/page.tsx", "app/app/pipelines/[id]/page.tsx", "app/app/inbox/page.tsx"])(
    "%s confere a função no servidor",
    (f) => expect(ler(f)).toMatch(/abreFunisEEntrada\(activeOrg\.interface_settings\?\.funcao\)/),
  );
  it.each(["claim", "transfer"])("a rota %s confere o alcance antes de trocar", (r) => {
    const s = ler(`app/api/v1/conversations/[id]/${r}/route.ts`);
    expect(s.indexOf('.from("conversations")')).toBeGreaterThan(-1);
    expect(s.indexOf('.from("conversations")')).toBeLessThan(s.indexOf('.rpc("fn_conversation_assign"'));
  });
  it("o Composer decide sozinho, então vale em toda tela", () => {
    expect(ler("components/inbox/Composer.tsx")).toMatch(/useFuncaoVistaOpcional\(\)\) === "vendedor"/);
  });
  it("a recusa do banco vira recusa de negócio", () => {
    expect(
      recusaDeMotivoDaPerdaPeloBanco({ code: "PT403", message: "vendedor_fora_da_coluna_da_ia: x" })?.codigo,
    ).toBe("vendedor_fora_da_coluna_da_ia");
  });
});
