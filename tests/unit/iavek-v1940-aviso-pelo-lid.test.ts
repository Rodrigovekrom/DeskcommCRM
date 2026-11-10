/**
 * ia.vek v1.9.40 (CRM-241, caso reserva): o aviso do Venda.IA também casa pelo LID, quando a mensagem
 * do grupo chega sem telefone (participante @lid sem o `participantAlt`). Com telefone, nada muda.
 */
import { describe, expect, it, vi } from "vitest";

import { configDoGuardiaoLeads, remetenteQueAvisa } from "@/lib/iavek/aviso-de-ajuda";
import { tratarAvisoDeAjuda } from "@/lib/iavek/aviso-de-ajuda.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";

const AVISO = [
  "Opa, tem um cliente precisando de uma atenção!",
  "*Nome:* Fulano de Teste",
  "*Número:* +55 (11) 98765-4321",
  "*Necessidade:* Status: Ajuda Humana Necessária.",
].join("\n");
const NUMERO = "+5581900000000";
const LID = "123456789012345";
const grupo = { channel_session_id: "11111111-1111-4111-8111-111111111111", group_chat_id: "120363000000000000@g.us" };
const cfg = (extra: Record<string, unknown> = {}) => ({ iavek: { guardiao_leads: { grupo, numero_que_avisa: NUMERO, ...extra } } });

function dublar(o: { settings: unknown; corpo?: string; phone: string | null; lid: string | null }) {
  const rpc = vi.fn(async () => ({ data: [{ resultado: "entregue", lead_id: "L", user_id: "G", metodo: "telefone" }], error: null }));
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in"]) q[m] = () => q;
    q.insert = () => Promise.resolve({ error: null });
    q.maybeSingle = async () => {
      if (tabela === "organizations") return { data: { settings: o.settings }, error: null };
      if (tabela === "channel_session_groups") return { data: { id: "g" }, error: null };
      if (tabela === "messages")
        return { data: { body: o.corpo ?? AVISO, metadata: { group_sender: { name: "Vendaia", phone: o.phone, lid: o.lid } } }, error: null };
      return { data: null, error: null };
    };
    q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
    return q;
  };
  return { db: { from, rpc } as never, rpc };
}
const linha = (): EventRow => ({
  id: "e", organization_id: "org", event_type: "message.group_received", entity_kind: "message", entity_id: "m",
  payload: { conversation_id: "c", message_id: "m" }, metadata: {}, consumed_by: [], attempts: 0,
});

describe("a configuração", () => {
  it("o lid é opcional; sem ele a configuração vale como antes", () => {
    expect(configDoGuardiaoLeads(cfg())?.numero_que_avisa_lid).toBeUndefined();
    expect(configDoGuardiaoLeads(cfg({ numero_que_avisa_lid: LID }))?.numero_que_avisa_lid).toBe(LID);
  });
  it("lid fora do formato (só dígitos) derruba a configuração inteira, como o número torto já derrubava", () => {
    expect(configDoGuardiaoLeads(cfg({ numero_que_avisa_lid: "123@lid" }))).toBeNull();
  });
});

describe("quem avisa (remetenteQueAvisa)", () => {
  const c = { numero_que_avisa: NUMERO, numero_que_avisa_lid: LID };
  it("COM telefone vale só o telefone, como sempre, mesmo se o lid bater", () => {
    expect(remetenteQueAvisa({ phone: NUMERO, lid: null }, c)).toBe("telefone");
    expect(remetenteQueAvisa({ phone: "+5511911111111", lid: LID }, c)).toBeNull();
  });
  it("SEM telefone vale o lid, se a loja o tiver", () => {
    expect(remetenteQueAvisa({ phone: null, lid: LID }, c)).toBe("lid");
    expect(remetenteQueAvisa({ phone: null, lid: "999999999" }, c)).toBeNull();
    expect(remetenteQueAvisa({ phone: null, lid: LID }, { numero_que_avisa: NUMERO })).toBeNull();
  });
  it("sem remetente, ninguém", () => {
    expect(remetenteQueAvisa(null, c)).toBeNull();
    expect(remetenteQueAvisa({ phone: null, lid: null }, c)).toBeNull();
  });
});

describe("o handler", () => {
  it("com telefone: o mesmo de antes (entregue:telefone)", async () => {
    const d = dublar({ settings: cfg({ numero_que_avisa_lid: LID }), phone: NUMERO, lid: LID });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("entregue:telefone");
  });
  it("só lid e o lid configurado: move o lead", async () => {
    const d = dublar({ settings: cfg({ numero_que_avisa_lid: LID }), phone: null, lid: LID });
    expect((await tratarAvisoDeAjuda(d.db, linha())).status).toBe("ok");
    expect(d.rpc).toHaveBeenCalled();
  });
  it("só lid e a loja SEM o lid: nada se move, e o detalhe mostra o lid para conferir", async () => {
    const d = dublar({ settings: cfg(), phone: null, lid: LID });
    const res = await tratarAvisoDeAjuda(d.db, linha());
    expect(res.status).toBe("skipped");
    expect(res.detail).toBe(`remetente_so_lid:${LID}`);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it("só lid, sem o lid configurado, e o texto NÃO é aviso: não expõe o lid", async () => {
    const d = dublar({ settings: cfg(), corpo: "bom dia, pessoal", phone: null, lid: LID });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("remetente_nao_autorizado");
  });
  it("só lid, lid configurado e diferente: não move", async () => {
    const d = dublar({ settings: cfg({ numero_que_avisa_lid: "999999999" }), phone: null, lid: LID });
    expect((await tratarAvisoDeAjuda(d.db, linha())).detail).toBe("remetente_nao_autorizado");
    expect(d.rpc).not.toHaveBeenCalled();
  });
});
