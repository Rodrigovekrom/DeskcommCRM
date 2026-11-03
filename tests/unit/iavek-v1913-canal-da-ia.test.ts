import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fraseDaNotificacao } from "@/components/shell/SinoPessoal";
import { blocoDeOrientacoes, canalDaIaAtivo, comCanalDaIa, podeOrientar } from "@/lib/iavek/canal-da-ia";

describe("v1.9.13 — o canal de orientação da IA", () => {
  it("nasce desligado, e ligar não perde as outras chaves", () => {
    expect(canalDaIaAtivo(null)).toBe(false);
    expect(canalDaIaAtivo({})).toBe(false);
    expect(canalDaIaAtivo({ iavek: { canal_orientacao_ia: { ativo: "true" } } })).toBe(false);
    const ligado = comCanalDaIa({ iavek: { perfil: { nicho: "clinica" } }, x: 1 }, true);
    expect(canalDaIaAtivo(ligado)).toBe(true);
    expect(ligado).toMatchObject({ x: 1, iavek: { perfil: { nicho: "clinica" } } });
  });

  it("orienta: Suporte IA, gerente e admin; vendedor e guardião não", () => {
    expect(podeOrientar("agent", "suporte")).toBe(true);
    expect(podeOrientar("manager", "apoio")).toBe(true);
    expect(podeOrientar("admin", undefined)).toBe(true);
    expect(podeOrientar("agent", "vendedor")).toBe(false);
    expect(podeOrientar("agent", "sdr")).toBe(false);
    expect(podeOrientar("agent", undefined)).toBe(false);
    expect(podeOrientar("viewer", "suporte")).toBe(false);
  });

  it("a orientação vai ao rascunho dizendo que vale só para a conversa; sem nada, sem bloco", () => {
    expect(blocoDeOrientacoes([])).toBe("");
    const b = blocoDeOrientacoes(["ofereça o Onix"]);
    expect(b).toContain("Vale só para esta conversa");
    expect(b).toContain("- ofereça o Onix");
  });

  it("a IA não aprende sozinha: as duas leituras filtram pela conversa, e nenhum gravador sai dela", () => {
    for (const p of ["lib/agent-engine/agent/reply-drafts.ts", "lib/agent-engine/agent/inbound-turn.ts"]) {
      const f = readFileSync(p, "utf8");
      expect(f).toMatch(/select texto from iavek_orientacoes_da_ia where organization_id=\$1 and conversation_id=\$2/);
      expect(f).not.toMatch(/(insert into|update) iavek_orientacoes_da_ia/);
    }
  });

  it("o sino diz o motivo e leva à conversa", () => {
    const n = { id: "1", tipo: "ia_travou", lida: false, created_at: "", lead_id: "l", lead_titulo: "Lead X", contato_nome: "Ana", tarefa_titulo: null, ator_nome: null, conversation_id: null, dados: { motivo: "não conseguiu escrever a resposta", conversa_id: "c" } };
    expect(fraseDaNotificacao(n, (s) => s)).toBe("A IA travou em Ana: não conseguiu escrever a resposta");
  });
});
