/**
 * ia.vek — a lista de telas marcada À MÃO para a pessoa vale por cima do desenho da função, só na APRESENTAÇÃO
 * (decisão do Rodrigo 17/11, opção a; Maestro 204213; Lupa 204427).
 *
 * Os 4 perfis abaixo são os 4 casos reais que existiam quando a regra nasceu (medidos só leitura, sem nome): um admin sem
 * função, um vendedor, um gerente e um gerente que atua como SDR. O teste trava:
 *   - sem a lista própria, o menu é EXATAMENTE o de antes (o mesmo da v1.9.60);
 *   - com a lista própria, as telas a mais aparecem, depois das da função, com o rótulo do catálogo;
 *   - nunca uma tela cuja página a função recusa (Entrada de leads e Funis para o vendedor);
 *   - a lista da EMPRESA continua cortando, e sozinha nunca passa por cima da função;
 *   - a marca `personalizada` nunca é aceita para gravar (o schema .strict() recusa);
 *   - a tela de Tarefas abre para o vendedor só com a lista própria que a inclui.
 * O que a pessoa vê de DADOS não muda aqui (nada de RLS): isso está no teste de banco
 * tests/invariants/iavek-visao-por-cima-da-funcao-dados.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FUNCOES, abreATelaDeTarefas, veEspacoDaIa } from "@/lib/iavek/funcoes";
import { combinarInterfaces, destinosDaInterface, interfaceSettingsSchema, lerInterface, paginaDaFuncaoAbre } from "@/lib/navigation/interface";
import { NAV_GROUPS, hubSections, sidebarGroups } from "@/lib/navigation/registry";

type Papel = "admin" | "manager" | "agent";
const EMPRESA_SEM_LISTA = { preset: "completa" };

const menu = (role: Papel, s: ReturnType<typeof combinarInterfaces>) =>
  sidebarGroups(false, role, s).flatMap((g) => g.items.map((i) => i.href));
const vinculo = (funcao: string | null, destinos?: string[]) => ({
  preset: "completa",
  ...(destinos ? { destinos } : {}),
  ...(funcao ? { funcao } : {}),
});

const ADMIN_13 = ["/app/inbox", "/app/meu-dia", "/app/espaco-ia", "/app/radar", "/app/agenda", "/app/templates", "/app/pipeline", "/app/space-do-guardiao", "/app/kanban", "/app/campaigns", "/app/contacts", "/app/companies", "/app/meus-numeros"];
const VENDEDOR_6 = ["/app/meu-dia", "/app/agenda", "/app/pipeline", "/app/tasks", "/app/meus-numeros", "/app/settings/notifications"];
const GERENTE_4 = ["/app/meu-dia", "/app/radar", "/app/agenda", "/app/pipeline"];
const GERENTE_SDR_14 = ["/app/inbox", "/app/meu-dia", "/app/agenda", "/app/pipeline", "/app/space-do-guardiao", "/app/kanban", "/app/campaigns", "/app/contacts", "/app/settings/tenant/agenda", "/app/faturamento", "/app/meus-numeros", "/app/metrics", "/app/activities", "/app/settings/notifications"];

/** O menu de ANTES (v1.9.60), gerado pelo código daquela versão para os mesmos perfis (o arquivo ANTES do desenho). */
const ANTES = {
  admin_com_lista: ["/app/inbox", "/app/espaco-ia", "/app/radar", "/app/agenda", "/app/templates", "/app/kanban", "/app/contacts"],
  vendedor: ["/app/meu-dia", "/app/pipeline", "/app/agenda", "/app/meus-numeros"],
  gerente_com_lista: ["/app/meu-dia", "/app/agenda", "/app/radar", "/app/pipeline"],
  gerente_sem_lista: ["/app/meu-dia", "/app/agenda", "/app/radar", "/app/pipeline", "/app/inbox"],
  sdr: ["/app/meu-dia", "/app/pipeline", "/app/space-do-guardiao", "/app/agenda", "/app/meus-numeros"],
};

