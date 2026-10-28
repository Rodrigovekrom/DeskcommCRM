import { z } from "zod";

/**
 * ia.vek v1.9.4 — O TRAJETO DO LEAD EM 72h (CRM-209, decisões do Rodrigo de 27/10).
 *
 * Cada TROCA DE MÃO tem uma trava (o botão não conclui sem os campos) e deixa
 * um RESUMO para quem recebe (atividade `iavek_passagem`, lida no cartão
 * "Passagem" do lead):
 *
 *   agendamento     SDR → vendedor ao MARCAR (v1.9.3): os 7 campos.
 *   negociar        SDR → vendedor para NEGOCIAR: os 7 campos + objeção +
 *                   próximo passo combinado. O lead vai para Negociando.
 *   devolver        vendedor → guardião ao DESISTIR: motivo da lista + o que
 *                   foi feito + próximo passo sugerido.
 *   trocar_vendedor guardião → outro vendedor, A QUALQUER MOMENTO dentro das
 *                   72h ("o SDR tem total autoridade"), com motivo curto; o
 *                   vendedor que perde o lead é avisado. Depois das 72h, só o
 *                   ADMINISTRADOR troca o vendedor.
 *   reativar        o lead do follow-up voltou (respondeu no WhatsApp ou o SDR
 *                   marcou): volta ao SDR (o guardião) num NOVO ciclo de 72h.
 *
 * Os 7 campos moram no próprio negócio (`crm_leads.custom_fields`, as chaves
 * dos campos do funil da loja); o CONTEXTO do atendimento vai no resumo.
 * Aqui só regras puras: o servidor está em `passagem-servidor.ts`.
 */

export const TIPOS_DE_PASSAGEM = ["agendamento", "negociar", "devolver", "trocar_vendedor", "reativar"] as const;
export type TipoDePassagem = (typeof TIPOS_DE_PASSAGEM)[number];

/** Os 7 campos do handoff SDR → loja (registrados no cofre da Fenômenos). */
export const CAMPOS_DA_PASSAGEM = [
  { chave: "carro_interesse", rotulo: "Carro de interesse" },
  { chave: "cidade", rotulo: "Cidade / região" },
  { chave: "forma_pagamento", rotulo: "Forma de pagamento" },
  { chave: "entrada_reais", rotulo: "Entrada (R$; 0 = sem entrada)" },
  { chave: "tem_troca", rotulo: "Tem carro na troca?" },
  { chave: "prazo_compra", rotulo: "Prazo para comprar" },
] as const;
export const ROTULO_DO_CONTEXTO = "Contexto do atendimento";
export const ROTULO_DA_TROCA = "Troca: modelo e ano";
export const CONTEXTO_MINIMO = 20;

export const MOTIVOS_DE_DESISTENCIA = [
  "Não responde",
  "Sem entrada",
  "Ficha reprovada",
  "Carro indisponível",
  "Parcela não cabe",
  "Quer outro modelo",
  "Outro",
] as const;

/** Perdido só com o NÃO do lead: entram na lista de motivos do funil da loja. */
export const MOTIVOS_DE_PERDA = [
  "Comprou em outra loja",
  "Desistiu da compra",
  "Sem crédito",
  "Longe demais",
  "Só pesquisando",
  "Preço",
] as const;

/** Onde o lead cai em cada passagem (slugs do funil 72h da loja). */
export const ETAPA_DA_PASSAGEM: Partial<Record<TipoDePassagem, string>> = {
  agendamento: "agendado-video",
  negociar: "qualificado",
  devolver: "carro-apresentado",
};

const preenchido = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
};

/** Os campos do negócio que faltam para passar (a troca pede modelo e ano). */
export function camposQueFaltam(campos: Record<string, unknown> | null | undefined): string[] {
  const c = campos ?? {};
  const faltam: string[] = CAMPOS_DA_PASSAGEM.filter((x) => !preenchido(c[x.chave])).map((x) => x.rotulo);
  // A tela antiga grava o booleano às vezes como texto ("true").
  const temTroca = c.tem_troca === true || c.tem_troca === "true";
  if (temTroca && (!preenchido(c.troca_modelo) || !preenchido(c.troca_ano))) faltam.push(ROTULO_DA_TROCA);
  return faltam;
}

const texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const proximoPasso = z.strictObject({ o_que: texto(3, 300), quando: z.string().datetime({ offset: true }) });

/** O que a tela pode gravar nos campos do negócio junto com a passagem. */
export const camposDaPassagemSchema = z
  .strictObject({
    carro_interesse: z.string().trim().max(200).optional(),
    cidade: z.string().trim().max(120).optional(),
    forma_pagamento: z.enum(["a_vista", "financiamento", "consorcio"]).optional(),
    entrada_reais: z.number().min(0).max(10_000_000).optional(),
    tem_troca: z.boolean().optional(),
    troca_modelo: z.string().trim().max(120).optional(),
    troca_ano: z.number().int().min(1950).max(2100).optional(),
    prazo_compra: z.enum(["0_7", "7_15", "15_30", "30_mais"]).optional(),
  })
  .partial();
export type CamposDaPassagem = z.infer<typeof camposDaPassagemSchema>;

export const passagemSchema = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("negociar"),
    lead_id: z.string().uuid(),
    vendedor_id: z.string().uuid(),
    campos: camposDaPassagemSchema.optional(),
    contexto: texto(CONTEXTO_MINIMO, 2000),
    objecao: texto(3, 500),
    proximo_passo: proximoPasso,
  }),
  z.strictObject({
    tipo: z.literal("devolver"),
    lead_id: z.string().uuid(),
    motivo: z.enum(MOTIVOS_DE_DESISTENCIA),
    feito: texto(10, 2000),
    proximo_passo_sugerido: texto(3, 500),
  }),
  z.strictObject({
    tipo: z.literal("trocar_vendedor"),
    lead_id: z.string().uuid(),
    vendedor_id: z.string().uuid(),
    motivo: texto(3, 300),
  }),
  z.strictObject({
    tipo: z.literal("reativar"),
    lead_id: z.string().uuid(),
    motivo: texto(3, 300).optional(),
  }),
]);
export type PedidoDePassagem = z.infer<typeof passagemSchema>;

/** Ainda dentro das 72h? (horas corridas desde o nascimento do lead no funil de entrada) */
export function dentroDoPrazo(nascimento: string, agora: Date, horas = 72): boolean {
  const t = Date.parse(nascimento);
  return Number.isFinite(t) && agora.getTime() - t < horas * 3_600_000;
}

/**
 * Quem pode trocar o vendedor: o GUARDIÃO do lead dentro das 72h; a GERÊNCIA
 * (gerente e administrador) a qualquer momento — decisão do Rodrigo de 28/10:
 * o gerente fica livre para ajudar os vendedores. Depois das 72h, a restrição
 * vale para o guardião e o vendedor; nunca para a gerência.
 */
export function podeTrocarVendedor(args: {
  souGuardiao: boolean;
  souGestor: boolean;
  dentroDas72h: boolean;
}): boolean {
  return args.souGestor || (args.souGuardiao && args.dentroDas72h);
}
