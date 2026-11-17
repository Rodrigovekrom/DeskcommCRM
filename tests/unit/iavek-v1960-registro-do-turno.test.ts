/**
 * ia.vek v1.9.60 (0646, CRM-491): um registro por turno respondido pela IA, sem texto do cliente.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { mensagensEnviadas, registrarTurnoDaIa } from "@/lib/agent-engine/agent/registro-do-turno";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("v1.9.60 (CRM-491): registro do turno", () => {
  it("só as mensagens que SAÍRAM entram (enviada ou já aceita); fila, veto e falha não", () => {
    expect(
      mensagensEnviadas([
        { kind: "sent", idempotencyKey: "a", messageId: U(1) },
        { kind: "already_sent", idempotencyKey: "b", messageId: U(2) },
        { kind: "queued", idempotencyKey: "c", messageId: U(3) },
        { kind: "blocked", idempotencyKey: "d" },
        { kind: "failed", idempotencyKey: "e", messageId: U(4) },
        { kind: "sent", idempotencyKey: "f", messageId: "nao-e-uuid" },
      ] as never),
    ).toEqual([U(1), U(2)]);
  });

  it("grava UMA linha com ligações e fatos, nunca texto; id que não é uuid vira nulo", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await registrarTurnoDaIa(
      { query } as never,
      {
        organizationId: U(9),
        jobId: U(5),
        kind: "inbound_turn",
        conversationId: U(6),
        contactId: "",
        inboundMessageId: null,
        outcomes: [{ kind: "sent", idempotencyKey: "a", messageId: U(1) }] as never,
        agentId: U(7),
        agentVersionId: U(8),
        modelo: "claude-haiku-5-5",
        nivelManipulacao: "none",
      },
      log,
    );
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("insert into iavek_turnos_da_ia");
    expect(params).toEqual([U(9), U(5), "inbound_turn", U(6), null, null, [U(1)], U(7), U(8), "claude-haiku-5-5", "none"]);
  });

  it("nunca lança: erro do banco vira aviso", async () => {
    const query = vi.fn(async () => {
      throw new Error("relation does not exist");
    });
    await expect(
      registrarTurnoDaIa({ query } as never, { organizationId: U(9) } as never, log),
    ).resolves.toBeUndefined();
  });

  it("o turno chama o registro antes do log de concluído, fora da prévia", () => {
    const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
    const i = fonte.lastIndexOf("ia.vek v1.9.60 (CRM-491)");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(fonte.lastIndexOf("runLog.info('turno do agente concluído'"));
    expect(fonte.slice(i, fonte.lastIndexOf("runLog.info('turno do agente concluído'"))).toMatch(/if \(!preview\) \{\s*await registrarTurnoDaIa\(/);
  });

  it("a migration não guarda texto: nenhuma coluna de corpo, mensagem ou conteúdo", () => {
    const mig = readFileSync(join(process.cwd(), "supabase/migrations/20261117170000_0646_iavek_turnos_da_ia.sql"), "utf8");
    const tabela = mig.slice(mig.lastIndexOf("create table if not exists public.iavek_turnos_da_ia"), mig.indexOf(");", mig.lastIndexOf("create table")));
    expect(tabela).not.toMatch(/\b(body|texto|content|conteudo|mensagem text)\b/);
  });
});
