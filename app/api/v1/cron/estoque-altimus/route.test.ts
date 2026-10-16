import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ia.vek v1.2: o cron do estoque sincroniza só a organização DONA
 * (`settings.integracoes.altimus.ativa`), e não exige mais uma organização só.
 */
const mocks = vi.hoisted(() => ({
  orgs: [] as Array<{ id: string; settings: unknown }>,
  paradas: [] as string[],
  sincronizar: vi.fn(async (_orgId: string, _deps: unknown) => ({
    criados: 0,
    atualizados: 0,
    desativados: 0,
  })),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/instalacao/config", () => ({
  valorDaInstalacao: async () => ({ valor: "https://altimus.example/estoque.json?chave=x" }),
}));
vi.mock("@/lib/organizacao/operante", () => ({ idsDeOrgsParadas: async () => mocks.paradas }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/estoque/deps-reais", () => ({ depsReais: (orgId: string) => ({ orgId }) }));
vi.mock("@/lib/estoque/sincronizar", () => ({
  sincronizarEstoque: mocks.sincronizar,
  rodadaTeveEfeito: () => false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: async () =>
        tabela === "organizations" ? { data: mocks.orgs, error: null } : { data: [], error: null },
    }),
  }),
}));

import { GET } from "./route";

const LOJA = "11111111-1111-4111-8111-111111111111";
const DEMO = "22222222-2222-4222-8222-222222222222";
const ligado = { integracoes: { altimus: { ativa: true } } };
const desligado = { integracoes: { altimus: { ativa: false } } };

async function rodar() {
  const r = await GET(new NextRequest("http://localhost/api/v1/cron/estoque-altimus"));
  return { status: r.status, corpo: await r.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.paradas = [];
});

describe("cron estoque-altimus: organização dona", () => {
  it("com 2 organizações, sincroniza SÓ a que tem o Altimus ligado", async () => {
    mocks.orgs = [
      { id: DEMO, settings: {} },
      { id: LOJA, settings: ligado },
    ];
    const { status, corpo } = await rodar();
    expect(status).toBe(200);
    expect(mocks.sincronizar).toHaveBeenCalledTimes(1);
    expect(mocks.sincronizar.mock.calls[0]![0]).toBe(LOJA);
    expect(corpo.data.organizacao).toBe(LOJA);
  });

  it("com 2 organizações e nenhuma ligada, não sincroniza nada (e não responde 409)", async () => {
    mocks.orgs = [
      { id: DEMO, settings: {} },
      { id: LOJA, settings: {} },
    ];
    const { status, corpo } = await rodar();
    expect(status).toBe(200);
    expect(corpo.data.pulado).toBe("sem_organizacao_dona");
    expect(mocks.sincronizar).not.toHaveBeenCalled();
  });

  it("ligado em duas organizações: recusa em vez de escolher", async () => {
    mocks.orgs = [
      { id: DEMO, settings: ligado },
      { id: LOJA, settings: ligado },
    ];
    const { status } = await rodar();
    expect(status).toBe(409);
    expect(mocks.sincronizar).not.toHaveBeenCalled();
  });

  it("transição: organização única que nunca mexeu na marca segue sincronizando", async () => {
    mocks.orgs = [{ id: LOJA, settings: { esteira: { ativa: false } } }];
    await rodar();
    expect(mocks.sincronizar).toHaveBeenCalledTimes(1);
    expect(mocks.sincronizar.mock.calls[0]![0]).toBe(LOJA);
  });

  it("organização única com o Altimus DESLIGADO de propósito não sincroniza", async () => {
    mocks.orgs = [{ id: LOJA, settings: desligado }];
    const { corpo } = await rodar();
    expect(corpo.data.pulado).toBe("sem_organizacao_dona");
    expect(mocks.sincronizar).not.toHaveBeenCalled();
  });

  it("dona suspensa não recebe sincronização", async () => {
    mocks.orgs = [
      { id: DEMO, settings: {} },
      { id: LOJA, settings: ligado },
    ];
    mocks.paradas = [LOJA];
    const { corpo } = await rodar();
    expect(corpo.data.pulado).toBe("organizacao_parada");
    expect(mocks.sincronizar).not.toHaveBeenCalled();
  });
});
