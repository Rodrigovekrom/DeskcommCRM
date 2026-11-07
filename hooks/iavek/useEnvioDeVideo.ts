"use client";
/**
 * ia.vek CRM-258: o envio de VÍDEO pelo campo da mensagem, sem travar a conversa. O vídeo sobe para
 * `/media/video` (até 300 MB), o servidor encolhe FORA do pedido e a tela pergunta o estado; quando fica
 * pronto, o envio segue pelo caminho de sempre (`send`). Enquanto isso, um item "enviando vídeo" fica
 * acima do campo; se falhar, "falhou" com o motivo, e a conversa segue livre.
 */
import { useCallback, useState } from "react";

import { VIDEO_MAX_ENTRADA_BYTES } from "@/lib/iavek/video/encolher-video";

export interface VideoEmPreparo {
  id: string;
  nome: string;
  estado: "enviando" | "falhou";
  motivo?: string;
}

type Envio = (p: { type: "video" | "document"; body?: string; media_storage_path: string; media_mime: string; media_size_bytes: number }) => Promise<unknown>;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useEnvioDeVideo(conversationId: string, enviar: Envio) {
  const [itens, setItens] = useState<VideoEmPreparo[]>([]);
  const mudar = (id: string, p: Partial<VideoEmPreparo>) => setItens((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const tirar = useCallback((id: string) => setItens((xs) => xs.filter((x) => x.id !== id)), []);

  const enviarVideo = useCallback(
    async (file: File, legenda: string) => {
      const id = crypto.randomUUID();
      setItens((xs) => [...xs, { id, nome: file.name, estado: "enviando" }]);
      const falhou = (motivo: string) => mudar(id, { estado: "falhou", motivo });
      if (file.size > VIDEO_MAX_ENTRADA_BYTES) return falhou("Vídeo acima de 300 MB.");
      try {
        const r = await fetch(`/api/v1/conversations/${conversationId}/media/video`, {
          method: "POST",
          headers: { "content-type": file.type || "video/mp4" },
          body: file,
        });
        const j = (await r.json().catch(() => null)) as { data?: { trabalho: string }; error?: { message?: string } } | null;
        if (!r.ok || !j?.data?.trabalho) return falhou(j?.error?.message ?? "Não deu para enviar o vídeo.");
        // Pergunta o estado até ficar pronto (o encolhimento leva de segundos a poucos minutos).
        for (let i = 0; i < 400; i++) {
          await esperar(i < 5 ? 1000 : 2000);
          const e = await fetch(`/api/v1/conversations/${conversationId}/media/video/${j.data.trabalho}`);
          const ej = (await e.json().catch(() => null)) as
            | { data?: { estado: string; motivo?: string; storage_path?: string; media_mime?: string; media_size_bytes?: number; kind?: "video" | "document" }; error?: { message?: string } }
            | null;
          if (!e.ok) return falhou(ej?.error?.message ?? "Não deu para preparar o vídeo.");
          if (ej?.data?.estado === "falhou") return falhou(ej.data.motivo ?? "Não deu para preparar o vídeo.");
          if (ej?.data?.estado === "pronto" && ej.data.storage_path && ej.data.kind) {
            await enviar({
              type: ej.data.kind,
              ...(legenda ? { body: legenda } : {}),
              media_storage_path: ej.data.storage_path,
              media_mime: ej.data.media_mime ?? "video/mp4",
              media_size_bytes: ej.data.media_size_bytes ?? 0,
            });
            tirar(id);
            return;
          }
        }
        falhou("O vídeo demorou demais para ficar pronto. Tente um trecho menor.");
      } catch {
        falhou("Não deu para enviar o vídeo. Confira a internet e tente de novo.");
      }
    },
    [conversationId, enviar, tirar],
  );

  return { itens, enviarVideo, tirar };
}
