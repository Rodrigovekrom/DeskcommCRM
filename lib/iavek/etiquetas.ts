/**
 * ia.vek v1.7.6: CRIAR etiqueta é configuração — só o admin faz.
 *
 * Gerente, SDR, suporte e vendedor continuam APLICANDO e tirando etiquetas que
 * já existem na organização. "Existe" é o que `fn_vocabulario_de_tags` lista: o
 * vocabulário da tela de Etiquetas (`settings.tags`), as sementes
 * (`canonical_conversation_tags`) e toda etiqueta já em uso em contato, lead ou
 * conversa. Digitar um nome novo no campo de etiqueta é que passa a ser
 * recusado para quem não é admin.
 *
 * A comparação ignora maiúsculas e espaços nas pontas — "Troca" e "troca " são
 * a mesma etiqueta, e não podem virar uma "nova" por causa da digitação.
 *
 * Só vale para quem entra pela SESSÃO (gente na tela). Chamada com token de
 * integração segue o escopo do token, como antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiErrorCodes } from "@/lib/api/errors";
import { fail } from "@/lib/api/wrappers";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const normal = (tag: string) => tag.trim().toLowerCase();

/** As etiquetas pedidas que ainda não existem na organização (puro, testável). */
export function etiquetasNovas(
  pedidas: readonly string[],
  existentes: readonly string[],
): string[] {
  const ja = new Set(existentes.map(normal));
  const novas = new Set<string>();
  for (const t of pedidas) {
    const n = normal(t);
    if (n && !ja.has(n)) novas.add(n);
  }
  return [...novas];
}

/**
 * Devolve o 403 quando quem não é admin tenta gravar uma etiqueta que não
 * existe; `null` quando pode seguir. Nunca deixa passar em silêncio um erro de
 * leitura: falha fechada (500), porque abrir seria criar etiqueta escondido.
 */
export async function recusaEtiquetaNova(args: {
  supabase: SupabaseClient;
  orgId: string;
  tags: readonly string[] | undefined | null;
  requestId: string;
  idioma?: Idioma;
  /** Quando a rota já conhece o papel, evita uma ida ao banco. */
  role?: string | null;
}): Promise<Response | null> {
  const { supabase, orgId, tags, requestId, idioma } = args;
  if (!tags || tags.length === 0) return null;

  let role = args.role ?? null;
  if (role == null) {
    const { data, error } = await supabase.rpc("fn_user_role_in_org", { p_org: orgId });
    if (error) return fail("internal_error", error.message, 500, { requestId });
    role = typeof data === "string" ? data : null;
  }
  if (roleAtLeast(role, "admin")) return null;

  const { data, error } = await supabase.rpc("fn_vocabulario_de_tags", { p_org: orgId });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const existentes = ((data ?? []) as Array<{ tag: string | null }>)
    .map((l) => l.tag)
    .filter((t): t is string => typeof t === "string");

  const novas = etiquetasNovas(tags, existentes);
  if (novas.length === 0) return null;
  return fail(
    ApiErrorCodes.tag_creation_admin_only,
    traduzir(
      "Só o administrador cria etiquetas novas. Escolha uma etiqueta da lista.",
      idioma ?? "pt-BR",
    ),
    403,
    { requestId, details: { etiquetas_novas: novas } },
  );
}
