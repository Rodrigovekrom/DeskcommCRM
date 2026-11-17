/**
 * ia.vek v1.9.60 (CRM-460): o turno da IA que MORRE (esgotou as tentativas) devolve a conversa a uma pessoa. O aviso
 * ao cliente só sai com a organização o ligando (`settings.iavek.ia_caiu.avisar_cliente`), e é DESLIGADO por padrão.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  HANDOFF_REASON_FALHA_DA_IA,
  RESUMO_DA_PASSAGEM_POR_FALHA,
  avisoAoClienteLigado,
  passarAoHumanoPorFalha,
} from "@/lib/agent-engine/agent/passagem-por-falha";
import { FRASE_DO_MOTIVO, MOTIVOS_DA_PASSAGEM, ORIGENS_DA_PASSAGEM } from "@/lib/escalacao/passagem";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as never;

function pool(o: { conversa?: { id: string; channel_session_id: string | null } | null; settings?: unknown }) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("from conversations")) return { rows: o.conversa ? [o.conversa] : [] };
        if (sql.includes("from organizations")) return { rows: [{ settings: o.settings ?? {} }] };
        return { rows: [] };
      }),
    } as never,
  };
}

const JOB = {
  id: "job-1",
  kind: "inbound_turn",
  status: "dead",
  organization_id: "org-1",
  contact_id: "contato-1",
  payload: { conversation_id: "conv-1" },
} as const;

function deps(extra: Record<string, unknown> = {}) {
  const handoff = vi.fn(async () => undefined);
  const checkpoint = vi.fn(async () => null);
  const avisarCliente = vi.fn(async () => ({ avisado: true }) as never);
  return { handoff, checkpoint, avisarCliente, d: { log, handoff, checkpoint, avisarCliente, ...extra } as never };
}

describe("v1.9.60 (CRM-460): se a IA cair, a conversa vai para uma pessoa", () => {
  it("turno que morreu: passagem para a fila humana, com origem e motivo falha_da_ia e o resumo que diz que o cliente NÃO pediu pessoa", async () => {
    const p = pool({ conversa: { id: "conv-1", channel_session_id: "cs-1" } });
    const x = deps();
    expect(await passarAoHumanoPorFalha(p.pool, JOB as never, x.d)).toBe("passou");
    expect(x.handoff).toHaveBeenCalledTimes(1);
    const [, ids, opts] = x.handoff.mock.calls[0] as unknown as [unknown, Record<string, string>, Record<string, any>];
    expect(ids).toEqual({ tenantId: "org-1", leadId: "contato-1", conversationId: "conv-1" });
    expect(opts.reason).toBe(HANDOFF_REASON_FALHA_DA_IA);
    expect(opts.passagem.origem).toBe("falha_da_ia");
    expect(opts.passagem.motivoCodigo).toBe("falha_da_ia");
    expect(opts.conversationSummary.startsWith(RESUMO_DA_PASSAGEM_POR_FALHA)).toBe(true);
  });

  it("aviso ao cliente DESLIGADO por padrão: não avisa, mas passa", async () => {
    const p = pool({ conversa: { id: "conv-1", channel_session_id: "cs-1" }, settings: {} });
    const x = deps();
    await passarAoHumanoPorFalha(p.pool, JOB as never, x.d);
    expect(x.avisarCliente).not.toHaveBeenCalled();
    expect(x.handoff).toHaveBeenCalledTimes(1);
  });

  it("com o aviso LIGADO na organização, avisa ANTES da passagem e leva o desfecho", async () => {
    const p = pool({ conversa: { id: "conv-1", channel_session_id: "cs-1" }, settings: { iavek: { ia_caiu: { avisar_cliente: true } } } });
    const x = deps();
    await passarAoHumanoPorFalha(p.pool, JOB as never, x.d);
    expect(x.avisarCliente).toHaveBeenCalledWith({ tenantId: "org-1", leadId: "contato-1", conversationId: "conv-1", channelSessionId: "cs-1", jobId: "job-1" });
    const ordemAviso = x.avisarCliente.mock.invocationCallOrder[0]!;
    const ordemHandoff = x.handoff.mock.invocationCallOrder[0]!;
    expect(ordemAviso).toBeLessThan(ordemHandoff);
    const [, , opts] = x.handoff.mock.calls[0] as unknown as [unknown, unknown, Record<string, any>];
    expect(opts.avisoAoLead).toEqual({ avisado: true });
  });

  it("o aviso que falha NÃO impede a passagem", async () => {
    const p = pool({ conversa: { id: "conv-1", channel_session_id: "cs-1" }, settings: { iavek: { ia_caiu: { avisar_cliente: true } } } });
    const x = deps({ avisarCliente: vi.fn(async () => { throw new Error("canal fora"); }) });
    expect(await passarAoHumanoPorFalha(p.pool, JOB as never, x.d)).toBe("passou");
    const [, , opts] = x.handoff.mock.calls[0] as unknown as [unknown, unknown, Record<string, any>];
    expect(opts.avisoAoLead).toEqual({ avisado: false, porque: "erro_no_envio" });
  });

  it("só os turnos que respondem a um cliente, e só quando morreram", async () => {
    const p = pool({ conversa: { id: "conv-1", channel_session_id: "cs-1" } });
    const x = deps();
    expect(await passarAoHumanoPorFalha(p.pool, { ...JOB, kind: "operator_turn" } as never, x.d)).toBe("nao_e_turno");
    expect(await passarAoHumanoPorFalha(p.pool, { ...JOB, status: "pending" } as never, x.d)).toBe("nao_morreu");
    expect(await passarAoHumanoPorFalha(p.pool, { ...JOB, contact_id: null } as never, x.d)).toBe("sem_contato");
    expect(x.handoff).not.toHaveBeenCalled();
  });

  it("sem conversa: não passa nada; sem conversa no payload, usa a mais recente do contato", async () => {
    const vazio = pool({ conversa: null });
    const x = deps();
    expect(await passarAoHumanoPorFalha(vazio.pool, JOB as never, x.d)).toBe("sem_conversa");
    const p = pool({ conversa: { id: "conv-9", channel_session_id: null } });
    await passarAoHumanoPorFalha(p.pool, { ...JOB, kind: "followup_turn", payload: {} } as never, x.d);
    expect(p.queries[0]!.sql).toContain("order by last_message_at desc");
  });

  it("nunca lança: erro no handoff vira 'erro' no log", async () => {
    const p = pool({ conversa: { id: "conv-1", channel_session_id: "cs-1" } });
    const x = deps({ handoff: vi.fn(async () => { throw new Error("banco fora"); }) });
    await expect(passarAoHumanoPorFalha(p.pool, JOB as never, x.d)).resolves.toBe("erro");
  });

  it("o interruptor só liga com true", () => {
    expect(avisoAoClienteLigado(undefined)).toBe(false);
    expect(avisoAoClienteLigado({ iavek: { ia_caiu: { avisar_cliente: "sim" } } })).toBe(false);
    expect(avisoAoClienteLigado({ iavek: { ia_caiu: { avisar_cliente: true } } })).toBe(true);
  });

  it("o vocabulário tem falha_da_ia nos dois lados (TypeScript e a 0645), com frase para a tela", () => {
    expect(ORIGENS_DA_PASSAGEM).toContain("falha_da_ia");
    expect(MOTIVOS_DA_PASSAGEM).toContain("falha_da_ia");
    expect(FRASE_DO_MOTIVO.falha_da_ia).toMatch(/não pediu uma pessoa/);
    const mig = readFileSync(join(process.cwd(), "supabase/migrations/20261117160000_0645_iavek_passagem_por_falha_da_ia.sql"), "utf8");
    const checks = mig.slice(mig.lastIndexOf("alter table public.passagens_de_atendimento\n  drop constraint if exists passagens_de_atendimento_origem_check"));
    expect(checks.match(/'falha_da_ia'/g)?.length).toBe(2);
  });

  it("o worker chama a passagem depois do roteamento cancelJob/failJob, sem mudar o roteamento", () => {
    const main = readFileSync(join(process.cwd(), "workers/agent-worker/main.ts"), "utf8").replace(/\s+/gu, " ");
    expect(main).toContain(
      "else { await failJob(pool, job.id, workerId, err, claimOfJob(job)?.acquired_at); }",
    );
    expect(main).toMatch(/if \(!terminal\) \{ await passarAoHumanoSeOJobMorreu\(pool, job\.id, \{/);
  });

  it("passarAoHumanoSeOJobMorreu só age quando a releitura acha o job dead", async () => {
    const { passarAoHumanoSeOJobMorreu } = await import("@/lib/agent-engine/agent/passagem-por-falha");
    const vivo = { query: vi.fn(async () => ({ rows: [] })) } as never;
    const x = deps();
    expect(await passarAoHumanoSeOJobMorreu(vivo, "job-1", x.d)).toBe("nao_morreu");
    expect(x.handoff).not.toHaveBeenCalled();
  });
});
