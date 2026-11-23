/**
 * POST /api/internal/iavek/novidade-da-versao — a Novidade da versão (ia.vek CRM-439, 0651; regra 4 do Rodrigo: o
 * TIME escreve as Novidades, e não existe tela para isso).
 *
 * Só do servidor: o segredo de cron (`autorizaCron`, fail-closed). Fica em `/api/internal/`, que o proxy deixa passar
 * para a rota decidir (lib/auth/public-paths.ts). A org vem no corpo, porque quem chama é o roteiro da troca, sem
 * sessão; nenhuma org é fixa no código. Grava tudo numa chamada (`fn_iavek_enviar_comunicado`). O passo no roteiro da
 * troca NÃO faz parte desta fase: vira roteiro próprio, com o md5 à Lupa. Uma falha aqui nunca derruba a troca.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import {
  envioDaNovidadeSchema,
  parametrosDoEnvio,
  statusDoErroDoEnvio,
} from "@/lib/iavek/comunicados";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req))
    return fail("unauthorized", "Segredo ausente ou inválido.", 401, { requestId });
  const corpo = envioDaNovidadeSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", "Corpo inválido.", 422, {
      requestId,
      details: corpo.error.flatten(),
    });
  }
  const admin = createAdminClient();
  const { data: org, error: erroDaOrg } = await admin
    .from("organizations")
    .select("id")
    .eq("id", corpo.data.organization_id)
    .maybeSingle();
  if (erroDaOrg) return fail("internal_error", erroDaOrg.message, 500, { requestId });
  if (!org) return fail("not_found", "Organização não encontrada.", 404, { requestId });
  const { data, error } = await admin.rpc(
    "fn_iavek_enviar_comunicado",
    parametrosDoEnvio(corpo.data.organization_id, { tipo: "novidade", corpo: corpo.data }),
  );
  if (error) {
    const status = statusDoErroDoEnvio(error.code);
    return fail(status === 500 ? "internal_error" : "validation_failed", error.message, status, {
      requestId,
    });
  }
  const linha = (Array.isArray(data) ? data[0] : data) as
    { comunicado_id: string; destinatarios: number } | undefined;
  if (!linha) return fail("internal_error", "A novidade não foi gravada.", 500, { requestId });
  void audit({
    action: "iavek.novidade_publicada",
    actorUserId: null,
    organizationId: corpo.data.organization_id,
    resourceType: "iavek_comunicado",
    resourceId: linha.comunicado_id,
    requestId,
    metadata: {
      versao: corpo.data.versao,
      para_funcao: corpo.data.para_funcao,
      destinatarios: linha.destinatarios,
    },
  });
  return ok({ id: linha.comunicado_id, destinatarios: linha.destinatarios }, { requestId });
}
