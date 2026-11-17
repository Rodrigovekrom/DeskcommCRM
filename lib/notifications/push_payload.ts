import { z } from "zod";

export const PUSH_PAYLOAD_MAX = 140;

export const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  tag: z.string().optional(),
  href: z.string().optional(),
  icon: z.string().optional(),
});

export type PushPayload = z.infer<typeof pushPayloadSchema>;

/**
 * ia.vek CRM-530: o que o aviso mostra na TELA DE BLOQUEIO, por org (`settings.iavek.push.conteudo`). Decisão do Rodrigo
 * (17/11): de fábrica, o título "Nova mensagem de <nome>", sem o texto da mensagem e sem a foto do contato.
 *   - 'so_nome' (o padrão): o título com o nome; o corpo é um convite neutro; sem foto;
 *   - 'completo': o de antes (o nome no título, até 140 caracteres do texto, e a foto);
 *   - 'nada': só "Nova mensagem", sem nome, texto nem foto.
 * Qualquer outro valor, ou ausente, vale 'so_nome'.
 */
export type ConteudoDoAviso = "so_nome" | "completo" | "nada";
export const CORPO_NEUTRO = "Toque para abrir a conversa";

export function conteudoDoAviso(settings: unknown): ConteudoDoAviso {
  const v = (settings as { iavek?: { push?: { conteudo?: unknown } } } | null)?.iavek?.push?.conteudo;
  return v === "completo" || v === "nada" ? v : "so_nome";
}

export function montarPayloadDeInbound(input: {
  brand: string;
  conversationId: string | null;
  preview: string;
  contactName?: string | null;
  icon?: string | null;
  /** ia.vek CRM-530: o que a tela de bloqueio mostra. Ausente = 'so_nome' (o padrão). */
  conteudo?: ConteudoDoAviso;
}): PushPayload {
  void input.brand;
  const conteudo = input.conteudo ?? "so_nome";
  const nome = input.contactName?.trim() || "";
  const tag = input.conversationId ? `msg:${input.conversationId}` : "msg";
  const href = input.conversationId ? `/app/inbox?id=${input.conversationId}` : "/app/inbox";
  if (conteudo === "nada") return { title: "Nova mensagem", body: CORPO_NEUTRO, tag, href };
  if (conteudo === "so_nome") {
    return { title: nome ? `Nova mensagem de ${nome}` : "Nova mensagem", body: CORPO_NEUTRO, tag, href };
  }
  const title = nome || "Nova mensagem";
  const body = truncar(input.preview);
  const icon = input.icon?.trim() || undefined;
  return { title, body, tag, href, icon };
}

export function truncar(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= PUSH_PAYLOAD_MAX) return t;
  return `${t.slice(0, PUSH_PAYLOAD_MAX - 1)}…`;
}

/** Sem cliente visível o SW mostra a bandeja; aba visível o emit da página cobre. */
export function pushDeveMostrarBandeja(clientesVisiveis: number): boolean {
  return clientesVisiveis === 0;
}
