/**
 * ia.vek v1.5 (parte C): as fotos que podem ser do CARRO DA TROCA do cliente,
 * para a galeria da ficha do lead. Só leitura; sem migration e sem storage novo
 * (decisão do Rodrigo, 17/10/2026):
 *
 *   - as imagens das conversas do contato (`messages`, servidas por
 *     `/api/v1/messages/<id>/media`);
 *   - as imagens subidas pela equipe como anexo de NOTA INTERNA
 *     (`conversation_notes`, servidas por `.../notes/<id>/media`).
 *
 * Quais delas SÃO do carro da troca é marcado no lead
 * (`custom_fields.troca_fotos`, lista de referências "m:<id>" / "n:<id>"), não
 * aqui. As duas origens seguem a retenção de mídia da organização: a que venceu
 * volta com `expirada: true` e a tela mostra "foto expirada".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fotoDaMensagem, fotoDaNota } from "@/lib/iavek/fotos-da-troca";

export const dynamic = "force-dynamic";

const LIMITE = 60;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id: contactId } = await ctx.params;

  const supabase = await createClient();
  const { data: contato, error: erroContato } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroContato) return fail("internal_error", erroContato.message, 500, { requestId });
  if (!contato) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const [mensagens, conversas] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id, conversation_id, created_at, direction, type, media_mime, media_storage_path, media_url, metadata",
      )
      .eq("contact_id", contactId)
      .eq("organization_id", orgId)
      .or("type.eq.image,media_mime.like.image/*")
      .order("created_at", { ascending: false })
      .limit(LIMITE),
    supabase
      .from("conversations")
      .select("id")
      .eq("contact_id", contactId)
      .eq("organization_id", orgId)
      .limit(200),
  ]);
  if (mensagens.error ?? conversas.error) {
    return fail("internal_error", (mensagens.error ?? conversas.error)!.message, 500, {
      requestId,
    });
  }

  const idsDasConversas = (conversas.data ?? []).map((c) => c.id);
  const notas =
    idsDasConversas.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("conversation_notes")
          .select(
            "id, conversation_id, created_at, created_by_name, media_mime, media_storage_path",
          )
          .in("conversation_id", idsDasConversas)
          .eq("organization_id", orgId)
          .like("media_mime", "image/%")
          .order("created_at", { ascending: false })
          .limit(LIMITE);
  if (notas.error) return fail("internal_error", notas.error.message, 500, { requestId });

  const fotos = [
    ...(mensagens.data ?? []).map(fotoDaMensagem),
    ...(notas.data ?? []).map(fotoDaNota),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return ok({ fotos }, { requestId });
}
