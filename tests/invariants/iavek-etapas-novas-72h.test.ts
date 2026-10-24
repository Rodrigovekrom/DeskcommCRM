import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * ia.vek v1.8.2 (migration 0589) — etapas novas do funil "fenomenos-72h".
 * Monta o funil ANTIGO (os 9 slugs da produção) com leads em todas as etapas,
 * aplica a migration DUAS vezes e confere: nenhum lead some, o mapa é o pedido,
 * os ids das etapas não mudam, CTA e Passado ao SDR ficam arquivadas e vazias.
 */
const ORG = "e7a00000-0000-4000-8000-000000000001";
const FUNIL = "e7a00000-5555-4000-8000-000000000001";
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20261024020000_0589_iavek_etapas_novas_do_funil_72h.sql"),
  "utf8",
);
const ANTIGAS: Array<[string, string, number, boolean, boolean, number]> = [
  // slug, nome antigo, posição, ganho, perda, leads
  ["novo", "Novo", 1000, false, false, 5],
  ["em-atendimento-ia", "Em atendimento IA", 2000, false, false, 3],
  ["carro-apresentado", "Carro apresentado", 3000, false, false, 2],
  ["cta", "CTA", 4000, false, false, 2],
  ["agendado-video", "Agendado/Vídeo", 5000, false, false, 1],
  ["qualificado", "Qualificado", 6000, false, false, 1],
  ["passado-ao-sdr", "Passado ao SDR", 7000, false, false, 1],
  ["vendido", "Vendido", 8000, true, false, 1],
  ["perdido", "Perdido", 9000, false, true, 1],
];
const TOTAL = ANTIGAS.reduce((s, a) => s + a[5], 0);

const quadro = () =>
  sql(`select s.name || '=' || count(l.id) from public.crm_stages s left join public.crm_leads l on l.stage_id = s.id
       where s.pipeline_id = '${FUNIL}' and not s.is_archived group by s.name, s.position order by s.position;`)
    .split("\n")
    .filter(Boolean);
const ids = () => sql(`select slug || ':' || id from public.crm_stages where pipeline_id = '${FUNIL}' order by slug;`);

let idsAntes = "";

beforeAll(() => {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}', 'etapas-72h-inv', 'Etapas', 'Etapas') on conflict (id) do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values ('${FUNIL}', '${ORG}', 'Primeiro Atendimento - 72h Leads Novos', 'fenomenos-72h', false) on conflict (id) do nothing;
  `);
  for (const [slug, nome, pos, ganho, perda, n] of ANTIGAS) {
    sql(`
      insert into public.crm_stages (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
        values ('${ORG}', '${FUNIL}', '${nome}', '${slug}', ${pos}, ${ganho}, ${perda}) on conflict do nothing;
      insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, source, status, closed_at, lost_reason)
        select '${ORG}', '${FUNIL}', s.id, '${slug} #' || g, 'manual', ${ganho ? "'won'" : perda ? "'lost'" : "'open'"},
               ${ganho || perda ? "now()" : "null"}, ${perda ? "'other'" : "null"}
          from public.crm_stages s, generate_series(1, ${n}) g where s.pipeline_id = '${FUNIL}' and s.slug = '${slug}';
    `);
  }
  idsAntes = ids();
  sql(MIGRATION);
});

describe("etapas novas do funil 72h", () => {
  it("a ordem e as contagens são as do mapa (CTA e Passado ao SDR vão para Em atendimento)", () => {
    expect(quadro()).toEqual([
      "IA responsável=3",
      "Lead novo=5",
      "Em atendimento=5",
      "Não responde=0",
      "Agendamento=1",
      "Ligação de vídeo feita=0",
      "Lead qualificado=1",
      "Troca=0",
      "Muito longe=0",
      "Vendido=1",
      "Perdido=1",
    ]);
  });

  it("nenhum lead some", () => {
    expect(Number(lastLine(sql(`select count(*) from public.crm_leads where pipeline_id = '${FUNIL}';`)))).toBe(TOTAL);
  });

  it("CTA e Passado ao SDR ficam ARQUIVADAS e vazias (nunca apagadas)", () => {
    expect(
      lastLine(sql(`select string_agg(slug || ':' || is_archived, ',' order by slug) from public.crm_stages where pipeline_id = '${FUNIL}' and slug in ('cta','passado-ao-sdr');`)),
    ).toBe("cta:true,passado-ao-sdr:true");
    expect(
      Number(lastLine(sql(`select count(*) from public.crm_leads l join public.crm_stages s on s.id = l.stage_id where s.pipeline_id = '${FUNIL}' and s.is_archived;`))),
    ).toBe(0);
  });

  it("as etapas antigas mantêm o MESMO id", () => {
    const depois = ids();
    for (const linha of idsAntes.split("\n")) expect(depois).toContain(linha);
  });

  it("idempotente: rodar de novo não muda nada", () => {
    const antes = quadro();
    const idsDepois = ids();
    sql(MIGRATION);
    expect(quadro()).toEqual(antes);
    expect(ids()).toBe(idsDepois);
  });

  it("a ENTRADA do lead fica em Lead novo (settings.etapa_de_entrada = 'novo'), não em IA responsável", () => {
    expect(lastLine(sql(`select settings->>'etapa_de_entrada' from public.crm_pipelines where id = '${FUNIL}';`))).toBe("novo");
    expect(
      lastLine(sql(`select name || ':' || is_archived || ':' || is_won || ':' || is_lost from public.crm_stages where pipeline_id = '${FUNIL}' and slug = 'novo';`)),
    ).toBe("Lead novo:false:false:false");
  });

  it("entrada já trocada (IA publicada) não é desfeita por rodar de novo", () => {
    sql(`update public.crm_pipelines set settings = settings || '{"etapa_de_entrada":"em-atendimento-ia"}' where id = '${FUNIL}';`);
    sql(MIGRATION);
    expect(lastLine(sql(`select settings->>'etapa_de_entrada' from public.crm_pipelines where id = '${FUNIL}';`))).toBe("em-atendimento-ia");
    sql(`update public.crm_pipelines set settings = settings || '{"etapa_de_entrada":"novo"}' where id = '${FUNIL}';`);
  });

  it("só uma etapa de ganho e uma de perda; Muito longe é etapa aberta", () => {
    expect(
      lastLine(sql(`select string_agg(name, ',' order by position) from public.crm_stages where pipeline_id = '${FUNIL}' and not is_archived and (is_won or is_lost);`)),
    ).toBe("Vendido,Perdido");
  });
});
