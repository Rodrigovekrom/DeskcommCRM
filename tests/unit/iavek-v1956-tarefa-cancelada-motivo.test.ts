/**
 * ia.vek v1.9.56 (0639; Maestro 003448, card 398): a tarefa cancelada pelo SISTEMA guarda o motivo. A prova de
 * comportamento (a tarefa do lead perdido vira 'cancelled' com 'lead_fechou'; a volta devolve a função igual e tira a
 * coluna) foi no banco de TESTE, numa transação desfeita (~/operacao/medidas/v1956-0639-no-teste.txt). Aqui: o texto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const M = readFileSync(join(process.cwd(), "supabase/migrations/20261114120000_0639_iavek_tarefa_cancelada_motivo.sql"), "utf8");
const codigo = M.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const BASE = readFileSync(join(process.cwd(), "supabase/baseline.sql"), "utf8");

describe("0639: o motivo da tarefa cancelada pelo sistema", () => {
  it("o manifest da v1.9.56 (0639)", () => {
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.56 \(0639\)/);
  });
  it("a coluna é ADITIVA e NULA (sem default, sem not null: só catálogo)", () => {
    expect(codigo).toContain("alter table public.crm_tasks add column if not exists cancelada_motivo text;");
    expect(codigo).not.toMatch(/cancelada_motivo text (not null|default)/i);
    expect(codigo).not.toMatch(/\b(drop|alter) (column|policy)\b/i);
  });
  it("o gatilho do lead fechado grava 'lead_fechou' e mantém a regra da 0625 (no ganho, só a pré-venda)", () => {
    expect(codigo).toContain("cancelada_motivo = 'lead_fechou'");
    expect(codigo).toContain("and t.status in ('pending', 'in_progress')");
    expect(codigo).toContain("or t.source_kind like 'ligacao%'");
    expect(codigo.match(/create or replace function/gi)).toHaveLength(1);
  });
  it("nunca marca 'done' (feita é só de quem registrou)", () => {
    expect(codigo).not.toMatch(/status\s*=\s*'done'/);
  });
  it("o baseline traz a 0639", () => {
    expect(BASE).toContain("(migration 0639, v1.9.56)");
    expect(BASE).toContain("alter table public.crm_tasks add column if not exists cancelada_motivo text;");
  });
});
