import { describe, expect, it, vi } from "vitest";

import { configDoGuardiaoLeads, lerAvisoDeAjuda, variantesDoTelefone } from "@/lib/iavek/aviso-de-ajuda";
import { tratarAvisoDeAjuda } from "@/lib/iavek/aviso-de-ajuda.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";

// O formato do print (05/11), com dados inventados.
const AVISO = [
  "Opa, tem um cliente precisando de uma atenção!",
  "",
  "*Cliente*",
  "*Nome:* Fulano de Teste",
  "*Número:* +55 (11) 98765-4321",
  "*Necessidade:* Status: Ajuda Humana Necessária. Motivo: quer falar de troca. Próximo passo: ligar.",
  "*Canal de origem:* meta_ads",
  "",
  "VENDA.IA 100% ativo ✅",
].join("\n");

describe("v1.9.22: leitura do aviso", () => {
  it("lê nome, telefone e o pedido de ajuda", () => {
    const l = lerAvisoDeAjuda(AVISO);
    expect(l.tipo).toBe("aviso");
    if (l.tipo !== "aviso") return;
    expect(l.nome).toBe("Fulano de Teste");
    expect(l.pedeAjudaHumana).toBe(true);
    expect(l.telefones).toEqual(expect.arrayContaining(["11987654321", "5511987654321", "1187654321", "551187654321"]));
  });
  it("sem asteriscos também", () => {
    const l = lerAvisoDeAjuda(AVISO.replace(/\*/g, ""));
    expect(l.tipo === "aviso" && l.nome).toBe("Fulano de Teste");
  });
  it("conversa comum do grupo não é aviso", () => {
    expect(lerAvisoDeAjuda("bom dia, pessoal").tipo).toBe("nao_e_aviso");
    expect(lerAvisoDeAjuda("Nome: Fulano\nNúmero: 11987654321").tipo).toBe("nao_e_aviso");
  });
  it("número curto ou estranho não casa nada", () => {
    expect(variantesDoTelefone("123")).toEqual([]);
    expect(variantesDoTelefone("abc")).toEqual([]);
    expect(variantesDoTelefone("1133334444")).toEqual(["1133334444", "551133334444"]);
  });
  it("sem o número que avisa, a configuração não vale", () => {
    const grupo = { channel_session_id: "11111111-1111-4111-8111-111111111111", group_chat_id: "120363000000000000@g.us" };
    expect(configDoGuardiaoLeads({ iavek: { guardiao_leads: { grupo } } })).toBeNull();
    expect(configDoGuardiaoLeads({ iavek: { guardiao_leads: { grupo, numero_que_avisa: "+5511900000000" } } })).not.toBeNull();
    expect(configDoGuardiaoLeads({})).toBeNull();
  });
});

// Dublê mínimo do supabase-js: devolve por tabela e registra os inserts e o rpc.
function dublar(o: { settings: unknown; grupo: boolean; corpo: string; remetente: string | null; rpc?: unknown }) {
  const inserts: unknown[] = [];
  const rpc = vi.fn(async () => ({ data: o.rpc ?? [{ resultado: "entregue", lead_id: "L", user_id: "G", metodo: "telefone" }], error: null }));
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in"]) q[m] = () => q;
    q.insert = (linhas: unknown) => {
      inserts.push({ tabela, linhas });
      return Promise.resolve({ error: null });
    };
    q.maybeSingle = async () => {
      if (tabela === "organizations") return { data: { settings: o.settings }, error: null };
      if (tabela === "channel_session_groups") return { data: o.grupo ? { id: "g" } : null, error: null };
      if (tabela === "messages")
        return { data: { body: o.corpo, metadata: { group_sender: { name: "Venda.IA", phone: o.remetente, lid: null } } }, error: null };
      return { data: null, error: null };
    };
    q.then = (res: (v: unknown) => void) => res({ data: [{ user_id: "M", role: "manager" }], error: null });
    return q;
  };
  return { db: { from, rpc } as never, inserts, rpc };
}
const CFG = {
  iavek: {
    guardiao_leads: {
      grupo: { channel_session_id: "11111111-1111-4111-8111-111111111111", group_chat_id: "120363000000000000@g.us" },
      numero_que_avisa: "+5511900000000",
    },
  },
};
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

describe("v1.9.22: quem age e quem não age", () => {
  it("sem configuração, nada acontece", async () => {
    const d = dublar({ settings: {}, grupo: true, corpo: AVISO, remetente: "+5511900000000" });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("sem_configuracao");
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it("outro grupo não move lead", async () => {
    const d = dublar({ settings: CFG, grupo: false, corpo: AVISO, remetente: "+5511900000000" });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("outro_grupo");
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it("outra pessoa do grupo, mesmo com o texto certo, não move lead", async () => {
    const d = dublar({ settings: CFG, grupo: true, corpo: AVISO, remetente: "+5511911111111" });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("remetente_nao_autorizado");
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it("o aviso certo chama o banco e avisa o guardião", async () => {
    const d = dublar({ settings: CFG, grupo: true, corpo: AVISO, remetente: "+5511900000000" });
    const res = await tratarAvisoDeAjuda(d.db, linha());
    expect(res.detail).toBe("entregue:telefone");
    expect(d.rpc).toHaveBeenCalledWith("fn_iavek_aviso_de_ajuda", expect.objectContaining({ p_nome: "Fulano de Teste" }));
    expect(JSON.stringify(d.inserts)).toContain("aviso_de_ajuda_entregue");
    expect(JSON.stringify(d.inserts)).not.toMatch(/98765/);
  });
  it("não reconhecido: gerente e admin no sino, sem telefone", async () => {
    const d = dublar({ settings: CFG, grupo: true, corpo: AVISO, remetente: "+5511900000000", rpc: [{ resultado: "nao_reconhecido", lead_id: null, user_id: null, metodo: null }] });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("nao_reconhecido");
    expect(JSON.stringify(d.inserts)).toContain("aviso_de_ajuda_nao_reconhecido");
    expect(JSON.stringify(d.inserts)).not.toMatch(/98765/);
  });
});
