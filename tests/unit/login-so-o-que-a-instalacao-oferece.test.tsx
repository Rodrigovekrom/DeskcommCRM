// A TELA DE LOGIN DA ia.vek (15/10/2026): só e-mail e senha quando a instalação é
// "só convite" e o Google está desligado; sem o título e o nome repetidos sob o
// logotipo (ficam para leitor de tela); campos sólidos e mais claros que o fundo.

import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  modo: vi.fn(),
  google: vi.fn(),
}));

vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: vi.fn(async () => ({ nome: "ia.vek CRM" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
  })),
}));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: vi.fn(async () => "pt-BR") }));
vi.mock("@/lib/i18n/dicionario", () => ({ traduzir: (texto: string) => texto }));
vi.mock("@/components/auth/EntrarComGoogle", () => ({
  EntrarComGoogle: () => <button>Entrar com Google</button>,
}));
vi.mock("@/lib/auth/politica-de-cadastro", () => ({ modoDeCadastro: mocks.modo }));
vi.mock("@/lib/auth/provedor-google", () => ({ estadoDoProvedorGoogle: mocks.google }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/app/actions/auth/signInWithPassword", () => ({ signInWithPassword: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

async function tela() {
  const { default: LoginPage } = await import("@/app/(public)/login/page");
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
}

describe("tela de login: só o que a instalação oferece", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("só convite + Google desligado: sem 'Criar conta' e sem botão do Google", async () => {
    mocks.modo.mockResolvedValue("so_convite");
    mocks.google.mockResolvedValue("desligado");
    const html = await tela();
    expect(html).not.toContain("Criar conta");
    expect(html).not.toContain('href="/signup"');
    expect(html).not.toContain("Entrar com Google");
    expect(html).toContain("Esqueci minha senha");
  });

  it("cadastro aberto + Google ligado: os dois voltam (controle)", async () => {
    mocks.modo.mockResolvedValue("aberto");
    mocks.google.mockResolvedValue("ligado");
    const html = await tela();
    expect(html).toContain("Criar conta");
    expect(html).toContain("Entrar com Google");
  });

  it("o título 'Entrar' e o nome da marca existem só para leitor de tela", async () => {
    mocks.modo.mockResolvedValue("so_convite");
    mocks.google.mockResolvedValue("desligado");
    const html = await tela();
    expect(html).toMatch(/<div class="sr-only"><h1>Entrar<\/h1><p>ia\.vek CRM<\/p><\/div>/);
  });

  it("os campos de e-mail e senha são sólidos e mais claros que o fundo", async () => {
    const { LoginForm } = await import("@/components/auth/LoginForm");
    const { container } = render(<LoginForm />);
    for (const id of ["email", "password"]) {
      const campo = container.querySelector<HTMLInputElement>(`#${id}`)!;
      expect(campo.className).toContain("bg-surface");
      expect(campo.className).toContain("dark:bg-surface-elevated");
      expect(campo.className).not.toMatch(/(^|\s)bg-bg(\s|$)/);
    }
  });
});
