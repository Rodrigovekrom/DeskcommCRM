import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/aberta — ia.vek CRM-244 (Fase 2): QUEM PEDE abriu a conversa.
 *
 * Grava "Abriu a conversa" no histórico dos leads abertos do contato (no máximo uma linha por
 * pessoa a cada 30 min; dentro da janela só atualiza o "visto até") e, com isso, zera as não lidas
 * DESTA pessoa no quadro. Não toca no contador de ninguém mais nem no da Entrada.
 *
 * A conversa é lida primeiro pela SESSÃO (a RLS diz se a pessoa a enxerga); só então a escrita vai
 * pelo service role, com a organização da sessão (nunca do corpo).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { registrarAbertura } from "@/lib/iavek/leitura-da-conversa";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const supabase = await createClient();
  const { data: visivel, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!visivel) return fail("resource_not_found", t("Conversa não encontrada."), 404, { requestId });

  const r = await registrarAbertura(createAdminClient(), authz.org.orgId, authz.user.id, id);
  if (!r.ok) return fail("internal_error", r.erro, 500, { requestId });
  return ok({ leads: r.leads }, { requestId });
}
