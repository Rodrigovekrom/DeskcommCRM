/**
 * ia.vek v1.5 (parte C): as fotos do carro da troca. A seleção mora no lead,
 * em `custom_fields.troca_fotos`: uma lista de referências "m:<id da mensagem>"
 * ou "n:<id da nota>" — nunca o caminho do arquivo, que a retenção anula quando
 * a mídia vence.
 */
export const CHAVE_DAS_FOTOS_DA_TROCA = "troca_fotos";
export const LEGENDA_DA_FOTO_DA_TROCA = "Foto do carro da troca";
/** Teto da lista no lead: `custom_fields` não tem limite próprio. */
export const MAX_FOTOS_DA_TROCA = 30;

export interface FotoDaTroca {
  ref: string;
  origem: "mensagem" | "nota";
  id: string;
  conversation_id: string;
  created_at: string;
  /** Quem mandou: o cliente (mensagem recebida) ou a equipe. */
  de: "cliente" | "equipe";
  expirada: boolean;
  url: string;
}

interface LinhaDaMensagem {
  id: string;
  conversation_id: string;
  created_at: string;
  direction: string;
  media_storage_path: string | null;
  media_url: string | null;
  metadata: unknown;
}

interface LinhaDaNota {
  id: string;
  conversation_id: string;
  created_at: string;
  media_storage_path: string | null;
}

export function fotoDaMensagem(m: LinhaDaMensagem): FotoDaTroca {
  const status = (m.metadata as { media_status?: unknown } | null)?.media_status;
  return {
    ref: `m:${m.id}`,
    origem: "mensagem",
    id: m.id,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    de: m.direction === "inbound" ? "cliente" : "equipe",
    expirada: status === "expired" || (!m.media_storage_path && !m.media_url),
    url: `/api/v1/messages/${m.id}/media`,
  };
}

export function fotoDaNota(n: LinhaDaNota): FotoDaTroca {
  return {
    ref: `n:${n.id}`,
    origem: "nota",
    id: n.id,
    conversation_id: n.conversation_id,
    created_at: n.created_at,
    de: "equipe",
    expirada: !n.media_storage_path,
    url: `/api/v1/conversations/${n.conversation_id}/notes/${n.id}/media`,
  };
}

/** A lista gravada no lead, lida com tolerância (valor estranho = vazia). */
export function refsMarcadas(customFields: Record<string, unknown> | null | undefined): string[] {
  const bruto = customFields?.[CHAVE_DAS_FOTOS_DA_TROCA];
  if (!Array.isArray(bruto)) return [];
  return bruto.filter((r): r is string => typeof r === "string" && /^[mn]:[0-9a-f-]{36}$/i.test(r));
}

/** Marca ou desmarca uma foto, sem repetir e sem passar do teto. */
export function alternarRef(atuais: string[], ref: string): string[] {
  if (atuais.includes(ref)) return atuais.filter((r) => r !== ref);
  return [...atuais, ref].slice(-MAX_FOTOS_DA_TROCA);
}
