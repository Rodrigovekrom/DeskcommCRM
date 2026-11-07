import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/media/video — ia.vek CRM-258: o vídeo do atendente, até 300 MB.
 *
 * O corpo é o PRÓPRIO arquivo (não multipart), gravado em disco aos poucos — nunca 300 MB na memória — e
 * cortado ao passar do teto. O tipo é conferido pelo cabeçalho e, de novo, pelo ffprobe na conversão
 * (o arquivo precisa ter faixa de vídeo). A conversão roda FORA do pedido (`fila-do-video`): a resposta é
 * imediata (201, com o id do trabalho) e a tela pergunta o estado em `.../video/[trabalho]`.
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { VIDEO_MAX_ENTRADA_BYTES } from "@/lib/iavek/video/encolher-video";
import { iniciarConversao } from "@/lib/iavek/video/fila-do-video";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id: conversationId } = await ctx.params;
  const authz = await resolveAuthDual(req, { requestId, resource: "conversation_media", role: "agent", scope: "mcp:write" });
  if (!authz.ok) return authz.response;
  const teto = await tetoDeEscritaDoToken(authz, "conversation_media", requestId);
  if (teto) return teto;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);

  // A conversa precisa ser visível para quem envia (a mesma conferência da rota de mídia).
  const { data: conv, error: convErr } = await authz.supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", authz.organizationId)
    .maybeSingle();
  if (convErr) return fail("internal_error", t("Erro ao validar conversa."), 500, { requestId });
  if (!conv) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime.startsWith("video/")) return fail("unsupported_media_type", t("Envie um arquivo de vídeo."), 415, { requestId });
  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > VIDEO_MAX_ENTRADA_BYTES) return fail("payload_too_large", t("Vídeo acima de 300 MB."), 413, { requestId });
  if (!req.body) return fail("validation_failed", t("Arquivo vazio."), 422, { requestId });

  const dir = await mkdtemp(join(tmpdir(), "video-"));
  const entrada = join(dir, "original");
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const arquivo = createWriteStream(entrada);
      const leitor = req.body!.getReader();
      const bombear = async (): Promise<void> => {
        for (;;) {
          const { done, value } = await leitor.read();
          if (done) break;
          total += value.byteLength;
          if (total > VIDEO_MAX_ENTRADA_BYTES) {
            await leitor.cancel().catch(() => {});
            throw new Error("grande_demais");
          }
          if (!arquivo.write(value)) await new Promise<void>((r) => arquivo.once("drain", () => r()));
        }
        arquivo.end();
      };
      arquivo.on("finish", () => resolve());
      arquivo.on("error", reject);
      bombear().catch((e) => { arquivo.destroy(); reject(e); });
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (err instanceof Error && err.message === "grande_demais") return fail("payload_too_large", t("Vídeo acima de 300 MB."), 413, { requestId });
    return fail("internal_error", t("Não deu para receber o vídeo."), 500, { requestId });
  }
  if (total === 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return fail("validation_failed", t("Arquivo vazio."), 422, { requestId });
  }

  const trabalho = iniciarConversao({ org: authz.organizationId, conversationId, userId: authz.actor.id, dir, entrada });
  return ok({ trabalho, recebido_bytes: total }, { requestId, status: 201 });
}
