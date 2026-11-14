/**
 * ia.vek v1.9.58 (0640; CRM-414, tabela do Rodrigo 14/11; desenho revisado pela Lupa 213835): as ligações da esteira
 * fecham sozinhas. A prova de COMPORTAMENTO (cada linha da tabela, o "não fecha", o lote antigo intocado sem evento, o
 * erro no gatilho que não derruba o INSERT, a volta) é no banco de TESTE, numa transação desfeita. Aqui: o texto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const M = readFileSync(join(process.cwd(), "supabase/migrations/20261114220000_0640_iavek_ligacoes_fecham_sozinhas.sql"), "utf8");
const codigo = M.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const BASE = readFileSync(join(process.cwd(), "supabase/baseline.sql"), "utf8");

const funcao = (nome: string) => {
  const i = codigo.indexOf(`create or replace function public.${nome}(`);
  expect(i).toBeGreaterThanOrEqual(0);
  return codigo.slice(i, codigo.indexOf("$$;", codigo.indexOf("$$", i) + 2));
};

describe("0640: as ligações fecham sozinhas", () => {
  it("o manifest da v1.9.58 (0640)", () => {
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.58 \(0640\)/);
  });

  it("nunca marca 'done' (feita é só de quem registrou) e só mexe no que está aberto", () => {
    expect(codigo).not.toMatch(/status\s*=\s*'done'/);
    expect(funcao("fn_iavek_cancela_ligacoes")).toContain("and t.status in ('pending', 'in_progress')");
    expect(funcao("fn_iavek_cancela_ligacoes")).toContain("cancelada_motivo = p_motivo");
  });

  it("(Lupa 213835) os 3 gatilhos: um erro NUNCA derruba o INSERT/UPDATE (exception → warning)", () => {
    for (const f of ["fn_iavek_ligacao_nasceu", "fn_iavek_ligacoes_na_etapa_de_compromisso", "fn_iavek_quente_fecha_com_resposta_de_gente"]) {
      expect(funcao(f)).toMatch(/exception when others then\s+raise warning/);
    }
  });

  it("os 4 motivos da tabela", () => {
    for (const m of ["proxima_ligacao", "cliente_respondeu", "etapa_de_compromisso", "equipe_respondeu"]) {
      expect(codigo).toContain(`'${m}'`);
    }
  });

  it("a quente fecha só L3…L7 (L1/L2 seguem: resposta 2 do Rodrigo)", () => {
    const f = funcao("fn_iavek_ligacao_nasceu");
    expect(f).toContain("array['ligacao:L3','ligacao:L4','ligacao:L5','ligacao:L6','ligacao:L7'], 'cliente_respondeu'");
  });

  it("(Lupa 215050) a próxima e a quente NÃO filtram por hora (a mesma transação), só excluem a própria tarefa", () => {
    const f = funcao("fn_iavek_ligacao_nasceu");
    expect(f).toContain("'cliente_respondeu', null, new.id)");
    expect(f).toContain("'proxima_ligacao', null, new.id)");
    expect(funcao("fn_iavek_cancela_ligacoes")).toContain("and (p_exceto is null or t.id <> p_exceto)");
    // a resposta de pessoa segue com o 'criada ANTES da mensagem'
    expect(funcao("fn_iavek_quente_fecha_com_resposta_de_gente")).toContain("'equipe_respondeu', coalesce(new.created_at, now())");
    expect(f).not.toMatch(/'ligacao:L1'[^;]*'cliente_respondeu'/);
  });

  it("(Lupa 213835) resposta de PESSOA = sent_via 'user' COM sent_by_user_id; NUNCA o external_device", () => {
    const gatilho = codigo.slice(codigo.indexOf("create trigger trg_iavek_quente_fecha_com_resposta_de_gente"));
    expect(gatilho).toContain("new.sent_via::text = 'user' and new.sent_by_user_id is not null");
    expect(codigo).not.toContain("external_device");
  });

  it("a etapa de compromisso vem do settings da ORG (sem org fixa) e só na ENTRADA na etapa", () => {
    const f = funcao("fn_iavek_ligacoes_na_etapa_de_compromisso");
    expect(f).toContain("settings -> 'esteira' -> 'entrada' -> 'etapas_de_compromisso'");
    expect(f).toContain("not (old.stage_id is not null and v_etapas ? old.stage_id::text)");
    expect(codigo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("os gatilhos só por EVENTO (insert/update), nunca uma varredura solta no corpo da migration", () => {
    expect(codigo.match(/create trigger/g)).toHaveLength(3);
    // fora dos corpos das funções ($$ … $$): nenhum update/delete/select que mexa nas tarefas na hora da migration
    const solto = codigo.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(solto).not.toMatch(/\b(update|delete from)\s+public\.crm_tasks/);
    expect(solto).not.toMatch(/\b(select|perform)\s+public\.fn_iavek_cancela_ligacoes/);
  });

  it("o baseline traz a 0640", () => {
    expect(BASE).toContain("(migration 0640, v1.9.58)");
    expect(BASE).toContain("create trigger trg_iavek_quente_fecha_com_resposta_de_gente");
  });
});
