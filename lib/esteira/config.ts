import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HORARIO_PADRAO, type HorarioComercial } from "./horas-uteis";

/**
 * CONFIGURAÇÃO DA ESTEIRA DE VENDAS (ia.vek D3) — `organizations.settings.esteira`.
 *
 * Diretriz do Rodrigo (16/10/2026): PAPÉIS, objetivo e trabalho, nunca pessoas.
 * Por isso quem recebe a escalada de ligação vencida e o relatório semanal é um
 * DESTINATÁRIO configurável na tela — um papel (todos com aquele papel ou acima)
 * ou um usuário — e nunca um nome no código ou no prompt.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const janela = z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, "abertura antes do fechamento");

export const PAPEIS_DESTINATARIOS = ["agent", "manager", "admin"] as const;

export const destinatarioSchema = z.discriminatedUnion("tipo", [
  z.strictObject({ tipo: z.literal("papel"), papel: z.enum(PAPEIS_DESTINATARIOS) }),
  z.strictObject({ tipo: z.literal("usuario"), usuario_id: z.string().uuid() }),
]);
export type Destinatario = z.infer<typeof destinatarioSchema>;

const uuid = z.string().uuid();

/** O funil de entrada (as 72h): onde o lead nasce e a IA atende. */
export const funilDeEntradaSchema = z.strictObject({
  pipeline_id: uuid,
  /** Horas corridas até a passagem para o follow-up. */
  horas: z.number().int().min(1).max(24 * 30).default(72),
  /** Colunas que contam como COMPROMISSO (agendado, vídeo): lead nelas não passa. */
  etapas_de_compromisso: z.array(uuid).default([]),
  /**
   * ia.vek v1.9.4: a esteira só cuida de lead que NASCEU a partir deste
   * instante. Ligar a esteira numa loja com centenas de leads antigos não pode
   * mandar todos de uma vez para o follow-up (com aviso e ligação para cada um).
   */
  desde: z.string().datetime({ offset: true }).optional(),
});

/** O funil de follow-up: fases por dia de vida do lead, e a coluna de quem voltou. */
export const funilDeFollowupSchema = z.strictObject({
  pipeline_id: uuid,
  /** Em ordem: o lead fica na 1ª fase cujo `ate_dia` alcança o dia de vida dele. */
  fases: z
    .array(z.strictObject({ ate_dia: z.number().int().min(1).max(365), etapa_id: uuid }))
    .min(1)
    .max(12),
  etapa_reengajou: uuid,
});

export const esteiraSettingsSchema = z.strictObject({
  /** Desligada por padrão: só roda quando os dois funis estão declarados e `ativa` é true. */
  ativa: z.boolean().optional(),
  entrada: funilDeEntradaSchema.optional(),
  followup: funilDeFollowupSchema.optional(),
  /** Quem recebe a 2ª cobrança (1 dia útil). Padrão: admin. */
  escalada_nivel2: destinatarioSchema.optional(),
  horario_comercial: z
    .strictObject({
      fuso: z.string().min(1).max(64),
      dias: z
        .strictObject({
          "0": janela.optional(),
          "1": janela.optional(),
          "2": janela.optional(),
          "3": janela.optional(),
          "4": janela.optional(),
          "5": janela.optional(),
          "6": janela.optional(),
        })
        .partial(),
    })
    .optional(),
  /** Quem recebe a cobrança de ligação vencida (2 h úteis e 1 dia útil). */
  escalada: destinatarioSchema.optional(),
  /** Quem recebe o relatório semanal por vendedor. */
  relatorio_semanal: destinatarioSchema.optional(),
  /** Horas úteis de atraso para a 1ª e a 2ª cobrança. */
  escalada_horas: z.number().int().min(1).max(24).optional(),
  escalada_horas_nivel2: z.number().int().min(1).max(72).optional(),
});
export type EsteiraSettings = z.infer<typeof esteiraSettingsSchema>;

export interface ConfigDaEsteira {
  /** Presente só quando a esteira está ATIVA e os dois funis declarados. */
  funis: { entrada: z.infer<typeof funilDeEntradaSchema>; followup: z.infer<typeof funilDeFollowupSchema> } | null;
  horario: HorarioComercial;
  escaladaNivel2: Destinatario;
  escalada: Destinatario;
  relatorioSemanal: Destinatario;
  escaladaHoras: number;
  escaladaHorasNivel2: number;
}

/** Padrões: o horário da Fenômenos, escalada e relatório para gestor (e acima), 2 h e 9 h úteis. */
export const PADRAO_DA_ESTEIRA: ConfigDaEsteira = {
  funis: null,
  horario: HORARIO_PADRAO,
  escaladaNivel2: { tipo: "papel", papel: "admin" },
  escalada: { tipo: "papel", papel: "manager" },
  relatorioSemanal: { tipo: "papel", papel: "manager" },
  escaladaHoras: 2,
  escaladaHorasNivel2: 9,
};

/** Lê `settings.esteira`; valor inválido cai no padrão (nunca derruba quem chama). */
export function configDaEsteira(settings: unknown): ConfigDaEsteira {
  const bruto = (settings as Record<string, unknown> | null)?.esteira;
  const r = esteiraSettingsSchema.safeParse(bruto ?? {});
  if (!r.success) return PADRAO_DA_ESTEIRA;
  const e = r.data;
  return {
    funis: e.ativa === true && e.entrada && e.followup ? { entrada: e.entrada, followup: e.followup } : null,
    escaladaNivel2: e.escalada_nivel2 ?? PADRAO_DA_ESTEIRA.escaladaNivel2,
    horario: e.horario_comercial
      ? { fuso: e.horario_comercial.fuso, dias: e.horario_comercial.dias as HorarioComercial["dias"] }
      : PADRAO_DA_ESTEIRA.horario,
    escalada: e.escalada ?? PADRAO_DA_ESTEIRA.escalada,
    relatorioSemanal: e.relatorio_semanal ?? PADRAO_DA_ESTEIRA.relatorioSemanal,
    escaladaHoras: e.escalada_horas ?? PADRAO_DA_ESTEIRA.escaladaHoras,
    escaladaHorasNivel2: e.escalada_horas_nivel2 ?? PADRAO_DA_ESTEIRA.escaladaHorasNivel2,
  };
}

const RANK: Record<string, number> = { viewer: 1, agent: 2, manager: 3, admin: 4 };

/** Os usuários que um destinatário alcança hoje (papel = aquele papel ou acima). */
export async function usuariosDoDestinatario(
  admin: SupabaseClient,
  orgId: string,
  d: Destinatario,
): Promise<string[]> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", orgId);
  if (error || !data) return [];
  const membros = data as Array<{ user_id: string; role: string }>;
  if (d.tipo === "usuario") return membros.some((m) => m.user_id === d.usuario_id) ? [d.usuario_id] : [];
  const minimo = RANK[d.papel] ?? 99;
  return membros.filter((m) => (RANK[m.role] ?? 0) >= minimo).map((m) => m.user_id);
}
