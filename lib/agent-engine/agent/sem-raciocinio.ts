import type { ModelMessage } from 'ai';

/**
 * Tira os blocos de RACIOCÍNIO (thinking) das mensagens do assistente antes de
 * reenviá-las numa chamada NOVA.
 *
 * Por quê (ia.vek, medido em 16/10/2026 com o Haiku 5.5): o modelo devolve
 * blocos de raciocínio ASSINADOS, e a assinatura amarra o bloco à conversa em
 * que nasceu (system, ferramentas e mensagens anteriores). O fechamento do
 * turno (`purpose: 'checkpoint'`) é uma 2ª chamada com a abertura reduzida a
 * texto e sem ferramentas — outra conversa para a Anthropic — e era recusado
 * com `Invalid signature in thinking block… bound to a different conversation`.
 * Cerca de 1 turno em 10 falhava assim.
 *
 * Seguro: a 2ª chamada termina numa mensagem do usuário (a instrução do
 * checkpoint), então não há laço de ferramenta aberto que exija o bloco; o
 * raciocínio de turnos anteriores não é lido pelo modelo de qualquer forma.
 * Mensagem do assistente que só tinha raciocínio sai inteira.
 */
export function semRaciocinio(messages: readonly ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || typeof m.content === 'string') {
      out.push(m);
      continue;
    }
    const content = m.content.filter((p) => p.type !== 'reasoning' && p.type !== 'reasoning-file');
    if (content.length === 0) continue;
    out.push(content.length === m.content.length ? m : { ...m, content });
  }
  return out;
}
