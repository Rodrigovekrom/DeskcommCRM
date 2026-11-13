/**
 * ia.vek v1.9.51.4 (Lupa 192902 b e c): a medida de tela com a REDE do navegador e um id ANÔNIMO da pessoa; e o
 * atraso do laço do app no log.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { medidaParaRegistro, medidaSchema, redeDoNavegador } from "@/lib/iavek/medidas-de-tela";
import { pessoaAnonima } from "@/lib/iavek/medidas-de-tela-servidor";
import { LIMIAR_MS, resumirHistograma } from "@/lib/iavek/atraso-do-laco";

describe("a rede do navegador", () => {
  it("navigator.connection vira {tipo, mbps, rtt_ms, economia}", () => {
    expect(redeDoNavegador({ connection: { effectiveType: "3g", downlink: 1.45, rtt: 312.6, saveData: false } })).toEqual({
      tipo: "3g", mbps: 1.45, rtt_ms: 313, economia: false,
    });
  });
  it("sem connection (Safari) ou com lixo = nada", () => {
    expect(redeDoNavegador({})).toBeUndefined();
    expect(redeDoNavegador(null)).toBeUndefined();
    expect(redeDoNavegador({ connection: { effectiveType: "5g", downlink: "x", rtt: -1 } })).toBeUndefined();
  });
  it("o schema aceita a rede e recusa campo a mais dentro dela", () => {
    const base = { tipo: "clique", tela: "/app/pipeline", ms: 12000 };
    expect(medidaSchema.safeParse({ ...base, rede: { tipo: "4g", mbps: 10, rtt_ms: 50 } }).success).toBe(true);
    expect(medidaSchema.safeParse({ ...base, rede: { tipo: "4g", ip: "1.2.3.4" } }).success).toBe(false);
    const ok = medidaSchema.parse({ ...base, rede: { tipo: "2g" } });
    expect(medidaParaRegistro(ok).rede).toEqual({ tipo: "2g" });
  });
  it("o medidor manda a rede em toda medida", () => {
    const s = readFileSync("components/shell/MedidorDeTela.tsx", "utf8");
    expect(s).toMatch(/const rede = redeDoNavegador\(/);
    expect(s).toMatch(/JSON\.stringify\(rede \? \{ \.\.\.m, rede \} : m\)/);
  });
});

describe("a pessoa anônima", () => {
  it("10 hex, a mesma para o mesmo usuário, outra para outro; não contém o id", () => {
    const a = pessoaAnonima("11111111-2222-3333-4444-555555555555", "segredo-de-teste");
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(pessoaAnonima("11111111-2222-3333-4444-555555555555", "segredo-de-teste")).toBe(a);
    expect(pessoaAnonima("99999999-2222-3333-4444-555555555555", "segredo-de-teste")).not.toBe(a);
    expect("11111111-2222-3333-4444-555555555555").not.toContain(a as string);
  });
  it("outro segredo = outro valor (sem o segredo do servidor não se volta ao id)", () => {
    expect(pessoaAnonima("u1", "s1")).not.toBe(pessoaAnonima("u1", "s2"));
  });
  it("sem segredo = sem o campo", () => {
    expect(pessoaAnonima("u1", "")).toBeNull();
  });
  it("a rota grava 'pessoa' e nunca o id nem o e-mail", () => {
    const s = readFileSync("app/api/v1/iavek/medidas/route.ts", "utf8");
    expect(s).toMatch(/const pessoa = pessoaAnonima\(authz\.user\.id\)/);
    expect(s).toMatch(/\.\.\.\(pessoa \? \{ pessoa \} : \{\}\)/);
    expect(s).not.toMatch(/user\.email|user_id: authz/);
  });
});

describe("o atraso do laço", () => {
  it("o resumo em ms (p50, p99, máximo); janela vazia = nada", () => {
    const h = { count: 10, max: 120_000_000, percentile: (p: number) => (p === 50 ? 10_400_000 : 98_760_000) };
    expect(resumirHistograma(h)).toEqual({ p50_ms: 10.4, p99_ms: 98.8, max_ms: 120 });
    expect(resumirHistograma({ count: 0, max: 0, percentile: () => 0 })).toBeNull();
  });
  it("o limiar da linha de 5 s é 50 ms, e o register do Node liga a medida", () => {
    expect(LIMIAR_MS).toBe(50);
    const i = readFileSync("instrumentation.ts", "utf8");
    expect(i).toMatch(/NEXT_RUNTIME === "nodejs"[\s\S]*ligarAtrasoDoLaco\(\)/);
  });
});
