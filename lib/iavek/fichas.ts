import { z } from "zod";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import type { Idioma } from "@/lib/i18n/idiomas";

/**
 * ia.vek v1.7.8 — Passar Ficha.
 *
 * A ficha de crédito do cliente (CPF, RG, renda, documentos) mora em
 * `iavek_fichas` / `iavek_ficha_documentos` (migration 0586), SEM acesso direto
 * da sessão: toda leitura e escrita passa por estas regras, no servidor.
 *
 * ⚠️ LGPD — o que NUNCA acontece com `dados`:
 *   - ir para log, auditoria, Sentry ou mensagem de erro (só ids e status);
 *   - ir para a IA (nenhuma ferramenta MCP nem prompt lê estas tabelas);
 *   - ir para o PDF da proposta (o documento da proposta não lê fichas).
 */

export const FUNCAO_ANALISTA_DE_FICHA = "analista_ficha";

export type TipoDeCampo = "texto" | "cpf" | "data" | "dinheiro" | "numero";

export interface CampoDaFicha {
  key: string;
  label: string;
  tipo: TipoDeCampo;
  obrigatorio: boolean;
}

/** Os campos iniciais (decisão do dono, 22/10/2026). O admin muda depois. */
export const CAMPOS_PADRAO_DA_FICHA: CampoDaFicha[] = [
  { key: "nome_completo", label: "Nome completo", tipo: "texto", obrigatorio: true },
  { key: "cpf", label: "CPF", tipo: "cpf", obrigatorio: true },
  { key: "rg", label: "RG", tipo: "texto", obrigatorio: true },
  { key: "data_nascimento", label: "Data de nascimento", tipo: "data", obrigatorio: true },
  { key: "renda_mensal", label: "Renda mensal", tipo: "dinheiro", obrigatorio: true },
  { key: "profissao", label: "Profissão", tipo: "texto", obrigatorio: true },
  { key: "endereco", label: "Endereço", tipo: "texto", obrigatorio: true },
  { key: "veiculo_interesse", label: "Veículo de interesse", tipo: "texto", obrigatorio: true },
  { key: "valor_veiculo", label: "Valor do veículo", tipo: "dinheiro", obrigatorio: true },
  { key: "entrada", label: "Entrada", tipo: "dinheiro", obrigatorio: false },
];

export const STATUS_DA_FICHA = ["enviada", "pendente_documento", "aprovada", "recusada"] as const;
export type StatusDaFicha = (typeof STATUS_DA_FICHA)[number];

export const TIPOS_DE_DOCUMENTO = ["rg", "cnh", "comprovante_renda", "comprovante_residencia", "outro"] as const;

const campoSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
    label: z.string().trim().min(1).max(80),
    tipo: z.enum(["texto", "cpf", "data", "dinheiro", "numero"]),
    obrigatorio: z.boolean(),
  })
  .strict();

export const camposDaFichaSchema = z
  .array(campoSchema)
  .min(1)
  .max(40)
  .refine((l) => new Set(l.map((c) => c.key)).size === l.length, { message: "chave repetida" });

/** Os campos em vigor: `organizations.settings.iavek.ficha_campos`, ou os padrão. */
export function lerCamposDaFicha(settings: unknown): CampoDaFicha[] {
  const bruto = (settings as { iavek?: { ficha_campos?: unknown } } | null)?.iavek?.ficha_campos;
  const lido = camposDaFichaSchema.safeParse(bruto);
  return lido.success ? lido.data : CAMPOS_PADRAO_DA_FICHA;
}

export function comCamposDaFicha(settings: unknown, campos: CampoDaFicha[]): Record<string, unknown> {
  const atual = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const iavek = (atual.iavek && typeof atual.iavek === "object" ? atual.iavek : {}) as Record<string, unknown>;
  return { ...atual, iavek: { ...iavek, ficha_campos: campos } };
}

/** CPF com os dígitos verificadores certos (só números). */
export function cpfValido(valor: string): boolean {
  const d = valor.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, peso: number) => {
    const soma = [...base].reduce((s, n, i) => s + Number(n) * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

/**
 * Confere os valores contra a lista de campos. Devolve os valores limpos (só
 * chaves da lista, texto aparado) e a lista do que falta ou está errado — pelo
 * RÓTULO, nunca pelo valor (o valor não volta em mensagem de erro).
 */
export function conferirDados(
  campos: CampoDaFicha[],
  entrada: Record<string, unknown>,
): { dados: Record<string, string>; problemas: string[] } {
  const dados: Record<string, string> = {};
  const problemas: string[] = [];
  for (const c of campos) {
    const bruto = entrada[c.key];
    const valor = typeof bruto === "number" ? String(bruto) : typeof bruto === "string" ? bruto.trim().slice(0, 500) : "";
    if (!valor) {
      if (c.obrigatorio) problemas.push(`${c.label}: obrigatório`);
      continue;
    }
    if (c.tipo === "cpf" && !cpfValido(valor)) problemas.push(`${c.label}: CPF inválido`);
    else if (c.tipo === "data" && !/^\d{4}-\d{2}-\d{2}$/.test(valor)) problemas.push(`${c.label}: data inválida`);
    else if ((c.tipo === "dinheiro" || c.tipo === "numero") && !/^\d+([.,]\d{1,2})?$/.test(valor.replace(/\./g, "").replace(/^R\$\s*/, "")))
      problemas.push(`${c.label}: número inválido`);
    dados[c.key] = valor;
  }
  return { dados, problemas };
}

/** Quem é a pessoa diante das fichas. */
export interface QuemNaFicha {
  userId: string;
  orgId: string;
  role: Role | null;
  analista: boolean;
  admin: boolean;
  /** Gerente: vê só o STATUS das fichas (não os dados) — padrão aprovado. */
  gerente: boolean;
  idioma: Idioma;
  suporteSoLeitura: boolean;
}

/**
 * Resolve quem chama SEM `requireRole`: para o analista de ficha o
 * `fn_user_role_in_org` devolve nulo (0586), e o `requireRole` negaria tudo —
 * de propósito. Aqui a função vem do próprio vínculo, que só o admin grava.
 */
export async function quemNaFicha(): Promise<QuemNaFicha | null> {
  const user = await loadAuthUser();
  if (!user) return null;
  const org = await resolveActiveOrg(user);
  if (!org) return null;
  const funcao = (org.interface_settings as { funcao?: string } | null | undefined)?.funcao ?? null;
  const analista = funcao === FUNCAO_ANALISTA_DE_FICHA;
  const role = analista ? null : (org.role as Role);
  return {
    userId: user.id,
    orgId: org.orgId,
    role,
    analista,
    admin: !analista && role !== null && ROLE_RANK[role] >= ROLE_RANK.admin,
    gerente: !analista && role === "manager",
    idioma: user.idioma,
    suporteSoLeitura: Boolean(user.support && user.support.access_mode !== "full"),
  };
}

/** Pode ver os DADOS (e documentos) desta ficha? Vendedor dono, analista, admin. */
export function podeVerDados(
  quem: QuemNaFicha,
  ficha: { enviada_por: string | null },
  donoDoLead: string | null,
): boolean {
  if (quem.analista || quem.admin) return true;
  return quem.userId === ficha.enviada_por || (donoDoLead !== null && quem.userId === donoDoLead);
}
