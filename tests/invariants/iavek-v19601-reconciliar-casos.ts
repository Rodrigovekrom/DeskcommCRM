/**
 * ia.vek v1.9.60.1 (Maestro 232512): os casos da comparação do passo 6 (reconciliarFollowup) ANTIGO x NOVO, num módulo
 * SEM o harness de banco, para valerem nos 2 lugares: a invariante (iavek-v19601-reconciliar-followup-igual.test.ts, no
 * Postgres efêmero do `pnpm test:db`) e o gerador da comparação no banco de TESTE (iavek-v19601-reconciliar-gerar-sql.ts,
 * tudo numa transação desfeita; fica em tests/ porque scripts/ entra na imagem e tests/ não). O SQL antigo é a cópia congelada da v1.9.60 (deps-reais.ts:516-551).
 */
export const SQL_ANTIGO_V1960 = `with sdrs as (
           select user_id from public.user_organizations
            where organization_id = $1 and revoked_at is null and role = 'agent' and interface_settings->>'funcao' = 'sdr_followup'),
         clones as (
           select c.id, c.owner_user_id, c.created_at from public.crm_leads c
            where c.organization_id = $1 and c.pipeline_id = $2 and c.owner_user_id in (select user_id from sdrs)
              and c.created_at > now() - interval '30 days'),
         g as (
           update public.crm_leads c set sdr_user_id = c.owner_user_id
             from clones k where c.id = k.id and c.sdr_user_id is distinct from c.owner_user_id returning c.id),
         o as (
           update public.crm_leads x set owner_user_id = k.owner_user_id, owner_kind = 'user', owner_agent_id = null, sdr_user_id = k.owner_user_id
             from clones k
            where x.organization_id = $1 and x.status = 'lost' and x.lost_reason = 'moved_to_another_pipeline'
              and x.source_metadata->'movido_para'->>'lead_id' = k.id::text
              and (x.owner_user_id is distinct from k.owner_user_id or x.sdr_user_id is distinct from k.owner_user_id)
           returning x.id),
         t as (
           update public.crm_tasks tk set assigned_to = k.owner_user_id
             from clones k
            where tk.organization_id = $1 and tk.status <> 'done'
              and tk.assigned_to is not null and tk.assigned_to is distinct from k.owner_user_id
              and tk.created_at <= k.created_at
              and (tk.lead_id = k.id
                   or tk.lead_id in (select x2.id from public.crm_leads x2
                                      where x2.organization_id = $1 and x2.status = 'lost'
                                        and x2.lost_reason = 'moved_to_another_pipeline'
                                        and x2.source_metadata->'movido_para'->>'lead_id' = k.id::text))
           returning tk.id)
         select (select count(*) from g)::int as guardioes, (select count(*) from o)::int as originais,
                (select count(*) from t)::int as tarefas`;

export const P = "b19601aa";
export const ORG = `${P}-0000-4000-8000-000000000001`;
export const OUTRA_ORG = `${P}-0000-4000-8000-000000000002`;
export const ADMIN = `${P}-1111-4000-8000-000000000001`;
export const FU = `${P}-1111-4000-8000-000000000002`; // SDR de Follow-up
export const VEND = `${P}-1111-4000-8000-000000000003`;
export const VEND2 = `${P}-1111-4000-8000-000000000004`;
const ENT = `${P}-2222-4000-8000-000000000001`;
const ENT_ETAPA = `${P}-2222-4000-8000-000000000002`;
export const FUNIL_FU = `${P}-2222-4000-8000-000000000003`;
const FU_ETAPA = `${P}-2222-4000-8000-000000000004`;
const OUTRA_ENT = `${P}-2222-4000-8000-000000000005`;
const OUTRA_ETAPA = `${P}-2222-4000-8000-000000000006`;

const L = (n: number) => `${P}-3333-4000-8000-${String(n).padStart(12, "0")}`;
const T = (n: number) => `${P}-4444-4000-8000-${String(n).padStart(12, "0")}`;

// Os clones do Follow-up (C*) e os leads que apontam para eles (O*).
export const C1 = L(1); // clone novo, dono FU, guardião nulo (g corrige)
const C2 = L(2); // clone novo, dono FU, guardião já FU
const C_VELHO = L(3); // clone de 40 dias: fora da janela de 30
const C_VEND = L(4); // clone com dono que NÃO é SDR de Follow-up
export const O1 = L(11); // original lost moved -> C1, dono VEND (o corrige)
const O2 = L(12); // original lost moved -> C2, dono e guardião já FU
const O_VELHO = L(13); // original -> C_VELHO
const O_VEND = L(14); // original -> C_VEND
export const O_OUTRO_MOTIVO = L(15); // lost por outro motivo, aponta C1
const O_ABERTO = L(16); // aberto, aponta C1
const SOLTO = L(17); // lead qualquer, sem passagem
const O_OUTRA_ORG = L(18); // de outra org, aponta C1

