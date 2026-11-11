/**
 * ia.vek v1.9.45, CRM-149 opção 1 (Rodrigo, 11/11): o aviso 🚨 de ligação atrasada NÃO vai ao grupo
 * do WhatsApp. Fica só na Central e no push, até o aviso do Guardião rodar no grupo.
 *
 * MEDIDO em 11/11 antes de escrever: isto JÁ é o comportamento. A cobrança (cobrarLigacao em
 * lib/esteira/deps-reais.ts) grava a atividade, o aviso na Central e o push; do CRM para um grupo, a
 * única saída é a ação de automação `avisar_grupo`, que não está em nenhuma regra na produção; e nos
 * últimos 7 dias o CRM enviou 0 mensagens a grupo. Este arquivo é a TRAVA: muda de propósito, ou não muda.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const e = vi.hoisted(() => ({
  atividades: [] as Array<Record<string, unknown>>,
  pushes: [] as Array<{ usuario: string; titulo: string }>,
  tabelas: [] as string[],
  inserts: [] as Array<{ tabela: string; linha: Record<string, unknown> }>,
}));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async (_db: unknown, a: Record<string, unknown>) => (e.atividades.push(a), { ok: true })),
}));
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushAoUsuario: vi.fn(async (_org: string, usuario: string, p: { title: string }) => void e.pushes.push({ usuario, titulo: p.title })),
}));
vi.mock("@/lib/esteira/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/esteira/config")>()),
  usuariosDoDestinatario: vi.fn(async () => ["guardiao"]),
}));

import { depsReaisDaEsteira } from "@/lib/esteira/deps-reais";

const admin = {
  from: (tabela: string) => {
    e.tabelas.push(tabela);
    return { insert: async (linha: Record<string, unknown>) => (e.inserts.push({ tabela, linha }), { error: null }) };
  },
  rpc: () => {
    throw new Error("a cobrança não chama rpc");
  },
} as never;

const TAREFA = { id: "t1", lead_id: "l1", contact_id: "c1", title: "Ligar para o cliente", assigned_to: "vendedor", due_at: "2026-11-11T12:00:00Z" };

beforeEach(() => Object.assign(e, { atividades: [], pushes: [], tabelas: [], inserts: [] }));

describe("v1.9.45 (CRM-149): a cobrança da ligação atrasada NÃO vai ao grupo", () => {
  it("⭐ cobra só na Central, no push e na marca: nenhuma outra tabela, nenhum envio", async () => {
    const deps = depsReaisDaEsteira(admin, "org", () => new Date("2026-11-11T15:00:00Z"));
    await deps.cobrar(TAREFA as never, 1, { kind: "guardiao" } as never);

    expect(e.atividades.map((a) => a.type)).toEqual(["esteira_ligacao_cobrada"]);
    expect(e.tabelas).toEqual(["agent_inbox_items"]); // a Central, e só ela
    expect(String(e.inserts[0]!.linha.title)).toMatch(/^🚨 Ligação atrasada/);
    expect(e.pushes.map((p) => p.usuario).sort()).toEqual(["guardiao", "vendedor"]);
  });

  it("⭐ o módulo da esteira não alcança nenhum caminho de grupo (avisar_grupo, aviso_grupo, @g.us, envio de mensagem)", () => {
    const fonte = readFileSync("lib/esteira/deps-reais.ts", "utf8");
    for (const proibido of [/avisos-grupo/, /avisar-grupo/, /avisar_grupo/, /aviso_grupo/, /@g\.us/, /group_chat_id/, /sendMessageHandler|messages\/_handler|enviarMensagem/]) {
      expect(fonte, `deps-reais.ts passou a citar ${proibido}: o aviso de ligação atrasada iria a um grupo?`).not.toMatch(proibido);
    }
  });
});
