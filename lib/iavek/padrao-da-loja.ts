import { z } from "zod";

import { HORARIO_PADRAO, inicioDoDiaLocal, somarHorasUteis, type HorarioComercial } from "@/lib/esteira/horas-uteis";

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

/**
 * v1.9.55 (CRM-172, decisão do Rodrigo 13/11): tipos novos, todos SEM IA, só leitura do que já está no banco:
 *  - resposta: a 1ª resposta de GENTE (0633: sent_by_user_id) em até N minutos ÚTEIS (horário da loja);
 *  - ficha: os campos obrigatórios da ficha preenchidos (fn_iavek_campos_que_faltam vazio);
 *  - agendamento: há uma visita (calendar_appointments não cancelado) do contato, criada depois do lead;
 *  - confirmacao: uma mensagem de saída de GENTE na véspera (dia local) da visita.
 */
export const TIPOS_DE_ITEM = ["marcacao", "campo", "resposta", "ficha", "agendamento", "confirmacao"] as const;
export type TipoDeItem = (typeof TIPOS_DE_ITEM)[number];

/** De quem é o item: o relógio do SDR começa na CHEGADA do lead; o do vendedor, quando ele vira dono. */
export const PAPEIS_DO_ITEM = ["sdr", "vendedor"] as const;
export type PapelDoItem = (typeof PAPEIS_DO_ITEM)[number];

/** Os campos do lead que um item do tipo "campo" pode exigir (ficha da compra, v1.5). */
export const CAMPOS_EXIGIVEIS = ["forma_pagamento", "tem_troca", "carro_interesse", "prazo_compra"] as const;

const itemSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    nome: z.string().trim().min(2).max(80),
    tipo: z.enum(TIPOS_DE_ITEM),
    papel: z.enum(PAPEIS_DO_ITEM).default("vendedor"),
    /** resposta: em até N minutos úteis. */
    minutos: z.number().int().min(1).max(240).nullable().default(null),
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
    // v1.9.55 (CRM-172): o padrão novo, de loja nova. A loja que já existe ganha o dela pela tela ou por roteiro de dado.
    { id: "resposta_7_min", nome: "Responder em até 7 minutos", tipo: "resposta", papel: "sdr", minutos: 7, minimo_de_fotos: 0, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: null },
    { id: "fotos_e_video", nome: "3 fotos e 1 vídeo do carro", tipo: "marcacao", papel: "sdr", minutos: null, minimo_de_fotos: 3, minimo_de_videos: 1, campo: null, ate_etapa: null, horas: 24 },
    { id: "ficha_completa", nome: "Ficha completa", tipo: "ficha", papel: "sdr", minutos: null, minimo_de_fotos: 0, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 24 },
    { id: "visita_agendada", nome: "Visita agendada", tipo: "agendamento", papel: "sdr", minutos: null, minimo_de_fotos: 0, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: 48 },
    { id: "confirmou_vespera", nome: "Visita confirmada na véspera", tipo: "confirmacao", papel: "sdr", minutos: null, minimo_de_fotos: 0, minimo_de_videos: 0, campo: null, ate_etapa: null, horas: null },
    { id: "video_com_nome", nome: "Vídeo com o nome do cliente", tipo: "marcacao", papel: "vendedor", minutos: null, minimo_de_fotos: 0, minimo_de_videos: 1, campo: null, ate_etapa: null, horas: 48 },
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

/** 'nao_se_aplica': o item não vale para este lead agora (ex.: confirmar a visita, sem visita marcada). */
export type SituacaoDoItem = "feito" | "pendente" | "fora_do_padrao" | "nao_se_aplica";

export interface ItemAvaliado {
  id: string;
  nome: string;
  tipo: TipoDeItem;
  papel: PapelDoItem;
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

/** v1.9.55: os fatos do lead que os tipos novos leem (o servidor junta por LOTE; ausente = desconhecido = não feito). */
export interface FatosDoLead {
  /** A 1ª saída de GENTE na conversa do contato, depois da chegada do lead (epoch ms). */
  primeiraRespostaDeGente?: number | null;
  /** fn_iavek_campos_que_faltam vazio. */
  fichaCompleta?: boolean | null;
  /** Há visita não cancelada do contato, criada depois do lead. */
  temVisita?: boolean | null;
  /** A visita (a próxima, ou a mais recente) e se houve saída de GENTE na véspera dela. */
  visita?: { inicio: number; confirmadaNaVespera: boolean } | null;
  /** O horário da loja (settings.esteira.horario_comercial); sem ele, o padrão. */
  horario?: HorarioComercial;
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
  fatos: FatosDoLead = {},
): ItemAvaliado[] {
  const campos = lead.custom_fields ?? {};
  const posAtual = posicaoDaEtapa.get(lead.stage_id);
  const chegada = new Date(lead.created_at).getTime();
  const horario = fatos.horario ?? HORARIO_PADRAO;
  return padrao.itens.map((item) => {
    // o relógio do SDR corre desde a CHEGADA; o do vendedor, desde que ele virou dono
    const inicio = item.papel === "sdr" ? chegada : new Date(lead.assigned_at ?? lead.created_at).getTime();
    const base = { id: item.id, nome: item.nome, tipo: item.tipo, papel: item.papel };
    if (item.tipo === "resposta") {
      if (!Number.isFinite(chegada) || !item.minutos) return { ...base, situacao: "pendente" as const, bloqueio: null };
      const limite = somarHorasUteis(new Date(chegada), item.minutos / 60, horario).getTime();
      const r = fatos.primeiraRespostaDeGente ?? null;
      const situacao: SituacaoDoItem = r !== null ? (r <= limite ? "feito" : "fora_do_padrao") : agora > limite ? "fora_do_padrao" : "pendente";
      return { ...base, situacao, bloqueio: null };
    }
    if (item.tipo === "confirmacao") {
      const v = fatos.visita ?? null;
      if (!v) return { ...base, situacao: "nao_se_aplica" as const, bloqueio: null };
      if (v.confirmadaNaVespera) return { ...base, situacao: "feito" as const, bloqueio: null };
      // chegou o DIA da visita (no fuso da loja) e não houve a confirmação na véspera
      const diaDaVisita = inicioDoDiaLocal(new Date(v.inicio), horario.fuso).getTime();
      return { ...base, situacao: agora >= diaDaVisita ? ("fora_do_padrao" as const) : ("pendente" as const), bloqueio: null };
    }
    let feito: boolean;
    let bloqueio: string | null = null;
    if (item.tipo === "ficha") {
      feito = fatos.fichaCompleta === true;
    } else if (item.tipo === "agendamento") {
      feito = fatos.temVisita === true;
    } else if (item.tipo === "campo") {
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
    return { ...base, situacao, bloqueio };
  });
}

export function resumo(itens: ItemAvaliado[]) {
  return {
    pendentes: itens.filter((i) => i.situacao === "pendente" || i.situacao === "fora_do_padrao").length,
    fora: itens.filter((i) => i.situacao === "fora_do_padrao").length,
  };
}
