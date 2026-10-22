/**
 * /api/v1/iavek/preferencias/[tela] — ia.vek v1.7.9.
 *
 * GET  as preferências de visualização de QUEM PEDE nesta tela.
 * PUT  grava as de quem pede (substitui o valor da tela).
 *
 * Pela SESSÃO: a RLS da 0587 só deixa ler e gravar a própria linha
 * (`user_id = auth.uid()`). Não toca `interface_settings`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerPreferenciasDoPipeline, preferenciasDoPipelineSchema, TELAS, type Tela } from "@/lib/iavek/preferencias-de-tela";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ tela: string }> };

function ehTela(v: string): v is Tela {
  return (TELAS as readonly string[]).includes(v);
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "preferencias" });
  if (!authz.ok) return authz.response;
  const { tela } = await ctx.params;
  if (!ehTela(tela)) return fail("not_found", traduzir("Tela desconhecida.", authz.user.idioma), 404, { requestId });
  const supabase = await createClient();
  const { data } = await supabase
    .from("iavek_preferencias_de_tela")
    .select("valor")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .eq("tela", tela)
    .maybeSingle();
  return ok(lerPreferenciasDoPipeline(data?.valor), { requestId });
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "preferencias" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const { tela } = await ctx.params;
  if (!ehTela(tela)) return fail("not_found", t("Tela desconhecida."), 404, { requestId });
  const corpo = preferenciasDoPipelineSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const supabase = await createClient();
  const { error } = await supabase
    .from("iavek_preferencias_de_tela")
    .upsert(
      { organization_id: authz.org.orgId, user_id: authz.user.id, tela, valor: corpo.data, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,user_id,tela" },
    );
  if (error) return fail("internal_error", t("Não consegui gravar a preferência."), 500, { requestId });
  return ok(corpo.data, { requestId });
}
