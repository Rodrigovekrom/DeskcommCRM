/**
 * GET /api/v1/settings/esteira/sem-retorno — CRM-141 (Rodrigo, 06/11/2026): a contagem
 * que se mostra ANTES de ligar a regra "terminou o follow-up sem retorno vira Perdido".
 * Só leitura; nada muda. Ler: gestor.
 *
 *  - `vao_entrar`: leads abertos nas fases do follow-up que ainda não terminaram a última
 *    fase — viram Perdido quando terminarem, se não voltarem a falar;
 *  - `ja_terminaram`: já passaram da última fase; ligando agora, ficam de fora.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { configDaEsteira, esteiraSettingsSchema } from "@/lib/esteira/config";
import { depsReaisDaEsteira } from "@/lib/esteira/deps-reais";
import { contagemSemRetorno } from "@/lib/esteira/rodada";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_esteira" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  const { data, error } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) return fail("internal_error", "Não deu para ler a configuração.", 500, { requestId });
  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  // A contagem vale com a esteira desligada também: os funis declarados bastam.
  const salvo = esteiraSettingsSchema.safeParse(settings.esteira ?? {});
  const followup = salvo.success ? salvo.data.followup : undefined;
  if (!followup) return fail("state_conflict", "O funil de follow-up da esteira não está declarado.", 409, { requestId });

  const agora = new Date();
  const leads = await depsReaisDaEsteira(admin, orgId, () => agora).leadsAbertos(followup.pipeline_id);
  const c = contagemSemRetorno(followup.fases, leads, agora);
  const em = configDaEsteira(settings).semRetorno;
  return ok(
    {
      vao_entrar: c.vaoEntrar,
      ja_terminaram: c.jaTerminaram,
      ultima_fase_ate_dia: followup.fases[followup.fases.length - 1]!.ate_dia,
      ligada_desde: em?.desde ?? null,
      contado_em: agora.toISOString(),
    },
    { requestId },
  );
}
