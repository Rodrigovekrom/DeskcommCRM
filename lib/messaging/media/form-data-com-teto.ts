/**
 * ia.vek v1.9.45 (CRM-259, BLOQUEIO da Lupa): lê o corpo multipart CONTANDO os bytes e corta ao passar do
 * teto, como a rota do vídeo. Antes da v1.9.45, o proxy do Next cortava tudo em 10 MB; fora dele, o
 * único teto antes de ler era o Content-Length, e um envio chunked (sem Content-Length) passava com
 * `declared = 0`, e o `req.formData()` guardava o corpo inteiro na memória, sem limite nenhum.
 *
 * Aqui a leitura para (e cancela o stream) no 1º pedaço que passa do teto; o pior caso de memória é o
 * próprio teto. Só depois de ler dentro do teto é que o multipart é interpretado.
 */
export type FormDataComTeto =
  | { ok: true; form: FormData; bytes: number }
  | { ok: false; motivo: "grande"; bytes: number }
  | { ok: false; motivo: "invalido"; bytes: number };

export async function formDataComTeto(req: Request, teto: number): Promise<FormDataComTeto> {
  if (!req.body) return { ok: false, motivo: "invalido", bytes: 0 };
  const leitor = req.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => {});
      return { ok: false, motivo: "grande", bytes: total };
    }
    pedacos.push(value);
  }
  const corpo = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    corpo.set(p, pos);
    pos += p.byteLength;
  }
  // P3 da Lupa: solta os pedaços logo depois de juntar (o pico cai de ~3x para ~2x o teto por envio).
  pedacos.length = 0;
  try {
    const form = await new Response(corpo, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
    return { ok: true, form, bytes: total };
  } catch {
    return { ok: false, motivo: "invalido", bytes: total };
  }
}