describe("(Lupa 205856, 3) sem a lista PRÓPRIA, o menu é BYTE A BYTE o da v1.9.60", () => {
  // a referência foi GERADA pelo código da v1.9.60 (2c3440e): 4 papéis × (sem função + cada função) × 2 presets
  const referencia = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/menu-sem-lista-v1960.json"), "utf8")) as Record<string, unknown>;
  it("as 64 combinações: a barra e os hubs iguais", () => {
    let n = 0;
    for (const role of ["viewer", "agent", "manager", "admin"] as const)
      for (const funcao of [null, ...FUNCOES])
        for (const preset of ["completa", "simplificada"] as const) {
          const s = combinarInterfaces({ preset: "completa" }, { preset, ...(funcao ? { funcao } : {}) });
          const agora = {
            sidebar: sidebarGroups(false, role, s).map((g) => ({ g: g.group.id, l: g.group.label, i: g.items.map((x) => [x.href, x.label]) })),
            hubs: NAV_GROUPS.map((g) => ({ g: g.id, s: hubSections(g.id, false, role, s).map((x) => [x.section, x.items.map((i) => i.href)]) })),
          };
          expect(JSON.stringify(agora)).toBe(JSON.stringify(referencia[`${role}|${funcao ?? "-"}|${preset}`]));
          n++;
        }
    expect(n).toBe(Object.keys(referencia).length);
  });
});

describe("sem a lista PRÓPRIA, o menu é exatamente o de antes", () => {
  it.each([
    ["vendedor", "agent", "vendedor", ANTES.vendedor],
    ["gerente", "manager", "gerente", ANTES.gerente_sem_lista],
    ["gerente que é SDR", "manager", "sdr", ANTES.sdr],
  ] as const)("%s", (_n, role, funcao, esperado) => {
    expect(menu(role, combinarInterfaces(EMPRESA_SEM_LISTA, vinculo(funcao)))).toEqual(esperado);
  });
});

