import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { tabelaDoObjeto } from "@/lib/modulos/dados/tabela";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  contato: z.string().uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * GET /api/v1/modulos/{modulo}/{objeto} — as fichas que um módulo de dados guarda.
 *
 * A tabela do módulo é **server-only** (`revoke all from anon, authenticated` no compilador), então
 * esta rota é o ÚNICO caminho de leitura — e o filtro por organização existe só aqui, no código. Não
 * há RLS de navegador para salvar um esquecimento, e é por isso que a organização vem da SESSÃO e
 * nunca do pedido: `requireRole` a resolve, e o que vier na URL é ignorado.
 *
 * O nome da tabela também não vem da URL: `tabelaDoObjeto` o deriva do que está instalado, e o que
 * não casa é 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ modulo: string; objeto: string }> },
): Promise<Response> {
  const { modulo, objeto } = await params;

  const autorizado = await requireRole("viewer", { resource: `modulos:${modulo}` });
  if (!autorizado.ok) return autorizado.response;

  const bruto = Object.fromEntries(new URL(request.url).searchParams);
  const query = querySchema.safeParse(bruto);
  if (!query.success) {
    return fail("invalid_request", "Pedido inválido.", 400);
  }

  const alvo = await tabelaDoObjeto(modulo, objeto);
  if (!alvo) {
    return fail("not_found", "Este módulo não guarda esta informação nesta instalação.", 404);
  }

  const admin = createAdminClient();
  let consulta = admin
    .from(alvo.tabela)
    .select("*")
    .eq("organization_id", autorizado.org.orgId);

  // O recorte por contato só existe se o objeto DECLAROU a referência: pedir por contato num objeto
  // que não a tem devolveria a lista inteira da organização, o que seria uma surpresa silenciosa.
  if (query.data.contato) {
    if (!alvo.refDoContato) {
      return fail("invalid_request", "Esta informação não é ligada a um contato.", 400);
    }
    consulta = consulta.eq(alvo.refDoContato, query.data.contato);
  }

  const { data, error } = await consulta.order("created_at", { ascending: false }).limit(query.data.limite);
  if (error) {
    return fail("upstream_unavailable", "Não foi possível ler agora.", 503);
  }

  return ok({
    rotulo: alvo.rotulo,
    campos: alvo.campos,
    fichas: data ?? [],
  });
}
