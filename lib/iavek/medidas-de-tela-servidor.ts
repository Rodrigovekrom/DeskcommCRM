import "server-only";
import { createHmac } from "node:crypto";

/**
 * ia.vek v1.9.51.4 (Lupa 192902 b): um id CURTO e ANÔNIMO da pessoa, para separar "uma pessoa" de "a loja toda" sem
 * nome. HMAC-SHA256 do id do usuário com um segredo do servidor (sem o segredo, não se volta do hash ao id, nem
 * testando todos os ids da loja), 10 caracteres hex. O mesmo usuário dá sempre o mesmo valor. Sem segredo: sem o campo.
 */
export function pessoaAnonima(userId: string, segredo = process.env.IAVEK_MEDIDA_SAL || process.env.INTERNAL_SECRET || ""): string | null {
  if (!segredo || !userId) return null;
  return createHmac("sha256", segredo).update(`medida-de-tela:${userId}`).digest("hex").slice(0, 10);
}