describe("com a lista PRÓPRIA", () => {
  it("o admin SEM função fica igual (a regra só tira o corte da função)", () => {
    expect(menu("admin", combinarInterfaces(EMPRESA_SEM_LISTA, vinculo(null, ADMIN_13)))).toEqual(ANTES.admin_com_lista);
  });

  it("o gerente com as 4 marcadas fica igual (todas já estão no desenho dele)", () => {
    expect(menu("manager", combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("gerente", GERENTE_4)))).toEqual(ANTES.gerente_com_lista);
  });

  it("o VENDEDOR: as 4 da função, na ordem e com os rótulos dela, e DEPOIS Tarefas; Notificações em Configurações", () => {
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", VENDEDOR_6));
    expect(menu("agent", s)).toEqual([...ANTES.vendedor, "/app/tasks"]);
    const rotulos = sidebarGroups(false, "agent", s).flatMap((g) => g.items.map((i) => i.label));
    expect(rotulos.slice(0, 4)).toEqual(["Meu dia", "Meus leads", "Agenda", "Meus dados"]);
    expect(rotulos).toContain("Tarefas");
    const config = hubSections("organizacao", false, "agent", s).flatMap((x) => x.items.map((i) => i.href));
    expect(config).toContain("/app/settings/notifications");
  });

  it("(Lupa 205856) uma tela 'só de hub' marcada (Campanhas) entra no FIM do menu da função", () => {
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", [...VENDEDOR_6, "/app/campaigns"]));
    const m = menu("agent", s);
    // as 4 da função primeiro, na ordem dela; as marcadas a mais DEPOIS, na ordem do catálogo (Campanhas, Tarefas)
    expect(m).toEqual([...ANTES.vendedor, "/app/campaigns", "/app/tasks"]);
  });

  it("o vendedor NUNCA vê no menu uma tela cuja página o desvia (Entrada de leads e Funis), nem marcada", () => {
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", [...VENDEDOR_6, "/app/inbox", "/app/kanban"]));
    const visiveis = destinosDaInterface(s, false, "agent").map((d) => d.href);
    expect(visiveis).not.toContain("/app/inbox");
    expect(visiveis).not.toContain("/app/kanban");
  });

  it("o gerente que é SDR ganha as telas marcadas que o papel permite (a função SDR não desvia Entrada nem Funis)", () => {
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("sdr", GERENTE_SDR_14));
    const m = menu("manager", s);
    expect(m.slice(0, ANTES.sdr.length)).toEqual(ANTES.sdr);
    for (const h of ["/app/inbox", "/app/kanban", "/app/contacts", "/app/metrics", "/app/campaigns"]) expect(m).toContain(h);
  });

  it("a lista da EMPRESA continua cortando, e a da empresa SOZINHA nunca passa por cima da função", () => {
    const empresa = { preset: "completa", destinos: ["/app/meu-dia", "/app/pipeline", "/app/tasks"] };
    const comPessoa = combinarInterfaces(empresa, vinculo("vendedor", ["/app/meu-dia", "/app/pipeline", "/app/agenda", "/app/tasks"]));
    expect(menu("agent", comPessoa)).toEqual(["/app/meu-dia", "/app/pipeline", "/app/tasks"]);
    const soEmpresa = combinarInterfaces(empresa, vinculo("vendedor"));
    expect(soEmpresa.personalizada).toBeUndefined();
    expect(menu("agent", soEmpresa)).toEqual(["/app/meu-dia", "/app/pipeline"]);
  });

  it("o preset 'simplificada' da pessoa não conta como lista própria", () => {
    expect(combinarInterfaces(EMPRESA_SEM_LISTA, { preset: "simplificada", funcao: "vendedor" }).personalizada).toBeUndefined();
  });
});

describe("(Lupa 204427, 2) nenhum item do menu leva a uma página que desvia a pessoa", () => {
  it.each([
    ["admin sem função", "admin", null, ADMIN_13],
    ["vendedor", "agent", "vendedor", VENDEDOR_6],
    ["vendedor que marcou Entrada e Funis", "agent", "vendedor", [...VENDEDOR_6, "/app/inbox", "/app/kanban"]],
    ["vendedor que marcou Campanhas e Faturamento", "agent", "vendedor", [...VENDEDOR_6, "/app/campaigns", "/app/faturamento"]],
    ["gerente", "manager", "gerente", GERENTE_4],
    ["gerente que é SDR", "manager", "sdr", GERENTE_SDR_14],
  ] as const)("%s: cada item do menu abre a página (as travas por função de tasks, inbox, kanban e espaco-ia)", (_n, role, funcao, lista) => {
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo(funcao, [...lista]));
    for (const href of menu(role, s)) {
      const abre =
        href === "/app/tasks"
          ? abreATelaDeTarefas(s.funcao, role, role === "admin", s)
          : href === "/app/espaco-ia"
            ? veEspacoDaIa(s.funcao ?? null, role, false)
            : paginaDaFuncaoAbre(s.funcao, href);
      expect({ href, abre }).toEqual({ href, abre: true });
    }
  });
});

