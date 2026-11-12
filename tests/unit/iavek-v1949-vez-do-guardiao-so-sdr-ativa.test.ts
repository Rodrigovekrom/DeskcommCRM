/**
 * ia.vek v1.9.49 (0631, Maestro 170903): a vez do guardião só vai a quem é SDR ATIVA NA HORA, nas DUAS funções que leem a
 * lista do rodízio (o aviso do grupo e o guardião do agendamento). O comportamento é provado no banco
 * (tests/invariants/iavek-vez-do-guardiao-so-sdr-ativa); aqui a trava do texto: o filtro não some de nenhuma das duas.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIG = readFileSync("supabase/migrations/20261112043000_0631_iavek_vez_do_guardiao_so_sdr_ativa.sql", "utf8");
const BASE = readFileSync("supabase/baseline.sql", "utf8");
const FILTRO = "and uo.role = 'agent' and uo.interface_settings->>'funcao' = 'sdr'";

function ultimaDefinicao(texto: string, fn: string): string {
  const i = texto.lastIndexOf(`create or replace function public.${fn}(`);
  return texto.slice(i, texto.indexOf("$$;", texto.indexOf("$$", i) + 2));
}

describe("0631 — a lista do rodízio é só a ORDEM; a vez é de quem é SDR ativa na hora", () => {
  for (const fn of ["fn_iavek_aviso_de_ajuda", "fn_iavek_guardiao_do_agendamento"]) {
    it(`${fn}: o filtro da SDR ativa está na migration E na definição mais nova do baseline`, () => {
      expect(ultimaDefinicao(MIG, fn)).toContain(FILTRO);
      expect(ultimaDefinicao(BASE, fn)).toContain(FILTRO);
    });

    it(`${fn}: sem nenhuma SDR ativa na lista, registra no log e cai na regra de antes`, () => {
      const corpo = ultimaDefinicao(MIG, fn);
      expect(corpo).toContain("raise log 'iavek 0631: a lista do rodizio da org % nao tem nenhuma SDR ativa");
      expect(corpo).toContain("and uo.interface_settings->>'funcao' = 'sdr'\n     order by");
    });
  }
});
