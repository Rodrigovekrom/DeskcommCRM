/**
 * ia.vek CRM-532 — a MARCA "ligação começando", guardada NESTE aparelho (sessionStorage) quando a pessoa toca em "Ligar".
 *
 * Por que no aparelho: o discador é do celular, fora do CRM; o CRM não fica sabendo da ligação. O que dá para saber é
 * que a pessoa tocou em "Ligar" e, depois de um tempo fora, VOLTOU para o CRM. Na volta, a marca diz de qual contato
 * (e de qual negócio/tarefa) perguntar "Como foi a ligação?". Sem dado de cliente: só ids e a hora.
 * Sem sessionStorage (modo privado travado), não há pergunta automática; o "Registrar a ligação" segue à mão.
 */
import { MINIMO_FORA_MS, VALIDADE_DA_MARCA_MS } from "@/lib/ligar/regras";

const CHAVE = "ligar.ligacao_comecando";

export interface MarcaDeLigacao {
  contatoId: string;
  leadId: string | null;
  tarefaId: string | null;
  /** epoch ms do toque em "Ligar" */
  em: number;
}

export function marcarLigacao(m: Omit<MarcaDeLigacao, "em">, agora: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify({ ...m, em: agora }));
  } catch {
    // sem sessionStorage: a pergunta não aparece sozinha; o registro à mão continua
  }
}

export function lerMarca(): MarcaDeLigacao | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const m = JSON.parse(bruto) as Partial<MarcaDeLigacao>;
    if (typeof m.contatoId !== "string" || typeof m.em !== "number") return null;
    return { contatoId: m.contatoId, leadId: m.leadId ?? null, tarefaId: m.tarefaId ?? null, em: m.em };
  } catch {
    return null;
  }
}

export function apagarMarca(): void {
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // nada a fazer
  }
}

/**
 * A volta conta como "voltou da ligação"? Ficou fora por pelo menos MINIMO_FORA_MS (desde o toque) e a marca ainda
 * vale (menos de VALIDADE_DA_MARCA_MS). Puro, para o teste.
 */
export function voltouDaLigacao(m: MarcaDeLigacao | null, agora: number): boolean {
  if (!m) return false;
  const fora = agora - m.em;
  return fora >= MINIMO_FORA_MS && fora <= VALIDADE_DA_MARCA_MS;
}