describe("(Lupa 214120) o menu de quem tem a lista não ganha NADA além do marcado (nem um item essencial)", () => {
  it("o vendedor com uma lista SEM os essenciais: a barra = as 4 da função + só as marcadas a mais; os essenciais ficam no rodapé", () => {
    const lista = ["/app/meu-dia", "/app/pipeline", "/app/tasks"];
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", lista));
    const barra = sidebarGroups(false, "agent", s)
      .filter((g) => g.group.id !== "organizacao")
      .flatMap((g) => g.items.map((i) => i.href));
    expect(barra).toEqual(["/app/meu-dia", "/app/pipeline", "/app/tasks"]);
  });
  it.each([
    ["vendedor", "agent", "vendedor", VENDEDOR_6],
    ["gerente", "manager", "gerente", GERENTE_4],
    ["gerente que é SDR", "manager", "sdr", GERENTE_SDR_14],
    ["SDR com uma lista curta", "agent", "sdr", ["/app/meu-dia", "/app/contacts"]],
  ] as const)("%s: tudo o que entra a MAIS do que o desenho da função (fora do rodapé) está na lista marcada", (_n, role, funcao, lista) => {
    const sem = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo(funcao));
    const com = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo(funcao, [...lista]));
    const fora = (st: typeof com) =>
      sidebarGroups(false, role, st).filter((g) => g.group.id !== "organizacao").flatMap((g) => g.items.map((i) => i.href));
    const amais = fora(com).filter((h) => !fora(sem).includes(h));
    for (const h of amais) expect(lista as readonly string[]).toContain(h);
  });
});

describe("(Lupa 211841) o combinado NUNCA é gravado de volta", () => {
  const raiz = process.cwd();
  const arquivos = (dir: string): string[] =>
    readdirSync(join(raiz, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? arquivos(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : [],
    );
  it("o combinarInterfaces só é chamado no login (lib/auth/server.ts), e as telas de edição partem do valor do BANCO", () => {
    const chamadores = ["app", "lib", "components"]
      .flatMap(arquivos)
      .filter((f) => /combinarInterfaces\(/.test(readFileSync(join(raiz, f), "utf8")) && !f.endsWith("lib/navigation/interface.ts"));
    expect(chamadores).toEqual(["lib/auth/server.ts"]);
    // a tela da empresa parte da linha de organizations; a do membro, da linha de user_organizations (rota /api/v1/team)
    expect(readFileSync(join(raiz, "app/app/settings/tenant/page.tsx"), "utf8")).toContain("initial={row.interface_settings}");
    expect(readFileSync(join(raiz, "components/team/MemberInterfaceDialog.tsx"), "utf8")).toContain("lerInterface(member.interface_settings)");
  });
  it("todo caminho de gravação valida com o schema .strict(), que RECUSA a marca", () => {
    for (const f of ["app/actions/settings/atualizarInterfaceDaEmpresa.ts", "app/api/v1/team/[user_id]/interface/route.ts", "lib/auth/issue-invite.ts", "lib/team/convites.ts"]) {
      expect(readFileSync(join(raiz, f), "utf8")).toMatch(/interfaceSettingsSchema/);
    }
    const combinado = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", VENDEDOR_6));
    expect(interfaceSettingsSchema.safeParse(combinado).success).toBe(false);
  });
});

describe("a marca 'personalizada'", () => {
  it("atravessa a releitura (lerInterface), mas NUNCA é aceita para gravar", () => {
    const s = combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", VENDEDOR_6));
    expect(lerInterface(s).settings.personalizada).toBe(true);
    expect(interfaceSettingsSchema.safeParse({ preset: "completa", personalizada: true }).success).toBe(false);
  });
});

describe("a tela de Tarefas", () => {
  it("o vendedor sem lista vai ao Meu dia; com a lista própria que inclui Tarefas, abre; a lista só da empresa não abre", () => {
    expect(abreATelaDeTarefas("vendedor", "agent", false)).toBe(false);
    expect(abreATelaDeTarefas("vendedor", "agent", false, combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", VENDEDOR_6)))).toBe(true);
    expect(
      abreATelaDeTarefas("vendedor", "agent", false, combinarInterfaces({ preset: "completa", destinos: ["/app/tasks", "/app/meu-dia"] }, vinculo("vendedor"))),
    ).toBe(false);
    expect(abreATelaDeTarefas("vendedor", "agent", false, combinarInterfaces(EMPRESA_SEM_LISTA, vinculo("vendedor", ["/app/meu-dia"])))).toBe(false);
  });
});
