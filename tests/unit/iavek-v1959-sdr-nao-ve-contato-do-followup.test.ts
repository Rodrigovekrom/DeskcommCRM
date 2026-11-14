/**
 * ia.vek v1.9.59 (0641, CRM-407; desenho b83f3066). O texto da RLS e o caminho de servidor da A1 (lib/iavek/sdr-pediu-contato.ts)
 * com um admin de mentira. A prova de COMPORTAMENTO da RLS e o login real da SDR ficam no TESTE e no canário.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { avisarFollowupSeEscondido, fonteDoPedido, MENSAGEM_A_SDR, responsavelDoPedido } from "@/lib/iavek/sdr-pediu-contato";

const M = readFileSync(join(process.cwd(), "supabase/migrations/20261114230000_0641_iavek_sdr_nao_ve_contato_do_followup.sql"), "utf8");
const codigo = M.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("0641: o texto da RLS", () => {
  it("o manifest da v1.9.59 (0641)", () => {
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.59 \(0641\)/);
  });
  it("só a função 'sdr' (role agent, ativa), sem org fixa nem uuid", () => {
    expect(codigo).toContain("uo.interface_settings->>'funcao' = 'sdr'");
    expect(codigo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(codigo).not.toMatch(/fenomenos|loja-teste/);
  });
  it("as regras 1-3: lead aberto no Follow-up, TODOS no Follow-up, e não é dela", () => {
    expect(codigo).toContain("l.status in ('open', 'future')");
    expect(codigo).toContain("x.pipeline_id is distinct from m.fu");
    expect(codigo).toContain("l.contact_id not in (select d.c from dela d where d.c is not null)");
  });
  it("(Maestro 222446) a regra 3 conta só o que está ABERTO hoje; o contato que ela criou não conta", () => {
    expect(codigo).toContain("l.owner_user_id = p_user and l.contact_id is not null and l.status in ('open', 'future')");
    expect(codigo).toContain("v.status not in ('closed', 'resolved', 'archived')");
    expect(codigo).toContain("a.starts_at > now() and a.status in ('pending', 'confirmed')");
    expect(codigo).toContain("t.status in ('pending', 'in_progress')");
    expect(codigo).not.toContain("k.created_by_user_id = p_user");
  });
  it("as 2 de contacts e a conversa SEM dono ganham a cláusula; o contact_id nulo segue como antes", () => {
    expect(codigo.match(/\("organization_id", "id"\) not in \(select h\.org_id, h\.contato_id from public\.fn_iavek_contatos_escondidos_da_sdr\(\) h\)/g)).toHaveLength(2);
    expect(codigo).toContain("and (contact_id is null or (organization_id, contact_id) not in (select h.org_id, h.contato_id from public.fn_iavek_contatos_escondidos_da_sdr() h)))");
  });
  it("as funções do servidor NÃO são do authenticated (só service_role)", () => {
    expect(codigo).toContain("revoke execute on function public.fn_iavek_escondidos_da_sdr(uuid) from public, anon, authenticated;");
    expect(codigo).toContain("revoke execute on function public.fn_iavek_contato_escondido_da_sdr(uuid, uuid, uuid) from public, anon, authenticated;");
  });
});

type Linha = Record<string, unknown>;
interface Mundo {
  escondido: boolean;
  lead: { id: string; owner_user_id: string | null } | null;
  membros: Array<{ user_id: string; role: string; funcao: string; created_at: string }>;
  platformAdmins: string[];
  tarefasAbertas: Linha[];
}

/** Um admin de mentira: lê o Mundo e grava em `gravado`. */
function adminDe(m: Mundo) {
  const gravado: { tarefas: Linha[]; atividades: Linha[] } = { tarefas: [], atividades: [] };
  const admin = {
    rpc: async () => ({ data: m.escondido, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { full_name: "Ana SDR" } } } }) } },
    from(tabela: string) {
      const f: Array<[string, string, unknown]> = [];
      const q: Record<string, unknown> = {};
      const reg = (op: string) => (k: string, v: unknown) => (f.push([op, k, v]), q);
      Object.assign(q, { select: () => q, eq: reg("eq"), is: reg("is"), in: reg("in"), gte: reg("gte"), order: () => q, limit: () => q });
      q.maybeSingle = async () => {
        if (tabela === "organizations") return { data: { settings: { esteira: { followup: { pipeline_id: "fu" } } } } };
        if (tabela === "crm_leads") return { data: m.lead };
        if (tabela === "crm_tasks") return { data: m.tarefasAbertas[0] ?? null };
        return { data: null };
      };
      q.then = (res: (v: unknown) => unknown) => {
        if (tabela === "user_organizations") {
          const funcao = f.find(([, k]) => k === "interface_settings->>funcao");
          const role = f.find(([, k]) => k === "role");
          const linhas = m.membros
            .filter((x) => (!role || x.role === role[2]) && (!funcao || (Array.isArray(funcao[2]) ? (funcao[2] as string[]).includes(x.funcao) : x.funcao === funcao[2])))
            .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.user_id.localeCompare(b.user_id));
          return Promise.resolve({ data: linhas, error: null }).then(res);
        }
        if (tabela === "platform_admins") return Promise.resolve({ data: m.platformAdmins.map((user_id) => ({ user_id })), error: null }).then(res);
        return Promise.resolve({ data: [], error: null }).then(res);
      };
      q.insert = (row: Linha) => {
        if (tabela === "crm_tasks") gravado.tarefas.push(row);
        if (tabela === "crm_lead_activities") gravado.atividades.push(row);
        const r = { data: { id: "tarefa-1" }, error: null };
        return { select: () => ({ single: async () => r }), then: (res: (v: unknown) => unknown) => Promise.resolve(r).then(res) };
      };
      return q;
    },
  };
  return { admin: admin as never, gravado };
}

