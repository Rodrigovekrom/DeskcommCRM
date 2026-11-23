-- manifest: ia.vek CRM-434 (0652) — quando um gerente ou admin responde ao cliente de outra pessoa, o DONO do lead ganha 1 aviso no sino ("respondeu o seu cliente")
--
-- POR QUÊ (Rodrigo, 17/11, regra FINAL em Maestro 195310/195351): o dono do lead precisa saber que a gerência falou com
-- o cliente dele. Desenho D3 (docs-iavek-desenhos/D3-crm434-respondeu-o-seu-cliente.md; verde da Lupa 130008 no
-- 3e19b1eb, com as condições 1 a 3).
--
-- A REGRA:
--   - dispara numa mensagem de SAÍDA escrita por uma PESSOA (o WHEN da 0640: outbound, sent_via 'user',
--     sent_by_user_id não nulo), fora de conversa de grupo;
--   - quem escreveu é gerente ou admin ATIVO da org (user_organizations.role in manager/admin, revoked_at nulo — o mesmo
--     que rank >= manager; o admin da plataforma, que não é membro, fica de fora). É lido do AUTOR, não do auth.uid():
--     o worker manda pelo service_role;
--   - o lead é o negócio ATIVO do contato, com o critério EXATO de resolveActiveLeadForContact
--     (lib/leads/active-lead.ts) e dos chamadores: abertos (status='open'); 1 só = ele; senão os do funil padrão
--     (is_default e não arquivado, limit 1) se houver algum, senão todos; o de maior coalesce(last_activity_at,
--     created_at); empate no topo = nenhum;
--   - o aviso vai ao DONO (owner_user_id), se ele for membro ATIVO e não for o autor, e se o autor não for o
--     sdr_user_id do lead (o guardião nunca dispara);
--   - janela: no máximo 1 aviso por conversa e dono a cada 10 min, lida pelo índice que já existe
--     (notificacoes_por_pessoa_idx: user_id, organization_id, created_at desc — 0579);
--   - sem o texto, sem não lidas, sem espera, sem push. Sem destinatário = SILÊNCIO.
-- NUNCA derruba a mensagem: tudo num bloco com exception, e a falha vira um WARNING no log do Postgres só com o SQLSTATE
-- e o id da mensagem (sem dado de cliente). Só leituras por índice, sem laço (o 'when others' não pega o
-- query_canceled de um statement_timeout).
-- LIMITE CONHECIDO: a resposta mandada do celular (sent_via external_device, sem sent_by_user_id) não avisa — o mesmo
-- WHEN da 0640.
-- ADITIVA: 1 função e 1 gatilho novos; o check do sino recriado com as 23 de hoje (0629 + 0651) mais 'resposta_de_outro'.
-- Volta: voltar-0652.sql (ops).

-- ---- 1. o sino: as 21 da 0629, as 2 da 0651 e o tipo novo ----
alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'lead_passado',
  'guardiao_etapa',
  'guardiao_ganho',
  'guardiao_perda',
  'guardiao_tarefa_vencida',
  'tarefa_vencida',
  'proposta_aguardando_aprovacao',
  'proposta_aprovada',
  'proposta_devolvida',
  'pedido_de_agendamento',
  'pedido_de_agendamento_confirmado',
  'pedido_de_agendamento_recusado',
  'ficha_enviada',
  'ficha_decidida',
  'agendamento_para_voce',
  'lead_devolvido',
  'lead_retirado',
  'lead_reativado',
  'aviso_da_loja',
  'ia_travou',
  'agendamento_no_seu_lead',
  'orientacao_da_loja',
  'novidade_da_versao',
  -- ia.vek CRM-434 (migration 0652): um gerente ou admin respondeu o cliente deste dono.
  'resposta_de_outro'
));

-- ---- 2. o gatilho ----
create or replace function public.fn_iavek_avisa_resposta_de_outro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_janela constant interval := interval '10 minutes';
  v_conversa record;
  v_padrao uuid;
  v_lead record;
  v_empate integer;
