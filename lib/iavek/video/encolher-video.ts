/**
 * ia.vek CRM-258 (Rodrigo, 06/11): o vídeo do atendente é ENCOLHIDO no servidor antes de ir ao WhatsApp.
 * Decisões: 720p; até 3 min vai como vídeo, acima (ou se não couber) vai como documento; até 300 MB para
 * escolher o arquivo. Só a versão encolhida fica guardada; o original temporário é apagado.
 *
 * O ffmpeg roda com prioridade BAIXA (`nice -n 10`) e no máximo 2 núcleos: a conversão não pode disputar a
 * CPU com a equipe usando o CRM. O ffmpeg já está na imagem do app (Dockerfile).
 */
import { spawn } from "node:child_process";

import {
  VIDEO_MAX_BYTES_COMO_VIDEO,
  VIDEO_MAX_BYTES_GUARDADO,
  VIDEO_MAX_SEGUNDOS_COMO_VIDEO,
  VIDEO_TETO_DA_CONVERSAO_MS,
} from "./limites";

export {
  VIDEO_MAX_BYTES_COMO_VIDEO,
  VIDEO_MAX_BYTES_GUARDADO,
  VIDEO_MAX_ENTRADA_BYTES,
  VIDEO_MAX_SEGUNDOS_COMO_VIDEO,
  VIDEO_TETO_DA_CONVERSAO_MS,
} from "./limites";

export type ComoEnviar = { tipo: "video" | "document" } | { tipo: "longo_demais" };

/** Vídeo ou documento, pela duração e pelo tamanho encolhido. Regra pura. */
export function comoEnviar(duracaoSegundos: number, bytesEncolhido: number): ComoEnviar {
  if (bytesEncolhido > VIDEO_MAX_BYTES_GUARDADO) return { tipo: "longo_demais" };
  if (duracaoSegundos > VIDEO_MAX_SEGUNDOS_COMO_VIDEO || bytesEncolhido > VIDEO_MAX_BYTES_COMO_VIDEO) return { tipo: "document" };
  return { tipo: "video" };
}

/**
 * Os argumentos do ffmpeg: MP4 H.264 + AAC, até 720 de altura (não aumenta vídeo menor), ~0,9 Mbit/s de
 * vídeo e 64 kbit/s de áudio; `faststart` para tocar enquanto baixa. 2 min ≈ 14 MB.
 */
export function argumentosDoFfmpeg(entrada: string, saida: string): string[] {
  return [
    "-nostdin", "-y", "-i", entrada,
    "-vf", "scale=-2:'min(720,ih)'",
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", "900k", "-maxrate", "1000k", "-bufsize", "2000k",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "64k", "-ac", "2",
    "-movflags", "+faststart",
    "-threads", "2",
    saida,
  ];
}

function rodar(cmd: string, args: string[], tetoMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let saida = "";
    let erro = "";
    proc.stdout?.on("data", (d: Buffer) => { saida = (saida + d.toString()).slice(-4000); });
    proc.stderr?.on("data", (d: Buffer) => { erro = (erro + d.toString()).slice(-600); });
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("conversao_demorou_demais")); }, tetoMs);
    proc.on("error", (err) => { clearTimeout(timer); reject(new Error(`ffmpeg_indisponivel: ${err.message}`)); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(saida);
      else reject(new Error(`ffmpeg_exit_${code}: ${erro}`));
    });
  });
}

/** Duração (s) e se há faixa de vídeo — o ffprobe confere que o arquivo é MESMO vídeo (não só o mime). */
export async function lerVideo(caminho: string): Promise<{ duracao: number; temVideo: boolean }> {
  const out = await rodar("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", caminho], 60_000);
  const j = JSON.parse(out || "{}") as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  return { duracao: Number(j.format?.duration ?? 0), temVideo: (j.streams ?? []).some((s) => s.codec_type === "video") };
}

/** Encolhe `entrada` em `saida`, com prioridade baixa. */
export async function encolher(entrada: string, saida: string): Promise<void> {
  await rodar("nice", ["-n", "10", "ffmpeg", ...argumentosDoFfmpeg(entrada, saida)], VIDEO_TETO_DA_CONVERSAO_MS);
}
