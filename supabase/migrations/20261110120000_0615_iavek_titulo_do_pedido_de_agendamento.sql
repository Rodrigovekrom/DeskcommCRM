-- manifest: ia.vek v1.9.38 (0615, CRM-256) — `iavek_pedidos_de_agendamento.titulo`: o título próprio que o SDR escreve ao pedir ou marcar pelo cartão do lead; quando o pedido vira compromisso, o compromisso nasce com ESSE título (sem ele, o nome do tipo, como sempre)
--
-- POR QUÊ: "pode criar do jeito que quiser" (Rodrigo, 10/11). A Agenda ganhou o campo Título na v1.9.38
-- (a coluna `calendar_appointments.title` já existia). Na Fenômenos, porém, o SDR marca pelo cartão do
-- lead (`PedirAgendamento`), que grava um PEDIDO; o compromisso só nasce quando o admin confirma (ou na
-- hora, para o SDR que marca direto). Sem esta coluna o título se perderia entre o pedido e o compromisso.
--
-- ADITIVA E ANULÁVEL: nenhuma linha existente muda; os pedidos de antes ficam com `titulo` nulo e
-- seguem nascendo com o nome do tipo (`tituloDoCompromisso` em lib/iavek/pedidos-de-agendamento.ts).
-- Mesmo teto da coluna do compromisso e da API (200). Sem função, sem policy, sem índice.
-- Idempotente (add column if not exists; a constraint só entra se ainda não existir).
-- Volta: voltar-0615.sql (drop column, que leva a constraint junto).

alter table public.iavek_pedidos_de_agendamento add column if not exists titulo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'iavek_pedidos_titulo_tamanho'
       and conrelid = 'public.iavek_pedidos_de_agendamento'::regclass
  ) then
    alter table public.iavek_pedidos_de_agendamento
      add constraint iavek_pedidos_titulo_tamanho check (titulo is null or length(titulo) between 1 and 200);
  end if;
end
$$;

comment on column public.iavek_pedidos_de_agendamento.titulo is
  'ia.vek v1.9.38 (CRM-256): título próprio do compromisso que o pedido vira. Nulo = o nome do tipo.';

notify pgrst, 'reload schema';
