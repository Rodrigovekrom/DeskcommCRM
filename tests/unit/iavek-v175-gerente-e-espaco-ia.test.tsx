/**
 * ia.vek v1.7.5 (pedido do Rodrigo): a visão nova do GERENTE e o Espaço da IA.
 *
 *   1. Espaço da IA: só o admin e a função "suporte" — no menu E na rota.
 *   2. Menu do gerente: dois grupos com nome próprio e 4 itens, nada mais.
 *   3. Os menus de admin, SDR, vendedor e suporte não mudam (além do item 1).
 *   4. É apresentação: nenhuma tela de dentro é bloqueada pela função.
 *   5. "apoio" deixou de ser cargo: é apelido do gerente, e sai das escolhas.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  membros: [] as Array<{ user_id: string; role: string; full_name: string | null }>,
  user: null as null | Record<string, unknown>,
  org: null as null | Record<string, unknown>,
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: mocks.membros }),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => mocks.user,
  resolveActiveOrg: async () => mocks.org,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/components/inbox/InboxLayout", () => ({ InboxLayout: () => null }));

import {
  DESTINOS_DA_FUNCAO,
  FUNCOES_DE_ESCOLHA,
  funcaoDaTela,
  veEspacoDaIa,
} from "@/lib/iavek/funcoes";
import { destinosDaInterface, type InterfaceSettings } from "@/lib/navigation/interface";
import { sidebarGroups } from "@/lib/navigation/registry";
import { SeletorDeVendedor } from "@/components/kanban/SeletorDeVendedor";
import { InterfaceEditor } from "@/components/team/InterfaceEditor";
import EspacoDaIaPage from "@/app/app/espaco-ia/page";

type Papel = "viewer" | "agent" | "manager" | "admin";
const ESPACO = "/app/espaco-ia";
const comFuncao = (funcao?: string) =>
  (funcao ? { preset: "completa", funcao } : { preset: "completa" }) as InterfaceSettings;
const hrefs = (funcao: string | undefined, role: Papel, platform = false) =>
  destinosDaInterface(comFuncao(funcao), platform, role).map((d) => d.href);
const barra = (funcao: string | undefined, role: Papel) =>
  sidebarGroups(false, role, comFuncao(funcao));

beforeEach(() => {
  mocks.membros = [];
});

describe("1. Espaço da IA: só admin e função suporte", () => {
  it("a regra, para toda combinação de função e papel", () => {
    for (const role of ["viewer", "agent", "manager", "admin"] as const) {
      for (const f of [undefined, "sdr", "suporte", "vendedor", "apoio", "gerente"]) {
        const espera = f ? f === "suporte" : role === "admin";
        expect(veEspacoDaIa(funcaoDaTela(f), role), `${f ?? "sem função"}/${role}`).toBe(espera);
        // e o menu (incluindo a busca ⌘K, que lê a mesma lista) obedece
        const papelQueAbre = role !== "viewer"; // minRole do item é agent
        expect(hrefs(f, role).includes(ESPACO), `${f ?? "sem função"}/${role}`).toBe(
          espera && papelQueAbre,
        );
      }
    }
    expect(veEspacoDaIa(null, null, true)).toBe(true); // admin de plataforma
  });

  it("o ADMIN vê o Espaço da IA na BARRA lateral (não só na busca)", () => {
    const itens = barra(undefined, "admin").flatMap((g) => g.items.map((d) => d.href));
    expect(itens).toContain(ESPACO);
  });

  it("a função suporte vê na barra; SDR, vendedor, gerente e apoio, não", () => {
    const naBarra = (f: string, role: Papel) =>
      barra(f, role)
        .flatMap((g) => g.items.map((d) => d.href))
        .includes(ESPACO);
    expect(naBarra("suporte", "agent")).toBe(true);
    expect(naBarra("sdr", "agent")).toBe(false);
    expect(naBarra("vendedor", "agent")).toBe(false);
    expect(naBarra("gerente", "manager")).toBe(false);
    expect(naBarra("apoio", "manager")).toBe(false);
  });

  it("o 'Ver como gerente' de um admin mostra o que o gerente vê: sem o Espaço", () => {
    expect(hrefs("gerente", "admin")).not.toContain(ESPACO);
  });

  it("a ROTA também: quem não pode vai para o Meu dia; admin e suporte entram", async () => {
    const abrir = async (role: Papel, funcao?: string, extra: Record<string, unknown> = {}) => {
      mocks.user = { id: "u", is_platform_admin: false, support: null, ...extra };
      mocks.org = { orgId: "o", role, interface_settings: comFuncao(funcao) };
      try {
        await EspacoDaIaPage({ searchParams: Promise.resolve({}) });
        return "entrou";
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(await abrir("admin")).toBe("entrou");
    expect(await abrir("agent", "suporte")).toBe("entrou");
    expect(await abrir("agent", "sdr")).toBe("REDIRECT:/app/meu-dia");
    expect(await abrir("agent", "vendedor")).toBe("REDIRECT:/app/meu-dia");
    expect(await abrir("manager", "gerente")).toBe("REDIRECT:/app/meu-dia");
    expect(await abrir("manager", "apoio")).toBe("REDIRECT:/app/meu-dia");
    expect(await abrir("agent")).toBe("REDIRECT:/app/meu-dia");
    expect(await abrir("manager")).toBe("REDIRECT:/app/meu-dia");
  });
});

describe("2. Menu do gerente", () => {
  it("dois grupos com os nomes pedidos, 4 itens, e o rodapé (perfil e segurança)", () => {
    const grupos = barra("gerente", "manager");
    expect(grupos.map((g) => g.group.label)).toEqual([
      "Controle e análise",
      "Acompanhamento",
      "Organização",
    ]);
    expect(grupos[0]!.items.map((d) => [d.href, d.label])).toEqual([
      ["/app/meu-dia", "Meu dia"],
      ["/app/agenda", "Agenda da loja"],
    ]);
    expect(grupos[1]!.items.map((d) => [d.href, d.label])).toEqual([
      ["/app/kanban", "Kanban por vendedor"],
      ["/app/inbox", "Atendimento do lead"],
    ]);
    // nenhum hub "Ver tudo em …" nos grupos dele
    expect(grupos.slice(0, 2).every((g) => !g.group.hub)).toBe(true);
    // o rodapé leva só às portas pessoais
    expect(hrefs("gerente", "manager").filter((h) => h.startsWith("/app/settings"))).toEqual(
      expect.arrayContaining(["/app/settings/profile", "/app/settings/security"]),
    );
    expect(
      hrefs("gerente", "manager")
        .filter((h) => h.startsWith("/app/settings"))
        .sort(),
    ).toEqual(["/app/settings/profile", "/app/settings/security"]);
  });

  it("saem Radar, Contatos, Tarefas, Casos, Desempenho, Atividades, Equipe, Notificações…", () => {
    const menu = hrefs("gerente", "manager");
    for (const h of [
      "/app/radar",
      "/app/templates",
      "/app/contacts",
      "/app/tasks",
      "/app/ai/cases",
      "/app/ai/inbox",
      "/app/metrics",
      "/app/activities",
      "/app/team",
      "/app/settings/notifications",
      "/app/settings/atendimento",
      "/app/settings/tags",
      ESPACO,
    ]) {
      expect(menu).not.toContain(h);
    }
  });

  it("Kanban por vendedor: o seletor escreve no MESMO filtro de responsável", () => {
    mocks.membros = [
      { user_id: "u2", role: "agent", full_name: "Zeca" },
      { user_id: "u1", role: "agent", full_name: "Ana" },
    ];
    const onChange = vi.fn();
    render(<SeletorDeVendedor filters={{ owner: "any" }} onChange={onChange} />);
    const select = screen.getByLabelText("Vendedor") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Todos os vendedores",
      "Ana",
      "Zeca",
    ]);
    fireEvent.change(select, { target: { value: "u2" } });
    expect(onChange).toHaveBeenCalledWith({ owner: "u2" });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ owner: "any" });
  });

  it("o quadro só mostra o seletor para o gerente (e o apoio)", () => {
    const fonte = readFileSync("app/app/pipelines/[id]/_client.tsx", "utf8");
    expect(fonte).toMatch(
      /funcaoDaTela\(useActiveOrg\(\)\?\.interface_settings\?\.funcao\) === "gerente"/,
    );
    expect(fonte).toContain("{ehGerente && <SeletorDeVendedor");
  });
});

describe("3. Os outros menus não mudam (além do Espaço da IA)", () => {
  it("SDR, vendedor e suporte: as mesmas listas da v1.7.4 (o SDR perde só o Espaço)", () => {
    const pessoal = ["/app/inbox", "/app/agenda", "/app/tasks", "/app/contacts", "/app/calls"];
    expect(DESTINOS_DA_FUNCAO.sdr).toEqual(["/app/meu-dia", ...pessoal, "/app/templates"]);
    expect(DESTINOS_DA_FUNCAO.suporte).toEqual([
      "/app/meu-dia",
      ESPACO,
      ...pessoal,
      "/app/templates",
    ]);
    expect(DESTINOS_DA_FUNCAO.vendedor).toEqual([
      "/app/meu-dia",
      "/app/inbox",
      "/app/agenda",
      "/app/kanban",
      "/app/tasks",
      "/app/contacts",
      "/app/products",
      "/app/proposals",
      "/app/calls",
      "/app/templates",
    ]);
  });

  it("admin sem função segue com tudo, e a barra de sempre (mais o Espaço)", () => {
    const admin = hrefs(undefined, "admin");
    for (const h of ["/app/ai/agents", "/app/settings/automacoes", "/app/webhooks", ESPACO]) {
      expect(admin).toContain(h);
    }
    expect(barra(undefined, "admin").some((g) => g.group.label === "Controle e análise")).toBe(
      false,
    );
  });
});

describe("4. Apresentação: nenhuma tela de dentro é bloqueada pela função", () => {
  it("só a tela inicial e o Espaço da IA leem a função para redirecionar", () => {
    const leem: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p);
        else if (/\.(ts|tsx)$/.test(nome) && !/\.test\./.test(nome)) {
          const f = readFileSync(p, "utf8");
          if (
            /redirect\(/.test(f) &&
            /(veEspacoDaIa|funcaoMostra|destinosDaInterface|homeDaInterface|funcaoDaTela)\(/.test(f)
          ) {
            leem.push(p);
          }
        }
      }
    };
    varrer("app/app");
    // contatos, leads, conversas: abrem por link de dentro do Kanban/Meu dia/Inbox
    expect(leem.sort()).toEqual(["app/app/espaco-ia/page.tsx", "app/app/page.tsx"]);
  });
});

describe("5. 'apoio' é apelido do gerente", () => {
  it("na tela, o apoio vira gerente; o que se escolhe não tem mais o apoio", () => {
    expect(funcaoDaTela("apoio")).toBe("gerente");
    expect(funcaoDaTela("gerente")).toBe("gerente");
    expect(funcaoDaTela("caixa")).toBeNull();
    expect(FUNCOES_DE_ESCOLHA).not.toContain("apoio");
    expect([...FUNCOES_DE_ESCOLHA].sort()).toEqual(["gerente", "sdr", "suporte", "vendedor"]);
  });

  it("menu e barra do apoio são EXATAMENTE os do gerente", () => {
    expect(hrefs("apoio", "manager")).toEqual(hrefs("gerente", "manager"));
    const desenho = (f: string) =>
      barra(f, "manager").map((g) => [g.group.label, g.items.map((d) => d.label)]);
    expect(desenho("apoio")).toEqual(desenho("gerente"));
  });

  it("Equipe/convite: o seletor de função não oferece apoio, e um vínculo antigo aparece como Gerente", () => {
    const onChange = vi.fn();
    render(
      <InterfaceEditor
        value={comFuncao("apoio")}
        onChange={onChange}
        role="manager"
        mostrarFuncao
      />,
    );
    const select = screen.getByTestId("funcao-na-loja") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "sdr",
      "suporte",
      "vendedor",
      "gerente",
    ]);
    expect(select.value).toBe("gerente");
  });

  it("o 'Ver como' lista as mesmas escolhas (sem apoio)", () => {
    const fonte = readFileSync("components/shell/VerComo.tsx", "utf8");
    expect(fonte).toContain("FUNCOES_DE_ESCOLHA.map(");
    expect(fonte).not.toMatch(/\bFUNCOES\.map\(/);
  });
});
