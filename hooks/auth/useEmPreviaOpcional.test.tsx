/**
 * ia.vek CRM-532 (Lupa 213638): a prévia "ver como" é detectada pela PRESENÇA do alvo, e não pela diferença de função.
 * O caso que a diferença de função deixava passar: o admin cuja função real é "vendedor" vendo como "vendedor".
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/browser", () => ({
  resetRealtimeAuthentication: vi.fn(),
  createClient: () => ({ auth: { refreshSession: vi.fn() } }),
}));

import { AuthProvider, useEmPreviaOpcional } from "@/hooks/auth/AuthProvider";
import type { AuthUser } from "@/lib/auth/types";

const admin: AuthUser = {
  id: "u-admin", email: "admin@example.test", full_name: null, avatar_url: null,
  organizations: [{ organization_id: "org", organization_name: "Organização", role: "admin" }],
  idioma: "pt-BR", is_platform_admin: false,
};
const CHAVE = "iavek:ver-como:u-admin:org";

function Sonda() {
  return <span data-testid="previa">{String(useEmPreviaOpcional())}</span>;
}
const comFuncaoReal = (funcao: string | null) => (
  <AuthProvider
    user={admin}
    activeOrg={{ orgId: "org", name: "Organização", role: "admin", interface_settings: { preset: "completa", ...(funcao ? { funcao } : {}) } } as never}
  >
    <Sonda />
  </AuthProvider>
);

afterEach(() => window.localStorage.clear());

describe("useEmPreviaOpcional", () => {
  it("fora do provedor: false (nunca lança)", () => {
    render(<Sonda />);
    expect(screen.getByTestId("previa").textContent).toBe("false");
  });

  it("sem prévia: false", async () => {
    render(comFuncaoReal(null));
    await waitFor(() => expect(screen.getByTestId("previa").textContent).toBe("false"));
  });

  it("a prévia com a MESMA função da real (vendedor vendo como vendedor): true (sem botão)", async () => {
    window.localStorage.setItem(CHAVE, "vendedor");
    render(comFuncaoReal("vendedor"));
    await waitFor(() => expect(screen.getByTestId("previa").textContent).toBe("true"));
  });

  it("a prévia de uma função diferente: true", async () => {
    window.localStorage.setItem(CHAVE, "sdr");
    render(comFuncaoReal(null));
    await waitFor(() => expect(screen.getByTestId("previa").textContent).toBe("true"));
  });
});
