/**
 * ia.vek v1.9.45 (CRM-280): na marcação do "Ir até o cliente", o CEP traz o endereço por extenso e a
 * prévia do km da loja. A prévia vem de /api/v1/iavek/km (dublê aqui); o km gravado é do servidor.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...a: unknown[]) => apiGet(...a) } }));

import { CepEKmDoCliente } from "@/components/iavek/CepEKmDoCliente";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

function Tela({ onEndereco }: { onEndereco: (e: string) => void }) {
  const [cep, setCep] = useState("");
  const [numero, setNumero] = useState("");
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CepEKmDoCliente cep={cep} numero={numero} onCep={setCep} onNumero={setNumero} onEnderecoDoCep={onEndereco} />
    </QueryClientProvider>
  );
}

describe("v1.9.45 (CRM-280): CEP e km na tela", () => {
  it("⭐ CEP completo → endereço por extenso e '≈ 12,3 km da loja', com a atribuição", async () => {
    apiGet.mockResolvedValue({ data: { endereco: "Rua do Cliente, 45, Centro, Sorocaba - SP", km: 12.3, motivo: "ok", atribuicao: "© openrouteservice.org by HeiGIT | dados © OpenStreetMap" } });
    const onEndereco = vi.fn();
    render(<Tela onEndereco={onEndereco} />);
    fireEvent.change(screen.getByLabelText("Nº"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("CEP do cliente"), { target: { value: "18050-123" } });
    await waitFor(() => expect(screen.getByTestId("km-do-cliente").textContent).toContain("≈ 12,3 km da loja"));
    expect(screen.getByTestId("km-do-cliente").textContent).toContain("OpenStreetMap");
    expect(onEndereco).toHaveBeenCalledWith("Rua do Cliente, 45, Centro, Sorocaba - SP");
    expect(String(apiGet.mock.calls.at(-1)![0])).toBe("/api/v1/iavek/km?cep=18050123&numero=45");
  });

  it("sem a chave (km nulo): avisa 'Km indisponível' e o endereço sai mesmo assim", async () => {
    apiGet.mockResolvedValue({ data: { endereco: "Rua do Cliente, Centro, Sorocaba - SP", km: null, motivo: "indisponivel", atribuicao: null } });
    const onEndereco = vi.fn();
    render(<Tela onEndereco={onEndereco} />);
    fireEvent.change(screen.getByLabelText("CEP do cliente"), { target: { value: "18050123" } });
    await waitFor(() => expect(screen.getByTestId("km-do-cliente").textContent).toContain("Km indisponível"));
    expect(onEndereco).toHaveBeenCalled();
  });

  it("CEP incompleto não chama a prévia", () => {
    render(<Tela onEndereco={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("CEP do cliente"), { target: { value: "1805" } });
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("km-do-cliente")).toBeNull();
  });
});