const base = (): Mundo => ({
  escondido: true,
  lead: { id: "lead-fu", owner_user_id: "dono-c" },
  membros: [],
  platformAdmins: [],
  tarefasAbertas: [],
});
const T = new Date("2026-11-15T14:00:00Z");

describe("v1.9.59 (A1): a SDR digitou o telefone de um contato escondido", () => {
  it("avisa o DONO: 1 tarefa (created_by NULO, o nome dela só no TEXTO) + 1 atividade; NENHUM lead novo", async () => {
    const { admin, gravado } = adminDe(base());
    expect(await avisarFollowupSeEscondido(admin, "org-1", "sdr-1", "contato-1", T)).toBe("avisado");
    expect(gravado.tarefas).toHaveLength(1);
    const t = gravado.tarefas[0]!;
    expect(t).toMatchObject({ assigned_to: "dono-c", created_by: null, lead_id: "lead-fu", source_kind: fonteDoPedido("sdr-1"), status: "pending" });
    expect(String(t.title)).toBe("Ana SDR pediu para falar com este cliente");
    expect(gravado.atividades).toHaveLength(1);
    expect(gravado.atividades[0]).toMatchObject({ type: "task_created", lead_id: "lead-fu" });
  });

  it("a mensagem à SDR não traz nome nem id", () => {
    expect(MENSAGEM_A_SDR).toBe("Este cliente está com o SDR de Follow-up; ele foi avisado.");
  });

  it("no máximo 1 tarefa aberta por (contato, SDR) por dia: a 2ª tentativa NÃO cria outra", async () => {
    const m = base();
    m.tarefasAbertas = [{ id: "ja-existe" }];
    const { admin, gravado } = adminDe(m);
    expect(await avisarFollowupSeEscondido(admin, "org-1", "sdr-1", "contato-1", T)).toBe("avisado");
    expect(gravado.tarefas).toHaveLength(0);
  });

  it("o contato NÃO está escondido dela: nada é gravado (quem chama segue a recusa de sempre)", async () => {
    const m = base();
    m.escondido = false;
    const { admin, gravado } = adminDe(m);
    expect(await avisarFollowupSeEscondido(admin, "org-1", "sdr-1", "contato-1", T)).toBe("nao_escondido");
    expect(gravado.tarefas).toHaveLength(0);
  });
});

describe("v1.9.59 (A1): quem recebe a tarefa do lead ÓRFÃO", () => {
  const membro = (user_id: string, role: string, funcao: string, created_at: string) => ({ user_id, role, funcao, created_at });

  it("o lead com dono: o dono", async () => {
    expect(await responsavelDoPedido(adminDe(base()).admin, "org-1", "dono-c")).toBe("dono-c");
  });
  it("órfão: o SDR de Follow-up ativo MAIS ANTIGO", async () => {
    const m = base();
    m.membros = [membro("fu-novo", "agent", "sdr_followup", "2026-11-10"), membro("fu-velho", "agent", "sdr_followup", "2026-10-01")];
    expect(await responsavelDoPedido(adminDe(m).admin, "org-1", null)).toBe("fu-velho");
  });
  it("órfão SEM SDR de Follow-up: o GERENTE mais antigo, e o 'apoio' conta como gerente (Maestro 222507)", async () => {
    const m = base();
    m.membros = [membro("ger", "manager", "gerente", "2026-10-05"), membro("apo", "agent", "apoio", "2026-10-02")];
    expect(await responsavelDoPedido(adminDe(m).admin, "org-1", null)).toBe("apo");
  });
  it("só 'apoio', sem gerente: vai ao APOIO (antes do admin)", async () => {
    const m = base();
    m.membros = [membro("apo", "agent", "apoio", "2026-10-02"), membro("adm", "admin", "", "2026-09-01")];
    expect(await responsavelDoPedido(adminDe(m).admin, "org-1", null)).toBe("apo");
  });
  it("órfão SEM SDR de Follow-up e SEM gerente: o ADMIN da org, NUNCA o platform admin", async () => {
    const m = base();
    m.membros = [membro("plat", "admin", "", "2026-01-01"), membro("adm", "admin", "", "2026-05-01")];
    m.platformAdmins = ["plat"];
    expect(await responsavelDoPedido(adminDe(m).admin, "org-1", null)).toBe("adm");
  });
  it("sem NINGUÉM (não deve acontecer): null, e a tarefa nasce sem dono (o alerta vai ao log)", async () => {
    const m = base();
    m.lead = { id: "lead-fu", owner_user_id: null };
    const { admin, gravado } = adminDe(m);
    expect(await avisarFollowupSeEscondido(admin, "org-1", "sdr-1", "contato-1", T)).toBe("avisado");
    expect(gravado.tarefas[0]).toMatchObject({ assigned_to: null });
  });
});
