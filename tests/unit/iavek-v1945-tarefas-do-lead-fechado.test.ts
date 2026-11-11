/**
 * ia.vek v1.9.45 (0621): "pode cancelar as tarefas dos leads fechados" (Rodrigo, via Maestro 211102).
 * Perder, ganhar ou ir para Compra futura CANCELA as tarefas pendentes do lead, com o motivo "lead fechado" na linha
 * do tempo; reabrir NÃO as traz de volta; e o aviso de tarefa vencida não sai para tarefa de lead que não está 'open'.
 * O comportamento foi provado no banco de TESTE (transação desfeita); aqui, as travas do texto.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const M = readFileSync("supabase/migrations/20261111210000_0621_iavek_tarefas_do_lead_fechado.sql", "utf8");
const B = readFileSync("supabase/baseline.sql", "utf8");

describe("v1.9.45 (0621): as tarefas do lead fechado", () => {
  it("⭐ o gatilho dispara SÓ quando o status MUDA para lost, won ou future", () => {
    // AFTER UPDATE (sem "of status"): o status é escrito pelo gatilho BEFORE, nunca está no SET; "of status" não dispararia
    expect(M).toMatch(/after update on public\.crm_leads/);
    expect(M).not.toMatch(/after update of status on public\.crm_leads/);
    expect(M).toMatch(/when \(new\.status in \('lost', 'won', 'future'\) and old\.status is distinct from new\.status\)/);
  });

  it("⭐ cancela só as PENDENTES do lead, sem apagar, e registra o motivo 'lead fechado' (o mesmo da limpeza de 11/11)", () => {
    expect(M).toMatch(/set status = 'cancelled'/);
    expect(M).toMatch(/t\.status in \('pending', 'in_progress'\)/);
    expect(M).not.toMatch(/delete from public\.crm_tasks/i);
    expect(M).toMatch(/'task_cancelled', 'rule',\s*'Tarefa cancelada: lead fechado'/);
    expect(M).toMatch(/jsonb_build_object\('motivo', 'lead_fechado'/);
  });

  it("o 'task_cancelled' NÃO quebra o silêncio do lead (fora da lista do fn_update_last_activity_at)", () => {
    const ultimo = B.lastIndexOf("create or replace function public.fn_update_last_activity_at");
    const corpo = B.slice(ultimo, B.indexOf("$$;", B.indexOf("$$", ultimo) + 2));
    expect(corpo).toContain("if new.type not in (");
    expect(corpo).not.toContain("task_cancelled");
  });

  it("⭐ reabrir NÃO traz as tarefas de volta: nenhum caminho volta 'cancelled' para 'pending'", () => {
    expect(M).not.toMatch(/set status = 'pending'/);
    expect(M).not.toMatch(/when \(new\.status = 'open'/);
  });

  it("⭐ o aviso de tarefa vencida: só tarefa pendente, e só de lead 'open' (tarefa sem lead segue avisando)", () => {
    expect(M).toMatch(/if v_task\.status not in \('pending', 'in_progress'\) then\s+return null;/);
    expect(M).toMatch(/if v_task\.lead_id is not null then[\s\S]{0,300}if v_status_do_lead is distinct from 'open' then\s+return null;/);
  });

  it("a tripla: a migration tem o manifest e o bloco no baseline, antes da VARREDURA anon", () => {
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.45 \(0621\)/);
    const bloco = B.indexOf("-- ---- ia.vek: as tarefas do lead fechado (migration 0621, v1.9.45) ----");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(B.indexOf("-- ---- VARREDURA anon:"));
  });
});