export type Caso = { id: string; lead: string; quem: string | null; status: string; criada: string; move: boolean };
// criada: relativa à passagem do clone (o clone nasce em now() - 2 dias)
export const TAREFAS: Caso[] = [
  { id: T(1), lead: C1, quem: VEND, status: "pending", criada: "3 days", move: true }, // no clone, antes: move
  { id: T(2), lead: O1, quem: VEND, status: "pending", criada: "3 days", move: true }, // no original, antes: move
  { id: T(3), lead: O1, quem: VEND, status: "done", criada: "3 days", move: false }, // feita: fica
  { id: T(4), lead: O1, quem: null, status: "pending", criada: "3 days", move: false }, // sem ninguém: fica
  { id: T(5), lead: O1, quem: FU, status: "pending", criada: "3 days", move: false }, // já do SDR: fica
  { id: T(6), lead: O1, quem: VEND, status: "pending", criada: "1 day", move: false }, // criada DEPOIS: fica
  { id: T(7), lead: C1, quem: VEND2, status: "pending", criada: "1 day", move: false }, // no clone, depois: fica
  { id: T(8), lead: O2, quem: VEND2, status: "pending", criada: "3 days", move: true }, // no original de C2: move
  { id: T(9), lead: C2, quem: VEND, status: "cancelled", criada: "3 days", move: true }, // cancelada não é 'done': move
  { id: T(10), lead: O_VELHO, quem: VEND, status: "pending", criada: "41 days", move: false }, // clone fora da janela
  { id: T(11), lead: O_VEND, quem: VEND2, status: "pending", criada: "3 days", move: false }, // clone sem SDR de FU
  { id: T(12), lead: O_OUTRO_MOTIVO, quem: VEND, status: "pending", criada: "3 days", move: false }, // outro motivo
  { id: T(13), lead: O_ABERTO, quem: VEND, status: "pending", criada: "3 days", move: false }, // original aberto
  { id: T(14), lead: SOLTO, quem: VEND, status: "pending", criada: "3 days", move: false }, // sem passagem
];

const lit = (s: string | null) => (s === null ? "null" : `'${s}'`);
export const comParametros = (q: string) => q.replaceAll("$1", `'${ORG}'`).replaceAll("$2", `'${FUNIL_FU}'`);

/** As 2 fotos depois do SQL: os leads (id:dono:guardião) e as tarefas (id:assigned_to) das 2 orgs, 1 linha cada. */
export const FOTOS_SQL = `
    select string_agg(id::text || ':' || coalesce(owner_user_id::text, '-') || ':' || coalesce(sdr_user_id::text, '-'), ',' order by id)
      from public.crm_leads where organization_id in ('${ORG}', '${OUTRA_ORG}');
    select string_agg(id::text || ':' || coalesce(assigned_to::text, '-'), ',' order by id)
      from public.crm_tasks where organization_id in ('${ORG}', '${OUTRA_ORG}');`;

