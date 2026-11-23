/**
 * ia.vek CRM-439 fase 1 (0651): as orientações da loja e as novidades da versão.
 *
 * As regras puras de `lib/iavek/comunicados.ts` (o alvo por função com o 'apoio' como gerente, o "substituída por", o
 * Manual da loja, o bloco do Meu dia, o "X de Y leram", os parâmetros da função de envio) e as ROTAS de verdade, com a
 * sessão e o banco de mentira:
 *   - o POST da orientação recusa quem não é gestor (regra 1 do Rodrigo) e traduz os 0 destinatários em 422;
 *   - o POST da novidade recusa quem vem sem o segredo e nunca usa a sessão;
 *   - o "li e entendi" vai pelo cliente da SESSÃO (a RLS vale), nunca pelo service_role.
 * As travas do banco (não edita, não apaga, a RLS) são provadas em tests/invariants/iavek-comunicados-0651.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { FUNCOES } from "@/lib/iavek/funcoes";
import {
  FUNCOES_ALVO,
  contagemDeLeitura,
  envioDaNovidadeSchema,
  envioDaOrientacaoSchema,
  funcaoDoAlvo,
  funcoesForaDoAlvo,
  parametrosDoEnvio,
  pendentesDoMeuDia,
  queAindaValem,
  statusDoErroDoEnvio,
  substituidoPor,
  TIPO_DO_SINO,
} from "@/lib/iavek/comunicados";
import { fraseDaNotificacao, type NotificacaoDoSino } from "@/components/shell/SinoPessoal";

const estado = vi.hoisted(() => ({
  papel: "manager" as string,
  rpcAdmin: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcSessao: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  erroDoEnvio: null as { code: string; message: string } | null,
  cronOk: false,
  auditou: [] as string[],
}));

vi.mock("@/lib/auth/require-role", async () => {
  const { roleAtLeast } = await import("@/lib/auth/types");
  return {
    requireRole: vi.fn(async (min: string) => {
      if (!roleAtLeast(estado.papel as never, min as never)) {
        return {
          ok: false,
          response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), {
            status: 403,
          }),
        };
      }
      return {
        ok: true,
        user: { id: "u-gestor", idioma: "pt-BR" },
        org: { orgId: "org-1", role: estado.papel },
      };
    }),
  };
});
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn((e: { action: string }) => estado.auditou.push(e.action)),
}));
vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: vi.fn(() => estado.cronOk) }));
vi.mock("@/lib/users/nome-do-atendente", () => ({
  nomesDosAtendentes: vi.fn(async () => new Map()),
}));

function cadeia(data: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit", "range"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data, error: null });
  c.then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  return c;
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => cadeia({ id: "11111111-1111-4111-8111-111111111111" }),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      estado.rpcAdmin.push({ fn, args });
      if (estado.erroDoEnvio) return { data: null, error: estado.erroDoEnvio };
      return { data: [{ comunicado_id: "c-1", destinatarios: 3 }], error: null };
    }),
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => cadeia(null),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      estado.rpcSessao.push({ fn, args });
      return { data: "2026-11-23T12:00:00Z", error: null };
    }),
  })),
}));

import { POST as enviar } from "@/app/api/v1/iavek/comunicados/route";
import { POST as ler } from "@/app/api/v1/iavek/comunicados/[id]/li/route";
import { POST as novidade } from "@/app/api/internal/iavek/novidade-da-versao/route";

const ORG = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";

function pedido(corpo: unknown): NextRequest {
  return new Request("http://x/api", {
    method: "POST",
    body: JSON.stringify(corpo),
  }) as unknown as NextRequest;
}
const ORIENTACAO = {
  alvo: "funcao",
  para_funcao: "vendedor",
  titulo: "Troca",
  texto: "Toda troca passa pela avaliação.",
};

beforeEach(() => {
  estado.papel = "manager";
  estado.rpcAdmin = [];
  estado.rpcSessao = [];
  estado.erroDoEnvio = null;
  estado.cronOk = false;
  estado.auditou = [];
});

describe("CRM-439: as regras puras", () => {
  it("o alvo é o FUNCOES sem o 'apoio' (conta como 'gerente', 0598) e sem a 'analista_ficha' (não usa o CRM, 0586)", () => {
    expect(funcoesForaDoAlvo()).toEqual(["apoio", "analista_ficha"]);
    expect([...FUNCOES_ALVO].sort()).toEqual(
      FUNCOES.filter((f) => f !== "apoio" && f !== "analista_ficha").sort(),
    );
    expect(funcaoDoAlvo("analista_ficha")).toBeNull();
    expect(funcaoDoAlvo("apoio")).toBe("gerente");
    expect(funcaoDoAlvo("gerente")).toBe("gerente");
    expect(funcaoDoAlvo("vendedor")).toBe("vendedor");
    expect(funcaoDoAlvo("inventada")).toBeNull();
    expect(funcaoDoAlvo(null)).toBeNull();
  });

  it("os tipos do sino nunca reaproveitam o 'aviso_da_loja'", () => {
    expect(Object.values(TIPO_DO_SINO)).toEqual(["orientacao_da_loja", "novidade_da_versao"]);
  });

  it("'substituída por' é a mais NOVA que corrige; o Manual mostra só o que vale", () => {
    const a = { id: "a", substitui_id: null, enviado_em: "2026-11-20T10:00:00Z" };
    const b = { id: "b", substitui_id: "a", enviado_em: "2026-11-21T10:00:00Z" };
    const c = { id: "c", substitui_id: "b", enviado_em: "2026-11-22T10:00:00Z" };
    const outra = { id: "x", substitui_id: null, enviado_em: "2026-11-19T10:00:00Z" };
    const mapa = substituidoPor([c, a, outra, b]);
    expect(mapa.get("a")).toBe("b");
    expect(mapa.get("b")).toBe("c");
    expect(mapa.has("c")).toBe(false);
    expect(queAindaValem([a, b, c, outra]).map((x) => x.id)).toEqual(["c", "x"]);
  });

  it("o Meu dia só leva o que pede leitura e não foi lido, do mais antigo ao mais novo", () => {
    const lista = [
      { id: "1", pede_leitura: true, lido: false, enviado_em: "2026-11-22T10:00:00Z" },
      { id: "2", pede_leitura: true, lido: true, enviado_em: "2026-11-20T10:00:00Z" },
      { id: "3", pede_leitura: false, lido: false, enviado_em: "2026-11-19T10:00:00Z" },
      { id: "4", pede_leitura: true, lido: false, enviado_em: "2026-11-21T10:00:00Z" },
    ];
    expect(pendentesDoMeuDia(lista).map((x) => x.id)).toEqual(["4", "1"]);
  });

  it("o 'X de Y leram' nunca passa do Y nem fica negativo", () => {
    expect(contagemDeLeitura(5, 2)).toEqual({ lidos: 2, total: 5, faltam: 3 });
    expect(contagemDeLeitura(2, 9)).toEqual({ lidos: 2, total: 2, faltam: 0 });
    expect(contagemDeLeitura(0, 0)).toEqual({ lidos: 0, total: 0, faltam: 0 });
  });

  it("o envio aceita só função OU pessoa, com título e texto, e recusa campo a mais", () => {
    expect(envioDaOrientacaoSchema.safeParse(ORIENTACAO).success).toBe(true);
    expect(envioDaOrientacaoSchema.safeParse({ ...ORIENTACAO, para_funcao: "apoio" }).success).toBe(
      false,
    );
    expect(envioDaOrientacaoSchema.safeParse({ ...ORIENTACAO, titulo: "   " }).success).toBe(false);
    expect(envioDaOrientacaoSchema.safeParse({ ...ORIENTACAO, pede_leitura: false }).success).toBe(
      false,
    );
    expect(
      envioDaOrientacaoSchema.safeParse({
        alvo: "pessoa",
        para_usuario: ID,
        titulo: "t",
        texto: "x",
      }).success,
    ).toBe(true);
    expect(
      envioDaOrientacaoSchema.safeParse({ alvo: "loja", titulo: "t", texto: "x" }).success,
    ).toBe(false);
  });

  it("a orientação sempre pede leitura e leva quem enviou; a novidade nunca leva quem enviou", () => {
    const o = parametrosDoEnvio("org-1", {
      tipo: "orientacao",
      enviadoPor: "u-1",
      corpo: envioDaOrientacaoSchema.parse(ORIENTACAO),
    });
    expect(o).toMatchObject({
      p_tipo: "orientacao",
      p_pede_leitura: true,
      p_enviado_por: "u-1",
      p_versao: null,
    });
    expect(o.p_para_usuario).toBeNull();
    const n = parametrosDoEnvio("org-1", {
      tipo: "novidade",
      corpo: envioDaNovidadeSchema.parse({
        organization_id: ORG,
        versao: "1.9.64",
        titulo: "Novo",
        texto: "x",
        para_funcao: "sdr",
        pede_leitura: false,
      }),
    });
    expect(n).toMatchObject({
      p_tipo: "novidade",
      p_alvo: "funcao",
      p_enviado_por: null,
      p_versao: "1.9.64",
      p_pede_leitura: false,
    });
  });

  it("o erro da função de envio vira 403, 422 ou 500", () => {
    expect(statusDoErroDoEnvio("PT403")).toBe(403);
    expect(statusDoErroDoEnvio("PT422")).toBe(422);
    expect(statusDoErroDoEnvio("23505")).toBe(500);
    expect(statusDoErroDoEnvio(undefined)).toBe(500);
  });

  it("a frase do sino traz o título (e a versão), nunca o texto", () => {
    const base = {
      id: "n",
      lead_id: null,
      lida: false,
      created_at: "2026-11-23T12:00:00Z",
    } as unknown as NotificacaoDoSino;
    const t = (s: string) => s;
    expect(
      fraseDaNotificacao(
        { ...base, tipo: "orientacao_da_loja", dados: { comunicado_id: "c", titulo: "Troca" } },
        t,
      ),
    ).toBe("Orientação da loja: Troca");
    expect(
      fraseDaNotificacao(
        {
          ...base,
          tipo: "novidade_da_versao",
          dados: { comunicado_id: "c", titulo: "Botão novo", versao: "1.9.64" },
        },
        t,
      ),
    ).toBe("Novidade da versão 1.9.64: Botão novo");
  });
});

describe("CRM-439: as rotas", () => {
  it("o vendedor (agent) não envia orientação: 403 antes de qualquer gravação", async () => {
    estado.papel = "agent";
    const r = await enviar(pedido(ORIENTACAO));
    expect(r.status).toBe(403);
    expect(estado.rpcAdmin).toHaveLength(0);
  });

  it("o gestor envia: uma chamada só à função de envio, com a org da sessão e quem enviou", async () => {
    const r = await enviar(pedido(ORIENTACAO));
    expect(r.status).toBe(200);
    expect(estado.rpcAdmin).toHaveLength(1);
    expect(estado.rpcAdmin[0]!.fn).toBe("fn_iavek_enviar_comunicado");
    expect(estado.rpcAdmin[0]!.args).toMatchObject({
      p_org: "org-1",
      p_enviado_por: "u-gestor",
      p_tipo: "orientacao",
    });
    expect(estado.auditou).toEqual(["iavek.comunicado_enviado"]);
  });

  it("ninguém recebe (PT422 da função) vira 422 com mensagem clara", async () => {
    estado.erroDoEnvio = {
      code: "PT422",
      message: "Ninguém recebe este comunicado: confira a função ou a pessoa.",
    };
    const r = await enviar(pedido(ORIENTACAO));
    expect(r.status).toBe(422);
    expect(estado.auditou).toHaveLength(0);
  });

  it("corpo inválido (alvo 'loja', que é pergunta do Rodrigo) vira 422 sem gravar", async () => {
    const r = await enviar(pedido({ alvo: "loja", titulo: "t", texto: "x" }));
    expect(r.status).toBe(422);
    expect(estado.rpcAdmin).toHaveLength(0);
  });

  it("o 'li e entendi' vai pelo cliente da SESSÃO (INVOKER, a RLS vale)", async () => {
    estado.papel = "agent";
    const r = await ler(pedido({}), { params: Promise.resolve({ id: ID }) });
    expect(r.status).toBe(200);
    expect(estado.rpcSessao).toEqual([{ fn: "fn_iavek_li_e_entendi", args: { p_comunicado: ID } }]);
    expect(estado.rpcAdmin).toHaveLength(0);
  });

  it("a novidade sem o segredo é recusada (401) e não grava", async () => {
    estado.cronOk = false;
    const r = await novidade(
      pedido({
        organization_id: ORG,
        versao: "1.9.64",
        titulo: "t",
        texto: "x",
        para_funcao: "vendedor",
      }),
    );
    expect(r.status).toBe(401);
    expect(estado.rpcAdmin).toHaveLength(0);
  });

  it("a novidade com o segredo grava pela função de envio, sem quem enviou", async () => {
    estado.cronOk = true;
    const r = await novidade(
      pedido({
        organization_id: ORG,
        versao: "1.9.64",
        titulo: "t",
        texto: "x",
        para_funcao: "vendedor",
      }),
    );
    expect(r.status).toBe(200);
    expect(estado.rpcAdmin[0]!.args).toMatchObject({
      p_org: ORG,
      p_tipo: "novidade",
      p_enviado_por: null,
      p_versao: "1.9.64",
    });
    expect(estado.auditou).toEqual(["iavek.novidade_publicada"]);
  });
});
