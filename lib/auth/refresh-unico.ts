/**
 * ia.vek v1.9.55 (CRM-368; desenho Lupa 113802/113908/162344/162431; Rodrigo "pode fazer o login de uma vez só"):
 * o login RENOVA UMA vez por sessão, não N.
 *
 * O problema: o proxy (e cada rota) cria um cliente Supabase NOVO por pedido, e a trava do auth-js contra refresh em
 * dobro é POR INSTÂNCIA. Então N pedidos juntos com o token perto de vencer fazem N `POST /auth/v1/token?grant_type=
 * refresh_token` pelo IP do servidor (a aba que volta do descanso dispara ~18–24). O limite do Auth conta por IP: uma
 * aba afeta todos os clientes.
 *
 * A mudança: o single-flight fica NO PONTO em que o auth-js chama o Auth (o `fetch` dos clientes do servidor, ver
 * `fetchDoServidor`). A regra de "quando renovar" continua a do PRÓPRIO auth-js (na 2.117.2: dentro do `getSession`,
 * faltando menos de EXPIRY_MARGIN_MS = 90 s). Só o refresh passa por aqui; qualquer outro pedido segue direto.
 *
 *  - Chave = sha256 do `refresh_token` do CORPO (nunca o user_id): tokens diferentes nunca se misturam.
 *  - O 1º faz o fetch de verdade; os outros esperam a MESMA promessa e recebem um `Response` NOVO (corpo, status e
 *    headers), e cada cliente grava os cookies novos na SUA resposta.
 *  - Só a resposta 200 fica guardada, por até 10 s (o reuse interval padrão do GoTrue). Erro (429, 400, rede) sai NA
 *    HORA: o pedido seguinte tenta de novo.
 *  - Limpeza por TTL a cada inserção; teto de 5.000 chaves (acima, limpa tudo: custa só um refresh a mais).
 *  - A sessão nova fica SÓ em memória, por 10 s. NUNCA vai ao log, ao contador nem a um erro (Lupa b): o contador loga
 *    só números.
 *  - Vale para o PROCESSO (o app é 1 processo Node: `node server.js`, standalone).
 */
import { createHash } from "node:crypto";

export const GUARDA_MS = 10_000;
export const TETO_DE_CHAVES = 5_000;
const INTERVALO_DO_REGISTRO_MS = 5 * 60_000;

type Guardado = { status: number; statusText: string; headers: [string, string][]; corpo: ArrayBuffer };
type Entrada = { promessa: Promise<Guardado>; expiraEm: number };

const emCurso = new Map<string, Entrada>();
const contagem = { chamou_o_auth: 0, esperou: 0 };
let ultimoRegistro = 0;

/** Só para os testes. */
export function zerarRefreshUnico(): void {
  emCurso.clear();
  contagem.chamou_o_auth = 0;
  contagem.esperou = 0;
  ultimoRegistro = 0;
}

export function contagemDoRefresh(): Readonly<typeof contagem> {
  return { ...contagem };
}

export function tamanhoDoMapa(): number {
  return emCurso.size;
}

function urlDe(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** É o refresh do auth-js? `POST …/auth/v1/token?grant_type=refresh_token`. */
export function ehRefreshDoAuth(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): boolean {
  const metodo = (init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();
  if (metodo !== "POST") return false;
  let u: URL;
  try {
    u = new URL(urlDe(input));
  } catch {
    return false;
  }
  return u.pathname.endsWith("/auth/v1/token") && u.searchParams.get("grant_type") === "refresh_token";
}

/** A chave: sha256 do refresh_token do corpo (string JSON, como o auth-js manda). Sem corpo legível = null (passa direto). */
function chaveDoCorpo(init?: RequestInit): string | null {
  if (typeof init?.body !== "string") return null;
  try {
    const rt = (JSON.parse(init.body) as { refresh_token?: unknown }).refresh_token;
    return typeof rt === "string" && rt ? createHash("sha256").update(rt).digest("hex") : null;
  } catch {
    return null;
  }
}

function limpar(agora: number): void {
  for (const [k, e] of emCurso) if (e.expiraEm <= agora) emCurso.delete(k);
  if (emCurso.size >= TETO_DE_CHAVES) emCurso.clear();
}

function remontar(g: Guardado): Response {
  return new Response(g.corpo.slice(0), { status: g.status, statusText: g.statusText, headers: g.headers });
}

function registrarDeTempoEmTempo(agora: number): void {
  if (agora - ultimoRegistro < INTERVALO_DO_REGISTRO_MS) return;
  ultimoRegistro = agora;
  // Só números (Lupa b): nunca token, sessão ou usuário.
  console.info(`[proxy] refresh: chamou o Auth=${contagem.chamou_o_auth} esperou=${contagem.esperou}`);
}

/**
 * Embrulha um fetch: o refresh do Auth vira single-flight por refresh_token; o resto passa intacto.
 * `agora` é injetável para os testes do TTL.
 */
export function comRefreshUnico(
  fetchDeVerdade: typeof globalThis.fetch,
  agora: () => number = Date.now,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (!ehRefreshDoAuth(input, init)) return fetchDeVerdade(input, init);
    const chave = chaveDoCorpo(init);
    if (!chave) return fetchDeVerdade(input, init);

    const t = agora();
    const ja = emCurso.get(chave);
    if (ja && ja.expiraEm > t) {
      contagem.esperou += 1;
      registrarDeTempoEmTempo(t);
      return remontar(await ja.promessa);
    }

    limpar(t);
    contagem.chamou_o_auth += 1;
    registrarDeTempoEmTempo(t);
    const promessa = (async (): Promise<Guardado> => {
      const r = await fetchDeVerdade(input, init);
      return {
        status: r.status,
        statusText: r.statusText,
        headers: [...r.headers.entries()],
        corpo: await r.arrayBuffer(),
      };
    })();
    // Enquanto o 1º está em curso, quem chega espera a mesma promessa (o teto do "em curso" é o mesmo GUARDA_MS).
    emCurso.set(chave, { promessa, expiraEm: t + GUARDA_MS });
    let g: Guardado;
    try {
      g = await promessa;
    } catch (e) {
      if (emCurso.get(chave)?.promessa === promessa) emCurso.delete(chave);
      throw e;
    }
    if (g.status !== 200) {
      // Erro sai NA HORA: o pedido seguinte tenta de novo. (Quem já esperava recebe o mesmo erro, como receberia hoje.)
      if (emCurso.get(chave)?.promessa === promessa) emCurso.delete(chave);
    } else {
      // A guarda de 10 s conta a partir da resposta 200.
      const e = emCurso.get(chave);
      if (e?.promessa === promessa) e.expiraEm = agora() + GUARDA_MS;
    }
    return remontar(g);
  };
}
