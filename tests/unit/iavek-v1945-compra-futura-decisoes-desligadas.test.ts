/**
 * ia.vek v1.9.45 (CRM-294): as 3 decisões do Rodrigo ficam PRONTAS e DESLIGADAS até o ok (Maestro 183236):
 *   (a) acorda_com_mensagem: a mensagem nova do cliente acorda o lead futuro (fn_nascer_lead_da_conversa);
 *   (b) aviso_de_preco: o preço do carro que muda vale também para o future (fn_iavek_preco_do_carro_mudou);
 *   (c) avisar_guardiao: o guardião é avisado quando o lead vai para Compra futura (a rota de mover).
 * O comportamento de (a) e (b) foi provado no banco de TESTE (transação desfeita); aqui, o (c) e as travas.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn(async () => ({ sent: 1, gone: 0 })) }));
vi.mock("@/lib/notifications/web_push", () => ({ enviarPushAoUsuario: push }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { avisarGuardiaoDaCompraFutura, avisarGuardiaoLigado } from "@/lib/iavek/compra-futura/avisar-guardiao";

const orgCom = (settings: unknown) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings }, error: null }) }) }) }) }) as never;
const base = { orgId: "org", leadId: "l1", titulo: "Lead do Corolla", guardiaoId: "guardiao", quemMoveu: "vendedor", mes: "2027-05-01" };
const LIGADO = { iavek: { compra_futura: { avisar_guardiao: true } } };

beforeEach(() => push.mockClear());

describe("v1.9.45 (CRM-294): as 3 decisões, prontas e desligadas", () => {
  it("⭐ (c) DESLIGADA (o padrão): o guardião NÃO é avisado", async () => {
    expect(await avisarGuardiaoDaCompraFutura(orgCom({}), base)).toBe("desligado");
    expect(push).not.toHaveBeenCalled();
  });

  it("⭐ (c) LIGADA: o guardião é avisado por push, com o mês", async () => {
    expect(await avisarGuardiaoDaCompraFutura(orgCom(LIGADO), base)).toBe("avisou");
    expect(push).toHaveBeenCalledWith("org", "guardiao", expect.objectContaining({ title: "Lead em Compra futura", body: expect.stringContaining("05/2027") }));
  });

  it("(c) quem moveu FOI o guardião, ou não há guardião: nada de push", async () => {
    expect(await avisarGuardiaoDaCompraFutura(orgCom(LIGADO), { ...base, quemMoveu: "guardiao" })).toBe("foi_o_guardiao");
    expect(await avisarGuardiaoDaCompraFutura(orgCom(LIGADO), { ...base, guardiaoId: null })).toBe("sem_guardiao");
    expect(push).not.toHaveBeenCalled();
  });

  it("(c) só 'true' liga (string, 1 ou ausente não ligam)", () => {
    expect(avisarGuardiaoLigado(LIGADO)).toBe(true);
    for (const v of [{}, null, { iavek: { compra_futura: { avisar_guardiao: "true" } } }, { iavek: { compra_futura: { avisar_guardiao: 1 } } }]) {
      expect(avisarGuardiaoLigado(v)).toBe(false);
    }
  });

  it("⭐ (a) e (b) na 0620: cada uma atrás do SEU interruptor, e o interruptor ausente = desligado", () => {
    const m = readFileSync("supabase/migrations/20261111200000_0620_iavek_compra_futura.sql", "utf8");
    expect(m).toMatch(/coalesce\(\(settings -> 'iavek' -> 'compra_futura' ->> p_chave\)::boolean, false\)/);
    expect(m).toMatch(/if public\.fn_iavek_compra_futura_ligada\(p_org, 'acorda_com_mensagem'\) then/);
    expect(m).toMatch(/l\.status = 'future' and public\.fn_iavek_compra_futura_ligada\(l\.organization_id, 'aviso_de_preco'\)/);
    // nenhuma migration nem script liga os interruptores
    expect(m).not.toMatch(/"acorda_com_mensagem": true|"aviso_de_preco": true|"avisar_guardiao": true/);
  });

  it("(c) a rota de mover chama o aviso SÓ ao entrar numa etapa de Compra futura", () => {
    const rota = readFileSync("app/api/v1/leads/[id]/move/route.ts", "utf8");
    expect(rota).toMatch(/is_compra_futura && lead\.stage_id !== input\.stage_id\) \{\s*void avisarGuardiaoDaCompraFutura/);
  });
});
