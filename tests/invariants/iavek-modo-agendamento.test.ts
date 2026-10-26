import { spawn } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.1 (migration 0594) — modo agendamento por empresa.
 *  · na CLÍNICA (modo ligado): dois compromissos vivos da MESMA pessoa no mesmo
 *    horário são recusados pelo banco — inclusive duas marcações SIMULTÂNEAS;
 *  · na LOJA (sem o modo): vários no mesmo horário, como a 0583 decidiu;
 *  · gerente (recepção) escreve na agenda só no modo; admin sempre;
 *  · o funil padrão de clínica nasce idempotente e só o servidor o cria.
 */
const ORG_C = "ab1e0000-9191-4000-8000-0000000000c0";
const ORG_L = "ab1e0000-9191-4000-8000-0000000000a0";
const ADMIN_C = "ab1e0000-9191-4000-8000-0000000000c1";
const RECEPCAO_C = "ab1e0000-9191-4000-8000-0000000000c2";
const PRO_C = "ab1e0000-9191-4000-8000-0000000000c3";
const ADMIN_L = "ab1e0000-9191-4000-8000-0000000000a1";
const GERENTE_L = "ab1e0000-9191-4000-8000-0000000000a2";
const PRO_L = "ab1e0000-9191-4000-8000-0000000000a3";

const AMANHA_10 = "date_trunc('day', now()) + interval '1 day 10 hours'";
const marcar = (org: string, dono: string, de: string, minutos = 30, status = "confirmed") =>
  `insert into public.calendar_appointments (organization_id, title, starts_at, ends_at, status, owner_user_id)
   values ('${org}', 'Prova 0594', ${de}, ${de} + interval '${minutos} minutes', '${status}', '${dono}') returning id;`;
const como = (user: string, corpo: string) =>
  sql(`set role authenticated;
       select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false);
       ${corpo}`);

