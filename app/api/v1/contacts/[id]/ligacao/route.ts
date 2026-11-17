/**
 * /api/v1/contacts/[id]/ligacao — ia.vek CRM-532: o "Como foi a ligação?" depois do botão "Ligar".
 *
 * GET  → o que a pergunta precisa saber, SEM registrar nada: o negócio da ligação (o `lead_id` pedido, se for deste
 *        contato e estiver aberto; senão o negócio ativo do contato) e a tarefa de ligação ABERTA dele, se houver.
 *        `pergunta` diz se a tela deve perguntar (sem negócio, não há onde registrar; sem tarefa, depende de
 *        LIGACAO_SEM_TAREFA_REGISTRA).
 * POST → registra pelos MESMOS 3 campos e pelo MESMO caminho da tarefa (app/api/v1/_ligacao/registrar.ts): com tarefa
 *        aberta, fecha a tarefa; sem tarefa, só a linha do tempo + o próximo passo.
 *
 * Tudo pelo cliente da SESSÃO (RLS), nunca o admin (Lupa 194615): quem não vê o contato, ou o negócio que a tela
 * pediu, recebe 404 e nada é gravado; as escritas (a tarefa, a linha do tempo, o próximo passo) também vão por ele. Agente ou
 * acima, como concluir tarefa. O telefone não passa por aqui: o discador já foi aberto pelo `tel:` do botão.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { registrarLigacao, type NegocioDaLigacao } from "@/app/api/v1/_ligacao/registrar";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { registroDeLigacaoSchema } from "@/lib/esteira/registro-de-ligacao";
import { PREFIXO_DE_LIGACAO } from "@/lib/esteira/rodada";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { LIGACAO_SEM_TAREFA_REGISTRA, ligaPeloCrm } from "@/lib/ligar/regras";
import { createClient } from "@/lib/supabase/server";
import type { Tarefa } from "@/lib/tarefas/tipos";

export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ id: string }>;
}

const uuid = z.string().uuid();
const corpoSchema = registroDeLigacaoSchema.and(z.object({ lead_id: uuid.nullish() }));

type Cliente = Awaited<ReturnType<typeof createClient>>;
type TarefaDeLigacao = Tarefa & { source_kind: string | null };

/**
 * (decisão do Rodrigo 17/11, Lupa 212314) Esta pessoa liga pelo CRM? A função REAL do vínculo dela + a lista da loja
 * (settings.iavek.ligar.funcoes; de fábrica, TODOS que atendem), lidas pelo cliente da sessão. Quem não liga: o GET não
 * pergunta, e o POST recusa com 403, sem gravar nada.
 */
async function ligaAqui(supabase: Cliente, orgId: string, userId: string, atende: boolean): Promise<boolean> {
  const [{ data: vinculo }, { data: org }] = await Promise.all([
    supabase
      .from("user_organizations")
      .select("interface_settings")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle(),
    supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
  ]);
  const funcao = (vinculo as { interface_settings?: { funcao?: string } } | null)?.interface_settings?.funcao;
  return ligaPeloCrm(funcao, (org as { settings?: unknown } | null)?.settings, atende);
}

