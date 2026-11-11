/**
 * ia.vek v1.9.45 (CRM-280): o km de carro da loja até o cliente (ViaCEP + OpenRouteService do HeiGIT),
 * com DUBLÊ até a chave existir. Nenhuma chamada sai para a rede neste arquivo.
 */
import { describe, expect, it, vi } from "vitest";

import { ATRIBUICAO_DO_KM, calcularKm, normalizaCep, textoParaGeocode } from "@/lib/iavek/km/calcular-km";

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function dubleDosServicos(opts: { cepInexistente?: string; semRota?: boolean; geocodeVazio?: boolean } = {}) {
  const chamadas: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push(url);
    if (url.startsWith("https://viacep.com.br/ws/")) {
      const cep = url.split("/")[4];
      if (cep === opts.cepInexistente) return resposta({ erro: true });
      return resposta({ logradouro: cep === "18000000" ? "Av. da Loja" : "Rua do Cliente", bairro: "Centro", localidade: "Sorocaba", uf: "SP" });
    }
    expect((init?.headers as Record<string, string>).Authorization).toBe("chave-de-teste");
    if (url.includes("/pelias/v1/search")) {
      if (opts.geocodeVazio) return resposta({ features: [] });
      const loja = new URL(url).searchParams.get("text")!.includes("Loja");
      return resposta({ features: [{ geometry: { coordinates: loja ? [-47.45, -23.5] : [-47.4, -23.45] } }] });
    }
    if (url.endsWith("/ors/v2/directions/driving-car")) {
      if (opts.semRota) return resposta({ routes: [] });
      return resposta({ routes: [{ summary: { distance: 12_345 } }] });
    }
    throw new Error("url inesperada: " + url);
  });
  return { fetcher, chamadas };
}

const LOJA = { cep: "18000-000", numero: "100" };
const CLIENTE = { cep: "18050-123", numero: "45" };

describe("v1.9.45 (CRM-280): km até o cliente", () => {
  it("⭐ CEP e número dos dois lados → km de carro (12,3 km), pelo endereço novo da API (api.heigit.org)", async () => {
    const { fetcher, chamadas } = dubleDosServicos();
    const r = await calcularKm({ origem: LOJA, destino: CLIENTE, chave: "chave-de-teste", fetcher });
    expect(r).toEqual({ ok: true, km: 12.3, origem: [-47.45, -23.5], destino: [-47.4, -23.45] });
    expect(chamadas.filter((u) => u.startsWith("https://api.heigit.org/")).length).toBe(3);
    expect(chamadas.some((u) => u.includes("api.openrouteservice.org"))).toBe(false);
  });

  it("⭐ SEM a chave: 'indisponível', e nenhuma chamada sai (nem ao ViaCEP)", async () => {
    const { fetcher } = dubleDosServicos();
    expect(await calcularKm({ origem: LOJA, destino: CLIENTE, chave: undefined, fetcher })).toEqual({ ok: false, motivo: "indisponivel" });
    expect(await calcularKm({ origem: LOJA, destino: CLIENTE, chave: "  ", fetcher })).toEqual({ ok: false, motivo: "indisponivel" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("CEP inválido, CEP que não existe, endereço sem coordenada e rota vazia viram motivos claros (nunca erro)", async () => {
    expect(await calcularKm({ origem: LOJA, destino: { cep: "123" }, chave: "chave-de-teste", fetcher: dubleDosServicos().fetcher })).toEqual({ ok: false, motivo: "cep_invalido" });
    expect(await calcularKm({ origem: LOJA, destino: CLIENTE, chave: "chave-de-teste", fetcher: dubleDosServicos({ cepInexistente: "18050123" }).fetcher })).toEqual({ ok: false, motivo: "cep_nao_encontrado" });
    expect(await calcularKm({ origem: LOJA, destino: CLIENTE, chave: "chave-de-teste", fetcher: dubleDosServicos({ geocodeVazio: true }).fetcher })).toEqual({ ok: false, motivo: "endereco_nao_encontrado" });
    expect(await calcularKm({ origem: LOJA, destino: CLIENTE, chave: "chave-de-teste", fetcher: dubleDosServicos({ semRota: true }).fetcher })).toEqual({ ok: false, motivo: "rota_nao_encontrada" });
  });

  it("serviço fora do ar vira 'erro_do_servico', não exceção", async () => {
    const quebrado = vi.fn(async () => { throw new Error("rede caiu"); });
    expect(await calcularKm({ origem: LOJA, destino: CLIENTE, chave: "chave-de-teste", fetcher: quebrado })).toEqual({ ok: false, motivo: "erro_do_servico" });
  });

  it("o texto do geocode e o CEP normalizado", () => {
    expect(normalizaCep("18050-123")).toBe("18050123");
    expect(normalizaCep("1805")).toBeNull();
    expect(textoParaGeocode({ cep: "18050123", logradouro: "Rua do Cliente", bairro: "Centro", cidade: "Sorocaba", uf: "SP" }, "45"))
      .toBe("Rua do Cliente, 45, Centro, Sorocaba - SP, Brasil");
    expect(ATRIBUICAO_DO_KM).toMatch(/HeiGIT.*OpenStreetMap/);
  });
});

// ── a partida da loja, a chave do servidor e o teto de tempo (lib/iavek/km/km-da-loja.ts) ──
import { kmDaLojaAte, partidaDaLoja } from "@/lib/iavek/km/km-da-loja";

const orgCom = (settings: unknown) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings }, error: null }) }) }) }) }) as never;
const COM_PARTIDA = { iavek: { km_origem: { cep: "18000-000", numero: "100" } } };

describe("v1.9.45 (CRM-280): km da LOJA até o cliente", () => {
  it("⭐ com a partida da loja e a chave: o endereço do ViaCEP e o km", async () => {
    const r = await kmDaLojaAte(orgCom(COM_PARTIDA), "org", CLIENTE, { fetcher: dubleDosServicos().fetcher, chave: "chave-de-teste" });
    expect(r).toEqual({ endereco: "Rua do Cliente, 45, Centro, Sorocaba - SP", km: 12.3, motivo: "ok" });
  });

  it("⭐ sem a chave: o endereço do ViaCEP sai, o km fica nulo ('indisponivel')", async () => {
    const r = await kmDaLojaAte(orgCom(COM_PARTIDA), "org", CLIENTE, { fetcher: dubleDosServicos().fetcher, chave: "" });
    expect(r).toEqual({ endereco: "Rua do Cliente, 45, Centro, Sorocaba - SP", km: null, motivo: "indisponivel" });
  });

  it("sem a partida da loja configurada: 'sem_partida' (e o endereço sai mesmo assim)", async () => {
    const r = await kmDaLojaAte(orgCom({}), "org", CLIENTE, { fetcher: dubleDosServicos().fetcher, chave: "chave-de-teste" });
    expect(r).toMatchObject({ km: null, motivo: "sem_partida" });
    expect(r.endereco).toContain("Rua do Cliente");
    expect(partidaDaLoja({ iavek: { km_origem: { cep: "123" } } })).toBeNull();
  });

  it("⭐ o serviço demorando: a marcação não espera além do teto ('demorou')", async () => {
    const lento = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("viacep") ? dubleDosServicos().fetcher(url, init) : new Promise<Response>(() => {}),
    );
    const t0 = Date.now();
    const r = await kmDaLojaAte(orgCom(COM_PARTIDA), "org", CLIENTE, { fetcher: lento, chave: "chave-de-teste", tetoMs: 200 });
    expect(r).toMatchObject({ km: null, motivo: "demorou" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
