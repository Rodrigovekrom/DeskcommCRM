/**
 * ia.vek CRM-258: a fila de conversão de vídeo — FORA do pedido. A rota recebe o vídeo, entrega aqui e
 * responde na hora; a tela mostra "enviando" e pergunta o estado. UMA conversão por vez (a CPU do servidor
 * é da equipe também). Estado na memória do processo do app: se o app reiniciar no meio, o trabalho some e
 * a tela mostra "falhou" (envie de novo) — nada fica pela metade no Storage nem no WhatsApp.
 */
import { randomUUID } from "node:crypto";
import { rm, stat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

import { comoEnviar, encolher, lerVideo } from "./encolher-video";

export type EstadoDoVideo =
  | { estado: "encolhendo" }
  | { estado: "pronto"; storage_path: string; media_mime: string; media_size_bytes: number; kind: "video" | "document"; duracao_s: number; ms: number }
  | { estado: "falhou"; motivo: string };

interface Trabalho {
  org: string;
  conversationId: string;
  userId: string;
  criadoEm: number;
  estado: EstadoDoVideo;
}

const trabalhos = new Map<string, Trabalho>();
let fila: Promise<void> = Promise.resolve();
const UMA_HORA = 60 * 60_000;

function limparVelhos() {
  const agora = Date.now();
  for (const [id, t] of trabalhos) if (agora - t.criadoEm > UMA_HORA) trabalhos.delete(id);
}

/** O motivo que a pessoa lê quando a conversão não deu. */
export function motivoLegivel(erro: unknown): string {
  const m = erro instanceof Error ? erro.message : String(erro);
  if (m === "nao_e_video") return "O arquivo não é um vídeo que dê para enviar.";
  if (m === "longo_demais") return "Vídeo longo demais: mesmo encolhido passa de 50 MB. Envie um trecho menor.";
  if (m === "conversao_demorou_demais") return "O vídeo demorou demais para encolher. Tente um trecho menor.";
  if (m.startsWith("ffmpeg_indisponivel")) return "O servidor não conseguiu encolher o vídeo agora. Tente de novo.";
  if (m.startsWith("ffmpeg_exit")) return "Não deu para ler este vídeo. Tente outro arquivo.";
  if (m === "upload") return "Não deu para guardar o vídeo. Tente de novo.";
  return "Não deu para preparar o vídeo. Tente de novo.";
}

async function processar(id: string, dir: string, entrada: string): Promise<void> {
  const t = trabalhos.get(id);
  if (!t) return;
  const t0 = Date.now();
  try {
    const info = await lerVideo(entrada);
    if (!info.temVideo) throw new Error("nao_e_video");
    const saida = join(dir, "encolhido.mp4");
    await encolher(entrada, saida);
    const { size } = await stat(saida);
    const como = comoEnviar(info.duracao, size);
    if (como.tipo === "longo_demais") throw new Error("longo_demais");
    const storagePath = `${t.org}/${t.conversationId}/encolhido-${randomUUID()}.mp4`;
    const { error } = await createAdminClient()
      .storage.from("whatsapp-media")
      .upload(storagePath, await readFile(saida), { contentType: "video/mp4", upsert: false });
    if (error) throw new Error("upload");
    t.estado = { estado: "pronto", storage_path: storagePath, media_mime: "video/mp4", media_size_bytes: size, kind: como.tipo, duracao_s: Math.round(info.duracao), ms: Date.now() - t0 };
    logger.info("video_encolhido", { organization_id: t.org, segundos: Math.round(info.duracao), bytes: size, ms: Date.now() - t0, kind: como.tipo });
  } catch (err) {
    t.estado = { estado: "falhou", motivo: motivoLegivel(err) };
    logger.warn("video_nao_encolheu", { organization_id: t.org, erro: err instanceof Error ? err.message.slice(0, 200) : String(err) });
  } finally {
    // O ORIGINAL nunca fica: só a versão encolhida vai para o Storage.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Entra na fila (uma conversão por vez) e devolve o id do trabalho. */
export function iniciarConversao(args: { org: string; conversationId: string; userId: string; dir: string; entrada: string }): string {
  limparVelhos();
  const id = randomUUID();
  trabalhos.set(id, { org: args.org, conversationId: args.conversationId, userId: args.userId, criadoEm: Date.now(), estado: { estado: "encolhendo" } });
  fila = fila.then(() => processar(id, args.dir, args.entrada)).catch(() => undefined);
  return id;
}

/** O estado, só para a mesma organização, conversa e pessoa que pediu. */
export function lerConversao(id: string, args: { org: string; conversationId: string; userId: string }): EstadoDoVideo | null {
  const t = trabalhos.get(id);
  if (!t || t.org !== args.org || t.conversationId !== args.conversationId || t.userId !== args.userId) return null;
  return t.estado;
}
