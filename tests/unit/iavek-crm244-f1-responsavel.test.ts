/**
 * ia.vek CRM-244, Fase 1 — troca de responsável pelo cartão.
 *
 * Decisão do Rodrigo (06/11): trocar o responsável é de guardião, gerente e admin. O vendedor não
 * vê a opção (tela) e o servidor recusa (PATCH do lead, 403 `responsavel_so_gestao`). A lista tem
 * busca por nome, e a troca ganha linha própria no histórico ("Trocou o responsável", de quem para
 * quem), em vez de cair em "Dados do negócio alterados".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { trocaResponsavel } from "@/lib/iavek/funcoes";
import { ACTIVITY_LABELS } from "@/lib/leads/activity-vocabulary";
import { contemONome } from "@/components/kanban/KanbanCardActions";

const ler = (p: string) => readFileSync(p, "utf8");

describe("quem troca o responsável", () => {
  it("guardião, gerente, gerente de apoio e quem não tem função trocam; o vendedor não", () => {
    expect(trocaResponsavel("sdr")).toBe(true);
    expect(trocaResponsavel("gerente")).toBe(true);
    expect(trocaResponsavel("apoio")).toBe(true);
    expect(trocaResponsavel(null)).toBe(true);
    expect(trocaResponsavel(undefined)).toBe(true);
    expect(trocaResponsavel("vendedor")).toBe(false);
  });

  it("a tela esconde a opção pela função VISTA (o Ver como vendedor mostra o que o vendedor vê)", () => {
    const fonte = ler("components/kanban/KanbanCardActions.tsx");
    expect(fonte).toMatch(/const funcaoVista = useFuncaoVistaOpcional\(\);/);
    expect(fonte).toMatch(/podeTrocarResponsavel = canAssign && trocaResponsavel\(funcaoVista\)/);
    expect(fonte).toMatch(/\{podeTrocarResponsavel && \(\s*<DropdownMenuSub/);
  });

  it("o servidor lê a função no banco, só pela tela, e o handler recusa quando o dono MUDA", () => {
    const rota = ler("app/api/v1/leads/[id]/route.ts");
    expect(rota).toMatch(/authz\.via === "session" && mexeNoDono && actor\.type === "user"/);
    expect(rota).toMatch(/trocaResponsavel\(await funcaoNaOrganizacao\(supabase, organizationId, actor\.id\)\)/);
    const handler = ler("app/api/v1/leads/_handler.ts");
    expect(handler).toMatch(/if \(trocouDono && ctx\.iavekTrocaResponsavel === false\)/);
    expect(handler).toMatch(/"responsavel_so_gestao"/);
    // reenviar o mesmo dono (o dossiê manda o form inteiro) não é troca
    expect(handler).toMatch(/ownerPatch\.owner_user_id !== donoAntes\.user \|\| ownerPatch\.owner_agent_id !== donoAntes\.agent/);
  });
});

describe("a lista não fecha no meio da busca", () => {
  it("só fecha por ação de quem usa (o quadro que se mexe sob o mouse não a fecha)", () => {
    const fonte = ler("components/kanban/KanbanCardActions.tsx");
    expect(fonte).toMatch(/open=\{listaAberta\}/);
    expect(fonte).toMatch(/onOpenChange=\{\(aberto\) => \{\s*if \(aberto\) setListaAberta\(true\);\s*\}\}/);
    // e fecha por Esc e quando o menu inteiro fecha
    expect(fonte).toMatch(/if \(e\.key === "Escape"\) fecharLista\(\);/);
    expect(fonte).toMatch(/<DropdownMenu onOpenChange=\{\(aberto\) => !aberto && fecharLista\(\)\}>/);
  });
});

describe("busca por nome na lista", () => {
  it("sem diferença de maiúscula nem acento; vazio mostra todos", () => {
    expect(contemONome("José da Silva", "jose")).toBe(true);
    expect(contemONome("José da Silva", "SILVA")).toBe(true);
    expect(contemONome("Ana", "jose")).toBe(false);
    expect(contemONome("Ana", "")).toBe(true);
    expect(contemONome(null, "a")).toBe(false);
  });
});

describe("linha própria no histórico", () => {
  it("o tipo novo tem rótulo", () => {
    expect(ACTIVITY_LABELS.owner_changed).toBe("Trocou o responsável");
  });

  it("a troca grava owner_changed com de/para e sai do 'Dados do negócio alterados'", () => {
    const handler = ler("app/api/v1/leads/_handler.ts");
    expect(handler).toMatch(/type: "owner_changed"/);
    expect(handler).toMatch(/return `De \$\{nome\(de\)\} para \$\{nome\(para\)\}`/);
    expect(handler).toMatch(/camposEditados\.length === 0 \? \{ ok: true as const \}/);
    expect(handler).toMatch(/new Set\(\["owner_user_id", "owner_agent_id", "owner_kind", "assigned_at"\]\)/);
  });
});
