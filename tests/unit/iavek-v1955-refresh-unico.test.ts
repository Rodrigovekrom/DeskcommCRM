/**
 * ia.vek v1.9.55 (CRM-368; Lupa 162344/162431): o refresh do login UMA vez por sessão (lib/auth/refresh-unico.ts).
 * Contra-prova: com o fetch SEM o embrulho, o mesmo cenário de 24 clientes faz 24 refreshes.
 */
import { createServerClient } from "@supabase/ssr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  comRefreshUnico,
  contagemDoRefresh,
  ehRefreshDoAuth,
  GUARDA_MS,
  tamanhoDoMapa,
  TETO_DE_CHAVES,
  zerarRefreshUnico,
} from "@/lib/auth/refresh-unico";
import { fetchDoServidor } from "@/lib/supabase/fetch-do-servidor";

const URL_SB = "https://projetoteste.supabase.co";
const REFRESH = `${URL_SB}/auth/v1/token?grant_type=refresh_token`;

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}
function jwt(expSeg: number, sub = "11111111-1111-4111-8111-111111111111"): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, exp: expSeg, aud: "authenticated", role: "authenticated" })}.assinatura`;
}
function sessao(expiraEmSeg: number, refresh: string, sub?: string) {
  const exp = Math.floor(Date.now() / 1000) + expiraEmSeg;
  return {
    access_token: jwt(exp, sub),
    refresh_token: refresh,
    token_type: "bearer",
    expires_in: expiraEmSeg,
    expires_at: exp,
    user: { id: sub ?? "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "x@teste.invalid" },
  };
}

/** O Auth de mentira: conta os refreshes e devolve uma sessão NOVA (com o refresh token novo derivado do velho). */
function authFalso(opts: { status?: number; atraso?: number } = {}) {
  const chamadas: string[] = [];
  const fn = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("grant_type=refresh_token")) {
      const rt = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token;
      chamadas.push(rt);
      await new Promise((r) => setTimeout(r, opts.atraso ?? 20));
      if ((opts.status ?? 200) !== 200) {
        return new Response(JSON.stringify({ error: "too_many_requests" }), { status: opts.status, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(sessao(3600, `${rt}-novo`)), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  return { fn, chamadas };
}

/** Um cliente de servidor como o do proxy/rotas: cookies de entrada e os que ele grava na SUA resposta. */
function clienteDoServidor(sessaoInicial: ReturnType<typeof sessao>, fetchDoCliente: typeof fetch) {
  const nome = "sb-projetoteste-auth-token";
  const gravados: { name: string; value: string }[] = [];
  const cliente = createServerClient(URL_SB, "anon-de-teste", {
    cookies: {
      getAll: () => [{ name: nome, value: `base64-${b64url(sessaoInicial)}` }],
      setAll: (c) => {
        for (const x of c) gravados.push({ name: x.name, value: x.value });
      },
    },
    global: { fetch: fetchDoCliente },
  });
  return { cliente, gravados };
}

beforeEach(() => zerarRefreshUnico());
afterEach(() => vi.restoreAllMocks());

describe("o embrulho: quem ele pega", () => {
  it("só o POST /auth/v1/token?grant_type=refresh_token", () => {
    expect(ehRefreshDoAuth(REFRESH, { method: "POST" })).toBe(true);
    expect(ehRefreshDoAuth(REFRESH, { method: "GET" })).toBe(false);
    expect(ehRefreshDoAuth(`${URL_SB}/auth/v1/token?grant_type=password`, { method: "POST" })).toBe(false);
    expect(ehRefreshDoAuth(`${URL_SB}/auth/v1/user`, { method: "GET" })).toBe(false);
    expect(ehRefreshDoAuth(`${URL_SB}/rest/v1/crm_leads`, { method: "POST" })).toBe(false);
  });
  it("o resto passa intacto (0 no contador)", async () => {
    const { fn } = authFalso();
    const f = comRefreshUnico(fn as unknown as typeof fetch);
    await Promise.all([f(`${URL_SB}/auth/v1/user`), f(`${URL_SB}/rest/v1/x`, { method: "POST", body: "{}" })]);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(contagemDoRefresh()).toEqual({ chamou_o_auth: 0, esperou: 0 });
  });
});

describe("o single-flight pelo refresh_token", () => {
  const corpo = (rt: string): RequestInit => ({ method: "POST", body: JSON.stringify({ refresh_token: rt }) });

  it("24 juntos com o MESMO refresh token = 1 refresh; as 24 respostas iguais, 200 e application/json", async () => {
    const { fn, chamadas } = authFalso();
    const f = comRefreshUnico(fn as unknown as typeof fetch);
    const rs = await Promise.all(Array.from({ length: 24 }, () => f(REFRESH, corpo("rt-a"))));
    expect(chamadas).toEqual(["rt-a"]);
    expect(contagemDoRefresh()).toEqual({ chamou_o_auth: 1, esperou: 23 });
    for (const r of rs) {
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/json");
      expect(((await r.json()) as { refresh_token: string }).refresh_token).toBe("rt-a-novo");
    }
  });

  it("2 refresh tokens diferentes juntos = 2 refreshes, e nenhuma resposta com a sessão do outro", async () => {
    const { fn, chamadas } = authFalso();
    const f = comRefreshUnico(fn as unknown as typeof fetch);
    const rs = await Promise.all([...Array(6)].map((_, i) => f(REFRESH, corpo(i % 2 ? "rt-b" : "rt-a"))));
    expect(chamadas.sort()).toEqual(["rt-a", "rt-b"]);
    const novos = await Promise.all(rs.map(async (r) => ((await r.json()) as { refresh_token: string }).refresh_token));
    novos.forEach((n, i) => expect(n).toBe(i % 2 ? "rt-b-novo" : "rt-a-novo"));
  });

  it("o 1º dá 429: sai do Map NA HORA; o pedido seguinte chama o Auth de novo", async () => {
    const ruim = authFalso({ status: 429 });
    const f = comRefreshUnico(ruim.fn as unknown as typeof fetch);
    const r1 = await f(REFRESH, corpo("rt-a"));
    expect(r1.status).toBe(429);
    expect(tamanhoDoMapa()).toBe(0);
    await f(REFRESH, corpo("rt-a"));
    expect(ruim.chamadas).toEqual(["rt-a", "rt-a"]);
  });

  it("erro de rede: sai do Map e o erro sobe; o seguinte tenta de novo", async () => {
    let n = 0;
    const f = comRefreshUnico((async () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    await expect(f(REFRESH, corpo("rt-a"))).rejects.toThrow("fetch failed");
    expect(tamanhoDoMapa()).toBe(0);
    expect((await f(REFRESH, corpo("rt-a"))).status).toBe(200);
    expect(n).toBe(2);
  });

  it("TTL: depois de 10 s, a mesma chave chama o Auth de novo", async () => {
    let agora = 1_000_000;
    const { fn, chamadas } = authFalso({ atraso: 0 });
    const f = comRefreshUnico(fn as unknown as typeof fetch, () => agora);
    await f(REFRESH, corpo("rt-a"));
    agora += GUARDA_MS - 1;
    await f(REFRESH, corpo("rt-a"));
    expect(chamadas).toHaveLength(1);
    agora += 2;
    await f(REFRESH, corpo("rt-a"));
    expect(chamadas).toHaveLength(2);
  });

  it("o Map não passa do teto (acima, limpa tudo)", async () => {
    const { fn } = authFalso({ atraso: 0 });
    const f = comRefreshUnico(fn as unknown as typeof fetch);
    for (let i = 0; i < TETO_DE_CHAVES + 50; i++) await f(REFRESH, corpo(`rt-${i}`));
    expect(tamanhoDoMapa()).toBeLessThanOrEqual(TETO_DE_CHAVES);
  });

  it("o log do contador e o do erro NÃO contêm token nenhum (Lupa b)", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...a) => void linhas.push(a.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a) => void linhas.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void linhas.push(a.join(" ")));
    const ruim = authFalso({ status: 429 });
    await comRefreshUnico(ruim.fn as unknown as typeof fetch)(REFRESH, corpo("rt-segredo-do-teste"));
    const bom = authFalso();
    await Promise.all([...Array(4)].map(() => comRefreshUnico(bom.fn as unknown as typeof fetch)(REFRESH, corpo("rt-segredo-do-teste"))));
    expect(linhas.some((l) => l.includes("[proxy] refresh: chamou o Auth="))).toBe(true);
    const tudo = linhas.join("\n");
    expect(tudo).not.toMatch(/eyJ/);
    expect(tudo).not.toContain("rt-segredo-do-teste");
  });
});

describe("com o auth-js DE VERDADE (createServerClient, como o proxy e as rotas)", () => {
  async function rodar(n: number, expiraEmSeg: number, comEmbrulho: boolean) {
    const auth = authFalso();
    vi.stubGlobal("fetch", auth.fn);
    const s = sessao(expiraEmSeg, "rt-da-aba");
    const fetchDoCliente = comEmbrulho ? fetchDoServidor(URL_SB, URL_SB) : ((i: Parameters<typeof fetch>[0], o?: RequestInit) => globalThis.fetch(i, o));
    const clientes = Array.from({ length: n }, () => clienteDoServidor(s, fetchDoCliente as typeof fetch));
    const res = await Promise.all(clientes.map((c) => c.cliente.auth.getSession()));
    vi.unstubAllGlobals();
    return { auth, clientes, res };
  }

  it("token a 30 s de vencer (dentro da margem de 90 s), 24 clientes juntos = 1 refresh; todos leem a sessão nova e gravam o cookie novo", async () => {
    const { auth, clientes, res } = await rodar(24, 30, true);
    expect(auth.chamadas).toEqual(["rt-da-aba"]);
    for (const r of res) expect(r.data.session?.refresh_token).toBe("rt-da-aba-novo");
    for (const c of clientes) expect(c.gravados.some((g) => g.name.startsWith("sb-projetoteste-auth-token"))).toBe(true);
  });

  it("token JÁ vencido, 24 juntos = 1 refresh", async () => {
    const { auth } = await rodar(24, -60, true);
    expect(auth.chamadas).toHaveLength(1);
  });

  it("token com folga (> 90 s) = 0 refresh", async () => {
    const { auth } = await rodar(24, 600, true);
    expect(auth.chamadas).toHaveLength(0);
  });

  it("o cliente do PROXY e o de uma ROTA (dois fetchDoServidor) com o mesmo refresh token, juntos = 1 refresh", async () => {
    const auth = authFalso();
    vi.stubGlobal("fetch", auth.fn);
    const s = sessao(30, "rt-da-aba");
    const doProxy = clienteDoServidor(s, fetchDoServidor(URL_SB, URL_SB));
    const daRota = clienteDoServidor(s, fetchDoServidor("http://kong:8000", URL_SB));
    await Promise.all([doProxy.cliente.auth.getSession(), daRota.cliente.auth.getSession()]);
    vi.unstubAllGlobals();
    expect(auth.chamadas).toHaveLength(1);
  });

  it("CONTRA-PROVA: sem o embrulho, os mesmos 24 clientes fazem 24 refreshes", async () => {
    const { auth } = await rodar(24, 30, false);
    expect(auth.chamadas).toHaveLength(24);
  });
});
