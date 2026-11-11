/**
 * ia.vek v1.9.45 (CRM-294, pedido da Lupa): a TRAVA para a próxima mudança de status do lead.
 *
 * Com o status 'future' (Compra futura), cada lugar do banco que compara o status do lead foi decidido um
 * a um (docs/iavek/compra-futura-impacto.md). Este teste lista, na ÚLTIMA definição de cada função do
 * baseline.sql que cita crm_leads, as que comparam o status do lead com 'open', 'won' ou 'lost', e compara
 * com a lista CONGELADA abaixo. Uma função nova (ou uma que passe a comparar) reprova: quem a escreveu
 * decide o que ela faz com o 'future' e só então a acrescenta aqui.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BASELINE = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");

/** Decididas em 11/11 (v1.9.45). Ver docs/iavek/compra-futura-impacto.md, seção 1. */
const DECIDIDAS = [
  "fn_atrito_metrics",
  "fn_attendant_metrics",
  "fn_crm_lead_close_on_stage",
  "fn_emit_event_on_lead_change",
  "fn_iavek_assumir_da_faixa",
  "fn_iavek_avisar_trava",
  "fn_iavek_aviso_de_ajuda",
  "fn_iavek_faixa_de_ajuda",
  "fn_iavek_lead_segue_a_conversa",
  "fn_iavek_notifica_mudanca_do_lead",
  "fn_iavek_preco_do_carro_mudou",
  "fn_iavek_rodizio_distribuir",
  "fn_iavek_trava_guardiao_do_lead",
  "fn_nascer_lead_da_conversa",
  "fn_solicitar_reenvio_conversao",
].sort();

function ultimasDefinicoes(sql: string): Map<string, string> {
  const funcs = new Map<string, string>();
  const re = /create\s+(?:or\s+replace\s+)?function\s+"?(?:public"?\.)?"?(\w+)"?\s*\(/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const ini = m.index;
    const d = /\$(\w*)\$/.exec(sql.slice(ini));
    if (!d) continue;
    const a = ini + d.index + d[0].length;
    const z = sql.indexOf(d[0], a);
    if (z < 0) continue;
    funcs.set(m[1]!, sql.slice(ini, z + d[0].length)); // a última definição vence
  }
  return funcs;
}

const COMPARA_STATUS_DE_LEAD =
  /(?:\b(?:l|v_lead|new|old)\.)?status\s*(?:=|<>|!=)\s*'(?:open|won|lost)'|status\s+(?:not\s+)?in\s*\([^)]*'(?:open|won|lost)'[^)]*\)/i;

describe("v1.9.45: a trava do status do lead (toda comparação de status foi decidida)", () => {
  const funcs = ultimasDefinicoes(BASELINE);

  it("acha funções para medir (a extração não pode quebrar calada)", () => {
    expect(funcs.size).toBeGreaterThan(300);
  });

  it("⭐ as funções que comparam o status do lead são EXATAMENTE as decididas", () => {
    const achadas = [...funcs.entries()]
      .filter(([, corpo]) => /crm_leads/i.test(corpo) && COMPARA_STATUS_DE_LEAD.test(corpo))
      // as que só comparam status de outra coisa (conversa, tarefa...) e citam crm_leads de passagem
      .filter(([, corpo]) =>
        corpo
          .split("\n")
          .some((l) => COMPARA_STATUS_DE_LEAD.test(l) && !/(conversation|conversa|task|tarefa|appointment|compromisso|propos|enrollment|run|message|inbox|demanda|campaign|case|c\.status)/i.test(l)),
      )
      .map(([nome]) => nome)
      .sort();
    const novas = achadas.filter((n) => !DECIDIDAS.includes(n));
    expect(
      novas,
      "Função nova que compara o status do lead: decida o que ela faz com o 'future' (Compra futura) e " +
        "acrescente o nome em DECIDIDAS e em docs/iavek/compra-futura-impacto.md.",
    ).toEqual([]);
  });

  it("o CHECK do status e o do closed_at conhecem o 'future'", () => {
    expect(BASELINE).toMatch(/add constraint crm_leads_status_enum\s+check \(status = any \(array\['open'::text, 'won'::text, 'lost'::text, 'future'::text\]\)\)/);
    expect(BASELINE).toMatch(/\(status = 'future' and closed_at is null\)/);
  });
});
