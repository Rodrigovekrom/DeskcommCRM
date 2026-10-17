/**
 * ia.vek v1.6 (parte A): a FUNÇÃO na loja (SDR · Vendedor · Gerente) decide só o
 * que a pessoa vê; "Ver como" troca a visão sem trocar papel; o Espaço da IA
 * tem item próprio no menu.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  combinarInterfaces,
  destinosDaInterface,
  interfaceSettingsSchema,
  lerInterface,
} from "@/lib/navigation/interface";
import { DESTINOS_DA_FUNCAO, funcaoMostra } from "@/lib/iavek/funcoes";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const auth = vi.hoisted(() => ({
  verComo: null as null | "sdr" | "vendedor" | "gerente",
  definirVerComo: vi.fn(),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
import { SeloVerComo } from "@/components/shell/VerComo";

const hrefs = (raw: unknown, role: "agent" | "manager" | "admin" = "agent") =>
  destinosDaInterface(raw, false, role).map((d) => d.href);

describe("função na interface do vínculo", () => {
  it("o schema aceita a função e recusa valor desconhecido", () => {
    expect(interfaceSettingsSchema.safeParse({ preset: "completa", funcao: "sdr" }).success).toBe(
      true,
    );
    expect(interfaceSettingsSchema.safeParse({ preset: "completa", funcao: "caixa" }).success).toBe(
      false,
    );
  });

  it("lerInterface guarda a função e ignora uma desconhecida sem invalidar o resto", () => {
    expect(lerInterface({ preset: "completa", funcao: "vendedor" }).settings.funcao).toBe(
      "vendedor",
    );
    const r = lerInterface({ preset: "simplificada", funcao: "caixa" });
    expect(r.settings).toEqual({ preset: "simplificada" });
  });

  it("a função atravessa a combinação empresa ∩ vínculo", () => {
    expect(combinarInterfaces(null, { preset: "completa", funcao: "sdr" }).funcao).toBe("sdr");
    expect(
      combinarInterfaces({ preset: "simplificada" }, { preset: "completa", funcao: "vendedor" })
        .funcao,
    ).toBe("vendedor");
  });
});

describe("menu por função", () => {
  it("SDR vê só a lista dela (e as portas essenciais), nunca além do papel", () => {
    const sdr = hrefs({ preset: "completa", funcao: "sdr" });
    expect(sdr).toContain("/app/inbox");
    expect(sdr).toContain("/app/espaco-ia");
    expect(sdr).not.toContain("/app/kanban");
    expect(sdr).not.toContain("/app/ai/agents");
    expect(sdr).toContain("/app/settings/profile");
    for (const h of sdr) {
      expect(
        funcaoMostra("sdr", h) || ["/app/settings/profile", "/app/settings/security"].includes(h),
      ).toBe(true);
    }
  });

  it("vendedor vê o funil e as propostas; gerente vê tudo o que o papel permite", () => {
    const vendedor = hrefs({ preset: "completa", funcao: "vendedor" });
    expect(vendedor).toContain("/app/kanban");
    expect(vendedor).not.toContain("/app/espaco-ia");
    expect(hrefs({ preset: "completa", funcao: "gerente" }, "manager")).toEqual(
      hrefs({ preset: "completa" }, "manager"),
    );
    expect(DESTINOS_DA_FUNCAO.gerente).toBeNull();
  });

  it("sem função, nada muda", () => {
    expect(hrefs({ preset: "completa" })).toEqual(hrefs(null));
  });
});

describe("Espaço da IA", () => {
  it("tem item próprio no menu, no grupo de atendimento", () => {
    const item = NAV_CATALOG.find((d) => d.href === "/app/espaco-ia");
    expect(item && "label" in item ? item.label : null).toBe("Espaço da IA");
    expect(item && "group" in item ? item.group : null).toBe("atendimento");
  });
});

describe("selo 'Vendo como'", () => {
  it("só aparece com uma visão escolhida, e o botão volta para a minha visão", () => {
    auth.verComo = null;
    const { rerender } = render(<SeloVerComo />);
    expect(screen.queryByTestId("selo-ver-como")).toBeNull();
    auth.verComo = "sdr";
    rerender(<SeloVerComo />);
    expect(screen.getByTestId("selo-ver-como").textContent).toContain("Vendo como: SDR");
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a minha visão" }));
    expect(auth.definirVerComo).toHaveBeenCalledWith(null);
  });
});
