import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ATUALIZACAO_DO_UPSTREAM, ROTULO_DA_VERSAO, VERSAO_IAVEK } from "@/lib/iavek/versao";

/**
 * ia.vek v1.1 (decisão do Rodrigo, 16/10/2026): o sistema não segue mais o
 * upstream. O rodapé mostra só a versão do ia.vek e nada na tela oferece o
 * "Atualizar agora" do DeskcommCRM.
 */
describe("ia.vek: versão própria, sem atualização do upstream", () => {
  it("o rótulo é 'ia.vek CRM vX.Y'", () => {
    expect(VERSAO_IAVEK).toMatch(/^\d+\.\d+$/);
    expect(ROTULO_DA_VERSAO).toBe(`ia.vek CRM v${VERSAO_IAVEK}`);
  });

  it("o 'Atualizar agora' do upstream está desligado", () => {
    expect(ATUALIZACAO_DO_UPSTREAM).toBe(false);
  });

  it("o rodapé não consulta versão nem anuncia 'Nova versão'", () => {
    const src = readFileSync("components/shell/VersionFooter.tsx", "utf8");
    expect(src).not.toContain("useSystemVersion");
    expect(src).not.toContain("Nova versão");
    expect(src).not.toContain("/app/settings/atualizacao");
    expect(src).toContain("ROTULO_DA_VERSAO");
  });

  it("a tela de atualização não monta o painel do upstream", () => {
    const src = readFileSync("app/app/settings/atualizacao/page.tsx", "utf8");
    expect(src).not.toMatch(/<UpdatePanel/);
    expect(src).toContain("AtualizacaoIavek");
  });
});