/** Uma sessão psql à parte, em paralelo: devolve a saída ou o erro. */
function sessao(script: string): Promise<{ ok: boolean; saida: string }> {
  return new Promise((resolve) => {
    const p = spawn("docker", ["exec", "-i", process.env.TEST_DB_CONTAINER!, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"]);
    let saida = "";
    p.stdout.on("data", (d) => (saida += d));
    p.stderr.on("data", (d) => (saida += d));
    p.on("close", (code) => resolve({ ok: code === 0, saida }));
    p.stdin.end(script);
  });
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_C}', 'clinica-admin@invariant.test'), ('${RECEPCAO_C}', 'clinica-recepcao@invariant.test'),
      ('${PRO_C}', 'clinica-pro@invariant.test'), ('${ADMIN_L}', 'loja-admin@invariant.test'),
      ('${GERENTE_L}', 'loja-gerente@invariant.test'), ('${PRO_L}', 'loja-pro@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG_C}', 'inv-0594-clinica', 'Clínica 0594', 'Clínica 0594', '{"iavek":{"perfil":{"nicho":"clinica","modo_agendamento":true}}}'),
      ('${ORG_L}', 'inv-0594-loja', 'Loja 0594', 'Loja 0594', '{}')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_C}', '${ORG_C}', 'admin', now()), ('${RECEPCAO_C}', '${ORG_C}', 'manager', now()), ('${PRO_C}', '${ORG_C}', 'agent', now()),
      ('${ADMIN_L}', '${ORG_L}', 'admin', now()), ('${GERENTE_L}', '${ORG_L}', 'manager', now()), ('${PRO_L}', '${ORG_L}', 'agent', now())
      on conflict do nothing;
    delete from public.calendar_appointments where organization_id in ('${ORG_C}', '${ORG_L}');
  `);
});

describe("0594 — a chave do modo agendamento", () => {
  it("lê a chave da empresa; sem chave = desligado; anon não executa", () => {
    expect(lastLine(sql(`select public.fn_iavek_modo_agendamento('${ORG_C}') || '/' || public.fn_iavek_modo_agendamento('${ORG_L}');`))).toBe("true/false");
    expect(lastLine(sql(`select has_function_privilege('anon', 'public.fn_iavek_modo_agendamento(uuid)', 'execute');`))).toBe("f");
  });
});

describe("0594 — agenda sem duplo na clínica", () => {
  it("o segundo compromisso vivo da MESMA pessoa no mesmo horário é recusado (PT409)", () => {
    sql(marcar(ORG_C, PRO_C, AMANHA_10));
    expect(() => sql(marcar(ORG_C, PRO_C, `${AMANHA_10} + interval '15 minutes'`, 30, "pending"))).toThrow(/agenda_horario_ocupado/);
  });

  it("outra pessoa no mesmo horário pode; horário seguinte pode; cancelado libera", () => {
    sql(`insert into auth.users (id, email) values ('ab1e0000-9191-4000-8000-0000000000c4', 'clinica-pro2@invariant.test') on conflict (id) do nothing;`);
    expect(() => sql(marcar(ORG_C, "ab1e0000-9191-4000-8000-0000000000c4", AMANHA_10))).not.toThrow();
    expect(() => sql(marcar(ORG_C, PRO_C, `${AMANHA_10} + interval '30 minutes'`))).not.toThrow();
    sql(`update public.calendar_appointments set status = 'cancelled', cancelled_at = now()
          where organization_id = '${ORG_C}' and owner_user_id = '${PRO_C}' and starts_at = ${AMANHA_10};`);
    expect(() => sql(marcar(ORG_C, PRO_C, AMANHA_10, 30, "pending"))).not.toThrow();
  });

  it("remarcar POR CIMA de outro compromisso também é recusado", () => {
    expect(() =>
      sql(`update public.calendar_appointments set starts_at = ${AMANHA_10} + interval '35 minutes', ends_at = ${AMANHA_10} + interval '65 minutes'
            where organization_id = '${ORG_C}' and owner_user_id = '${PRO_C}' and starts_at = ${AMANHA_10} and status = 'pending';`),
    ).toThrow(/agenda_horario_ocupado/);
  });

  it("DUAS marcações SIMULTÂNEAS para a mesma pessoa: só uma entra", async () => {
    const de = "date_trunc('day', now()) + interval '2 days 14 hours'";
    const roteiro = `begin; ${marcar(ORG_C, PRO_C, de)} select pg_sleep(1.5); commit;`;
    const [a, b] = await Promise.all([sessao(roteiro), new Promise<{ ok: boolean; saida: string }>((r) => setTimeout(() => void sessao(roteiro).then(r), 300))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)?.saida).toMatch(/agenda_horario_ocupado/);
    expect(lastLine(sql(`select count(*) from public.calendar_appointments where organization_id = '${ORG_C}' and owner_user_id = '${PRO_C}' and starts_at = ${de};`))).toBe("1");
  });
});

describe("0594 — a loja (sem o modo) não muda", () => {
  it("vários compromissos da mesma pessoa no mesmo horário continuam permitidos", () => {
    sql(marcar(ORG_L, PRO_L, AMANHA_10));
    expect(() => sql(marcar(ORG_L, PRO_L, AMANHA_10))).not.toThrow();
    expect(lastLine(sql(`select count(*) from public.calendar_appointments where organization_id = '${ORG_L}' and starts_at = ${AMANHA_10};`))).toBe("2");
  });
});

describe("0594 — quem escreve na agenda", () => {
  const marcarComo = (user: string, org: string, dono: string, horas: number) =>
    como(user, marcar(org, dono, `date_trunc('day', now()) + interval '3 days ${horas} hours'`));

  it("na clínica, a recepção (gerente) marca", () => {
    expect(() => marcarComo(RECEPCAO_C, ORG_C, PRO_C, 9)).not.toThrow();
  });

  it("na loja, o gerente NÃO marca (só o admin, como na 0583)", () => {
    expect(() => marcarComo(GERENTE_L, ORG_L, PRO_L, 9)).toThrow(/row-level security/);
    expect(() => marcarComo(ADMIN_L, ORG_L, PRO_L, 9)).not.toThrow();
  });

  it("o profissional (agent) não marca nem na clínica", () => {
    expect(() => marcarComo(PRO_C, ORG_C, PRO_C, 11)).toThrow(/row-level security/);
  });
});

describe("0594 — funil padrão de clínica", () => {
  it("cria as 8 etapas, vira o padrão e é idempotente", () => {
    const id1 = lastLine(sql(`select public.fn_iavek_semear_funil_clinica('${ORG_C}');`));
    const id2 = lastLine(sql(`select public.fn_iavek_semear_funil_clinica('${ORG_C}');`));
    expect(id2).toBe(id1);
    expect(lastLine(sql(`select string_agg(name, ' > ' order by position) from public.crm_stages where pipeline_id = '${id1}';`))).toBe(
      "Novo lead > Em atendimento > Pré-agendado > Agendado > Compareceu > Procedimento feito > Não compareceu > Perdido",
    );
    expect(lastLine(sql(`select count(*) filter (where is_default) || '/' || bool_or(is_default and slug = 'clinica') from public.crm_pipelines where organization_id = '${ORG_C}';`))).toBe("1/true");
    expect(lastLine(sql(`select count(*) filter (where is_won) || '/' || count(*) filter (where is_lost) from public.crm_stages where pipeline_id = '${id1}';`))).toBe("1/1");
  });

  it("só o servidor cria (a sessão não executa)", () => {
    expect(lastLine(sql(`select has_function_privilege('authenticated', 'public.fn_iavek_semear_funil_clinica(uuid)', 'execute');`))).toBe("f");
  });
});
