/**
 * ia.vek v1.9.50 (Lupa 153805): uma FUNÇÃO da equipe nunca existe sem a régua de visão dela.
 *
 * O furo que este teste fecha: uma função nova que o fn_iavek_modo_da_funcao não conhece devolve NULL, então vale o
 * visibility_mode da organização (na Fenômenos, vazio = 'own_and_unassigned'). Ela veria TODOS os leads e conversas
 * sem dono e todos os contatos. Foi o que quase saiu com o 'sdr_followup' (CRM-254): a função nasceu antes da RLS.
 *
 * Regra: toda função de FUNCOES (lib/iavek/funcoes.ts) ou é TRATADA no fn_iavek_modo_da_funcao mais novo das
 * migrations, ou está na lista abaixo das que seguem o modo da organização DE PROPÓSITO. Uma função nova sem uma das
 * duas = VERMELHO. É unitário: roda em todo push.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FUNCOES } from "@/lib/iavek/funcoes";

/** As que seguem o modo da organização de propósito (a gerência vê tudo pelo papel; o analista não usa o /app). */
const SEGUEM_O_MODO_DA_ORG = new Set(["gerente", "apoio", "analista_ficha"]);

function corpoMaisNovo(funcao: string): string {
  const dir = "supabase/migrations";
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let corpo = "";
  for (const a of arquivos) {
    const s = readFileSync(join(dir, a), "utf8");
    const i = s.lastIndexOf(`create or replace function public.${funcao}(`);
    if (i >= 0) corpo = s.slice(i, s.indexOf("$$;", s.indexOf("$$", i) + 2));
  }
  return corpo;
}

describe("toda função da equipe tem a régua de visão", () => {
  const modo = corpoMaisNovo("fn_iavek_modo_da_funcao");

  it("o fn_iavek_modo_da_funcao foi achado nas migrations (a leitura não ficou vazia)", () => {
    expect(modo).toContain("when 'vendedor' then");
  });

  it("cada função de FUNCOES é tratada no fn_iavek_modo_da_funcao, ou segue o modo da organização de propósito", () => {
    const sem = FUNCOES.filter((f) => !SEGUEM_O_MODO_DA_ORG.has(f) && !modo.includes(`when '${f}'`));
    expect(sem).toEqual([]);
  });
});
