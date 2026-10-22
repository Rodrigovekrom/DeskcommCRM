import { z } from "zod";

/**
 * ia.vek v1.8.0 — o PADRÃO DA LOJA (Assistente do Vendedor, partes A1+A2).
 *
 * O admin define o que todo atendimento tem de ter (ex.: 6 fotos externas e 2
 * internas do carro, vídeo com o nome do cliente) e até quando. O sistema
 * CONFERE — sem IA: conta as fotos e os vídeos que o vendedor mandou na conversa
 * e lê as marcações de 1 toque dele — e só SINALIZA. Nada trava, nada envia.
 *
 * Mora em `organizations.settings.iavek.padrao_da_loja` (sem migration); as
 * marcações do vendedor, nos campos do lead (`custom_fields.iavek_padrao_<id>`,
 * data ISO), pelo merge atômico da 0502.
 */

export const TIPOS_DE_ITEM = ["marcacao", "campo"] as const;
export type TipoDeItem = (typeof TIPOS_DE_ITEM)[number];

/** Os campos do lead que um item do tipo "campo" pode exigir (ficha da compra, v1.5). */
export const CAMPOS_EXIGIVEIS = ["forma_pagamento", "tem_troca", "carro_interesse", "prazo_compra"] as const;

const itemSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    nome: z.string().trim().min(2).max(80),
    tipo: z.enum(TIPOS_DE_ITEM),
    /** marcação: o vendedor só marca depois de mandar ao menos isto na conversa. */
    minimo_de_fotos: z.number().int().min(0).max(50).default(0),
    minimo_de_videos: z.number().int().min(0).max(20).default(0),
    /** campo: a chave do lead que tem de estar preenchida. */
    campo: z.enum(CAMPOS_EXIGIVEIS).nullable().default(null),
    /** Prazo: até o lead ENTRAR nesta etapa (id), e/ou X horas depois de ele ter dono. */
    ate_etapa: z.uuid().nullable().default(null),
    horas: z.number().int().min(1).max(720).nullable().default(null),
  })
  .strict();
export type ItemDoPadrao = z.infer<typeof itemSchema>;

export const padraoDaLojaSchema = z
  .object({
    ativo: z.boolean(),
    itens: z
      .array(itemSchema)
      .max(20)
      .refine((l) => new Set(l.map((i) => i.id)).size === l.length, { message: "id repetido" }),
  })
  .strict();
export type PadraoDaLoja = z.infer<typeof padraoDaLojaSchema>;

/** O ponto de partida (exemplos da reunião com a loja). Começa DESLIGADO. */
export const PADRAO_INICIAL: PadraoDaLoja = {
  ativo: false,
  itens: [
    { id: "fotos_externas", nome: "6 fotos externas do carro", tipo: "marcacao", minimo_de_fotos: 6, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 },
    { id: "fotos_internas", nome: "2 fotos internas do carro", tipo: "marcacao", minimo_de_fotos: 8, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 },
    { id: "video_com_nome", nome: "Vídeo com o nome do cliente", tipo: "marcacao", minimo_de_fotos: 0, minimo_de_videos: 1, campo: null, ate_etapa: null, horas: 48 },
    { id: "forma_de_pagamento", nome: "Forma de pagamento definida", tipo: "campo", minimo_de_fotos: 0, minimo_de_videos: 0, campo: "forma_pagamento", ate_etapa: null, horas: 48 },
  ],
};

export function lerPadraoDaLoja(settings: unknown): PadraoDaLoja {
  const bruto = (settings as { iavek?: { padrao_da_loja?: unknown } } | null)?.iavek?.padrao_da_loja;
  const lido = padraoDaLojaSchema.safeParse(bruto);
  return lido.success ? lido.data : PADRAO_INICIAL;
}

export function comPadraoDaLoja(settings: unknown, padrao: PadraoDaLoja): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, padrao_da_loja: padrao } };
}

export const chaveDaMarcacao = (itemId: string) => `iavek_padrao_${itemId}`;

export type SituacaoDoItem = "feito" | "pendente" | "fora_do_padrao";

export interface ItemAvaliado {
  id: string;
  nome: string;
  tipo: TipoDeItem;
  situacao: SituacaoDoItem;
  /** Para marcação: por que ainda não dá para marcar (faltam fotos/vídeos). */
  bloqueio: string | null;
}

export interface LeadParaAvaliar {
  stage_id: string;
  assigned_at: string | null;
  created_at: string;
  custom_fields: Record<string, unknown> | null;
}

/**
 * A avaliação de um lead. `posicaoDaEtapa` dá a posição de cada etapa do funil
 * (para "até a etapa X"); `midia` é o que o VENDEDOR mandou na conversa.
 */
export function avaliarLead(
  padrao: PadraoDaLoja,
  lead: LeadParaAvaliar,
  midia: { fotos: number; videos: number },
  posicaoDaEtapa: Map<string, number>,
  agora: number = Date.now(),
): ItemAvaliado[] {
  const campos = lead.custom_fields ?? {};
  const posAtual = posicaoDaEtapa.get(lead.stage_id);
  const inicio = new Date(lead.assigned_at ?? lead.created_at).getTime();
  return padrao.itens.map((item) => {
    let feito: boolean;
    let bloqueio: string | null = null;
    if (item.tipo === "campo") {
      const v = item.campo ? campos[item.campo] : undefined;
      feito = v !== undefined && v !== null && v !== "";
    } else {
      feito = typeof campos[chaveDaMarcacao(item.id)] === "string";
      const faltamFotos = Math.max(0, item.minimo_de_fotos - midia.fotos);
      const faltamVideos = Math.max(0, item.minimo_de_videos - midia.videos);
      if (!feito && (faltamFotos > 0 || faltamVideos > 0)) {
        bloqueio = [faltamFotos > 0 ? `faltam ${faltamFotos} foto(s)` : null, faltamVideos > 0 ? `falta ${faltamVideos} vídeo(s)` : null]
          .filter(Boolean)
          .join(" e ");
      }
    }
    let vencido = false;
    if (item.ate_etapa) {
      const posAlvo = posicaoDaEtapa.get(item.ate_etapa);
      vencido = posAtual !== undefined && posAlvo !== undefined && posAtual >= posAlvo;
    }
    if (!vencido && item.horas && Number.isFinite(inicio)) vencido = agora - inicio > item.horas * 3600_000;
    const situacao: SituacaoDoItem = feito ? "feito" : vencido ? "fora_do_padrao" : "pendente";
    return { id: item.id, nome: item.nome, tipo: item.tipo, situacao, bloqueio };
  });
}

export function resumo(itens: ItemAvaliado[]) {
  return {
    pendentes: itens.filter((i) => i.situacao !== "feito").length,
    fora: itens.filter((i) => i.situacao === "fora_do_padrao").length,
  };
}
