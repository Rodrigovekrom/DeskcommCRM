/**
 * AVISO NO GRUPO DO WHATSAPP DA EQUIPE (ia.vek D4).
 *
 * Decisão do Rodrigo (16/10/2026): UM grupo, com o tipo no prefixo —
 * 🎉 comemoração (agendou), 🚨 urgência (travou, precisa de ajuda),
 * 📊 observação (reengajou, objeção recorrente). O grupo e o número que envia
 * moram em `organizations.settings.aviso_grupo`; cada regra de automação só
 * escolhe o tipo e o texto.
 *
 * Proteção do número: espaçamento mínimo entre dois avisos ao grupo e um teto
 * por dia (no fuso da organização). Aviso interno não respeita a janela de
 * disparo ao cliente (é a equipe, como o aviso de caso). Teto atingido não
 * empurra para amanhã: um 🚨 de ontem chega velho, então ele é PULADO e conta.
 */
import { z } from "zod";

export const TIPOS_DE_AVISO = ["comemoracao", "urgente", "observacao"] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

export const PREFIXO_DO_AVISO: Record<TipoDeAviso, string> = {
  comemoracao: "🎉",
  urgente: "🚨",
  observacao: "📊",
};

export const ID_DE_GRUPO = /^[\d-]+@g\.us$/;

export const avisoGrupoSettingsSchema = z.strictObject({
  channel_session_id: z.string().uuid(),
  group_chat_id: z.string().regex(ID_DE_GRUPO, "Grupo inválido."),
  /** Rótulo para a tela (o nome do grupo quando foi escolhido). */
  group_subject: z.string().max(120).optional(),
  espacamento_segundos: z.number().int().min(10).max(3600).default(60),
  teto_diario: z.number().int().min(1).max(200).default(30),
});
export type AvisoGrupoSettings = z.infer<typeof avisoGrupoSettingsSchema>;

/** Lê `settings.aviso_grupo`; ausente ou inválido = não configurado (null). */
export function configDoAvisoGrupo(settings: unknown): AvisoGrupoSettings | null {
  const bruto = (settings as Record<string, unknown> | null)?.aviso_grupo;
  if (bruto === undefined || bruto === null) return null;
  const r = avisoGrupoSettingsSchema.safeParse(bruto);
  return r.success ? r.data : null;
}

export const TETO_DO_TEXTO = 1000;

/** O texto que vai ao grupo: prefixo do tipo + corpo, sem passar do teto. */
export function textoDoAviso(tipo: TipoDeAviso, corpo: string): string {
  const limpo = corpo.trim();
  const jaTemPrefixo = limpo.startsWith(PREFIXO_DO_AVISO[tipo]);
  const texto = jaTemPrefixo ? limpo : `${PREFIXO_DO_AVISO[tipo]} ${limpo}`;
  return texto.length > TETO_DO_TEXTO ? `${texto.slice(0, TETO_DO_TEXTO - 1)}…` : texto;
}

export type DecisaoDoAviso =
  | { tipo: "enviar" }
  | { tipo: "adiar"; ate: Date }
  | { tipo: "teto_atingido" };

export function decidirAviso(input: {
  agora: Date;
  ultimoEnvio: Date | null;
  enviadosHoje: number;
  cfg: Pick<AvisoGrupoSettings, "espacamento_segundos" | "teto_diario">;
}): DecisaoDoAviso {
  if (input.enviadosHoje >= input.cfg.teto_diario) return { tipo: "teto_atingido" };
  if (input.ultimoEnvio) {
    const libera = input.ultimoEnvio.getTime() + input.cfg.espacamento_segundos * 1000;
    if (libera > input.agora.getTime()) return { tipo: "adiar", ate: new Date(libera) };
  }
  return { tipo: "enviar" };
}
