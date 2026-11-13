/**
 * ia.vek v1.9.54 (CRM-357; Lupa 193007/213948): o funil de LOJA pronto ao criar a empresa.
 *  1. a migration 0636 leva EXATAMENTE o modelo (lib/iavek/modelos/funil-de-loja-20261113.json), sem nenhum id e sem a loja;
 *  2. os SLUGS de que as regras dependem (0589/0590/0596/0608) existem no modelo;
 *  3. toda referência '@...' do modelo tem destino no próprio modelo (o remapeamento não pode faltar);
 *  4. a esteira SEMEADA no banco de TESTE (a saída real da função, fixture) passa no MESMO zod da esteira, desligada;
 *  5. a função é só do service_role, com a trava por org e os estados do meio.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { esteiraSettingsSchema } from "@/lib/esteira/config";

const MIG = readFileSync("supabase/migrations/20261114010000_0636_iavek_funil_de_loja_pronto.sql", "utf8");
const MODELO_TXT = readFileSync("lib/iavek/modelos/funil-de-loja-20261113.json", "utf8");
const MODELO = JSON.parse(MODELO_TXT) as {
  funis: Array<{ slug: string; is_default: boolean; settings: unknown; etapas: Array<{ slug: string; is_won: boolean; is_lost: boolean }> }>;
  esteira: unknown;
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function refs(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") { if (v.startsWith("@")) out.push(v); return out; }
  if (Array.isArray(v)) { v.forEach((x) => refs(x, out)); return out; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k.startsWith("@")) out.push(k); refs(x, out); }
  return out;
}

describe("1. o modelo na migration", () => {
  it("a migration embute o modelo IGUAL ao arquivo (o mesmo JSON)", () => {
    const m = MIG.match(/\$modelo\$(.*?)\$modelo\$/s);
    expect(m).not.toBeNull();
    expect(JSON.parse((m as RegExpMatchArray)[1] as string)).toEqual(MODELO);
  });
  it("sem nenhum id e sem o nome da loja de origem", () => {
    expect(MODELO_TXT).not.toMatch(UUID);
    expect(MODELO_TXT.toLowerCase()).not.toMatch(/fen[oô]menos/);
  });
  it("2 funis (72h com 17 etapas e padrão; Follow-up com 8), 1 ganho e 1 perda em cada", () => {
    const f72 = MODELO.funis.find((f) => f.slug === "loja-72h");
    const ffu = MODELO.funis.find((f) => f.slug === "loja-follow-up");
    expect(f72?.etapas).toHaveLength(17);
    expect(ffu?.etapas).toHaveLength(8);
    expect(f72?.is_default).toBe(true);
    for (const f of [f72, ffu]) {
      expect(f?.etapas.filter((e) => e.is_won)).toHaveLength(1);
      expect(f?.etapas.filter((e) => e.is_lost)).toHaveLength(1);
    }
  });
  it("a migration diz que é o retrato de 13/11 e NÃO acompanha a loja de origem", () => {
    expect(MIG).toMatch(/RETRATO da Fenômenos de 13\/11\/2026/);
    expect(MIG).toMatch(/NÃO\s+--\s*acompanha mudanças futuras|NÃO\s*acompanha mudanças futuras/);
  });
});

describe("2. os slugs das regras", () => {
  it("as etapas que as regras usam existem no funil de 72h", () => {
    const slugs = new Set(MODELO.funis.find((f) => f.slug === "loja-72h")?.etapas.map((e) => e.slug));
    for (const s of ["novo", "em-atendimento-ia", "carro-apresentado", "agendado-video",
      "qualificado", "ligacao-de-video", "ficha-feita", "vendido"]) expect(slugs.has(s), s).toBe(true);
  });
  it("(Rodrigo CRM-172) as 4 etapas vazias NÃO vêm (nem arquivadas): CTA, Passado ao SDR, Troca, Muito longe", () => {
    const slugs = MODELO.funis.flatMap((f) => f.etapas.map((e) => e.slug));
    for (const s of ["cta", "passado-ao-sdr", "troca", "muito-longe"]) expect(slugs, s).not.toContain(s);
    expect(MODELO.funis.flatMap((f) => f.etapas).filter((e) => (e as { is_archived?: boolean }).is_archived)).toEqual([]);
  });
});

describe("3. o remapeamento", () => {
  it("toda referência '@...' do modelo tem destino no próprio modelo", () => {
    const destinos = new Set<string>();
    for (const f of MODELO.funis) {
      destinos.add(`@funil:${f.slug}`);
      for (const e of f.etapas) destinos.add(`@etapa:${f.slug}:${e.slug}`);
    }
    const todas = refs(MODELO);
    expect(todas.length).toBeGreaterThan(20);
    expect(todas.filter((r) => !destinos.has(r))).toEqual([]);
  });
  it("a função FALHA ALTO sem destino (exception, nunca id nulo)", () => {
    expect(MIG.match(/raise exception 'modelo do funil de loja: referência sem destino/g)?.length).toBe(2);
  });
});

describe("4. a esteira semeada (saída real no TESTE)", () => {
  it("passa no esteiraSettingsSchema, DESLIGADA, com o 'desde' e 6 compromissos e 4 fases", () => {
    const e = JSON.parse(readFileSync("tests/unit/fixtures-iavek-0636-esteira-semeada.json", "utf8"));
    const r = esteiraSettingsSchema.safeParse(e);
    expect(r.success, JSON.stringify(r.error?.issues ?? [])).toBe(true);
    expect(e.ativa).toBe(false);
    expect(e.entrada.desde).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(e.entrada.etapas_de_compromisso).toHaveLength(6);
    expect(e.followup.fases).toHaveLength(4);
  });
});

describe("5. a função", () => {
  it("só o service_role; a trava por org; os estados do meio", () => {
    expect(MIG).toMatch(/revoke execute on function public\.fn_iavek_semear_funil_loja\(uuid\) from public, anon, authenticated/);
    expect(MIG).toMatch(/grant execute on function public\.fn_iavek_semear_funil_loja\(uuid\) to service_role/);
    expect(MIG).toMatch(/pg_advisory_xact_lock\(hashtextextended\('iavek_funil_loja:'/);
    expect(MIG).toMatch(/'resultado', 'ja_tinha'/);
    expect(MIG).toMatch(/'resultado', 'tem_funil_sem_esteira'/);
  });
});

vi.mock("server-only", () => ({}));
import { semearFunilDaLoja } from "@/lib/iavek/perfil-da-empresa-servidor";

describe("6. semearFunilDaLoja (nunca lança) e a rota de criar empresa", () => {
  const admin = (r: { data?: unknown; error?: { message: string } | null } | Error) =>
    ({ rpc: vi.fn(async () => { if (r instanceof Error) throw r; return { data: r.data ?? null, error: r.error ?? null }; }) }) as never;
  it("criado / ja_tinha / tem_funil_sem_esteira passam como vieram", async () => {
    for (const x of ["criado", "ja_tinha", "tem_funil_sem_esteira"] as const)
      expect(await semearFunilDaLoja(admin({ data: { resultado: x } }), "org")).toBe(x);
  });
  it("erro do banco, exceção ou resultado estranho = 'falhou', sem lançar", async () => {
    expect(await semearFunilDaLoja(admin({ error: { message: "boom" } }), "org")).toBe("falhou");
    expect(await semearFunilDaLoja(admin(new Error("rede")), "org")).toBe("falhou");
    expect(await semearFunilDaLoja(admin({ data: { resultado: "outra coisa" } }), "org")).toBe("falhou");
  });
  it("a rota: só a loja de carros semeia, e a resposta e o audit levam o resultado", () => {
    const rota = readFileSync("app/api/v1/admin/tenants/route.ts", "utf8");
    expect(rota).toMatch(/if \(nicho === "loja_de_carros"\) funilDeLoja = await semearFunilDaLoja\(admin, org\.id\);/);
    expect(rota.match(/\.\.\.\(funilDeLoja \? \{ funil_de_loja: funilDeLoja \} : \{\}\)/g)?.length).toBe(2);
    expect(rota).toMatch(/if \(nicho === "clinica"\) await semearFunilDaClinica\(admin, org\.id\);/);
  });
});
