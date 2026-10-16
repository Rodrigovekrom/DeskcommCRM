/**
 * GET /api/v1/cron/tarefas-vencidas — anuncia no barramento a tarefa que venceu
 * sem ser concluída (ia.vek D4): `task.overdue`, entidade `crm_task`, UMA vez por
 * tarefa. É o gatilho "Quando uma tarefa vencer sem ser concluída" das
 * automações (ex.: avisar o grupo da equipe com 🚨).
 *
 * Só olha as últimas 24 h de vencimento: tarefa vencida há uma semana não vira
 * aviso de madrugada no primeiro dia em que o cron passar a existir. A trava de
 * "uma vez" é o próprio `event_log`: tarefa que já tem `task.overdue` não emite.
 * Rodada sem efeito não audita.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const JANELA_MS = 24 * 3_600_000;
const LOTE = 300;

type Vencida = {
  id: string;
  organization_id: string;
  title: string;
  due_date: string;
  lead_id: string | null;
  contact_id: string | null;
  assigned_to: string | null;
  source_kind: string | null;
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const admin = createAdminClient();
  const agora = new Date();
  const { data, error } = await admin
    .from("crm_tasks")
    .select("id, organization_id, title, due_date, lead_id, contact_id, assigned_to, source_kind")
    .in("status", ["pending", "in_progress"])
    .lt("due_date", agora.toISOString())
    .gte("due_date", new Date(agora.getTime() - JANELA_MS).toISOString())
    .order("due_date", { ascending: true })
    .limit(LOTE);
  if (error) return fail("internal_error", "Não deu para ler as tarefas.", 500, { requestId });
  const vencidas = (data ?? []) as Vencida[];
  if (vencidas.length === 0) return ok({ emitidas: 0 }, { requestId });

  const { data: jaAnunciadas } = await admin
    .from("event_log")
    .select("entity_id")
    .eq("event_type", "task.overdue")
    .in(
      "entity_id",
      vencidas.map((t) => t.id),
    );
  const ja = new Set(((jaAnunciadas ?? []) as Array<{ entity_id: string }>).map((r) => r.entity_id));
  const paradas = new Set(await idsDeOrgsParadas(admin));

  const porOrg = new Map<string, number>();
  for (const t of vencidas) {
    if (ja.has(t.id) || paradas.has(t.organization_id)) continue;
    const { error: errEmit } = await admin.rpc("emit_event", {
      p_event_type: "task.overdue",
      p_entity_kind: "crm_task",
      p_entity_id: t.id,
      p_payload: {
        task_id: t.id,
        title: t.title,
        due_date: t.due_date,
        lead_id: t.lead_id,
        contact_id: t.contact_id,
        assigned_to: t.assigned_to,
        source_kind: t.source_kind,
      },
      p_metadata: { source: "cron:tarefas-vencidas" },
      p_organization_id: t.organization_id,
    });
    if (errEmit) {
      logger.warn("tarefa_vencida_nao_anunciada", { task_id: t.id, error: errEmit.message });
      continue;
    }
    porOrg.set(t.organization_id, (porOrg.get(t.organization_id) ?? 0) + 1);
  }

  for (const [orgId, emitidas] of porOrg) {
    if (emitidas > 0) {
      void audit({
        action: "task.overdue_announced",
        organizationId: orgId,
        bypassedRls: true,
        resourceType: "crm_tasks",
        metadata: { emitidas },
        requestId,
      });
    }
  }
  return ok({ emitidas: [...porOrg.values()].reduce((a, b) => a + b, 0) }, { requestId });
}
