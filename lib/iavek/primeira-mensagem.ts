import { ehFuncao, funcaoDaTela, type Funcao } from "@/lib/iavek/funcoes";

/**
 * ia.vek v1.9.6 (Rodrigo, 30/10): o MODELO da primeira mensagem do guardião e
 * do vendedor. Nunca sai sozinho: aparece pronto na caixa de texto, a pessoa
 * confere e envia (só a IA envia sozinha). Mora em
 * `organizations.settings.primeira_mensagem` (`{ sdr, vendedor }`): sem modelo
 * gravado, nada aparece.
 *
 * "Primeira" = a primeira daquele responsável naquele lead. Variável sem valor
 * NÃO é inventada: o `{nome}` fica visível para a pessoa preencher.
 */
export const FUNCOES_COM_MODELO = ["sdr", "vendedor"] as const satisfies readonly Funcao[];

export function modeloDaFuncao(settings: unknown, funcaoBruta: unknown): string | null {
  const funcao = ehFuncao(funcaoBruta) ? funcaoDaTela(funcaoBruta) : null;
  if (!funcao || !(FUNCOES_COM_MODELO as readonly string[]).includes(funcao)) return null;
  const raiz = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const bloco = (raiz as { primeira_mensagem?: unknown }).primeira_mensagem;
  if (!bloco || typeof bloco !== "object" || Array.isArray(bloco)) return null;
  const v = (bloco as Record<string, unknown>)[funcao];
  return typeof v === "string" && v.trim().length > 0 && v.length <= 2000 ? v : null;
}

export type VariaveisDoModelo = Partial<Record<"primeiro_nome" | "dia" | "hora" | "guardiao", string | null>>;

/** Troca `{variavel}` pelo valor; sem valor, o `{variavel}` fica para a pessoa preencher. */
export function preencherModelo(modelo: string, vars: VariaveisDoModelo): string {
  return modelo.replace(/\{(primeiro_nome|dia|hora|guardiao)\}/g, (inteiro, k: keyof VariaveisDoModelo) => {
    const v = vars[k]?.trim();
    return v ? v : inteiro;
  });
}

export function primeiroNome(nome: string | null | undefined): string | null {
  const p = (nome ?? "").trim().split(/\s+/)[0];
  if (!p || /^\+?\d/.test(p)) return null; // telefone no lugar do nome não é nome
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function diaNoFuso(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "hoje", "amanhã" ou "dd/mm" — como o Rodrigo escreveu ("amanhã às 17:00"). */
export function diaDoCompromisso(inicio: Date, agora: Date, fuso: string): string {
  const alvo = diaNoFuso(inicio, fuso);
  if (alvo === diaNoFuso(agora, fuso)) return "hoje";
  if (alvo === diaNoFuso(new Date(agora.getTime() + 86_400_000), fuso)) return "amanhã";
  // A mensagem vai ao cliente da loja, em português: "dd/mm" montado à mão.
  const [, mes, dia] = alvo.split("-");
  return `${dia}/${mes}`;
}

export function horaDoCompromisso(inicio: Date, fuso: string): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(inicio);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${v("hour")}:${v("minute")}`;
}
