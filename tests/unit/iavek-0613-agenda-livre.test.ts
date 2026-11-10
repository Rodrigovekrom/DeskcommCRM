/**
 * ia.vek 0613 (CRM-255/257, Rodrigo 06/11: "todos consigam agendar sem problemas"): na LOJA (sem modo
 * agendamento) qualquer pessoa da equipe cria, remarca, cancela e conclui, inclusive na agenda do colega;
 * concluir sem duas etapas e antes do início; Marcar agendamento pede só lead, dia e hora. A CLÍNICA
 * (modo agendamento) segue como antes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(p, "utf8");
const ultima = (b: string, nome: string) => {
  const i = b.lastIndexOf(`create or replace function public.${nome}(`);
  return b.slice(i, b.indexOf("$$;", i));
};

describe("rota da agenda", () => {
  it("o piso é a equipe (agent); a clínica (modo) segue exigindo gerente", () => {
    const r = ler("app/api/v1/agenda/agendamentos/route.ts");
    expect(r).toMatch(/role: "agent",/);
    expect(r).toMatch(/if \(authz\.actor\.type === "user" && modoAgendamento && !roleAtLeast\(authz\.actor\.role, "manager"\)\)/);
    expect(r).not.toMatch(/Requer role >= admin/);
    expect(r).toMatch(/iavekAgendaLivre: !modoAgendamento,/);
  });
  it("o handler pula a agenda do colega e o 'ainda não começou' só na loja", () => {
    const h = ler("app/api/v1/agenda/agendamentos/_handler.ts");
    expect(h).toMatch(/if \(ctx\.iavekAgendaLivre\) return;/);
    expect(h).toMatch(/!ctx\.iavekSdrMarcaParaVendedor && !ctx\.iavekAgendaLivre && aOpcaoPodeRecortar/);
    expect(h).toMatch(/!ctx\.iavekAgendaLivre &&\s*\(input\.status === "completed" \|\| input\.status === "no_show"\)/);
  });
});

describe("pedidos e Marcar agendamento", () => {
  it("na loja qualquer pessoa confirma ou recusa pedido; na clínica, só o admin", () => {
    const r = ler("app/api/v1/iavek/pedidos-de-agendamento/[id]/route.ts");
    expect(r).toMatch(/const agendaLivre = !\(await modoAgendamentoDaOrg\(orgId\)\);\s*if \(!ehAdmin && !agendaLivre\)/);
  });
  it("Marcar agendamento: sem cobrança de campos/contexto; sem tipo, vale o primeiro ativo", () => {
    const r = ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts");
    expect(r).not.toMatch(/Faltam campos para passar o lead/);
    expect(r).toMatch(/\?\? \(await primeiroTipoAtivo\(admin, orgId\)\)/);
    expect(ler("components/iavek/PedirAgendamento.tsx")).not.toMatch(/CONTEXTO_MINIMO/);
  });
});

describe("banco (0613, última definição do baseline)", () => {
  const b = ler("supabase/baseline.sql");
  it("RLS de escrita: + agent na loja; a clínica segue gerente/admin", () => {
    const i = b.lastIndexOf("create policy calendar_appointments_write");
    const p = b.slice(i, b.indexOf(");\n", b.indexOf("with check", i)));
    expect(p.match(/fn_role_at_least\(organization_id, 'agent'\)\s*and not public\.fn_iavek_modo_agendamento\(organization_id\)/g)?.length).toBe(2);
  });
  it("concluir não pede duas etapas; o resto segue pedindo", () => {
    expect(ultima(b, "fn_appointment_change_core")).toContain("coalesce(p_patch->>'status','') not in ('completed','no_show') and not public.fn_session_mfa_proven()");
  });
  it("agenda do colega e 'ainda não começou' só valem no modo agendamento", () => {
    expect(ultima(b, "fn_appointment_change_core")).toContain("and public.fn_iavek_modo_agendamento(p_org)");
    expect(ultima(b, "fn_appointment_stamp")).toContain("if new.starts_at>now() and public.fn_iavek_modo_agendamento(new.organization_id) then raise exception 'appointment_not_started'");
  });
  it("ficam: 180 dias e contato da mesma empresa", () => {
    expect(ler("lib/iavek/pedidos-de-agendamento.ts")).toMatch(/180/);
    expect(ultima(b, "fn_appointment_stamp")).toContain("appointment_contact_scope");
  });
});

describe("CRM-255/257: na loja, tipo sem responsável não trava ninguém", () => {
  it("criar: sem responsável escolhido nem padrão, fica na agenda de quem marca (só na agenda livre)", () => {
    const h = readFileSync("app/api/v1/agenda/agendamentos/_handler.ts", "utf8");
    expect(h).toMatch(/tipo\.default_owner_user_id \?\?\s*\(ctx\.iavekAgendaLivre && ctx\.actor\.type === "user" \? ctx\.actor\.id : null\)/);
  });
  it("horários: a mesma regra, e a clínica segue sem responsável = sem agenda", () => {
    const r = readFileSync("app/api/v1/agenda/horarios-livres/route.ts", "utf8");
    // v1.9.38: o modo é lido uma vez (`naClinica`) e serve também ao horário da loja; a regra é a mesma.
    expect(r).toContain("const naClinica = await modoAgendamentoDaOrg(activeOrg.orgId);");
    expect(r).toContain("donoSeFaltar: naClinica ? null : authz.user.id");
    const c = readFileSync("lib/agenda/consulta.ts", "utf8");
    expect(c).toContain("params.ownerUserId ?? tipo.default_owner_user_id ?? params.donoSeFaltar ?? null");
  });
});

describe("CRM-255/257: a Central também conclui antes do início, na loja", () => {
  it("Compareceu/Faltou só esperam o horário quando há modo agendamento (clínica)", () => {
    const d = readFileSync("components/agenda/DetalheDoCompromisso.tsx", "utf8");
    expect(d).toContain("(modo_agendamento && Date.parse(a.starts_at) > query.dataUpdatedAt) ||");
    expect(d).not.toMatch(/^\s*Date\.parse\(a\.starts_at\) > query\.dataUpdatedAt \|\|/m);
  });
});
