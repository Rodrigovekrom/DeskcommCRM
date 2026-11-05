import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { corrigeVenda } from "@/lib/iavek/funcoes";
import { recusaDeMotivoDaPerdaPeloBanco } from "@/lib/leads/motivo-da-perda";

const migration = readFileSync("supabase/migrations/20261105020000_0608_iavek_aviso_de_venda_e_agendado.sql", "utf8");
const baseline = readFileSync("supabase/baseline.sql", "utf8");

describe("v1.9.20: correção da venda", () => {
  it("só gerente e admin corrigem; o guardião e o vendedor não", () => {
    expect(corrigeVenda(null, "admin")).toBe(true);
    expect(corrigeVenda("apoio", "manager")).toBe(true);
    expect(corrigeVenda("gerente", "agent")).toBe(true);
    expect(corrigeVenda("vendedor", "agent")).toBe(false);
    expect(corrigeVenda("sdr", "agent")).toBe(false);
    expect(corrigeVenda("suporte", "agent")).toBe(false);
    expect(corrigeVenda("analista_ficha", "viewer")).toBe(false);
  });
});

describe("v1.9.20: as recusas do banco viram recusa de negócio", () => {
  it.each([
    ["venda_so_gerente: x", "PT403", "venda_so_gerente"],
    ["venda_data_invalida: x", "PT422", "venda_data_invalida"],
    ["agendado_sem_horario: x", "PT422", "iavek_agendado_sem_horario"],
  ])("%s", (message, code, codigo) => {
    expect(recusaDeMotivoDaPerdaPeloBanco({ code, message })?.codigo).toBe(codigo);
  });
  it("a trava de campos segue igual", () => {
    expect(recusaDeMotivoDaPerdaPeloBanco({ code: "PT422", message: "Faltam campos obrigatórios: A, B" })?.codigo).toBe(
      "iavek_campos_obrigatorios",
    );
  });
});

describe("v1.9.20: o aviso e a tela", () => {
  it("o aviso de venda não leva cliente nem valor", () => {
    const corpo = migration.slice(migration.lastIndexOf("create or replace function public.fn_iavek_aviso_de_venda"), migration.lastIndexOf("trg_iavek_aviso_de_venda"));
    const dados = corpo.slice(corpo.indexOf("jsonb_build_object"), corpo.indexOf("from public.user_organizations"));
    expect(dados).toMatch(/carro_nome/);
    expect(dados).not.toMatch(/title|contact|value_cents|phone|lead/);
  });
  it("as regras só valem no nicho loja de carros, com a Agendado da loja", () => {
    expect(migration.match(/'loja_de_carros'\) <> 'loja_de_carros'/g)).toHaveLength(3);
    expect(migration).toMatch(/s\.slug = 'agendado-video'/);
  });
  it("o gatilho do aviso não depende de status na lista do UPDATE, e a pessoa marca o visto", () => {
    expect(migration).toMatch(/create trigger trg_iavek_aviso_de_venda\s+after update on public\.crm_leads/);
    expect(migration).toMatch(/grant update \(popup_visto_em\) on public\.notificacoes to authenticated/);
  });
  it("a migration está no baseline, antes da varredura", () => {
    const i = baseline.lastIndexOf("create or replace function public.fn_iavek_agendado_exige_horario");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(baseline.indexOf("-- ---- VARREDURA anon"));
  });
  it("o pop-up marca ao aparecer e o Agendado sem horário abre a janela", () => {
    expect(readFileSync("components/iavek/AvisoDeVenda.tsx", "utf8")).toMatch(/\.patch\("\/api\/v1\/iavek\/notificacoes\/avisos-de-venda"/);
    expect(readFileSync("components/kanban/KanbanBoard.tsx", "utf8")).toMatch(/onAgendadoSemHorario: setAgendarAntes/);
  });
});
