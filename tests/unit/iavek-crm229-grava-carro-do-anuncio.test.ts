/**
 * ia.vek CRM-229 (completado em 06/11): o lead que nasce de anúncio ganha `carro_anuncio` quando o
 * casamento com o catálogo é único; não pisa em valor já gravado; sem anúncio, não lê o catálogo.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { gravarCarroDoAnuncio } from "@/lib/iavek/carro-do-anuncio-servidor";

const ONIX = { id: "11111111-1111-4111-8111-111111111111", nome: "Chevrolet Onix LT 1.0 2022 Prata Manual", marca: "Chevrolet", ativo: true };
const GOL = { id: "22222222-2222-4222-8222-222222222222", nome: "Volkswagen Gol 1.6 2015 Branco Manual", marca: "Volkswagen", ativo: true };

function bancoFalso(campos: Record<string, unknown>, carros = [ONIX, GOL]) {
  const log = { catalogoLido: 0, gravado: null as Record<string, unknown> | null, metadata: null as Record<string, unknown> | null };
  const consulta = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const encadear = () => q;
    Object.assign(q, {
      select: encadear, eq: encadear, order: encadear,
      range: async (de: number) => { log.catalogoLido += 1; return { data: de === 0 ? carros : [], error: null }; },
      maybeSingle: async () => ({ data: { custom_fields: campos, source_metadata: { ad_id: "1" } }, error: null }),
      update: (v: { custom_fields?: Record<string, unknown>; source_metadata?: Record<string, unknown> }) => {
        if (v.custom_fields) log.gravado = v.custom_fields;
        if (v.source_metadata) log.metadata = v.source_metadata;
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    });
    void tabela;
    return q;
  };
  return { db: { from: consulta } as never, log };
}

describe("CRM-229: grava o carro do anúncio quando o lead nasce", () => {
  it("anúncio do Onix 2022 → grava o id do Onix, sem tocar nos outros campos", async () => {
    const { db, log } = bancoFalso({ cidade: "Recife" });
    const r = await gravarCarroDoAnuncio(db, "org", "lead", { ad_title: "Onix LT 2022 prata", ad_body: "Imperdível!" });
    expect(r).toBe("gravou");
    expect(log.gravado).toEqual({ cidade: "Recife", carro_anuncio: ONIX.id });
  });
  it("sem anúncio no contato → nada, e nem lê o catálogo", async () => {
    const { db, log } = bancoFalso({});
    expect(await gravarCarroDoAnuncio(db, "org", "lead", {})).toBe("sem_anuncio");
    expect(log.catalogoLido).toBe(0);
  });
  it("já tinha carro do anúncio → não pisa", async () => {
    const { db, log } = bancoFalso({ carro_anuncio: GOL.id });
    expect(await gravarCarroDoAnuncio(db, "org", "lead", { ad_title: "Onix LT 2022 prata" })).toBe("ja_tinha");
    expect(log.gravado).toBeNull();
  });
  it("anúncio que não casa com nenhum carro → não grava", async () => {
    const { db, log } = bancoFalso({});
    expect(await gravarCarroDoAnuncio(db, "org", "lead", { ad_title: "Promoção de pneus" })).toBe("nenhum");
    expect(log.gravado).toBeNull();
  });
  it("P3: 'nenhum' fica marcado NO LEAD (source_metadata), sem tocar no resto", async () => {
    const { db, log } = bancoFalso({});
    expect(await gravarCarroDoAnuncio(db, "org", "lead", { ad_title: "Promoção de pneus" })).toBe("nenhum");
    expect(log.metadata).toMatchObject({ ad_id: "1", iavek_carro_desfecho: { desfecho: "nenhum" } });
    expect((log.metadata!.iavek_carro_desfecho as { candidatos?: unknown }).candidatos).toBeUndefined();
  });
  it("P3: 'empate' fica marcado no lead com os carros candidatos (os 2 Polo Track do caso de 07/11)", async () => {
    const POLO_A = { id: "33333333-3333-4333-8333-333333333333", nome: "Volkswagen Polo W/ TRACK MA 2023/2024 Cinza Manual", marca: "Volkswagen", ativo: true };
    const POLO_B = { id: "44444444-4444-4444-8444-444444444444", nome: "Volkswagen Polo Track 1.0 Flex 12V 5p 2023/2024 Cinza", marca: "Volkswagen", ativo: true };
    const { db, log } = bancoFalso({}, [POLO_A, POLO_B]);
    expect(await gravarCarroDoAnuncio(db, "org", "lead", { ad_title: "Polo Track 2023/2024 cinza" })).toBe("empate");
    expect(log.gravado).toBeNull();
    const marca = log.metadata!.iavek_carro_desfecho as { desfecho: string; candidatos: string[]; em: string };
    expect(marca.desfecho).toBe("empate");
    expect([...marca.candidatos].sort()).toEqual([POLO_A.id, POLO_B.id].sort());
    expect(Number.isNaN(Date.parse(marca.em))).toBe(false);
  });
  it("P3: 'gravou', 'ja_tinha' e 'sem_anuncio' NÃO mexem no source_metadata", async () => {
    for (const [campos, anuncio] of [[{}, { ad_title: "Onix LT 2022 prata" }], [{ carro_anuncio: GOL.id }, { ad_title: "Onix LT 2022 prata" }], [{}, {}]] as const) {
      const { db, log } = bancoFalso(campos as Record<string, unknown>);
      await gravarCarroDoAnuncio(db, "org", "lead", anuncio);
      expect(log.metadata).toBeNull();
    }
  });
  it("o nascimento do lead chama a etapa, protegida (nunca derruba o card)", () => {
    const s = readFileSync("lib/leads/nascimento-do-lead.ts", "utf8");
    expect(s).toMatch(/try \{\s*const desfecho = await gravarCarroDoAnuncio\(db, organizationId, lead\.id as string, contato\?\.source_metadata\);/);
  });
});
