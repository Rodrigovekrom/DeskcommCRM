/**
 * GET /api/v1/iavek/fichas/[id]/documentos/[docId] — ia.vek v1.7.8.
 * Devolve uma URL ASSINADA de 60 s para ver o documento (vendedor dono,
 * analista ou admin) e registra a leitura.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { quemNaFicha } from "@/lib/iavek/fichas";
import { exigeVerDados, lerFicha, registrarLeitura, semAcesso } from "@/lib/iavek/fichas-servidor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; docId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const { id, docId } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(docId).success) return semAcesso(quem, requestId);
  const ficha = await lerFicha(quem.orgId, id);
  if (!ficha || !exigeVerDados(quem, ficha)) return semAcesso(quem, requestId);
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("iavek_ficha_documentos")
    .select("id, storage_path")
    .eq("organization_id", quem.orgId)
    .eq("ficha_id", id)
    .eq("id", docId)
    .maybeSingle();
  if (!doc) return semAcesso(quem, requestId);
  const { data: assinada, error } = await admin.storage.from("iavek-fichas").createSignedUrl(doc.storage_path, 60);
  if (error || !assinada) return fail("internal_error", "signed_url_failed", 500, { requestId });
  await registrarLeitura(quem, id, "documento", doc.id);
  return ok({ url: assinada.signedUrl, expira_em_segundos: 60 }, { requestId });
}
