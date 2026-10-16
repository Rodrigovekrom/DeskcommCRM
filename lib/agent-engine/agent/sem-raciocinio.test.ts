import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { semRaciocinio } from './sem-raciocinio';

describe('semRaciocinio', () => {
  it('tira reasoning do assistente e preserva texto, ferramenta e o resto', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'pensando', providerOptions: { anthropic: { signature: 'x' } } },
          { type: 'tool-call', toolCallId: 't1', toolName: 'send_message', input: { body: 'Oi!' } },
        ],
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't1', toolName: 'send_message', output: { type: 'text', value: 'ok' } }] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'só pensei' }] },
      { role: 'assistant', content: 'texto puro' },
    ];
    const r = semRaciocinio(msgs);
    expect(r).toHaveLength(4);
    expect(r[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 't1', toolName: 'send_message', input: { body: 'Oi!' } }],
    });
    expect(r[3]).toEqual({ role: 'assistant', content: 'texto puro' });
    expect(JSON.stringify(r)).not.toContain('reasoning');
  });
  it('sem raciocínio, devolve as mesmas mensagens', () => {
    const msgs: ModelMessage[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: [{ type: 'text', text: 'b' }] }];
    expect(semRaciocinio(msgs)).toEqual(msgs);
    expect(semRaciocinio(msgs)[1]).toBe(msgs[1]);
  });
});
