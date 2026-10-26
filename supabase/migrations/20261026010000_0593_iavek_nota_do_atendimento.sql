-- manifest: ia.vek v1.8.4 — nota do atendimento do vendedor feita pela IA a cada Fechar (tabela iavek_notas_de_atendimento, só gerente/admin leem), preço do claude-haiku-5-5 no catálogo, tipo de invocação novo, e "Contexto completo" aceita a Descrição do lead com 20+ letras
--
-- POR QUÊ (pedido do Rodrigo, 24/10/2026; desenho aprovado pelo Maestro):
--   · Quando o VENDEDOR clica em Fechar, um avaliador separado (sem ferramentas,
--     sem canal de envio — nunca fala com o lead) lê aquele atendimento e dá uma
--     nota de 0 a 10, com pontos fortes, pontos a melhorar e um trecho que
--     justifica. Critérios editáveis no Acervo. Só gerente e admin veem. A chave
--     (organizations.settings.iavek.nota_do_atendimento.ativo) nasce DESLIGADA.
--   · O fechamento roda com a chave de serviço (fn_service_status), então quem
--     emite o evento `conversation.closed` é a ROTA, que sabe quem fechou — não
--     um gatilho (auth.uid() seria nulo).
--   · O modelo é o claude-haiku-5-5. Sem a linha de preço, o custo gravado seria
--     zero e o teto de gasto não enxergaria a nota. Preço oficial da Anthropic
--     (conferido em 26/10/2026): US$0,10 por milhão de entrada e US$0,50 por
--     milhão de saída, para pedidos até 100 mil tokens — 10 e 50 centavos.
--   · "Contexto completo" (0590/0591) só contava nota interna numa conversa do
--     contato: lead sem conversa nunca cumpria, e o vendedor que escreveu o
--     contexto na Descrição não via contar (achado do Maestro no canário).
--
-- ADITIVA: tabela nova (nasce vazia), uma linha no catálogo e uma no preço,
-- um valor a mais no CHECK de ai_invocations (só alarga), uma função trocada
-- (create or replace) e um gatilho novo de LGPD. Nenhum dado existente muda.

-- ---- 1. o claude-haiku-5-5 no catálogo e no preço ----
insert into public.ai_models
  (provider, model_id, display_name, description, context_window,
   input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider)
values
  ('anthropic', 'claude-haiku-5-5', 'Claude Haiku 5.5',
   'O Haiku mais novo: barato e rápido, para classificação e avaliação.', 1000000, 10, 50, true, false)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools;

insert into public.ai_pricing
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
values
  ('claude-haiku-5-5', 10, 50, 'ia.vek 0593 — preço oficial até 100 mil tokens por pedido (acima: 50/250)')
on conflict (model) do update set
  prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
  completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
  notes = excluded.notes,
  superseded_at = null;

-- ---- 2. o tipo de invocação novo (espelha InvocationKind de lib/ai/log-invocation.ts) ----
alter table public.ai_invocations drop constraint if exists ai_invocations_invocation_kind_check;
alter table public.ai_invocations add constraint ai_invocations_invocation_kind_check
  check (invocation_kind = any (array['bot_respond', 'sentiment_classify', 'triage_classify', 'embedding_generate', 'iavek_nota_atendimento']));

-- ---- 3. as notas ----
create table if not exists public.iavek_notas_de_atendimento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  -- quem atendeu (o avaliado) e quem clicou em Fechar
  vendedor_user_id uuid references auth.users(id) on delete set null,
  fechado_por_user_id uuid references auth.users(id) on delete set null,
  -- o evento do Fechar que gerou esta nota: reprocessar o mesmo evento não duplica
  event_id uuid not null,
  nota numeric(3,1) not null check (nota >= 0 and nota <= 10),
  pontos_fortes text[] not null default '{}',
  pontos_a_melhorar text[] not null default '{}',
  trecho text,
  etapa_nome text,
  desde timestamptz,
  ate timestamptz not null,
  mensagens_avaliadas int not null default 0,
  modelo text not null,
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  custo_cents numeric(12,6) not null default 0,
  criterios_do_acervo boolean not null default false,
  created_at timestamptz not null default now(),
  constraint iavek_notas_de_atendimento_evento_unico unique (organization_id, event_id)
);

