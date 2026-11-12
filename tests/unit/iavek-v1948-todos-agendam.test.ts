/**
 * ia.vek v1.9.48 — NA LOJA, TODOS AGENDAM (decisão do Rodrigo, 06/11 e 10/11, CRM-255/257:
 * "todos agendam, sem passo intermediário").
 *
 * O furo (12/11): o botão "Agendar horário" (cartão do lead, conversa, painel do inbox) perguntava ao
 * /agenda-do-sdr se a pessoa marcava direto, e a regra (`sdrMarcaDireto`, v1.9.3) só dizia SIM para a
 * função "sdr". O vendedor caía no PEDIDO e ficava esperando um admin. A 0613 tinha aberto a Agenda e a
 * decisão do pedido, mas não este botão.
 *
 * Este arquivo fica VERMELHO se algum caminho de agendar voltar a usar "só a função sdr".
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { marcaDiretoNaLoja } from "@/lib/iavek/sdr-marca-direto";

const RAIZ = process.cwd();
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8");

/** Um admin client de mentira: devolve o vínculo e a organização pedidos. */
function adminFalso(vinculo: { interface_settings: unknown } | null, settings: unknown) {
  const cadeia = (data: unknown) => {
    const c = {
      select: () => c,
      eq: () => c,
      is: () => c,
      maybeSingle: async () => ({ data, error: null }),
    };
    return c;
  };
  return {
    from: (tabela: string) =>
      tabela === "user_organizations" ? cadeia(vinculo) : cadeia({ settings }),
  } as never;
}

const LOJA = { iavek: { perfil: { nicho: "loja_de_carros", modo_agendamento: false } } };
const CLINICA = { iavek: { perfil: { nicho: "clinica", modo_agendamento: true } } };
const LOJA_EM_MODO_AGENDAMENTO = { iavek: { perfil: { nicho: "loja_de_carros", modo_agendamento: true } } };

describe("v1.9.48 — quem marca direto: na loja, TODOS (a função não decide)", () => {
  for (const funcao of ["sdr", "vendedor", "gerente", "apoio", undefined]) {
    it(`na loja, a função ${funcao ?? "(nenhuma)"} marca direto`, async () => {
      const r = await marcaDiretoNaLoja(adminFalso({ interface_settings: funcao ? { funcao } : {} }, LOJA), "org", "eu");
      expect(r.marcaDireto).toBe(true);
      // ehSdr só diz quem vira GUARDIÃO; não decide quem marca.
      expect(r.ehSdr).toBe(funcao === "sdr");
    });
  }

  it("a organização sem perfil gravado vale como loja (a Fenômenos): marca direto", async () => {
    const r = await marcaDiretoNaLoja(adminFalso({ interface_settings: { funcao: "vendedor" } }, {}), "org", "eu");
    expect(r.marcaDireto).toBe(true);
  });

  it("a clínica (modo agendamento) segue a regra dela: ninguém marca por aqui, nem o SDR", async () => {
    for (const s of [CLINICA, LOJA_EM_MODO_AGENDAMENTO]) {
      for (const funcao of ["sdr", "vendedor", "gerente"]) {
        const r = await marcaDiretoNaLoja(adminFalso({ interface_settings: { funcao } }, s), "org", "eu");
        expect(r.marcaDireto).toBe(false);
      }
    }
  });

  it("quem não é membro ativo (vínculo revogado ou ausente) não marca", async () => {
    const r = await marcaDiretoNaLoja(adminFalso(null, LOJA), "org", "eu");
    expect(r).toEqual({ marcaDireto: false, ehSdr: false });
  });
});

