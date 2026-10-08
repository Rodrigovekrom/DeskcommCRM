import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { FundoDaCasca } from "@/components/shell/FundoDaCasca";
import type { ActiveOrg } from "@/lib/auth/types";
import type { Branding } from "@/lib/branding";
import { MarcaDaInstalacaoProvider } from "@/lib/branding/contexto";

/**
 * A rede neural da área logada aparece só com a marca do produto (ia.vek /
 * ia.vek CRM), na variante `sutil`, e a casca a monta UMA vez. O login segue
 * com a variante completa.
 */

let activeOrg: ActiveOrg | null = null;
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, activeOrg }) }));

afterEach(() => {
  cleanup();
  activeOrg = null;
});

function renderCom(marca: Branding) {
  return render(
    <MarcaDaInstalacaoProvider marca={marca}>
      <FundoDaCasca />
    </MarcaDaInstalacaoProvider>,
  );
}

describe("FundoDaCasca", () => {
  it.each(["ia.vek", "ia.vek CRM"])(
    "com a instalação %s, desenha o canvas atrás de tudo",
    (name) => {
      const { container } = renderCom({ name, logoUrl: null, initial: "I" });
      const canvas = container.querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas!.getAttribute("aria-hidden")).toBe("true");
      expect(canvas!.className).toMatch(/pointer-events-none/);
      expect(canvas!.className).toMatch(/-z-10/);
    },
  );

  it("instalação com marca própria fica limpa", () => {
    const { container } = renderCom({ name: "Acme CRM", logoUrl: null, initial: "A" });
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("organização que pôs logo próprio também fica limpa", () => {
    activeOrg = { marca: { logoUrl: "https://cdn.x/logo.png" } } as unknown as ActiveOrg;
    const { container } = renderCom({ name: "ia.vek CRM", logoUrl: null, initial: "I" });
    expect(container.querySelector("canvas")).toBeNull();
  });
});

describe("onde cada variante mora", () => {
  const ler = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("a casca monta o fundo uma vez, e o login segue com a variante completa", () => {
    const casca = ler("app/app/_components/AppShell.tsx");
    expect(casca.match(/<FundoDaCasca \/>/g)).toHaveLength(1);
    expect(casca).toMatch(/relative isolate/);
    expect(ler("components/shell/FundoDaCasca.tsx")).toMatch(/variante="sutil"/);
    expect(ler("app/(public)/layout.tsx")).toMatch(/<FundoNeural \/>/);
  });
});
