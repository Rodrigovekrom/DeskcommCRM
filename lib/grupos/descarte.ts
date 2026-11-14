/**
 * ia.vek v1.9.57 (card "Registrar aviso de grupo ligado que não foi reconhecido · Sistema"; Maestro 153024).
 *
 * Mensagem de grupo que não casa com um grupo LIGADO é descartada (`grupo_desligado`), calada. Isso é certo para o grupo
 * que ninguém ligou, mas esconde o defeito do grupo LIGADO que não foi reconhecido: o id que o provedor manda em outro
 * formato, ou a mensagem que chega por OUTRA sessão do canal. Medido em 14/11 (grupo da AEG): "ninguém postou" e
 * "postou e não casou" ficavam iguais.
 *
 * Aqui, só para a org que TEM grupo ligado (a que não tem segue calada, como hoje):
 *  - PARECIDO com um ligado (o mesmo id em outra sessão, ou os mesmos dígitos em outro formato) → `warn` na hora:
 *    `grupo_habilitado_nao_reconhecido`, com o motivo. É o defeito, e é raro;
 *  - qualquer outro grupo → só conta; a cada 10 min, 1 linha `info` por org (`grupos_descartados`: quantas e quantos
 *    grupos distintos), para não encher o log com os grupos em que o número está.
 * Os ids vão como HASH curto (sha256, 10 hex), nunca crus. Sem org fixa: vale para toda org.
 */
import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";

export interface GrupoHabilitado {
  groupChatId: string;
  channelSessionId: string;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);
const digitos = (s: string) => s.split("@")[0]!.replace(/\D/g, "");

/** O ligado que se parece com o que chegou, e por quê; null = nenhum parecido. Exportada para o teste. */
export function parecidoComLigado(
  chatId: string,
  sessao: string,
  ligados: GrupoHabilitado[],
): { ligado: GrupoHabilitado; motivo: "outra_sessao" | "id_em_outro_formato" } | null {
  for (const g of ligados) {
    if (g.groupChatId === chatId && g.channelSessionId !== sessao) return { ligado: g, motivo: "outra_sessao" };
  }
  const d = digitos(chatId);
  if (d.length < 10) return null;
  for (const g of ligados) {
    if (g.groupChatId === chatId) continue;
    const dl = digitos(g.groupChatId);
    if (dl.length >= 10 && (dl === d || d.includes(dl) || dl.includes(d))) return { ligado: g, motivo: "id_em_outro_formato" };
  }
  return null;
}

const JANELA_MS = 10 * 60_000;
const contagem = new Map<string, { n: number; grupos: Set<string>; desde: number }>();

/** Só para o teste. */
export function zerarContagemDeDescartes(): void {
  contagem.clear();
}

/**
 * Chamado quando a mensagem de grupo NÃO casou com um ligado. `ligados` = os grupos ligados da org (lista vazia = a org
 * não tem grupo ligado: nada a registrar). Nunca lança.
 */
export function registrarDescarteDeGrupo(
  org: string,
  chatId: string,
  sessao: string,
  ligados: GrupoHabilitado[],
  agora: number = Date.now(),
): "nada" | "aviso" | "contado" {
  try {
    if (ligados.length === 0) return "nada";
    const p = parecidoComLigado(chatId, sessao, ligados);
    if (p) {
      logger.warn("grupo_habilitado_nao_reconhecido", {
        organization_id: org,
        motivo: p.motivo,
        chat_hash: hash(chatId),
        ligado_hash: hash(p.ligado.groupChatId),
        mesma_sessao: p.ligado.channelSessionId === sessao,
      });
      return "aviso";
    }
    const c = contagem.get(org) ?? { n: 0, grupos: new Set<string>(), desde: agora };
    c.n += 1;
    c.grupos.add(hash(chatId));
    if (agora - c.desde >= JANELA_MS) {
      logger.info("grupos_descartados", { organization_id: org, mensagens: c.n, grupos_distintos: c.grupos.size, janela_min: Math.round((agora - c.desde) / 60_000) });
      contagem.set(org, { n: 0, grupos: new Set<string>(), desde: agora });
    } else {
      contagem.set(org, c);
    }
    return "contado";
  } catch {
    return "nada";
  }
}
