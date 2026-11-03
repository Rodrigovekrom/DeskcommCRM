import { z } from "zod";

import { funcaoDaTela } from "@/lib/iavek/funcoes";

/**
 * ia.vek v1.9.13 — o canal de orientação da IA (CRM-220, migration 0601).
 *
 * Quem é do Suporte IA não responde no lugar da IA: orienta, e a IA escreve. Mora
 * em `settings.iavek.canal_orientacao_ia.ativo`; ausente = desligado.
 */
export const orientacaoSchema = z.object({ texto: z.string().trim().min(1).max(1000) });
export const revisaoSchema = z.object({ revisao: z.enum(["virou_regra", "descartada"]) });
export const canalSchema = z.strictObject({ ativo: z.boolean() });

export function canalDaIaAtivo(settings: unknown): boolean {
  const iavek = (settings as { iavek?: { canal_orientacao_ia?: { ativo?: unknown } } } | null)?.iavek;
  return iavek?.canal_orientacao_ia?.ativo === true;
}

/** Devolve `settings` com a chave gravada, sem perder as outras do ia.vek. */
export function comCanalDaIa(settings: unknown, ativo: boolean): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, canal_orientacao_ia: { ativo } } };
}

/** Quem orienta: Suporte IA, gerente e admin. A mesma régua de `fn_iavek_orientar_ia`. */
export function podeOrientar(role: string | null | undefined, funcao: unknown): boolean {
  if (role === "admin" || role === "manager") return true;
  return role === "agent" && funcaoDaTela(funcao) === "suporte";
}

/**
 * O que a sugestão recebe: as orientações DESTA conversa, nunca de outra. A IA não
 * aprende sozinha: o que vale para todas as conversas passa pela revisão semanal.
 */
export function blocoDeOrientacoes(textos: readonly string[]): string {
  if (textos.length === 0) return "";
  return (
    "## Orientação da equipe para este atendimento\n" +
    "Vale só para esta conversa. Siga ao escrever ao cliente, sem mencionar que recebeu orientação.\n" +
    textos.map((t) => `- ${t}`).join("\n")
  );
}
