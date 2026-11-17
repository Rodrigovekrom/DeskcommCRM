/**
 * POST /api/v1/tasks/[id]/ligacao — registra a LIGAÇÃO de uma tarefa da esteira
 * (ia.vek D3) pelos 3 campos e aplica os efeitos (`lib/esteira/registro-de-ligacao.ts`).
 *
 * Só para tarefa de ligação (`source_kind` `ligacao:*`) ainda aberta. A tarefa
 * fecha, a linha "Ligação registrada" entra na timeline com os 3 campos, e o
 * próximo passo mexe no negócio pelos MESMOS caminhos da tela (mover, perder,
 * criar tarefa). Agente ou acima, como concluir tarefa.
 *
 * (CRM-532) O registro em si mora em app/api/v1/_ligacao/registrar.ts, o MESMO do "Como foi a ligação?" do botão Ligar.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { registrarLigacao, type NegocioDaLigacao } from "@/app/api/v1/_ligacao/registrar";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { registroDeLigacaoSchema } from "@/lib/esteira/registro-de-ligacao";
import { ehLigacao } from "@/lib/esteira/rodada";
import { createClient } from "@/lib/supabase/server";
import type { Tarefa } from "@/lib/tarefas/tipos";

export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = registroDeLigacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const registro = parsed.data;
  const supabase = await createClient();

  const { data: tarefaLida } = await supabase
    .from("crm_tasks")
    .select("id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_by, created_at, updated_at, source_kind")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const tarefa = tarefaLida as (Tarefa & { source_kind: string | null }) | null;
  if (!tarefa) return fail("not_found", "Tarefa não encontrada.", 404, { requestId });
  if (!ehLigacao(tarefa.source_kind)) {
    return fail("validation_failed", "Esta tarefa não é uma ligação da esteira.", 422, { requestId });
  }
  if (tarefa.status === "done" || tarefa.status === "cancelled") {
    return fail("conflict", "Esta ligação já foi registrada.", 409, { requestId });
  }

  const { data: negocioLido } = tarefa.lead_id
    ? await supabase
        .from("crm_leads")
        .select("id, pipeline_id, status, contact_id")
        .eq("id", tarefa.lead_id)
        .eq("organization_id", orgId)
        .maybeSingle()
    : { data: null };
  const negocio = negocioLido as NegocioDaLigacao | null;
  return registrarLigacao({
    supabase,
    orgId,
    user: { id: authz.user.id, idioma: authz.user.idioma },
    requestId,
    registro,
    tarefa,
    negocio,
    origem: "esteira",
  });
}
