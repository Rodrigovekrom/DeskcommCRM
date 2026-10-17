/**
 * ia.vek v1.7: o sino PESSOAL (tabela `notificacoes`, migration 0579).
 *
 *   GET   /api/v1/iavek/notificacoes          → as 30 mais recentes + não lidas
 *   PATCH /api/v1/iavek/notificacoes          → { ids?: uuid[] } marca como lidas
 *                                               (sem ids: todas as minhas)
 *
 * Cliente da SESSÃO: a RLS só devolve as linhas da própria pessoa, e só deixa
 * mudar `lida_em`. A linha não guarda texto com dado pessoal: título do lead e
 * nome do contato são lidos aqui, na hora (e somem com o lead).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, tipo, lead_id, task_id, ator_user_id, dados, lida_em, created_at, " +
  "crm_leads(title, contact_id, contacts(name, display_name, phone_number)), crm_tasks(title)";

function primeiro<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notificacoes" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const supabase = await createClient();

  const [lista, naoLidas] = await Promise.all([
    supabase
      .from("notificacoes")
      .select(COLUNAS)
      .eq("organization_id", orgId)
      .eq("user_id", authz.user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("notificacoes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("user_id", authz.user.id)
      .is("lida_em", null),
  ]);
  const falha = lista.error ?? naoLidas.error;
  if (falha) return fail("internal_error", falha.message, 500, { requestId });

  type Linha = {
    id: string;
    tipo: string;
    lead_id: string | null;
    task_id: string | null;
    ator_user_id: string | null;
    dados: Record<string, unknown> | null;
    lida_em: string | null;
    created_at: string;
    crm_leads?: unknown;
    crm_tasks?: unknown;
  };
  const linhas = (lista.data ?? []) as unknown as Linha[];
  const nomes = await nomesDosAtendentes(linhas.map((l) => l.ator_user_id));

  // A conversa mais recente de cada contato, para o clique abrir o atendimento.
  const contatos = [
    ...new Set(
      linhas
        .map((l) => (primeiro(l.crm_leads as never) as { contact_id?: string } | null)?.contact_id)
        .filter((c): c is string => Boolean(c)),
    ),
  ];
  const conversas = new Map<string, string>();
  if (contatos.length > 0) {
    const { data } = await supabase
      .from("conversations")
      .select("id, contact_id, last_message_at")
      .eq("organization_id", orgId)
      .in("contact_id", contatos)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    for (const c of data ?? [])
      if (c.contact_id && !conversas.has(c.contact_id)) conversas.set(c.contact_id, c.id);
  }

  const notificacoes = linhas.map((l) => {
    const lead = primeiro(l.crm_leads as never) as {
      title?: string;
      contact_id?: string | null;
      contacts?: unknown;
    } | null;
    const contato = primeiro(lead?.contacts as never) as {
      name?: string | null;
      display_name?: string | null;
      phone_number?: string | null;
    } | null;
    const tarefa = primeiro(l.crm_tasks as never) as { title?: string } | null;
    return {
      id: l.id,
      tipo: l.tipo,
      lida: l.lida_em !== null,
      created_at: l.created_at,
      dados: l.dados ?? {},
      lead_id: l.lead_id,
      lead_titulo: lead?.title ?? null,
      contato_nome: contato ? rotuloDoContato(contato) : null,
      tarefa_titulo: tarefa?.title ?? null,
      ator_nome: l.ator_user_id ? (nomes.get(l.ator_user_id) ?? null) : null,
      conversation_id: lead?.contact_id ? (conversas.get(lead.contact_id) ?? null) : null,
    };
  });

  return ok({ notificacoes, nao_lidas: naoLidas.count ?? 0 }, { requestId });
}

const marcarSchema = z.strictObject({ ids: z.array(z.string().uuid()).max(100).optional() });

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "notificacoes" });
  if (!authz.ok) return authz.response;
  const parsed = marcarSchema.safeParse((await req.json().catch(() => ({}))) as unknown);
  if (!parsed.success)
    return fail("validation_error", "Envie { ids?: uuid[] }.", 422, { requestId });

  const supabase = await createClient();
  let q = supabase
    .from("notificacoes")
    .update({ lida_em: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .is("lida_em", null);
  if (parsed.data.ids && parsed.data.ids.length > 0) q = q.in("id", parsed.data.ids);
  const { error } = await q;
  if (error) return fail("internal_error", error.message, 500, { requestId });
  // Marcar como lida é preferência de tela da própria pessoa, não mutação de
  // negócio: não vai para a auditoria (mesma régua da leitura de mensagens).
  return ok({ marcadas: true }, { requestId });
}
