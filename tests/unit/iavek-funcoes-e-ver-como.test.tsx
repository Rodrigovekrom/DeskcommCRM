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
import { DESTINOS_DA_FUNCAO, ROTULO_DA_FUNCAO, funcaoMostra } from "@/lib/iavek/funcoes";
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
    // v1.9.6: o guardião responde pela conversa aberta do card (Meus leads); a
    // Entrada de leads saiu do menu dele.
    expect(sdr).not.toContain("/app/inbox");
    // v1.7.5: o Espaço da IA é só do admin e da função suporte.
    expect(sdr).not.toContain("/app/espaco-ia");
    expect(sdr).not.toContain("/app/kanban");
    expect(sdr).not.toContain("/app/ai/agents");
    expect(sdr).toContain("/app/settings/profile");
    for (const h of sdr) {
      expect(
        funcaoMostra("sdr", h) || ["/app/settings/profile", "/app/settings/security"].includes(h),
      ).toBe(true);
    }
  });

  it("v1.9.7: o vendedor vê exatamente Meu dia, Meus leads, Agenda e Meus dados", () => {
    const vendedor = hrefs({ preset: "completa", funcao: "vendedor" });
    expect(vendedor).toContain("/app/pipeline");
    expect(vendedor).not.toContain("/app/kanban");
    expect(vendedor).not.toContain("/app/inbox");
    expect(vendedor).not.toContain("/app/espaco-ia");
  });

  it("v1.7.5: o gerente vê SÓ os 4 itens dele, mais as portas pessoais", () => {
    const gerente = hrefs({ preset: "completa", funcao: "gerente" }, "manager");
    expect([...gerente].sort()).toEqual(
      [
        "/app/meu-dia",
        "/app/agenda",
        "/app/pipeline", // v1.9.8: o "Kanban por vendedor" abre o Pipeline da loja
        "/app/inbox",
        "/app/settings/profile",
        "/app/settings/security",
      ].sort(),
    );
    // Toda entrada da lista existe no catálogo (sem porta fantasma).
    const catalogo = NAV_CATALOG.map((d) => d.href as string);
    for (const h of DESTINOS_DA_FUNCAO.gerente) expect(catalogo).toContain(h);
  });

  it("nenhum gerente (gerente ou apoio) vê configuração técnica", () => {
    const tecnicas = [
      "/app/ai/agents",
      "/app/ai/followups",
      "/app/ai/atendimento",
      "/app/ai/routers",
      "/app/ai/credentials",
      "/app/ai/providers",
      "/app/ai/knowledge/sources",
      "/app/ai/memory",
      "/app/ai/skills",
      "/app/ai/proposals",
      "/app/ai/runs",
      "/app/ai/usage",
      "/app/ai/evolution",
      "/app/settings/automacoes",
      "/app/webhooks",
      "/app/settings/recursos",
      "/app/extensions",
      "/app/integracao-dados",
      "/app/imports",
      "/app/audit",
      "/app/settings/tenant/pipelines",
    ];
    for (const f of ["gerente", "apoio"] as const) {
      const menu = hrefs({ preset: "completa", funcao: f }, "manager");
      for (const h of tecnicas) expect(menu).not.toContain(h);
    }
  });

  it("admin sem função continua vendo tudo", () => {
    const admin = hrefs({ preset: "completa" }, "admin");
    expect(admin).toContain("/app/ai/agents");
    expect(admin).toContain("/app/settings/automacoes");
    expect(admin).toContain("/app/webhooks");
  });

  it("sem função, nada muda", () => {
    expect(hrefs({ preset: "completa" })).toEqual(hrefs(null));
  });
});

describe("funções novas da v1.7.1", () => {
  it("v1.7.5: o Gerente de apoio virou apelido do gerente — o mesmo menu", () => {
    expect(hrefs({ preset: "completa", funcao: "apoio" }, "manager")).toEqual(
      hrefs({ preset: "completa", funcao: "gerente" }, "manager"),
    );
  });

  it("v1.9.6: o Suporte IA tem o Atendimento da IA e não tem Meus leads nem o Espaço da IA", () => {
    const suporte = hrefs({ preset: "completa", funcao: "suporte" });
    expect(suporte.filter((h) => h !== "/app/inbox")).toEqual(
      hrefs({ preset: "completa", funcao: "sdr" }).filter(
        (h) => h !== "/app/pipeline" && h !== "/app/space-do-guardiao",
      ),
    );
    expect(suporte).not.toContain("/app/pipeline");
    expect(suporte).toContain("/app/inbox");
    expect(suporte).not.toContain("/app/espaco-ia");
  });

  it("o schema aceita as duas, e os rótulos são os combinados", () => {
    for (const f of ["apoio", "suporte"]) {
      expect(interfaceSettingsSchema.safeParse({ preset: "completa", funcao: f }).success).toBe(
        true,
      );
    }
    expect(ROTULO_DA_FUNCAO.apoio).toBe("Gerente de apoio");
    expect(ROTULO_DA_FUNCAO.suporte).toBe("Suporte IA");
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
    expect(screen.getByTestId("selo-ver-como").textContent).toContain("Vendo como: Guardião");
    fireEvent.click(screen.getByRole("button", { name: "Voltar para a minha visão" }));
    expect(auth.definirVerComo).toHaveBeenCalledWith(null);
  });
});
