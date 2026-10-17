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
import { cronometroDoLead, entradaDaEsteira } from "@/lib/iavek/cronometro-72h";
import { FUNCOES } from "@/lib/iavek/funcoes";
import { atrasosPorPessoa, limitesDoDia, perdasPorMotivo, porPrazo } from "@/lib/iavek/meu-dia";
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
  const { funcao } = parsed.data;

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
    if (funcao === "sdr") {
      const [leads, ligacoes, passos, agendadosHoje] = await Promise.all([
        leadsComPrazo(200),
        tarefas("ligacoes", true, fim),
        tarefas("proximos_passos", true, fim),
        supabase
          .from("calendar_appointments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .neq("status", "cancelled")
          .gte("created_at", inicio.toISOString())
          .lt("created_at", fim.toISOString()),
      ]);
      const novos = porPrazo(leads).slice(0, 30);
      const conversas = await conversasDos(supabase, orgId, [
        ...novos.map((l) => l.contact_id),
        ...ligacoes.map((t) => t.contact_id),
        ...passos.map((t) => t.contact_id),
      ]);
      const comConversa = <T extends { contact_id: string | null }>(x: T) => ({
        ...x,
        conversation_id: x.contact_id ? (conversas.get(x.contact_id) ?? null) : null,
      });
      return ok(
        {
          funcao,
          sdr: {
            leads_novos: novos.map(comConversa),
            ligacoes: ligacoes.map(comConversa),
            proximos_passos: passos.map(comConversa),
            agendamentos: { hoje: agendadosHoje.count ?? 0, meta: metaDoDia },
          },
        },
        { requestId },
      );
    }

    if (funcao === "vendedor") {
      const [agenda, leads, propostas, passos] = await Promise.all([
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
            `id, title, status, updated_at, contact_id, crm_stages!crm_leads_stage_id_fkey(name), ${CONTATO}`,
          )
          .eq("organization_id", orgId)
          .eq("owner_user_id", eu)
          .eq("status", "open")
          .order("updated_at", { ascending: false })
          .limit(30),
        supabase
          .from("crm_proposals")
          .select(
            `id, titulo, status, total_cents, moeda, valid_until, contact_id, lead_id, ${CONTATO}`,
          )
          .eq("organization_id", orgId)
          .eq("sent_by_user_id", eu)
          .in("status", ["rascunho", "enviando", "enviada"])
          .order("updated_at", { ascending: false })
          .limit(30),
        tarefas("proximos_passos", true, null),
      ]);
      const falha = agenda.error ?? leads.error ?? propostas.error;
      if (falha) throw new Error(falha.message);
      const leadsLimpos = (leads.data ?? []).map((l) => {
        const { crm_stages, ...resto } = l as typeof l & { crm_stages?: unknown };
        const etapa = Array.isArray(crm_stages) ? crm_stages[0] : crm_stages;
        return {
          ...semEmbed(resto as LinhaComContato & typeof resto),
          etapa: (etapa as { name?: string } | null)?.name ?? null,
        };
      });
      const conversas = await conversasDos(supabase, orgId, [
        ...leadsLimpos.map((l) => l.contact_id),
        ...(propostas.data ?? []).map((p) => p.contact_id),
        ...passos.map((t) => t.contact_id),
      ]);
      const comConversa = <T extends { contact_id: string | null }>(x: T) => ({
        ...x,
        conversation_id: x.contact_id ? (conversas.get(x.contact_id) ?? null) : null,
      });
      return ok(
        {
          funcao,
          vendedor: {
            agendamentos: (agenda.data ?? []).map((a) => semEmbed(a as LinhaComContato & typeof a)),
            leads: leadsLimpos.map(comConversa),
            propostas: (propostas.data ?? []).map((p) =>
              comConversa(semEmbed(p as LinhaComContato & typeof p)),
            ),
            proximos_passos: passos.map(comConversa),
          },
        },
        { requestId },
      );
    }

    // ── gerente ──────────────────────────────────────────────────────────────
    const desde30 = new Date(agora.getTime() - 30 * DIA).toISOString();
    const [novosHoje, comPrazo, atrasadas, agendou, veio, comprou, perdidos, abertas] =
      await Promise.all([
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
      ]);
    const falha =
      novosHoje.error ??
      atrasadas.error ??
      agendou.error ??
      veio.error ??
      comprou.error ??
      perdidos.error ??
      abertas.error;
    if (falha) throw new Error(falha.message);

    const estourando = porPrazo(comPrazo).filter(
      (l) => new Date(l.fim_em).getTime() - agora.getTime() < DIA,
    );
    const conversas = await conversasDos(
      supabase,
      orgId,
      estourando.map((l) => l.contact_id),
    );
    const porPessoa = atrasosPorPessoa(atrasadas.data ?? []);
    const nomes = await nomesDosAtendentes(porPessoa.map((p) => p.user_id));
    const comPessoa = (abertas.data ?? []).filter((c) => c.assigned_to_user_id).length;

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

const metaSchema = z.strictObject({
  meta_agendamentos_dia: z.number().int().min(0).max(1000).nullable(),
});

/**
 * A meta de agendamentos do dia (o contador "agendamentos x meta" do SDR).
 * Gerente para cima define; 0 ou null tira a meta.
 */
export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "organizations" });
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
  const meta = parsed.data.meta_agendamentos_dia;
  if (meta && meta > 0) iavek.meta_agendamentos_dia = meta;
  else delete iavek.meta_agendamentos_dia;
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
    metadata: { meta_agendamentos_dia: meta && meta > 0 ? meta : null },
  });
  return ok({ meta_agendamentos_dia: meta && meta > 0 ? meta : null }, { requestId });
}