/** A semente inteira (auth.users, org, membros, funis, etapas, leads e tarefas), como SQL. */
export function sementeSql(): string {
  const lead = (id: string, org: string, funil: string, etapa: string, dono: string | null, sdr: string | null, status: string,
    motivo: string | null, criado: string, aponta: string | null) =>
    `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, source, owner_user_id, sdr_user_id, status, lost_reason,
       created_at, closed_at, source_metadata)
     values ('${id}', '${org}', '${funil}', '${etapa}', 'inv ${id.slice(-4)}', 'whatsapp', ${lit(dono)}, ${lit(sdr)}, '${status}', ${lit(motivo)},
       now() - interval '${criado}', ${status === "open" ? "null" : `now() - interval '${criado}'`},
       ${aponta ? `jsonb_build_object('movido_para', jsonb_build_object('lead_id', '${aponta}'))` : "'{}'::jsonb"});`;
  return `
    insert into auth.users (id, email) values
      ('${ADMIN}', 'v19601-admin@invariant.test'), ('${FU}', 'v19601-fu@invariant.test'),
      ('${VEND}', 'v19601-v1@invariant.test'), ('${VEND2}', 'v19601-v2@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'v19601-inv', 'V19601', 'V19601'), ('${OUTRA_ORG}', 'v19601-inv-2', 'V19601b', 'V19601b')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN}', '${ORG}', 'admin', now()), ('${FU}', '${ORG}', 'agent', now()),
      ('${VEND}', '${ORG}', 'agent', now()), ('${VEND2}', '${ORG}', 'agent', now())
      on conflict do nothing;
    update public.user_organizations set interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"sdr_followup"}'::jsonb
     where organization_id = '${ORG}' and user_id = '${FU}';
    update public.user_organizations set interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"vendedor"}'::jsonb
     where organization_id = '${ORG}' and user_id in ('${VEND}', '${VEND2}');
    -- (comparar 23:38Z) a org nova já ganha um funil padrão (uniq_crm_pipelines_org_default): os daqui não são o padrão
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values
      ('${ENT}', '${ORG}', 'Entrada', 'v19601-ent', false), ('${FUNIL_FU}', '${ORG}', 'Follow-up', 'v19601-fu', false),
      ('${OUTRA_ENT}', '${OUTRA_ORG}', 'Entrada', 'v19601-ent-2', false)
      on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${ENT_ETAPA}', '${ORG}', '${ENT}', 'Novo', 'v19601-novo', 1000),
      ('${FU_ETAPA}', '${ORG}', '${FUNIL_FU}', 'd03-10', 'v19601-d03-10', 1000),
      ('${OUTRA_ETAPA}', '${OUTRA_ORG}', '${OUTRA_ENT}', 'Novo', 'v19601-novo-2', 1000)
      on conflict (id) do nothing;
    ${lead(C1, ORG, FUNIL_FU, FU_ETAPA, FU, null, "open", null, "2 days", null)}
    ${lead(C2, ORG, FUNIL_FU, FU_ETAPA, FU, FU, "open", null, "2 days", null)}
    ${lead(C_VELHO, ORG, FUNIL_FU, FU_ETAPA, FU, null, "open", null, "40 days", null)}
    ${lead(C_VEND, ORG, FUNIL_FU, FU_ETAPA, VEND, null, "open", null, "2 days", null)}
    ${lead(O1, ORG, ENT, ENT_ETAPA, VEND, null, "lost", "moved_to_another_pipeline", "5 days", C1)}
    ${lead(O2, ORG, ENT, ENT_ETAPA, FU, FU, "lost", "moved_to_another_pipeline", "5 days", C2)}
    ${lead(O_VELHO, ORG, ENT, ENT_ETAPA, VEND, null, "lost", "moved_to_another_pipeline", "45 days", C_VELHO)}
    ${lead(O_VEND, ORG, ENT, ENT_ETAPA, VEND2, null, "lost", "moved_to_another_pipeline", "5 days", C_VEND)}
    ${lead(O_OUTRO_MOTIVO, ORG, ENT, ENT_ETAPA, VEND, null, "lost", "no_response", "5 days", C1)}
    ${lead(O_ABERTO, ORG, ENT, ENT_ETAPA, VEND, null, "open", null, "5 days", C1)}
    ${lead(SOLTO, ORG, ENT, ENT_ETAPA, VEND, null, "open", null, "5 days", null)}
    ${lead(O_OUTRA_ORG, OUTRA_ORG, OUTRA_ENT, OUTRA_ETAPA, null, null, "lost", "moved_to_another_pipeline", "5 days", C1)}
  ` +
    TAREFAS.map(
      (t) => `insert into public.crm_tasks (id, organization_id, title, lead_id, assigned_to, due_date, status, created_at)
              values ('${t.id}', '${ORG}', 'inv', '${t.lead}', ${lit(t.quem)}, now() + interval '1 day', '${t.status}', now() - interval '${t.criada}');`,
    ).join("\n");
}

/** O assigned_to esperado de cada tarefa depois do passo 6 (id:quem), na ordem do id, como a foto. */
export function tarefasEsperadas(): string {
  return [...TAREFAS].sort((x, y) => x.id.localeCompare(y.id)).map((t) => `${t.id}:${t.move ? FU : (t.quem ?? "-")}`).join(",");
}

/** O retorno esperado (guardioes|originais|tarefas): g = C1; o = O1; t = T1, T2, T8, T9. */
export const RETORNO_ESPERADO = "1|1|4";

