/**
 * ia.vek v1.9.60 (CRM-422, decisão do Rodrigo 15/11 "aviso do grupo: avisar o dono"): quando o Venda.IA pede ajuda
 * num lead que JÁ TEM DONO, o sino vai SÓ ao Guardião do lead (a SDR, crm_leads.sdr_user_id), nunca ao vendedor; sem
 * Guardião ou com ele fora da empresa, a UMA Guardiã do rodízio (a que recebeu esse aviso há mais tempo); lista vazia,
 * gerente e admin. O lead não se move.
 */
import { describe, expect, it, vi } from "vitest";

import { EVENTO_LEAD_COM_DONO, quemAvisarNoLeadComDono, tratarAvisoDeAjuda } from "@/lib/iavek/aviso-de-ajuda.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";

const GUARDIA = "11111111-1111-4111-8111-111111111111";
const DAIANE = "22222222-2222-4222-8222-222222222222";
const PALOMA = "33333333-3333-4333-8333-333333333333";
const VENDEDOR = "44444444-4444-4444-8444-444444444444";

interface Cenario {
  sdr: string | null;
  ativos: string[];
  lista: string[];
  anteriores?: Array<{ user_id: string; created_at: string }>;
  gerencia?: string[];
}

/** Dublê do supabase-js: cada consulta guarda os filtros e responde pelo cenário. */
function dublar(c: Cenario) {
  const inserts: Array<{ tabela: string; linhas: unknown }> = [];
  const settings = {
    iavek: {
      rodizio: { ativo: false, participantes: c.lista },
      guardiao_leads: {
        grupo: { channel_session_id: "55555555-5555-4555-8555-555555555555", group_chat_id: "120363000000000000@g.us" },
        numero_que_avisa: "+5511900000000",
      },
    },
  };
  const from = (tabela: string) => {
    const f: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit"]) q[m] = () => q;
    q.eq = (k: string, v: unknown) => ((f[k] = v), q);
    q.is = (k: string, v: unknown) => ((f[`is:${k}`] = v), q);
    q.in = (k: string, v: unknown) => ((f[`in:${k}`] = v), q);
    q.insert = (linhas: unknown) => (inserts.push({ tabela, linhas }), Promise.resolve({ error: null }));
    q.maybeSingle = async () => {
      if (tabela === "organizations") return { data: { settings }, error: null };
      if (tabela === "channel_session_groups") return { data: { id: "g" }, error: null };
      if (tabela === "messages")
        return {
          data: {
            body: "Opa, tem um cliente precisando de uma atenção!\nNome: Fulano de Teste\nNúmero: 11987654321\nStatus: Ajuda Humana Necessária",
            metadata: { group_sender: { name: "Venda.IA", phone: "+5511900000000", lid: null } },
          },
          error: null,
        };
      if (tabela === "crm_leads") return { data: { sdr_user_id: c.sdr }, error: null };
      if (tabela === "user_organizations") {
        const u = f.user_id as string;
        return { data: c.ativos.includes(u) ? { user_id: u } : null, error: null };
      }
      return { data: null, error: null };
    };
    q.then = (res: (v: unknown) => void) => {
      if (tabela === "user_organizations" && f["in:user_id"]) {
        const pedidos = f["in:user_id"] as string[];
        return res({ data: pedidos.filter((u) => c.ativos.includes(u)).map((user_id) => ({ user_id })), error: null });
      }
      if (tabela === "user_organizations" && f["in:role"]) {
        return res({ data: (c.gerencia ?? []).map((user_id) => ({ user_id, role: "manager" })), error: null });
      }
      if (tabela === "notificacoes") {
        expect(f["dados->>evento"]).toBe(EVENTO_LEAD_COM_DONO);
        return res({ data: [...(c.anteriores ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), error: null });
      }
      return res({ data: [], error: null });
    };
    return q;
  };
  const rpc = vi.fn(async () => ({
    data: [{ resultado: "ja_tem_dono", lead_id: "L1", user_id: VENDEDOR, metodo: "telefone" }],
    error: null,
  }));
  return { db: { from, rpc } as never, inserts, settings };
}

const linha = (): EventRow => ({
  id: "e",
  organization_id: "org",
  event_type: "message.group_received",
  entity_kind: "message",
  entity_id: "m",
  payload: { conversation_id: "c", message_id: "m" },
  metadata: {},
  consumed_by: [],
  attempts: 0,
});

function destinos(inserts: Array<{ tabela: string; linhas: unknown }>) {
  return inserts
    .filter((i) => i.tabela === "notificacoes")
    .flatMap((i) => i.linhas as Array<{ user_id: string; dados: { evento: string; por?: string } }>);
}

describe("v1.9.60 (CRM-422): aviso do grupo num lead que já tem dono", () => {
  it("vai SÓ ao Guardião do lead, nunca ao vendedor dono", async () => {
    const d = dublar({ sdr: GUARDIA, ativos: [GUARDIA, DAIANE, PALOMA, VENDEDOR], lista: [DAIANE, PALOMA] });
    const res = await tratarAvisoDeAjuda(d.db, linha());
    expect(res.status).toBe("ok");
    expect(res.detail).toBe("ja_tem_dono:telefone:guardiao");
    const ds = destinos(d.inserts);
    expect(ds.map((x) => x.user_id)).toEqual([GUARDIA]);
    expect(ds[0]!.dados.evento).toBe(EVENTO_LEAD_COM_DONO);
    expect(JSON.stringify(d.inserts)).not.toContain(VENDEDOR);
    expect(JSON.stringify(d.inserts)).not.toMatch(/98765/);
  });

  it("sem Guardião: a Guardiã do rodízio que recebeu esse aviso há mais tempo", async () => {
    const d = dublar({
      sdr: null,
      ativos: [DAIANE, PALOMA],
      lista: [DAIANE, PALOMA],
      anteriores: [{ user_id: DAIANE, created_at: "2026-11-17T10:00:00Z" }],
    });
    const alvo = await quemAvisarNoLeadComDono(d.db, "org", "L1", d.settings);
    expect(alvo).toEqual({ destinos: [PALOMA], por: "rodizio" });
  });

  it("rodízio sem histórico: a ordem da lista desempata", async () => {
    const d = dublar({ sdr: null, ativos: [DAIANE, PALOMA], lista: [PALOMA, DAIANE] });
    expect(await quemAvisarNoLeadComDono(d.db, "org", "L1", d.settings)).toEqual({ destinos: [PALOMA], por: "rodizio" });
  });

  it("Guardião fora da empresa conta como sem Guardião", async () => {
    const d = dublar({ sdr: GUARDIA, ativos: [DAIANE], lista: [PALOMA, DAIANE] });
    expect(await quemAvisarNoLeadComDono(d.db, "org", "L1", d.settings)).toEqual({ destinos: [DAIANE], por: "rodizio" });
  });

  it("lista vazia ou sem ninguém ativo: gerente e admin, para o aviso não se perder", async () => {
    const d = dublar({ sdr: null, ativos: [], lista: [DAIANE], gerencia: ["M1", "A1"] });
    expect(await quemAvisarNoLeadComDono(d.db, "org", "L1", d.settings)).toEqual({ destinos: ["M1", "A1"], por: "gerencia" });
    const vazio = dublar({ sdr: null, ativos: [], lista: [], gerencia: [] });
    expect(await quemAvisarNoLeadComDono(vazio.db, "org", "L1", vazio.settings)).toEqual({ destinos: [], por: "ninguem" });
  });

  it("controle: o lead não se move (nenhuma escrita além do sino)", async () => {
    const d = dublar({ sdr: GUARDIA, ativos: [GUARDIA], lista: [] });
    await tratarAvisoDeAjuda(d.db, linha());
    expect(d.inserts.every((i) => i.tabela === "notificacoes")).toBe(true);
  });
});
