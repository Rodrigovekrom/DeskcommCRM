/**
 * ia.vek v1.9.51 ("CRM mais leve 2", Maestro 214930, opção A) — quem está logado, NO PROXY, sem ir ao Auth pela rede.
 *
 * POR QUÊ (medido pela Lupa em 12/11): ~455 chamadas/min ao Auth com 3 a 8 pessoas. O proxy chamava `getUser()` em
 * TODA requisição (inclusive /api) e a rota chamava de novo: 2 idas ao Auth por chamada de API.
 *
 * O QUE MUDA: SÓ o proxy. Ele usa `getClaims()`, que confere a ASSINATURA do JWT pela chave pública do projeto (o JWKS,
 * guardado em cache) e a EXPIRAÇÃO, sem rede. O `getClaims()` também renova a sessão vencida pelo refresh token, como o
 * `getUser()` fazia (os cookies novos saem pelo mesmo `setAll`).
 *
 * O QUE NÃO MUDA (a segurança): as ROTAS da API e as páginas do servidor seguem com `getUser()` pela rede, então a
 * sessão REVOGADA (logout em outro aparelho, troca de senha, sessão encerrada pelo admin) continua recusada NA HORA em
 * toda leitura e escrita de dado. O proxy só decide "logado ou vai para o login"; uma sessão revogada pode, por até
 * 1 h (o `exp` do token), abrir a casca de uma página, sem dado nenhum. Tirar a pessoa da loja segue valendo na hora
 * (a RLS lê o vínculo no banco).
 *
 * ARMADILHA: com token do segredo antigo (HS256) ou sem `kid`, o `getClaims()` cai SOZINHO no `getUser()` pela rede,
 * sem ganho e sem aviso. Por isso o contador abaixo (Maestro 214930: provar no canário que os tokens saem por ES256).
 */

type ResultadoDosClaims = {
  data: { claims: { sub?: string } & Record<string, unknown>; header: { alg?: string; kid?: string } } | null;
  error: unknown;
};
type AuthComClaims = { getClaims: () => Promise<ResultadoDosClaims> };

const contagem = { local: 0, rede: 0, sem_sessao: 0 };
let ultimoRegistro = 0;
const INTERVALO_DO_REGISTRO_MS = 5 * 60_000;

/** O caminho que o `getClaims()` tomou, pelo cabeçalho do token (a MESMA regra do auth-js). */
export function caminhoDoToken(header: { alg?: string; kid?: string } | null | undefined): "local" | "rede" {
  if (!header?.alg || header.alg.startsWith("HS") || !header.kid) return "rede";
  return "local";
}

export function contagemDoProxy(): Readonly<typeof contagem> {
  return { ...contagem };
}

function registrarDeTempoEmTempo(agora: number) {
  if (agora - ultimoRegistro < INTERVALO_DO_REGISTRO_MS) return;
  ultimoRegistro = agora;
  // Uma linha a cada 5 min no log do app (a prova do canário e a medida da Lupa). Sem token, sem usuário.
  console.info(`[proxy] sessão: local=${contagem.local} rede=${contagem.rede} sem_sessao=${contagem.sem_sessao}`);
}

export async function usuarioDoProxy(auth: AuthComClaims, agora = Date.now()): Promise<{ id: string } | null> {
  const { data, error } = await auth.getClaims();
  const sub = !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!sub) contagem.sem_sessao += 1;
  else contagem[caminhoDoToken(data?.header)] += 1;
  registrarDeTempoEmTempo(agora);
  return sub ? { id: sub } : null;
}
