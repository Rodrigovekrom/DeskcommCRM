import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nomeComFuncao } from "@/components/iavek/ResponsavelDoLead";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** ia.vek v1.9.5 — o cartão do Pipeline (CRM-196 e CRM-179). */
describe("v1.9.5 — responsável fácil de ver (196)", () => {
  it("nome com a função da loja; sem função, só o nome", () => {
    expect(nomeComFuncao({ nome: "Ana", funcao: "Vendedor" })).toBe("Ana (Vendedor)");
    expect(nomeComFuncao({ nome: "Ana", funcao: null })).toBe("Ana");
    expect(nomeComFuncao(undefined)).toBeNull();
  });

  it("o cartão da loja mostra responsável, guardião e objetivo; o painel do lead também", () => {
    expect(ler("components/iavek/CartaoIavek.tsx")).toContain("<ResponsavelNoCartao");
    const p = ler("components/iavek/PassagemDoLead.tsx");
    expect(p).toContain('data-testid="passagem-responsavel"');
    expect(p).toContain('data-testid="passagem-objetivo"');
  });

  it("o objetivo é a tarefa em aberto que vence primeiro", () => {
    const s = ler("lib/iavek/responsavel-do-lead.ts");
    expect(s).toContain('.in("status", ["pending", "in_progress"])');
    expect(s).toContain('.order("due_date", { ascending: true, nullsFirst: false })');
  });
});

describe("v1.9.5 — a prévia da última mensagem muda sem recarregar (179)", () => {
  it("o quadro escuta as conversas da empresa e recarrega quando a de um cliente dele muda", () => {
    const b = ler("hooks/kanban/useBoard.ts");
    expect(b).toContain('{ event: "UPDATE", schema: "public", table: "conversations", filter: `organization_id=eq.${orgDoQuadro}` }');
    expect(b).toContain("if (!nova?.contact_id || !contatosDoQuadro.current.has(nova.contact_id)) return;");
  });
});
