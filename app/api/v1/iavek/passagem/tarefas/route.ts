/**
 * /api/v1/iavek/passagem/tarefas — ia.vek v1.9.62 (CRM-497, D4 1A/2A do Rodrigo): o passo "Antes de passar: as
 * tarefas deste lead". Quem PASSA o lead resolve cada tarefa aberta dele (de quem for) antes da passagem:
 *
 * GET  ?lead_id=   as tarefas de PESSOA abertas do lead (as automáticas da régua fecham sozinhas na passagem) e as
 *                  que a pessoa excluiu neste passo e ainda pode VOLTAR.
 * POST             { lead_id, task_id, acao }: `feita` (status done), `excluir` (CANCELA com o motivo
 *                  'excluida_ao_passar': fica na linha do tempo e volta se foi engano) ou `voltar` (a excluída neste
 *                  passo volta a 'pending').
 *
 * Quem pode: quem enxerga o lead pela SESSÃO e cuida dele (dono, guardião), a gerência, ou quem passa por função (SDR,
 * SDR de Follow-up, suporte). Service role, SEMPRE filtrando a organização e o lead (a tarefa tem de ser DESTE lead).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { funcaoDaTela } from "@/lib/iavek/funcoes";
import { lerLeadDaPassagem, leadVisivelPelaSessao, tarefasDePessoaAbertas } from "@/lib/iavek/passagem-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createAdminClient } from "@/lib/supabase/admin";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";

export const dynamic = "force-dynamic";

/** O motivo da tarefa excluída no passo da passagem (D4 2A): cancelada, não apagada. */
const MOTIVO_EXCLUIDA = "excluida_ao_passar";

const acaoSchema = z.object({
  lead_id: z.string().uuid(),
  task_id: z.string().uuid(),
  acao: z.enum(["feita", "excluir", "voltar"]),
});

type Autorizado = Extract<Awaited<ReturnType<typeof requireRole>>, { ok: true }>;

async function podeResolver(authz: Autorizado, leadId: string): Promise<boolean> {
  if (!(await leadVisivelPelaSessao(authz.org.orgId, leadId))) return false;
  const lead = await lerLeadDaPassagem(createAdminClient(), authz.org.orgId, leadId);
  if (!lead || lead.status !== "open") return false;
  const eu = authz.user.id;
  const funcao = funcaoDaTela(authz.org.interface_settings?.funcao);
  return (
    roleAtLeast(authz.org.role, "manager") ||
    lead.owner_user_id === eu ||
    lead.sdr_user_id === eu ||
    funcao === "sdr" ||
    funcao === "sdr_followup" ||
    funcao === "suporte"
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const leadId = req.nextUrl.searchParams.get("lead_id") ?? "";
  if (!z.string().uuid().safeParse(leadId).success) return fail("validation_failed", t("Lead inválido."), 422, { requestId });
  if (!(await podeResolver(authz, leadId))) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const admin = createAdminClient();
  const abertas = await tarefasDePessoaAbertas(admin, authz.org.orgId, leadId);
  const { data: excluidas, error } = await admin
    .from("crm_tasks")
    .select("id, title, assigned_to, due_date, status")
    .eq("organization_id", authz.org.orgId)
    .eq("lead_id", leadId)
    .eq("status", "cancelled")
    .eq("cancelada_motivo", MOTIVO_EXCLUIDA)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) return fail("internal_error", t("Não consegui ler as tarefas."), 500, { requestId });
  return ok({ abertas, excluidas: excluidas ?? [] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const parsed = acaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  const { lead_id: leadId, task_id: taskId, acao } = parsed.data;
  if (!(await podeResolver(authz, leadId))) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  // A tarefa TEM de ser deste lead e desta organização, e estar no estado de onde a ação parte.
  const de = acao === "voltar" ? ["cancelled"] : ["pending", "in_progress"];
  const mudanca =
    acao === "feita"
      ? { status: "done" }
      : acao === "excluir"
        ? { status: "cancelled", cancelada_motivo: MOTIVO_EXCLUIDA }
        : { status: "pending", cancelada_motivo: null };
  let escrita = admin
    .from("crm_tasks")
    .update(mudanca)
    .eq("organization_id", orgId)
    .eq("lead_id", leadId)
    .eq("id", taskId)
    .in("status", de);
  if (acao === "voltar") escrita = escrita.eq("cancelada_motivo", MOTIVO_EXCLUIDA);
  const { data: tarefa, error } = await escrita
    .select("id, title, due_date, priority, lead_id, contact_id, status")
    .maybeSingle();
  if (error) return fail("internal_error", t("Não consegui mudar a tarefa."), 500, { requestId });
  if (!tarefa) return fail("state_conflict", t("A tarefa mudou ou não é deste lead. Atualize a lista."), 409, { requestId });

  const actor = { type: "user" as const, id: authz.user.id, role: authz.org.role };
  const linha = tarefa as { id: string; title: string; due_date: string | null; priority: string | null; lead_id: string; contact_id: string | null };
  if (acao === "feita") {
    await registraAtividadeDaTarefa(admin, { organizationId: orgId, tarefa: linha as never, tipo: "task_completed", actor });
  } else {
    await emitLeadActivity(admin, {
      organizationId: orgId,
      leadId,
      contactId: linha.contact_id,
      type: acao === "excluir" ? "task_cancelled" : "note",
      sourceModule: "tarefas",
      sourceId: linha.id,
      actor,
      reason:
        acao === "excluir"
          ? `Tarefa excluída ao passar o lead: ${linha.title.slice(0, 160)}`
          : `Tarefa voltou (tinha sido excluída ao passar o lead): ${linha.title.slice(0, 160)}`,
      payload: { motivo: MOTIVO_EXCLUIDA, acao },
    });
  }
  void audit({
    action: "iavek.passagem_tarefa",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_tasks",
    resourceId: linha.id,
    requestId,
    metadata: { acao, lead_id: leadId },
  });
  const abertas = await tarefasDePessoaAbertas(admin, orgId, leadId);
  return ok({ task_id: linha.id, acao, abertas }, { requestId });
}