begin
  begin
    if new.conversation_id is null then return null; end if;

    select c.id, c.organization_id, c.contact_id, c.is_group into v_conversa
      from public.conversations c
     where c.id = new.conversation_id and c.organization_id = new.organization_id;
    if not found or v_conversa.is_group or v_conversa.contact_id is null then return null; end if;

    -- quem escreveu: gerente ou admin ATIVO desta org.
    if not exists (
      select 1 from public.user_organizations uo
       where uo.organization_id = new.organization_id
         and uo.user_id = new.sent_by_user_id
         and uo.revoked_at is null
         and uo.role in ('manager', 'admin')
    ) then
      return null;
    end if;

    -- o funil padrão (o mesmo limit 1 dos chamadores de resolveActiveLeadForContact).
    select p.id into v_padrao
      from public.crm_pipelines p
     where p.organization_id = new.organization_id and p.is_default = true and p.is_archived = false
     limit 1;

    -- o lead ativo: abertos; os do funil padrão se houver algum, senão todos; o de maior atividade.
    with abertos as (
      select l.id, l.owner_user_id, l.sdr_user_id, l.pipeline_id,
             coalesce(l.last_activity_at, l.created_at) as atividade
        from public.crm_leads l
       where l.organization_id = new.organization_id
         and l.contact_id = v_conversa.contact_id
         and l.status = 'open'
    ), pool as (
      select a.* from abertos a
       where v_padrao is null
          or a.pipeline_id = v_padrao
          or not exists (select 1 from abertos b where b.pipeline_id = v_padrao)
    )
    select p.id, p.owner_user_id, p.sdr_user_id, p.atividade,
           (select count(*) from pool q where q.atividade is not distinct from p.atividade) as empatados
      into v_lead
      from pool p
     order by p.atividade desc nulls last
     limit 1;
    if not found then return null; end if;
    -- empate no topo (com 2+ no pool): ambíguo, não avisa. Um lead só nunca é empate.
    if v_lead.empatados > 1 then return null; end if;

    -- o dono: existe, é membro ativo, não é quem escreveu; quem escreveu não é o guardião do lead.
    if v_lead.owner_user_id is null
       or v_lead.owner_user_id = new.sent_by_user_id
       or v_lead.sdr_user_id is not distinct from new.sent_by_user_id then
      return null;
    end if;
    if not exists (
      select 1 from public.user_organizations uo
       where uo.organization_id = new.organization_id
         and uo.user_id = v_lead.owner_user_id
         and uo.revoked_at is null
    ) then
      return null;
    end if;

    -- a janela: 1 por conversa e dono a cada 10 min (o índice da 0579 por user_id, organization_id, created_at).
    if exists (
      select 1 from public.notificacoes n
       where n.user_id = v_lead.owner_user_id
         and n.organization_id = new.organization_id
         and n.created_at > now() - v_janela
         and n.tipo = 'resposta_de_outro'
         and n.dados->>'conversation_id' = new.conversation_id::text
    ) then
      return null;
    end if;

    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id, dados)
    values (new.organization_id, v_lead.owner_user_id, 'resposta_de_outro', v_lead.id, new.sent_by_user_id,
            jsonb_build_object('conversation_id', new.conversation_id));
  exception when others then
    -- sem dado de cliente: só o código do erro e o id da mensagem.
    raise warning 'fn_iavek_avisa_resposta_de_outro (0652): SQLSTATE % (mensagem %)', sqlstate, new.id;
  end;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_avisa_resposta_de_outro() from public, anon, authenticated;

drop trigger if exists trg_iavek_avisa_resposta_de_outro on public.messages;
create trigger trg_iavek_avisa_resposta_de_outro
  after insert on public.messages
  for each row
  when (new.direction = 'outbound' and new.sent_via::text = 'user' and new.sent_by_user_id is not null)
  execute function public.fn_iavek_avisa_resposta_de_outro();

notify pgrst, 'reload schema';
