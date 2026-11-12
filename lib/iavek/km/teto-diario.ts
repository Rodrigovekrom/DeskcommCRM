/**
 * ia.vek v1.9.49 (nota (a) da Lupa na v1.9.47): o TETO DIÁRIO do km por ORGANIZAÇÃO.
 *
 * A chave do OpenRouteService é UMA para a instalação inteira, e cada cálculo de km gasta 2 geocodes (a partida e o
 * cliente) e 1 rota. O limite por usuário (limite-por-usuario.ts, v1.9.47) segura uma pessoa; este segura uma LOJA:
 * sem ele, uma organização esgota a cota do dia e o km some para todas.
 *
 * O NÚMERO PADRÃO É SUPOSTO, não medido: em 12/11 a produção NÃO tem ORS_API_KEY (conferido no .env, sem ler o valor),
 * então a cota real não pôde ser lida (os cabeçalhos x-ratelimit-* da resposta). A conta parte do plano grátis
 * documentado (geocode 1.000/dia, rota 2.000/dia): 1.000 / 2 = 500 cálculos/dia para a chave inteira; 200 por
 * organização deixa folga para 2 lojas. Quando a chave chegar, MEDIR e ajustar. Cada organização pode ter o seu em
 * `settings.iavek.km_teto_diario` (0 a 5.000; 0 = sem km).
 *
 * A contagem é por DIA de São Paulo, no Redis (sobrevive ao reinício do app; expira em 2 dias), com a memória do
 * processo de reserva quando o Redis não está configurado ou falha. Só conta quando o ORS seria chamado DE FATO.
 */
import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { validarConfigRedisRest } from "@/lib/redis-config";

export const KM_POR_DIA_POR_ORG_PADRAO = 200;
export const KM_POR_DIA_MAXIMO = 5_000;

/** O teto da organização: o dela em settings.iavek.km_teto_diario (inteiro de 0 a 5.000), senão o padrão. */
export function tetoDaOrg(settings: unknown): number {
  const v = (settings as { iavek?: { km_teto_diario?: unknown } } | null)?.iavek?.km_teto_diario;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= KM_POR_DIA_MAXIMO ? v : KM_POR_DIA_POR_ORG_PADRAO;
}

/** O dia de São Paulo (AAAA-MM-DD): a cota "do dia" vira à meia-noite da loja, não à da UTC. */
export function diaEmSaoPaulo(agora: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(agora),
  );
}

/** O que conta: o Redis em produção; nos testes, qualquer coisa com `incr` e `expire`. */
export interface Contador {
  incr(chave: string): Promise<number>;
  expire(chave: string, segundos: number): Promise<unknown>;
}

const memoria = new Map<string, number>();
let redis: Redis | null | undefined;
let avisou = false;

function contadorPadrao(): Contador | null {
  if (redis !== undefined) return redis;
  const config = validarConfigRedisRest(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  redis = config.ok ? new Redis({ url: env.UPSTASH_REDIS_REST_URL!, token: env.UPSTASH_REDIS_REST_TOKEN!, retry: false }) : null;
  return redis;
}

/**
 * Gasta 1 cálculo do teto do dia da organização. `true` = pode chamar o ORS (e já foi contado); `false` = o teto do
 * dia acabou (a chamada não acontece e o km fica nulo, com o motivo "teto_do_dia").
 */
export async function gastarDoTetoDoDia(
  orgId: string,
  teto: number,
  opts: { agora?: number; contador?: Contador | null } = {},
): Promise<boolean> {
  if (teto <= 0) return false;
  const chave = `iavek:km:${orgId}:${diaEmSaoPaulo(opts.agora)}`;
  const c = opts.contador === undefined ? contadorPadrao() : opts.contador;
  if (c) {
    try {
      const n = await c.incr(chave);
      if (n === 1) await c.expire(chave, 2 * 86_400);
      return n <= teto;
    } catch (erro) {
      if (!avisou) {
        logger.warn("[iavek-km] o Redis do teto do dia falhou; contando na memória", {
          causa: erro instanceof Error ? erro.message.slice(0, 120) : "?",
        });
        avisou = true;
      }
    }
  }
  // reserva: a memória do processo (o app é um processo; o pior caso de um reinício é zerar a conta do dia)
  for (const k of memoria.keys()) if (!k.endsWith(diaEmSaoPaulo(opts.agora))) memoria.delete(k);
  const n = (memoria.get(chave) ?? 0) + 1;
  memoria.set(chave, n);
  return n <= teto;
}
