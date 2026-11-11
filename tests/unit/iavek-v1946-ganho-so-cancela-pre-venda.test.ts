/**
 * ia.vek v1.9.46 (0625, nota 3 da Lupa, Maestro 234646): GANHAR o lead cancela só a PRÉ-VENDA; a pós-venda e a feita
 * à mão ficam pendentes. Perder e Compra futura seguem cancelando todas. Provado no TESTE (desfeito): ganho com 1
 * ligação da esteira e 1 de pós-venda = a ligação cancelada e a pós-venda pendente.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { FONTES_DA_PRE_VENDA, FONTE_DA_TAREFA_DE_FOLLOWUP, PREFIXO_DA_PRE_VENDA, eTarefaDaPreVenda } from "@/lib/tarefas/vocabulario-de-origem";

const M = readFileSync("supabase/migrations/20261112000000_0625_iavek_ganho_so_cancela_pre_venda.sql", "utf8");
const B = readFileSync("supabase/baseline.sql", "utf8");
const ultima = (n: string) => {
  const i = B.lastIndexOf(`create or replace function public.${n}(`);
  return B.slice(i, B.indexOf("$$;", B.indexOf("$$", i) + 2));
};

describe("v1.9.46 (0625): o ganho só cancela a pré-venda", () => {
  it("⭐ no GANHO, só ligacao%, followup e as promessas; perder e Compra futura, todas", () => {
    const f = ultima("fn_iavek_cancela_tarefas_do_lead_fechado");
    expect(f).toMatch(/and \(new\.status <> 'won'\s+or t\.source_kind like 'ligacao%'\s+or t\.source_kind in \('followup', 'promised_proposal', 'promised_followup'\)\)/);
  });

  it("⭐ o SQL e o TypeScript dizem a MESMA lista da pré-venda", () => {
    const f = ultima("fn_iavek_cancela_tarefas_do_lead_fechado");
    expect(f).toContain(`t.source_kind like '${PREFIXO_DA_PRE_VENDA}%'`);
    expect(f).toContain(`t.source_kind in (${FONTES_DA_PRE_VENDA.map((x) => `'${x}'`).join(", ")})`);
  });

  it("a regra no TypeScript: na dúvida, a tarefa FICA", () => {
    expect(eTarefaDaPreVenda("ligacao:L3")).toBe(true);
    expect(eTarefaDaPreVenda("ligacao")).toBe(true); // a dos 7 dias da Compra futura
    expect(eTarefaDaPreVenda("followup")).toBe(true);
    expect(eTarefaDaPreVenda("promised_proposal")).toBe(true);
    expect(eTarefaDaPreVenda(null)).toBe(false); // à mão (ex.: "entregar o documento")
    expect(eTarefaDaPreVenda("proximo_passo")).toBe(false);
    expect(eTarefaDaPreVenda("entrega")).toBe(false);
  });

  it("o motor de follow-up passa a marcar as tarefas dele como 'followup'", () => {
    const e = readFileSync("lib/followup/engine.ts", "utf8");
    expect(FONTE_DA_TAREFA_DE_FOLLOWUP).toBe("followup");
    expect(e).toMatch(/origem: `followup:\$\{item\.enrollment_id\}`,[\s\S]{0,200}sourceKind: FONTE_DA_TAREFA_DE_FOLLOWUP/);
  });

  it("o gatilho (quando dispara) NÃO muda: só a função", () => {
    expect(M).not.toMatch(/create trigger/);
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.46 \(0625\)/);
    expect(B.indexOf("-- ---- ia.vek: o ganho só cancela a pré-venda (migration 0625, v1.9.46) ----")).toBeLessThan(B.indexOf("-- ---- VARREDURA anon:"));
  });
});
