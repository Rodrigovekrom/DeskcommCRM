/**
 * ia.vek CRM-258: os limites do vídeo, SEM dependência do Node — este arquivo vai também para o navegador
 * (o hook da tela importa daqui). `encolher-video.ts` usa `node:child_process` e nunca pode ir ao navegador.
 */
/** O que se pode escolher para enviar (vídeo bruto do celular). */
export const VIDEO_MAX_ENTRADA_BYTES = 300 * 1024 * 1024;
/** Até aqui vai como VÍDEO (toca na conversa); acima, como documento. */
export const VIDEO_MAX_SEGUNDOS_COMO_VIDEO = 180;
/** O WhatsApp aceita vídeo como mídia até ~16 MB; acima disso, documento. */
export const VIDEO_MAX_BYTES_COMO_VIDEO = 16 * 1024 * 1024;
/** O bucket guarda até 50 MB: o encolhido que passar disso não é guardado. */
export const VIDEO_MAX_BYTES_GUARDADO = 50 * 1024 * 1024;
/** Tempo máximo de uma conversão (um vídeo de 300 MB num servidor ocupado). */
export const VIDEO_TETO_DA_CONVERSAO_MS = 10 * 60_000;
