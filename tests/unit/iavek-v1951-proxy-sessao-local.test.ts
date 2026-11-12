import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { caminhoDoToken, contagemDoProxy, usuarioDoProxy } from "@/lib/auth/sessao-do-proxy";

/** ia.vek v1.9.51 (Maestro 214930, opção A): SÓ o proxy confere o JWT localmente; as rotas seguem pela rede. */

const auth = (r: unknown) => ({ getClaims: vi.fn(async () => r as never) });

describe("usuarioDoProxy", () => {
  it("token ES256 válido: devolve o usuário e conta 'local'", async () => {
    const antes = contagemDoProxy().local;
    const u = await usuarioDoProxy(auth({ data: { claims: { sub: "u1" }, header: { alg: "ES256", kid: "k1" } }, error: null }));
    expect(u).toEqual({ id: "u1" });
    expect(contagemDoProxy().local).toBe(antes + 1);
  });
  it("token do segredo antigo (HS256): o getClaims foi à rede; conta 'rede' (é o que o canário vigia)", async () => {
    const antes = contagemDoProxy().rede;
    await usuarioDoProxy(auth({ data: { claims: { sub: "u1" }, header: { alg: "HS256" } }, error: null }));
    expect(contagemDoProxy().rede).toBe(antes + 1);
  });
  it("assinatura errada, expirado ou sem sessão (erro): NINGUÉM logado -> o proxy manda para o login", async () => {
    expect(await usuarioDoProxy(auth({ data: null, error: new Error("invalid JWT signature") }))).toBeNull();
    expect(await usuarioDoProxy(auth({ data: { claims: {}, header: { alg: "ES256", kid: "k" } }, error: null }))).toBeNull();
  });
  it("caminhoDoToken segue a regra do auth-js (sem alg, HS* ou sem kid = rede)", () => {
    expect(caminhoDoToken({ alg: "ES256", kid: "k" })).toBe("local");
    expect(caminhoDoToken({ alg: "RS256", kid: "k" })).toBe("local");
    expect(caminhoDoToken({ alg: "HS256", kid: "k" })).toBe("rede");
    expect(caminhoDoToken({ alg: "ES256" })).toBe("rede");
    expect(caminhoDoToken(null)).toBe("rede");
  });
});

describe("a fronteira: o proxy local, as rotas pela rede (a revogação na hora)", () => {
  it("o proxy NÃO chama mais o getUser (nem o getSession)", () => {
    const p = readFileSync("proxy.ts", "utf8");
    expect(p).toContain("usuarioDoProxy(supabase.auth)");
    expect(p).not.toMatch(/auth\.getUser\(\)/);
    expect(p).not.toMatch(/auth\.getSession\(\)/);
  });
  it("a autenticação das ROTAS segue com o getUser pela rede", () => {
    expect(readFileSync("lib/auth/server.ts", "utf8")).toMatch(/auth\.getUser\(\)/);
    expect(readFileSync("lib/auth/require-role.ts", "utf8")).toMatch(/auth\.getUser\(\)/);
  });
});

describe("aba escondida não vai ao banco (Maestro 214930, item 2)", () => {
  it("a rede de segurança do quadro pula o intervalo com a aba escondida e refaz ao voltar", () => {
    const s = readFileSync("hooks/realtime/useRefetchDeSeguranca.ts", "utf8");
    expect(s).toContain('if (document.visibilityState !== "hidden") void verificar();');
    expect(s).toContain('if (document.visibilityState === "visible") void verificar();');
  });
  it("a conferência do modo suporte também", () => {
    const s = readFileSync("hooks/auth/AuthProvider.tsx", "utf8");
    expect(s).toContain('if (document.visibilityState !== "hidden") void check();');
    expect(s).toContain('document.removeEventListener("visibilitychange", aoVoltar);');
  });
});
