/**
 * ia.vek v1.9.49 (nota (a) da Lupa na v1.9.47): o TETO DIÁRIO do km por organização.
 */
import { describe, expect, it } from "vitest";

import { kmDaLojaAte } from "@/lib/iavek/km/km-da-loja";
import {
  KM_POR_DIA_POR_ORG_PADRAO,
  diaEmSaoPaulo,
  gastarDoTetoDoDia,
  tetoDaOrg,
  type Contador,
} from "@/lib/iavek/km/teto-diario";

/** Um Redis de mentira (incr + expire), para ver o que é contado e por quanto tempo. */
function redisFalso() {
  const n = new Map<string, number>();
  const ttl = new Map<string, number>();
  const c: Contador = {
    incr: async (k) => {
      n.set(k, (n.get(k) ?? 0) + 1);
      return n.get(k)!;
    },
    expire: async (k, s) => {
      ttl.set(k, s);
      return 1;
    },
  };
  return { c, n, ttl };
}

describe("o teto do dia por organização", () => {
  it("o padrão é 200 (SUPOSTO: o plano grátis documentado; a produção ainda não tem a chave para medir)", () => {
    expect(KM_POR_DIA_POR_ORG_PADRAO).toBe(200);
    expect(tetoDaOrg({})).toBe(200);
    expect(tetoDaOrg(null)).toBe(200);
  });

  it("cada organização pode ter o seu (0 a 5.000, inteiro); fora disso, o padrão", () => {
    expect(tetoDaOrg({ iavek: { km_teto_diario: 50 } })).toBe(50);
    expect(tetoDaOrg({ iavek: { km_teto_diario: 0 } })).toBe(0);
    for (const ruim of [-1, 5_001, 2.5, "100", null]) expect(tetoDaOrg({ iavek: { km_teto_diario: ruim } })).toBe(200);
  });

  it("passou do teto do dia: recusa; a outra organização segue com o dela", async () => {
    const { c } = redisFalso();
    const agora = Date.parse("2026-11-13T15:00:00Z");
    const a = [];
    for (let i = 0; i < 4; i++) a.push(await gastarDoTetoDoDia("org-a", 3, { agora, contador: c }));
    expect(a).toEqual([true, true, true, false]);
    expect(await gastarDoTetoDoDia("org-b", 3, { agora, contador: c })).toBe(true);
  });

  it("o dia é o de São Paulo: às 02:59Z ainda é ontem na loja; às 03:00Z vira", async () => {
    expect(diaEmSaoPaulo(Date.parse("2026-11-14T02:59:00Z"))).toBe("2026-11-13");
    expect(diaEmSaoPaulo(Date.parse("2026-11-14T03:00:00Z"))).toBe("2026-11-14");
    const { c } = redisFalso();
    expect(await gastarDoTetoDoDia("org-a", 1, { agora: Date.parse("2026-11-14T02:59:00Z"), contador: c })).toBe(true);
    expect(await gastarDoTetoDoDia("org-a", 1, { agora: Date.parse("2026-11-14T02:59:30Z"), contador: c })).toBe(false);
    expect(await gastarDoTetoDoDia("org-a", 1, { agora: Date.parse("2026-11-14T03:00:00Z"), contador: c })).toBe(true);
  });

  it("a chave do Redis expira em 2 dias (não cresce sem fim) e só ganha o prazo na 1ª conta", async () => {
    const { c, ttl } = redisFalso();
    await gastarDoTetoDoDia("org-a", 5, { contador: c });
    await gastarDoTetoDoDia("org-a", 5, { contador: c });
    expect([...ttl.values()]).toEqual([2 * 86_400]);
  });

  it("o Redis caiu: conta na memória (não deixa o km sem teto)", async () => {
    const quebrado: Contador = {
      incr: async () => {
        throw new Error("fetch failed");
      },
      expire: async () => 1,
    };
    const agora = Date.parse("2026-11-20T15:00:00Z");
    expect(await gastarDoTetoDoDia("org-mem", 1, { agora, contador: quebrado })).toBe(true);
    expect(await gastarDoTetoDoDia("org-mem", 1, { agora, contador: quebrado })).toBe(false);
  });

  it("teto 0 = nenhum cálculo (a organização sem km)", async () => {
    expect(await gastarDoTetoDoDia("org-a", 0, { contador: redisFalso().c })).toBe(false);
  });
});

describe("o kmDaLojaAte respeita o teto: o ORS NÃO é chamado quando o teto acabou", () => {
  const settings = { iavek: { km_origem: { cep: "18000000", numero: "1" }, km_teto_diario: 1 } };
  const admin = {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { settings }, error: null }) };
      return q;
    },
  } as never;

  function fetcherQueConta() {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      if (u.includes("viacep")) return new Response(JSON.stringify({ logradouro: "Rua A", bairro: "B", localidade: "Sorocaba", uf: "SP" }));
      if (u.includes("/pelias/v1/search")) return new Response(JSON.stringify({ features: [{ geometry: { coordinates: [-47.4, -23.5] } }] }));
      return new Response(JSON.stringify({ routes: [{ summary: { distance: 12_345 } }] }));
    };
    return { f, ors: () => urls.filter((u) => !u.includes("viacep")).length };
    // (a forma das respostas é a do iavek-v1945-km-ate-o-cliente: ViaCEP, /pelias/v1/search e /ors/v2/directions)
  }

  it("1º cálculo do dia: chama o ORS; 2º (teto 1): 'teto_do_dia', sem chamar o ORS; o agendamento segue (km nulo)", async () => {
    const { c } = redisFalso();
    const { f, ors } = fetcherQueConta();
    const r1 = await kmDaLojaAte(admin, "org-teto", { cep: "18010000" }, { fetcher: f, chave: "k", contador: c });
    expect(r1.motivo).toBe("ok");
    const chamadasDepoisDo1 = ors();
    expect(chamadasDepoisDo1).toBeGreaterThan(0);
    const r2 = await kmDaLojaAte(admin, "org-teto", { cep: "18010000" }, { fetcher: f, chave: "k", contador: c });
    expect(r2).toMatchObject({ km: null, motivo: "teto_do_dia" });
    expect(r2.endereco).toBeTruthy(); // o endereço do ViaCEP segue (não é do ORS)
    expect(ors()).toBe(chamadasDepoisDo1);
  });

  it("sem a chave do ORS, não gasta o teto (nada seria chamado)", async () => {
    const { c, n } = redisFalso();
    const { f } = fetcherQueConta();
    await kmDaLojaAte(admin, "org-sem-chave", { cep: "18010000" }, { fetcher: f, chave: "", contador: c });
    expect(n.size).toBe(0);
  });
});
