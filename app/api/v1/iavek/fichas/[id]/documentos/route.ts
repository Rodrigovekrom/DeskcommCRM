/**
 * POST /api/v1/iavek/fichas/[id]/documentos — ia.vek v1.7.8. Multipart:
 * `arquivo` + `tipo`. O vendedor dono (ou o admin) anexa foto/PDF de documento
 * à ficha. Vai para o bucket PRIVADO iavek-fichas (sem policy para a sessão).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { quemNaFicha, TIPOS_DE_DOCUMENTO } from "@/lib/iavek/fichas";
import { exigeVerDados, lerFicha, semAcesso } from "@/lib/iavek/fichas-servidor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};
const MAXIMO = 10 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const t = (s: string) => traduzir(s, quem.idioma);
  const { id } = await ctx.params;
  if (quem.analista || quem.suporteSoLeitura || !z.uuid().safeParse(id).success) return semAcesso(quem, requestId);
  const ficha = await lerFicha(quem.orgId, id);
  if (!ficha || !exigeVerDados(quem, ficha)) return semAcesso(quem, requestId);
  if (ficha.status === "aprovada" || ficha.status === "recusada" || ficha.anonimizada) {
    return fail("state_conflict", t("A ficha já foi decidida."), 409, { requestId });
  }

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const tipo = String(form?.get("tipo") ?? "outro");
  if (!(arquivo instanceof File) || !(TIPOS_DE_DOCUMENTO as readonly string[]).includes(tipo)) {
    return fail("validation_failed", t("Envie um arquivo e o tipo do documento."), 422, { requestId });
  }
  const ext = MIMES[arquivo.type];
  if (!ext) return fail("validation_failed", t("Formato não aceito: use foto (JPG, PNG, WEBP, HEIC) ou PDF."), 422, { requestId });
  if (arquivo.size > MAXIMO) return fail("validation_failed", t("Arquivo maior que 10 MB."), 422, { requestId });

  const caminho = `${quem.orgId}/${id}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error: erroUp } = await admin.storage
    .from("iavek-fichas")
    .upload(caminho, Buffer.from(await arquivo.arrayBuffer()), { contentType: arquivo.type, upsert: false });
  if (erroUp) return fail("internal_error", t("Não consegui guardar o documento."), 500, { requestId });

  const { data: doc, error } = await admin
    .from("iavek_ficha_documentos")
    .insert({
      organization_id: quem.orgId,
      ficha_id: id,
      tipo,
      nome: arquivo.name.slice(0, 120),
      mime: arquivo.type,
      tamanho: arquivo.size,
      storage_path: caminho,
      enviado_por: quem.userId,
    })
    .select("id")
    .single();
  if (error || !doc) {
    await admin.storage.from("iavek-fichas").remove([caminho]);
    return fail("internal_error", t("Não consegui guardar o documento."), 500, { requestId });
  }
  void audit({
    action: "iavek.ficha_documento_anexado",
    actorUserId: quem.userId,
    organizationId: quem.orgId,
    resourceType: "iavek_fichas",
    resourceId: id,
    requestId,
    metadata: { documento_id: doc.id, tipo },
  });
  return ok({ id: doc.id }, { requestId });
}