describe("v1.9.48 — a TRAVA: nenhum caminho de agendar volta a ser 'só a função sdr'", () => {
  const fontes = execFileSync("git", ["ls-files", "lib", "app", "components", "hooks", "workers"], { encoding: "utf8", cwd: RAIZ })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("a regra antiga (sdrMarcaDireto) não existe mais em lugar nenhum do código", () => {
    const comARegraAntiga = fontes.filter((f) => /\bsdrMarcaDireto\b/.test(ler(f)));
    expect(comARegraAntiga).toEqual([]);
  });

  it("marcaDireto sai SÓ do perfil da empresa — a função do membro não entra na conta", () => {
    const s = ler("lib/iavek/sdr-marca-direto.ts");
    const corpo = s.slice(s.indexOf("export async function marcaDiretoNaLoja"), s.indexOf("export interface VendedorDaLoja"));
    expect(corpo).toContain("return { marcaDireto: ehLojaDeCarros(perfil) && !perfil.modo_agendamento, ehSdr };");
    // nenhum "if (... sdr ...) return { marcaDireto: false" escondido antes da conta
    expect(corpo).not.toMatch(/sdr["'][^\n]*\)\s*return/);
    expect(corpo).not.toMatch(/marcaDireto:\s*[^,;}\n]*ehSdr/);
  });

  it("os caminhos de agendar usam a regra da loja, e a tela não olha a função de ninguém", () => {
    expect(ler("app/api/v1/iavek/agenda-do-sdr/route.ts")).toContain(
      "const { marcaDireto } = await marcaDiretoNaLoja(admin, authz.org.orgId, authz.user.id);",
    );
    expect(ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts")).toContain(
      "const { marcaDireto, ehSdr } = await marcaDiretoNaLoja(admin, orgId, authz.user.id);",
    );
    // Os botões de agendar: nenhum decide pela função "sdr".
    for (const f of [
      "components/iavek/PedirAgendamento.tsx",
      "components/inbox/CRMSidePanel.tsx",
      "components/iavek/ConversaNoQuadro.tsx",
      "components/kanban/KanbanBoard.tsx",
    ]) {
      expect(ler(f), f).not.toMatch(/funcao[^\n]{0,60}["']sdr["']|["']sdr["'][^\n]{0,60}funcao/);
    }
    expect(ler("components/iavek/PedirAgendamento.tsx")).toContain("setMarcaDireto(Boolean(r.data?.marca_direto));");
  });
});

describe("v1.9.48 — o que muda quando quem marca NÃO é SDR", () => {
  const r = ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts");

  it("o guardião é sempre um SDR: quem marca sem ser SDR não vira guardião", () => {
    expect(r).toContain("guardiaoNovo: ehSdr ? authz.user.id : null,");
    expect(r).toContain("const guardiao = lead.sdr_user_id ?? args.guardiaoNovo;");
  });

  it("o vendedor que marca o próprio cliente: sem 'passagem' para si mesmo e sem aviso de si mesmo", () => {
    expect(r).toContain("const mudouDeMaos = negocio.owner_user_id !== vendedorId;");
    expect(r).toContain("if (mudouDeMaos) await registrarPassagem(admin, {");
    expect(r).toContain("if (vendedorId !== authz.user.id) await avisarVendedorDoAgendamento(admin, {");
    // e na tela ele já vem escolhido como vendedor
    expect(ler("components/iavek/PedirAgendamento.tsx")).toContain(
      'setVendedorId(vendedores.some((v) => v.id === user.id) ? user.id : "");',
    );
  });

  it("o lead de outra pessoa da loja segue só com a gerência (podePassarOLead não mudou)", () => {
    expect(r).toContain("if (!gerencia && !podePassarOLead(negocio, authz.user.id)) {");
  });

  it("os PEDIDOS que existirem: na loja, a equipe vê os pendentes e decide (a mesma regra do POST [id])", () => {
    expect(r).toContain("const podeDecidir = ehAdmin || !(await modoAgendamentoDaOrg(orgId));");
    expect(r).toContain("return ok({ pedidos, pode_decidir: podeDecidir }, { requestId });");
    expect(r).toContain('if (!podeDecidir) consulta = consulta.eq("pedido_por", authz.user.id);');
    expect(ler("app/api/v1/iavek/pedidos-de-agendamento/[id]/route.ts")).toContain(
      "const agendaLivre = !(await modoAgendamentoDaOrg(orgId));",
    );
  });

  it("a IA segue PEDINDO na loja (outra decisão do Rodrigo): a chave dela é o modo agendamento, não esta regra", () => {
    const a = ler("lib/mcp/tools/agendamento.ts");
    expect(a).toContain("return (await agendaDaIaDaOrg(organizationId)).modo;");
    expect(a).not.toMatch(/marcaDiretoNaLoja/);
  });
});
