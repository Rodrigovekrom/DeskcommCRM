/**
 * ia.vek v1.9.50 (Lupa 153805 e 155258): uma FUNÇÃO da equipe nunca existe sem as réguas de visão dela.
 *
 * O furo que este teste fecha: uma função nova que o banco não conhece cai nos padrões ABERTOS:
 *   - LEAD: o fn_iavek_modo_da_funcao devolve NULL, então vale o visibility_mode da organização (na Fenômenos, vazio =
 *     'own_and_unassigned'): ela veria todos os leads e conversas sem dono;
 *   - CONTATO: a restrição só vale para quem está no fn_iavek_orgs_onde_sou_vendedor, e o resto vê TODOS os contatos.
 * Foi o que quase saiu com o 'sdr_followup' (CRM-254): a função nasceu antes da RLS.
 *
 * Regra: toda função de FUNCOES (lib/iavek/funcoes.ts), em CADA régua, ou é TRATADA no corpo mais novo da função do
 * banco, ou está na lista das que seguem o padrão aberto DE PROPÓSITO. Uma função nova sem uma das duas, em qualquer
 * régua = VERMELHO. É unitário: roda em todo push.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FUNCOES } from "@/lib/iavek/funcoes";

/** LEAD: as que seguem o modo da organização de propósito (a gerência vê tudo pelo papel; o analista não usa o /app). */
const SEGUEM_O_MODO_DA_ORG = ["gerente", "apoio", "analista_ficha"];
/** CONTATO: as que veem todos os contatos da loja de propósito (só o vendedor é restrito; Lupa 155258). */
const VEEM_TODOS_OS_CONTATOS = ["sdr", "suporte", "gerente", "apoio", "analista_ficha"];

export interface Regua {
  nome: string;
  corpo: string;
  /** como a função aparece no corpo quando é tratada */
  tratada: (funcao: string, corpo: string) => boolean;
  dePropósito: readonly string[];
}

/** As funções que, numa régua, não são tratadas nem estão na lista de propósito. */
export function semRegua(funcoes: readonly string[], regua: Regua): string[] {
  return funcoes.filter((f) => !regua.dePropósito.includes(f) && !regua.tratada(f, regua.corpo));
}

/**
 * O corpo da definição MAIS NOVA de uma função do banco: o arquivo mais novo (ordem das migrations) que a define. A
 * busca ignora maiúsculas (Lupa 155258: "CREATE OR REPLACE FUNCTION" não pode fazer o teste ler um corpo antigo calado).
 */
function corpoMaisNovo(funcao: string): string {
  const dir = "supabase/migrations";
  const def = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${funcao}\\s*\\(`, "gi");
  let corpo = "";
  for (const a of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const s = readFileSync(join(dir, a), "utf8");
    const achados = [...s.matchAll(def)];
    const ultimo = achados.at(-1);
    if (!ultimo) continue;
    const i = ultimo.index!;
    const abre = s.indexOf("$$", i);
    corpo = s.slice(i, s.indexOf("$$", abre + 2));
  }
  return corpo;
}

const REGUA_DO_LEAD: Regua = {
  nome: "lead (fn_iavek_modo_da_funcao)",
  corpo: corpoMaisNovo("fn_iavek_modo_da_funcao"),
  tratada: (f, corpo) => new RegExp(`when\\s+'${f}'`, "i").test(corpo),
  dePropósito: SEGUEM_O_MODO_DA_ORG,
};
const REGUA_DO_CONTATO: Regua = {
  nome: "contato (fn_iavek_orgs_onde_sou_vendedor)",
  corpo: corpoMaisNovo("fn_iavek_orgs_onde_sou_vendedor"),
  tratada: (f, corpo) => corpo.includes(`'${f}'`),
  dePropósito: VEEM_TODOS_OS_CONTATOS,
};

describe("toda função da equipe tem as réguas de visão (lead e contato)", () => {
  it("os corpos das duas funções do banco foram achados (a leitura não ficou vazia)", () => {
    expect(REGUA_DO_LEAD.corpo).toMatch(/when\s+'vendedor'/i);
    expect(REGUA_DO_CONTATO.corpo).toContain("'vendedor'");
  });

  for (const r of [REGUA_DO_LEAD, REGUA_DO_CONTATO]) {
    it(`régua do ${r.nome}: cada função de FUNCOES é tratada ou está na lista de propósito`, () => {
      expect(semRegua(FUNCOES, r)).toEqual([]);
    });
  }
});

describe("a trava pega o que deve (casos de mentira, sem depender do repo)", () => {
  const lead = (corpo: string): Regua => ({ ...REGUA_DO_LEAD, corpo });
  const contato = (corpo: string): Regua => ({ ...REGUA_DO_CONTATO, corpo });
  // só as funções do caso (as reais do repo são conferidas acima): uma tratada, uma de propósito e a nova
  const FUNCOES_COM_A_NOVA = ["vendedor", "gerente", "sdr_followup"];

  it("a função nova SEM régua nenhuma: vermelha nas duas", () => {
    expect(semRegua(FUNCOES_COM_A_NOVA, lead("when 'vendedor' then 'own'"))).toEqual(["sdr_followup"]);
    expect(semRegua(FUNCOES_COM_A_NOVA, contato("funcao' = 'vendedor'"))).toEqual(["sdr_followup"]);
  });

  it("(Lupa 155258) tratada no LEAD mas NÃO no CONTATO: a régua do contato fica vermelha", () => {
    expect(semRegua(FUNCOES_COM_A_NOVA, lead("when 'vendedor' then 'own' when 'sdr_followup' then 'own'"))).toEqual([]);
    expect(semRegua(FUNCOES_COM_A_NOVA, contato("funcao' = 'vendedor'"))).toEqual(["sdr_followup"]);
  });

  it("tratada nas duas (o 'in (...)' do contato também vale): verde", () => {
    expect(semRegua(FUNCOES_COM_A_NOVA, contato("funcao' in ('vendedor', 'sdr_followup')"))).toEqual([]);
  });

  it("o WHEN em maiúsculas também conta como tratado", () => {
    expect(semRegua(FUNCOES_COM_A_NOVA, lead("WHEN 'vendedor' THEN 'own' WHEN 'sdr_followup' THEN 'own'"))).toEqual([]);
  });
});
