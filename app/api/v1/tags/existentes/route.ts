/**
 * GET /api/v1/tags/existentes — ia.vek v1.8.3: os NOMES das etiquetas que já
 * existem na organização, para o seletor do "Editar campos".
 *
 * É a mesma régua que a escrita usa para recusar etiqueta nova de quem não é
 * admin (`recusaEtiquetaNova`, lib/iavek/etiquetas.ts → `fn_vocabulario_de_tags`).
 * Com o campo de texto livre, o vendedor digitava um nome novo, o Salvar inteiro
 * levava 403 e os outros campos se perdiam. Oferecer só o que a escrita aceita
 * fecha a porta antes do clique.
 *
 * Leitura de `viewer` (como `/tags/cores`): a pergunta é "que etiqueta posso
 * aplicar", não "posso mexer no vocabulário" — essa segue em `/tags/vocabulario`,
 * de gerente para cima.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("viewer", { requestId, resource: "settings_tags" });
  if (!auth.ok) return auth.response;

  // Client da SESSÃO: a função é `security invoker`, e a RLS recorta a organização.
  const db = await createClient();
  const { data, error } = await db.rpc("fn_vocabulario_de_tags", { p_org: auth.org.orgId });
  if (error) return fail("internal_error", "Não foi possível carregar as etiquetas.", 500, { requestId });

  const tags = [
    ...new Set(
      ((data ?? []) as Array<{ tag: string | null }>)
        .map((l) => (typeof l.tag === "string" ? l.tag.trim() : ""))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return ok(tags, { requestId, meta: { total: tags.length } });
}
