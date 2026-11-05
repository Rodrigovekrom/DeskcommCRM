/**
 * ia.vek v1.9.22 — Guardião Leads, item 3: o aviso que o Venda.IA manda no grupo da equipe.
 *
 * Formato (print do Rodrigo, 05/11): 1ª linha "Opa, tem um cliente precisando de uma atenção!",
 * depois "Nome: …", "Número: …", "Necessidade: …" (com "Status: Ajuda Humana Necessária"),
 * "Canal de origem: …" e "VENDA.IA 100% ativo ✅". O casamento é pelo TELEFONE; o nome só
 * desempata ou, sem telefone que case, acha um lead único em IA Atendendo.
 *
 * Nada aqui liga grupo: quem decide qual grupo vale é `settings.iavek.guardiao_leads`,
 * gravado só por script, com a decisão do Rodrigo.
 */
import { z } from "zod";

const CABECALHO = /precisando de uma aten[cç][aã]o/i;
const AJUDA_HUMANA = /Ajuda Humana Necess[aá]ria/i;
const LINHA_DO_NOME = /^[\s*_]*Nome[\s*_]*:[\s*_]*(.+?)[\s*_]*$/im;
const LINHA_DO_NUMERO = /^[\s*_]*N[uú]mero[\s*_]*:[\s*_]*(.+?)[\s*_]*$/im;

export type LeituraDoAviso =
  | { tipo: "nao_e_aviso" }
  | { tipo: "aviso"; telefones: string[]; nome: string | null; pedeAjudaHumana: boolean };

export function lerAvisoDeAjuda(texto: string | null | undefined): LeituraDoAviso {
  const t = (texto ?? "").slice(0, 5000);
  if (!CABECALHO.test(t)) return { tipo: "nao_e_aviso" };
  const nome = LINHA_DO_NOME.exec(t)?.[1]?.trim() || null;
  const numero = LINHA_DO_NUMERO.exec(t)?.[1] ?? "";
  return { tipo: "aviso", telefones: variantesDoTelefone(numero), nome, pedeAjudaHumana: AJUDA_HUMANA.test(t) };
}

/**
 * As formas com que o mesmo celular brasileiro pode estar gravado: com e sem 55, com e sem o 9
 * depois do DDD. Só dígitos. Número curto demais não casa nada.
 */
export function variantesDoTelefone(bruto: string): string[] {
  const d = bruto.replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return [];
  const local = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length !== 10 && local.length !== 11) return [];
  const ddd = local.slice(0, 2);
  const resto = local.slice(2);
  const formas = new Set<string>([local]);
  if (local.length === 11 && resto.startsWith("9")) formas.add(ddd + resto.slice(1));
  if (local.length === 10 && /^[6-9]/.test(resto)) formas.add(`${ddd}9${resto}`);
  return [...formas].flatMap((f) => [f, `55${f}`]);
}

export const configDoGuardiaoLeadsSchema = z.object({
  grupo: z.object({
    channel_session_id: z.uuid(),
    group_chat_id: z.string().regex(/^[\d-]+@g\.us$/),
  }),
  /** O número que manda o aviso, "+55…". Mensagem de outra pessoa do grupo não move lead. */
  numero_que_avisa: z.string().regex(/^\+\d{10,15}$/),
});
export type ConfigDoGuardiaoLeads = z.infer<typeof configDoGuardiaoLeadsSchema>;

/** Ausente ou incompleta = desligado. O número que avisa é obrigatório. */
export function configDoGuardiaoLeads(settings: unknown): ConfigDoGuardiaoLeads | null {
  const bruto = (settings as { iavek?: { guardiao_leads?: unknown } } | null)?.iavek?.guardiao_leads;
  const r = configDoGuardiaoLeadsSchema.safeParse(bruto);
  return r.success ? r.data : null;
}

export const RESULTADOS_DO_AVISO = ["entregue", "sem_guardiao", "ja_tem_dono", "ambiguo", "nao_reconhecido"] as const;
export type ResultadoDoAviso = (typeof RESULTADOS_DO_AVISO)[number];
