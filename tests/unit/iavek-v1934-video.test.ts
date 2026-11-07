// ia.vek CRM-258: o vídeo é encolhido no servidor (720p, ~0,9 Mbit/s) e vai já convertido; acima de 3 min,
// ou se não couber em 16 MB, vai como documento; até 300 MB para escolher.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { argumentosDoFfmpeg, comoEnviar, VIDEO_MAX_ENTRADA_BYTES } from "@/lib/iavek/video/encolher-video";
import { motivoLegivel } from "@/lib/iavek/video/fila-do-video";
import { wahaSendPlanFor } from "@/lib/waha/media-send";

const MB = 1024 * 1024;

describe("CRM-258: vídeo ou documento", () => {
  it("até 3 min e até 16 MB vai como vídeo", () => {
    expect(comoEnviar(120, 14 * MB)).toEqual({ tipo: "video" });
    expect(comoEnviar(180, 16 * MB)).toEqual({ tipo: "video" });
  });
  it("acima de 3 min vai como documento, mesmo pequeno", () => {
    expect(comoEnviar(181, 5 * MB)).toEqual({ tipo: "document" });
  });
  it("se não couber em 16 MB vai como documento", () => {
    expect(comoEnviar(150, 17 * MB)).toEqual({ tipo: "document" });
  });
  it("acima do que o Storage guarda (50 MB) é recusado com motivo", () => {
    expect(comoEnviar(900, 51 * MB)).toEqual({ tipo: "longo_demais" });
    expect(motivoLegivel(new Error("longo_demais"))).toMatch(/longo demais/);
  });
  it("o teto de escolha é 300 MB", () => {
    expect(VIDEO_MAX_ENTRADA_BYTES).toBe(300 * MB);
  });
});

describe("CRM-258: como encolhe", () => {
  const a = argumentosDoFfmpeg("in", "out.mp4").join(" ");
  it("720p sem aumentar vídeo menor, ~0,9 Mbit/s, H.264 + AAC, faststart, 2 núcleos", () => {
    expect(a).toContain("scale=-2:'min(720,ih)'");
    expect(a).toContain("-b:v 900k");
    expect(a).toContain("-c:v libx264");
    expect(a).toContain("-c:a aac");
    expect(a).toContain("+faststart");
    expect(a).toContain("-threads 2");
  });
  it("o ffmpeg roda com prioridade baixa (nice) para não disputar a CPU com a equipe", () => {
    const fonte = readFileSync("lib/iavek/video/encolher-video.ts", "utf8");
    expect(fonte).toMatch(/rodar\("nice", \["-n", "10", "ffmpeg"/);
  });
  it("todo erro vira um motivo legível", () => {
    for (const e of ["nao_e_video", "conversao_demorou_demais", "ffmpeg_exit_1: x", "ffmpeg_indisponivel: x", "upload", "outra"]) {
      expect(motivoLegivel(new Error(e))).toMatch(/\.$/);
      expect(motivoLegivel(new Error(e))).not.toMatch(/ffmpeg|exit|_/);
    }
  });
});

describe("CRM-258: envio já convertido", () => {
  const media = { url: "https://x/y.mp4", mime: "video/mp4" };
  it("vídeo encolhido vai com convert:false", () => {
    expect(wahaSendPlanFor("video", { ...media, jaConvertido: true }).payload).toMatchObject({ convert: false });
  });
  it("vídeo de outro caminho segue com convert:true (nada muda para ele)", () => {
    expect(wahaSendPlanFor("video", media).payload).toMatchObject({ convert: true });
  });
  it("o envio só marca como já convertido o arquivo que a fila de vídeo gerou", () => {
    const h = readFileSync("app/api/v1/messages/_handler.ts", "utf8");
    expect(h).toContain('(filename ?? "").startsWith("encolhido-")');
    const fila = readFileSync("lib/iavek/video/fila-do-video.ts", "utf8");
    expect(fila).toContain("encolhido-${randomUUID()}.mp4");
  });
});

describe("CRM-258: o proxy deixa de fora SÓ o envio de vídeo", () => {
  const fonte = readFileSync("proxy.ts", "utf8");
  const m = fonte.match(/matcher: \[\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*"([^"]+)"/);
  const re = new RegExp(`^${m![1]!.replace(/\\\\/g, "\\")}$`);
  it("o envio de vídeo não passa pelo proxy (que cortaria o corpo em 10 MB)", () => {
    expect(re.test("/api/v1/conversations/abc-123/media/video")).toBe(false);
  });
  it("o resto segue passando: o estado do vídeo, a mídia comum, as telas", () => {
    expect(re.test("/api/v1/conversations/abc-123/media/video/trab-1")).toBe(true);
    expect(re.test("/api/v1/conversations/abc-123/media")).toBe(true);
    expect(re.test("/api/v1/messages")).toBe(true);
    expect(re.test("/app/inbox")).toBe(true);
  });
});
