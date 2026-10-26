import { z } from "zod";

/**
 * ia.vek v1.9.0 — o PERFIL DA EMPRESA (pedido do Maestro, 26/10/2026).
 *
 * A instalação passa a atender mais de um tipo de empresa: a Fenômenos (loja de
 * carros) e a AP Clinic (clínica de procedimentos). O que foi feito para a loja
 * — carro de interesse, forma de pagamento, parcela, troca, Passar Ficha, o
 * estoque do Altimus e o texto da nota do atendimento — só aparece onde o
 * perfil é `loja_de_carros`. O "modo agendamento" (a IA e a recepção marcando
 * na agenda) é a outra chave, desligada por padrão.
 *
 * Mora em `organizations.settings.iavek.perfil`. AUSENTE OU INVÁLIDO vale como
 * loja de carros com o modo agendamento desligado: é o que toda organização já
 * instalada era até aqui, então a Fenômenos não muda nada sem que ninguém
 * grave coisa alguma. Quem grava é o admin da PLATAFORMA (na tela da empresa
 * ou ao criá-la), nunca o admin da organização.
 */

export const NICHOS_DA_EMPRESA = ["loja_de_carros", "clinica"] as const;
export type NichoDaEmpresa = (typeof NICHOS_DA_EMPRESA)[number];

export const perfilDaEmpresaSchema = z.strictObject({
  nicho: z.enum(NICHOS_DA_EMPRESA),
  modo_agendamento: z.boolean(),
});
export type PerfilDaEmpresa = z.infer<typeof perfilDaEmpresaSchema>;

export const PERFIL_PADRAO: PerfilDaEmpresa = Object.freeze({
  nicho: "loja_de_carros",
  modo_agendamento: false,
});

/** `settings.iavek.perfil`; ausente ou inválido = o padrão (loja de carros, sem modo agendamento). */
export function lerPerfilDaEmpresa(settings: unknown): PerfilDaEmpresa {
  const bruto = (settings as { iavek?: { perfil?: unknown } } | null)?.iavek?.perfil;
  const lido = perfilDaEmpresaSchema.safeParse(bruto);
  return lido.success ? lido.data : { ...PERFIL_PADRAO };
}

/** Devolve `settings` com o perfil gravado, sem perder as outras chaves do ia.vek. */
export function comPerfilDaEmpresa(settings: unknown, perfil: PerfilDaEmpresa): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, perfil } };
}

/** As telas e textos de loja de carros só valem aqui. */
export const ehLojaDeCarros = (perfil: Pick<PerfilDaEmpresa, "nicho"> | null | undefined): boolean =>
  (perfil?.nicho ?? PERFIL_PADRAO.nicho) === "loja_de_carros";