create index if not exists iavek_notas_de_atendimento_semana_idx
  on public.iavek_notas_de_atendimento (organization_id, created_at desc);
create index if not exists iavek_notas_de_atendimento_vendedor_idx
  on public.iavek_notas_de_atendimento (organization_id, vendedor_user_id, created_at desc);
create index if not exists iavek_notas_de_atendimento_conversa_idx
  on public.iavek_notas_de_atendimento (conversation_id, created_at desc);

alter table public.iavek_notas_de_atendimento enable row level security;

-- Quem lê: gerente e admin da organização. O vendedor NÃO lê (nem a própria —
-- chave futura do Rodrigo). Quem escreve: só o servidor (worker, service_role).
drop policy if exists iavek_notas_de_atendimento_select on public.iavek_notas_de_atendimento;
create policy iavek_notas_de_atendimento_select on public.iavek_notas_de_atendimento
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'manager'));

revoke all on table public.iavek_notas_de_atendimento from anon, authenticated;
grant select on table public.iavek_notas_de_atendimento to authenticated;
grant all on table public.iavek_notas_de_atendimento to service_role;

-- ---- 4. LGPD: anonimizar o contato apaga o texto das notas dele ----
-- A nota (o número) fica: é dado do VENDEDOR. Os textos saem, porque citam o
-- atendimento daquele cliente.
create or replace function public.fn_iavek_redigir_notas_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.iavek_notas_de_atendimento
     set trecho = null,
         pontos_fortes = '{}',
         pontos_a_melhorar = '{}'
   where organization_id = new.organization_id
     and (contact_id = new.id
          or conversation_id in (select c.id from public.conversations c
                                  where c.contact_id = new.id and c.organization_id = new.organization_id))
     and (trecho is not null or pontos_fortes <> '{}' or pontos_a_melhorar <> '{}');
  return new;
end;
$$;
revoke execute on function public.fn_iavek_redigir_notas_ao_anonimizar() from public, anon, authenticated;

drop trigger if exists trg_iavek_redigir_notas_ao_anonimizar on public.contacts;
create trigger trg_iavek_redigir_notas_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and old.is_anonymized is distinct from true)
  execute function public.fn_iavek_redigir_notas_ao_anonimizar();

-- ---- 5. "Contexto completo" aceita a Descrição do lead (20+ letras) ----
create or replace function public.fn_iavek_campos_que_faltam_do_lead(l public.crm_leads)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when char_length(btrim(coalesce(l.description, ''))) >= 20
           or exists (select 1 from public.conversation_notes n join public.conversations c on c.id = n.conversation_id
                       where c.contact_id = l.contact_id and c.organization_id = l.organization_id)
           or exists (select 1 from public.lead_notes ln where ln.contact_id = l.contact_id and ln.organization_id = l.organization_id)
         then null else 'Contexto completo' end,
    case when coalesce(array_length(l.tags, 1), 0) > 0
           or exists (select 1 from public.contacts k where k.id = l.contact_id and coalesce(array_length(k.tags, 1), 0) > 0)
         then null else 'Tags de acompanhamento' end,
    case when l.stage_id is not null then null else 'Fase do funil' end,
    case when l.sdr_user_id is not null
           or (l.owner_user_id is not null
               and coalesce(public.fn_iavek_funcao_do_membro(l.organization_id, l.owner_user_id), '') = 'sdr')
         then null else 'Guardião responsável' end,
    case when l.owner_user_id is not null then null else 'Vendedor responsável' end,
    case when nullif(btrim(coalesce(l.custom_fields->>'carro_interesse', '')), '') is not null then null else 'Carro de interesse' end,
    case when coalesce(l.custom_fields->>'parcela_desejavel', '') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
              and replace(l.custom_fields->>'parcela_desejavel', ',', '.')::numeric > 0
         then null else 'Parcela desejável' end
  ], null)
  -- Só responde por lead da organização de quem pergunta (sessão); o serviço vê todos.
  where auth.uid() is null or l.organization_id in (select public.fn_user_org_ids());
$$;
revoke execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) from public, anon;
grant execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) to authenticated, service_role;