/** O negócio e a tarefa de ligação aberta, pelo cliente da sessão (RLS). */
async function alvoDaLigacao(
  supabase: Cliente,
  orgId: string,
  contatoId: string,
  leadPedido: string | null,
): Promise<{
  contatoVisivel: boolean;
  /** (Lupa 194615) a tela pediu um negócio que a pessoa NÃO vê (ou não é deste contato, ou não está aberto): 404 */
  leadPedidoInvisivel: boolean;
  negocio: NegocioDaLigacao | null;
  tarefa: TarefaDeLigacao | null;
}> {
  const { data: contato } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contatoId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!contato) return { contatoVisivel: false, leadPedidoInvisivel: false, negocio: null, tarefa: null };

  const { data: leads } = await supabase
    .from("crm_leads")
    .select("id, organization_id, pipeline_id, status, contact_id, last_activity_at, created_at")
    .eq("organization_id", orgId)
    .eq("contact_id", contatoId);
  const lista = (leads ?? []) as (LeadCandidate & { contact_id: string | null })[];

  let negocio: NegocioDaLigacao | null = null;
  const pedido = leadPedido ? lista.find((l) => l.id === leadPedido && l.status === "open") : undefined;
  // pediu um negócio específico e ele não veio pela RLS: NÃO cai em outro negócio do contato
  if (leadPedido && !pedido) return { contatoVisivel: true, leadPedidoInvisivel: true, negocio: null, tarefa: null };
  if (pedido) {
    negocio = pedido;
  } else {
    const { data: padrao } = await supabase
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .eq("is_archived", false)
      .limit(1)
      .maybeSingle();
    const rota = resolveActiveLeadForContact(lista, { defaultPipelineId: (padrao as { id: string } | null)?.id ?? null });
    negocio = rota.routed ? (lista.find((l) => l.id === rota.leadId) ?? null) : null;
  }
  if (!negocio) return { contatoVisivel: true, leadPedidoInvisivel: false, negocio: null, tarefa: null };

  // a tarefa de ligação ABERTA deste negócio que vence primeiro (a que a pessoa está fazendo)
  const { data: tarefas } = await supabase
    .from("crm_tasks")
    .select("id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_by, created_at, updated_at, source_kind")
    .eq("organization_id", orgId)
    .eq("lead_id", negocio.id)
    .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
    .in("status", ["pending", "in_progress"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1);
  const tarefa = ((tarefas ?? [])[0] as TarefaDeLigacao | undefined) ?? null;
  return { contatoVisivel: true, leadPedidoInvisivel: false, negocio, tarefa };
}

export async function GET(req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;

  const leadPedido = req.nextUrl.searchParams.get("lead_id");
  const supabase = await createClient();
  if (!(await ligaAqui(supabase, authz.org.orgId, authz.user.id, true))) {
    return ok({ pergunta: false, lead_id: null, tarefa: null }, { requestId });
  }
  const alvo = await alvoDaLigacao(
    supabase,
    authz.org.orgId,
    id,
    leadPedido && uuid.safeParse(leadPedido).success ? leadPedido : null,
  );
  if (!alvo.contatoVisivel) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  if (alvo.leadPedidoInvisivel) return fail("not_found", "Negócio não encontrado.", 404, { requestId });
  const pergunta = alvo.negocio !== null && (alvo.tarefa !== null || LIGACAO_SEM_TAREFA_REGISTRA);
  return ok(
    {
      pergunta,
      lead_id: alvo.negocio?.id ?? null,
      tarefa: alvo.tarefa ? { id: alvo.tarefa.id, titulo: alvo.tarefa.title } : null,
    },
    { requestId },
  );
}

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const { lead_id: leadPedido, ...registro } = parsed.data;
  const supabase = await createClient();
  if (!(await ligaAqui(supabase, orgId, authz.user.id, true))) {
    return fail("forbidden", "Registrar a ligação por aqui é só para quem liga pelo CRM.", 403, { requestId });
  }
  const alvo = await alvoDaLigacao(supabase, orgId, id, leadPedido ?? null);
  if (!alvo.contatoVisivel) return fail("not_found", "Contato não encontrado.", 404, { requestId });
  if (alvo.leadPedidoInvisivel) return fail("not_found", "Negócio não encontrado.", 404, { requestId });
  if (!alvo.negocio) {
    return fail("validation_failed", "Este contato não tem negócio aberto para registrar a ligação.", 422, { requestId });
  }
  if (!alvo.tarefa && !LIGACAO_SEM_TAREFA_REGISTRA) {
    return fail("validation_failed", "Não há tarefa de ligação aberta para este negócio.", 422, { requestId });
  }

  return registrarLigacao({
    supabase,
    orgId,
    user: { id: authz.user.id, idioma: authz.user.idioma },
    requestId,
    registro,
    tarefa: alvo.tarefa,
    negocio: alvo.negocio,
    origem: alvo.tarefa ? "esteira" : "ligar",
  });
}
