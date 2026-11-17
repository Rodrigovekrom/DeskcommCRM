/**
 * ia.vek v1.9.60 (CRM-488): a anonimização do contato tira os trechos da base de conhecimento (ai_chunks) que vieram
 * das conversas dele, pela MESMA remoção do "marcar como pessoal" (fn_contato_pessoal_remove_trechos_do_rag, 0564),
 * e a retomada diária enxerga o trecho que sobrou. Os rascunhos da IA NÃO entram aqui: o gatilho trg_reply_redact
 * (0227) já os zera na virada de is_anonymized.
 */
import { describe, expect, it, vi } from "vitest";

import { completarRedacaoDoContato, varrerRedacoesIncompletas, type ClienteDaCascata } from "@/lib/lgpd/cascata";

const ORG = "org-1";
const CONTATO = "contato-1";

/** Dublê: toda leitura devolve vazio, salvo as tabelas listadas; o rpc é o da 0564. */
function dublar(o: {
  removidos?: number;
  erroRpc?: string;
  semRpc?: boolean;
  contatos?: Array<{ id: string; organization_id: string }>;
  conversas?: Array<{ id: string; contact_id: string }>;
  trechos?: Array<{ metadata: { conversation_id: string } }>;
}) {
  const leituras: Array<{ tabela: string; filtros: Record<string, unknown> }> = [];
  const rpc = vi.fn(async () =>
    o.erroRpc ? { data: null, error: { message: o.erroRpc } } : { data: o.removidos ?? 0, error: null },
  );
  const db = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      const resposta = () => {
        if (tabela === "contacts" && o.contatos) return { data: o.contatos, error: null };
        if (tabela === "conversations") return { data: o.conversas ?? [], error: null };
        if (tabela === "ai_chunks") return { data: o.trechos ?? [], error: null };
        return { data: [], error: null };
      };
      const q: Record<string, unknown> = {
        eq: (k: string, v: unknown) => ((filtros[k] = v), q),
        in: (k: string, v: unknown) => ((filtros[`in:${k}`] = v), q),
        not: () => q,
        limit: () => q,
        order: () => q,
        range: (de: number) => ((filtros.de = de), q),
        then: (res: (v: unknown) => void) => {
          leituras.push({ tabela, filtros });
          // a paginação de contatos para na 2ª página
          if (tabela === "contacts" && (filtros.de as number) > 0) return res({ data: [], error: null });
          return res(resposta());
        },
      };
      return { select: () => q, update: () => q };
    },
    ...(o.semRpc ? {} : { rpc }),
  } as unknown as ClienteDaCascata;
  return { db, rpc, leituras };
}

describe("v1.9.60 (CRM-488): os trechos de RAG do contato na anonimização", () => {
  it("chama a remoção da 0564 para ESTE contato e conta o que saiu", async () => {
    const d = dublar({ removidos: 3 });
    const r = await completarRedacaoDoContato(d.db, { id: CONTATO, organizationId: ORG });
    expect(d.rpc).toHaveBeenCalledWith("fn_contato_pessoal_remove_trechos_do_rag", { p_org: ORG, p_contact: CONTATO });
    expect(r.trechosApagados).toBe(3);
    expect(r.tabelas).toContain("ai_chunks");
  });

  it("sem trecho nenhum, não declara a tabela (a segunda passada é 0)", async () => {
    const d = dublar({ removidos: 0 });
    const r = await completarRedacaoDoContato(d.db, { id: CONTATO, organizationId: ORG });
    expect(r.trechosApagados).toBe(0);
    expect(r.tabelas).not.toContain("ai_chunks");
  });

  it("a recusa (o client do usuário, sem service role) vira falha registrada, não exceção", async () => {
    const d = dublar({ erroRpc: "permission denied for function fn_contato_pessoal_remove_trechos_do_rag" });
    const r = await completarRedacaoDoContato(d.db, { id: CONTATO, organizationId: ORG });
    expect(r.trechosApagados).toBe(0);
    expect(r.falhas.join(" ")).toMatch(/^ai_chunks: permission denied|ai_chunks: permission denied/);
  });

  it("controle: o dublê sem rpc (os testes antigos) não quebra e não conta nada", async () => {
    const d = dublar({ semRpc: true });
    const r = await completarRedacaoDoContato(d.db, { id: CONTATO, organizationId: ORG });
    expect(r.trechosApagados).toBe(0);
    expect(r.falhas).toEqual([]);
  });

  it("a retomada diária enxerga o trecho que sobrou e completa o contato", async () => {
    const d = dublar({
      removidos: 1,
      contatos: [{ id: CONTATO, organization_id: ORG }],
      conversas: [{ id: "conv-1", contact_id: CONTATO }],
      trechos: [{ metadata: { conversation_id: "conv-1" } }],
    });
    const r = await varrerRedacoesIncompletas(d.db);
    expect(r.completados.map((c) => c.contactId)).toEqual([CONTATO]);
    expect(d.rpc).toHaveBeenCalledTimes(1);
    const leituraDosTrechos = d.leituras.find((l) => l.tabela === "ai_chunks");
    expect(leituraDosTrechos?.filtros["in:metadata->>conversation_id"]).toEqual(["conv-1"]);
  });

  it("sem trecho sobrando, a retomada não visita o contato", async () => {
    const d = dublar({ contatos: [{ id: CONTATO, organization_id: ORG }], conversas: [{ id: "conv-1", contact_id: CONTATO }] });
    const r = await varrerRedacoesIncompletas(d.db);
    expect(r.completados).toEqual([]);
    expect(d.rpc).not.toHaveBeenCalled();
  });
});
