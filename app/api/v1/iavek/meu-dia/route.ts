/**
 * ia.vek v1.6 (parte B): os dados do "Meu dia" de cada FUNÇÃO.
 *
 *   GET /api/v1/iavek/meu-dia?funcao=sdr|vendedor|gerente
 *
 * Só leitura, com o cliente da SESSÃO (RLS) e `organization_id` à mão em toda
 * consulta. A função vem da tela (é o que a pessoa está VENDO, inclusive no
 * "Ver como"); ela não abre dado nenhum: o que a RLS e o papel não deixam ler,
 * não volta. A meta de agendamentos do dia mora em
 * `organizations.settings.iavek.meta_agendamentos_dia` (sem migration).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { capacidadePorHorario } from "@/lib/iavek/capacidade-da-agenda";
import { cronometroDoLead, entradaDaEsteira } from "@/lib/iavek/cronometro-72h";
import { FUNCOES, funcaoDaTela } from "@/lib/iavek/funcoes";
import {
  atrasosPorPessoa,
  limitesDoDia,
  perdasPorMotivo,
  porPrazo,
  tarefasPorPessoa,
} from "@/lib/iavek/meu-dia";
import { SOURCE_KIND_PROXIMO_PASSO } from "@/lib/iavek/proximo-passo";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const querySchema = z.object({ funcao: z.enum(FUNCOES) });
const DIA = 86_400_000;
const CONTATO = "contacts(name, display_name, phone_number)";
const TAREFA = `id, title, due_date, status, source_kind, contact_id, lead_id, assigned_to, ${CONTATO}`;

type Supa = Awaited<ReturnType<typeof createClient>>;

interface LinhaComContato {
  contacts?: {
    name?: string | null;
    display_name?: string | null;
    phone_number?: string | null;
  } | null;
}

function semEmbed<T extends LinhaComContato>(linha: T) {
  const { contacts, ...resto } = linha;
  const c = Array.isArray(contacts) ? (contacts[0] ?? null) : (contacts ?? null);
  return { ...resto, contato_nome: c ? rotuloDoContato(c) : null };
}

/** A conversa mais recente de cada contato, para o atalho "abrir a conversa". */
async function conversasDos(
  supabase: Supa,
  orgId: string,
  contactIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(contactIds.filter((c): c is string => Boolean(c)))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("conversations")
    .select("id, contact_id, last_message_at")
    .eq("organization_id", orgId)
    .in("contact_id", ids)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(500);
  const mapa = new Map<string, string>();
  for (const c of data ?? [])
    if (c.contact_id && !mapa.has(c.contact_id)) mapa.set(c.contact_id, c.id);
  return mapa;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return fail("validation_failed", "Função inválida.", 422, { requestId });
  // v1.7.5: "apoio" é apelido de gerente — o dia é o do gerente.
  const funcao = funcaoDaTela(parsed.data.funcao) ?? parsed.data.funcao;

  const orgId = authz.org.orgId;
  const eu = authz.user.id;
  const fuso = authz.org.timezone || "America/Sao_Paulo";
  const agora = new Date();
  const { inicio, fim } = limitesDoDia(agora, fuso);
  const supabase = await createClient();

  const { data: org, error: erroOrg } = await createAdminClient()
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (erroOrg) return fail("internal_error", erroOrg.message, 500, { requestId });
  const settings = (org?.settings ?? {}) as Record<string, unknown>;
  const entrada = entradaDaEsteira(settings);
  const meta = Number(
    (settings.iavek as { meta_agendamentos_dia?: unknown } | undefined)?.meta_agendamentos_dia,
  );
  const metaDoDia = Number.isFinite(meta) && meta > 0 ? meta : null;

  /** Leads abertos no funil de entrada, com o prazo das 72h (fora de compromisso). */
  async function leadsComPrazo(limite: number) {
    if (!entrada) return [];
    const { data, error } = await supabase
      .from("crm_leads")
      .select(
        `id, title, status, pipeline_id, stage_id, created_at, contact_id, owner_user_id, ${CONTATO}`,
      )
      .eq("organization_id", orgId)
      .eq("pipeline_id", entrada.pipeline_id)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(limite);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((l) => {
        const cron = cronometroDoLead(l, entrada);
        return cron ? { ...semEmbed(l as LinhaComContato & typeof l), fim_em: cron.fim_em } : null;
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }

  async function tarefas(
    filtro: "ligacoes" | "proximos_passos",
    soMinhas: boolean,
    ate: Date | null,
  ) {
    let q = supabase
      .from("crm_tasks")
      .select(TAREFA)
      .eq("organization_id", orgId)
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(50);
    q =
      filtro === "ligacoes"
        ? q.like("source_kind", "ligacao:%")
        : q.eq("source_kind", SOURCE_KIND_PROXIMO_PASSO);
    if (soMinhas) q = q.eq("assigned_to", eu);
    if (ate) q = q.lt("due_date", ate.toISOString());
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((t) => semEmbed(t as LinhaComContato & typeof t));
  }

  try {
    // ia.vek v1.7: SDR e Vendedor têm a MESMA visão; muda só QUAIS leads entram.
    // "Meus leads" = os que eu sou dono OU guardião (SDR que passou adiante).
    // O SDR ganha, além disso, a fila dos leads novos das 72h e a meta do dia.
    // v1.7.1: o SDR de suporte tem o dia do SDR (com a fila das 72h); o
    // Gerente de apoio, o do vendedor — até a v1.7.5, quando virou o gerente.
    if (funcao === "sdr" || funcao === "suporte" || funcao === "vendedor") {
      const ehSdr = funcao === "sdr" || funcao === "suporte";
      const [agenda, meus, ligacoes, passos, propostas, novos, agendadosHoje] = await Promise.all([
        supabase
          .from("calendar_appointments")
          .select(`id, title, starts_at, ends_at, status, contact_id, conversation_id, ${CONTATO}`)
          .eq("organization_id", orgId)
          .eq("owner_user_id", eu)
          .neq("status", "cancelled")
          .gte("starts_at", inicio.toISOString())
          .lt("starts_at", fim.toISOString())
          .order("starts_at", { ascending: true })
          .limit(30),
        supabase
          .from("crm_leads")
          .select(
            `id, title, status, updated_at, contact_id, owner_user_id, sdr_user_id, crm_stages!crm_leads_stage_id_fkey(name), ${CONTATO}`,
          )
          .eq("organization_id", orgId)
          .eq("status", "open")
          .or(`owner_user_id.eq.${eu},sdr_user_id.eq.${eu}`)
          .order("updated_at", { ascending: false })
          .limit(50),
        tarefas("ligacoes", true, fim),
        tarefas("proximos_passos", true, null),
        supabase
          .from("crm_proposals")
          .select(
            `id, titulo, status, total_cents, moeda, valid_until, contact_id, lead_id, ${CONTATO}`,
          )
          .eq("organization_id", orgId)
          // v1.7.6: as que eu enviei e as que eu pedi para o gerente aprovar.
          .or(`sent_by_user_id.eq.${eu},aprovacao_pedida_por.eq.${eu}`)
          .in("status", ["rascunho", "aguardando_aprovacao", "enviando", "enviada"])
          .order("updated_at", { ascending: false })
          .limit(30),
        ehSdr ? leadsComPrazo(200) : Promise.resolve([]),
        // v1.7.6: a meta conta os PEDIDOS DESTE SDR que o admin confirmou hoje
        // (o SDR não marca mais direto; pedido recusado ou pendente não conta).
        ehSdr
          ? supabase
              .from("iavek_pedidos_de_agendamento")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .eq("pedido_por", eu)
              .eq("status", "confirmado")
              .gte("decidido_em", inicio.toISOString())
              .lt("decidido_em", fim.toISOString())
          : Promise.resolve({ count: 0, error: null }),
      ]);
      const falha = agenda.error ?? meus.error ?? propostas.error ?? agendadosHoje.error;
      if (falha) throw new Error(falha.message);

      const leadsLimpos = (meus.data ?? []).map((l) => {
        const {
          crm_stages,
          owner_user_id,
          sdr_user_id: _guardiao,
          ...resto
        } = l as typeof l & {
          crm_stages?: unknown;
          owner_user_id: string | null;
          sdr_user_id: string | null;
        };
        const etapa = Array.isArray(crm_stages) ? crm_stages[0] : crm_stages;
        return {
          ...semEmbed(resto as LinhaComContato & typeof resto),
          etapa: (etapa as { name?: string } | null)?.name ?? null,
          papel: owner_user_id === eu ? ("dono" as const) : ("guardiao" as const),
          dono_id: owner_user_id,
        };
      });

      // Para os leads que eu GUARDO: quem é o dono agora e qual o próximo passo
      // dele (o que o guardião acompanha e cobra).
      const guardados = leadsLimpos.filter((l) => l.papel === "guardiao");
      const passosDosGuardados = new Map<string, { title: string; due_date: string | null }>();
      if (guardados.length > 0) {
        const { data } = await supabase
          .from("crm_tasks")
          .select("lead_id, title, due_date")
          .eq("organization_id", orgId)
          .eq("source_kind", SOURCE_KIND_PROXIMO_PASSO)
          .in("status", ["pending", "in_progress"])
          .in(
            "lead_id",
            guardados.map((l) => l.id),
          )
          .order("due_date", { ascending: true, nullsFirst: false });
        for (const t of data ?? []) {
          if (t.lead_id && !passosDosGuardados.has(t.lead_id)) {
            passosDosGuardados.set(t.lead_id, { title: t.title, due_date: t.due_date });
          }
        }
      }
      const nomesDosDonos = await nomesDosAtendentes(guardados.map((l) => l.dono_id));

      const conversas = await conversasDos(supabase, orgId, [
        ...leadsLimpos.map((l) => l.contact_id),
        ...ligacoes.map((t) => t.contact_id),
        ...passos.map((t) => t.contact_id),
        ...(propostas.data ?? []).map((p) => p.contact_id),
        ...novos.map((l) => l.contact_id),
      ]);
      const comConversa = <T extends { contact_id: string | null }>(x: T) => ({
        ...x,
        conversation_id: x.contact_id ? (conversas.get(x.contact_id) ?? null) : null,
      });

      return ok(
        {
          funcao,
          pessoal: {
            agendamentos: (agenda.data ?? []).map((a) => semEmbed(a as LinhaComContato & typeof a)),
            leads: leadsLimpos.map((l) => {
              const { dono_id, ...resto } = l;
              return comConversa({
                ...resto,
                dono_nome:
                  l.papel === "guardiao" && dono_id ? (nomesDosDonos.get(dono_id) ?? null) : null,
                proximo_passo_do_dono:
                  l.papel === "guardiao" ? (passosDosGuardados.get(l.id) ?? null) : null,
              });
            }),
            ligacoes: ligacoes.map(comConversa),
            proximos_passos: passos.map(comConversa),
            propostas: (propostas.data ?? []).map((p) =>
              comConversa(semEmbed(p as LinhaComContato & typeof p)),
            ),
          },
          ...(ehSdr
            ? {
                sdr: {
                  leads_novos: porPrazo(novos).slice(0, 30).map(comConversa),
                  agendamentos: { hoje: agendadosHoje.count ?? 0, meta: metaDoDia },
                },
              }
            : {}),
        },
        { requestId },
      );
    }

    // ── gerente ──────────────────────────────────────────────────────────────
    const desde30 = new Date(agora.getTime() - 30 * DIA).toISOString();
    const desde7 = new Date(agora.getTime() - 7 * DIA).toISOString();
    const [
      novosHoje,
      comPrazo,
      atrasadas,
      agendou,
      veio,
      comprou,
      perdidos,
      abertas,
      tarefasAbertas,
      tarefasFeitas,
    ] = await Promise.all([
      supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("created_at", inicio.toISOString())
        .lt("created_at", fim.toISOString()),
      leadsComPrazo(500),
      supabase
        .from("crm_tasks")
        .select("assigned_to, source_kind")
        .eq("organization_id", orgId)
        .in("status", ["pending", "in_progress"])
        .lt("due_date", agora.toISOString())
        .limit(1000),
      supabase
        .from("calendar_appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .neq("status", "cancelled")
        .gte("created_at", desde30),
      supabase
        .from("calendar_appointments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "completed")
        .gte("starts_at", desde30),
      supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "won")
        .gte("closed_at", desde30),
      supabase
        .from("crm_leads")
        .select("lost_reason")
        .eq("organization_id", orgId)
        .eq("status", "lost")
        .gte("closed_at", desde30)
        .limit(1000),
      supabase
        .from("conversations")
        .select("assigned_to_user_id")
        .eq("organization_id", orgId)
        .eq("status", "open")
        .eq("is_group", false)
        .limit(2000),
      // v1.7.5: as tarefas da equipe — todas as abertas e as feitas em 7 dias.
      supabase
        .from("crm_tasks")
        .select(TAREFA)
        .eq("organization_id", orgId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(1000),
      supabase
        .from("crm_tasks")
        .select(TAREFA)
        .eq("organization_id", orgId)
        .eq("status", "done")
        .gte("updated_at", desde7)
        .order("updated_at", { ascending: false })
        .limit(300),
    ]);
    const falha =
      novosHoje.error ??
      atrasadas.error ??
      agendou.error ??
      veio.error ??
      comprou.error ??
      perdidos.error ??
      abertas.error ??
      tarefasAbertas.error ??
      tarefasFeitas.error;
    if (falha) throw new Error(falha.message);

    const estourando = porPrazo(comPrazo).filter(
      (l) => new Date(l.fim_em).getTime() - agora.getTime() < DIA,
    );
    type LinhaDaTarefa = LinhaComContato & {
      id: string;
      title: string;
      due_date: string | null;
      status: string;
      source_kind: string | null;
      contact_id: string | null;
      assigned_to: string | null;
    };
    const tarefasDaEquipe = (
      [...(tarefasAbertas.data ?? []), ...(tarefasFeitas.data ?? [])] as unknown as LinhaDaTarefa[]
    ).map(semEmbed);
    const conversas = await conversasDos(supabase, orgId, [
      ...estourando.map((l) => l.contact_id),
      ...tarefasDaEquipe.map((t) => t.contact_id),
    ]);
    const porPessoa = atrasosPorPessoa(atrasadas.data ?? []);
    const resumoDasTarefas = tarefasPorPessoa(tarefasDaEquipe, agora);
    const nomes = await nomesDosAtendentes([
      ...porPessoa.map((p) => p.user_id),
      ...resumoDasTarefas.map((p) => p.user_id),
    ]);
    const nomeDe = (u: string | null) => (u ? (nomes.get(u) ?? null) : null);
    const comPessoa = (abertas.data ?? []).filter((c) => c.assigned_to_user_id).length;
    // v1.7.6: as propostas que os vendedores deixaram aguardando a aprovação.
    const { data: aguardando, error: erroAguardando } = await supabase
      .from("crm_proposals")
      .select("id, titulo, total_cents, moeda, lead_id, aprovacao_pedida_em, aprovacao_pedida_por, contacts(name, display_name)")
      .eq("organization_id", orgId)
      .eq("status", "aguardando_aprovacao")
      .order("aprovacao_pedida_em", { ascending: true })
      .limit(50);
    if (erroAguardando) throw new Error(erroAguardando.message);
    type LinhaAguardando = {
      id: string;
      titulo: string;
      total_cents: number;
      moeda: string;
      lead_id: string | null;
      aprovacao_pedida_em: string | null;
      aprovacao_pedida_por: string | null;
      contacts?: unknown;
    };
    const linhasAguardando = (aguardando ?? []) as unknown as LinhaAguardando[];
    const nomesDosPedintes = await nomesDosAtendentes(
      linhasAguardando.map((p) => p.aprovacao_pedida_por).filter((u): u is string => Boolean(u)),
    );

    return ok(
      {
        funcao,
        gerente: {
          leads_novos_hoje: novosHoje.count ?? 0,
          estourando: estourando.slice(0, 30).map((l) => ({
            ...l,
            conversation_id: l.contact_id ? (conversas.get(l.contact_id) ?? null) : null,
          })),
          atrasos_por_pessoa: porPessoa.map((p) => ({
            ...p,
            nome: p.user_id ? (nomes.get(p.user_id) ?? null) : null,
          })),
          funil_30d: {
            agendou: agendou.count ?? 0,
            veio: veio.count ?? 0,
            comprou: comprou.count ?? 0,
          },
          conversas_abertas: {
            com_pessoa: comPessoa,
            com_ia_ou_sem_dono: (abertas.data ?? []).length - comPessoa,
          },
          perdas_30d: perdasPorMotivo(perdidos.data ?? []),
          meta_agendamentos_dia: metaDoDia,
          agenda_capacidade_por_horario: capacidadePorHorario(settings),
          propostas_aguardando_aprovacao: linhasAguardando.map((p) => {
            const c = (Array.isArray(p.contacts) ? p.contacts[0] : p.contacts) as
              | { name?: string | null; display_name?: string | null }
              | null
              | undefined;
            return {
              id: p.id,
              titulo: p.titulo,
              total_cents: p.total_cents,
              moeda: p.moeda,
              lead_id: p.lead_id,
              pedida_em: p.aprovacao_pedida_em,
              vendedor_nome: p.aprovacao_pedida_por
                ? (nomesDosPedintes.get(p.aprovacao_pedida_por) ?? null)
                : null,
              contato_nome: c ? rotuloDoContato(c as never) : null,
            };
          }),
          tarefas_da_equipe: {
            por_pessoa: resumoDasTarefas.map((p) => ({ ...p, nome: nomeDe(p.user_id) })),
            itens: tarefasDaEquipe.map((t) => ({
              id: t.id,
              title: t.title,
              due_date: t.due_date,
              status: t.status,
              source_kind: t.source_kind,
              contact_id: t.contact_id,
              contato_nome: t.contato_nome,
              conversation_id: t.contact_id ? (conversas.get(t.contact_id) ?? null) : null,
              assigned_to: t.assigned_to,
              responsavel_nome: nomeDe(t.assigned_to),
            })),
          },
        },
      },
      { requestId },
    );
  } catch (e) {
    return fail("internal_error", e instanceof Error ? e.message : "Erro ao montar o dia.", 500, {
      requestId,
    });
  }
}

const metaSchema = z
  .strictObject({
    meta_agendamentos_dia: z.number().int().min(0).max(1000).nullable().optional(),
    // v1.7.6: quantos atendimentos cabem no mesmo horário (null = sem limite).
    agenda_capacidade_por_horario: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .refine((v) => v.meta_agendamentos_dia !== undefined || v.agenda_capacidade_por_horario !== undefined);

/**
 * A meta de agendamentos do dia (o contador "agendamentos x meta" do SDR).
 * Gerente para cima define; 0 ou null tira a meta.
 */
export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = metaSchema.safeParse((await req.json().catch(() => undefined)) as unknown);
  if (!parsed.success) {
    return fail("validation_error", "Envie { meta_agendamentos_dia: número | null }.", 422, {
      requestId,
    });
  }
  const admin = createAdminClient();
  const { data: org, error: erroLer } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (erroLer || !org)
    return fail("internal_error", "Não consegui ler a configuração.", 500, { requestId });
  const atual = (org.settings ?? {}) as Record<string, unknown>;
  const iavek = { ...((atual.iavek as Record<string, unknown> | undefined) ?? {}) };
  const metaPedida = parsed.data.meta_agendamentos_dia;
  if (metaPedida !== undefined) {
    if (metaPedida && metaPedida > 0) iavek.meta_agendamentos_dia = metaPedida;
    else delete iavek.meta_agendamentos_dia;
  }
  const capacidade = parsed.data.agenda_capacidade_por_horario;
  if (capacidade !== undefined) {
    if (capacidade) iavek.agenda_capacidade_por_horario = capacidade;
    else delete iavek.agenda_capacidade_por_horario;
  }
  const metaGravada = Number(iavek.meta_agendamentos_dia);
  const meta = Number.isFinite(metaGravada) && metaGravada > 0 ? metaGravada : null;
  const { error } = await admin
    .from("organizations")
    .update({ settings: { ...atual, iavek } })
    .eq("id", orgId);
  if (error) return fail("internal_error", "Não deu para salvar.", 500, { requestId });

  void audit({
    action: "iavek.meta_agendamentos_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: {
      meta_agendamentos_dia: meta,
      agenda_capacidade_por_horario: (iavek.agenda_capacidade_por_horario as number | undefined) ?? null,
    },
  });
  return ok(
    {
      meta_agendamentos_dia: meta,
      agenda_capacidade_por_horario: (iavek.agenda_capacidade_por_horario as number | undefined) ?? null,
    },
    { requestId },
  );
}
