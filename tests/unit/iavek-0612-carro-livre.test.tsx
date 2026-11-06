/**
 * ia.vek 0612 (Rodrigo, 06/11): o carro deixa de travar (mover etapa com campo obrigatório, passar
 * para negociar, Marcar agendamento do guardião) e vira texto livre com sugestão do estoque. Os
 * OUTROS obrigatórios ficam iguais.
 */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { CampoDoCatalogo } from "@/components/contacts/CampoDoCatalogo";
import { CAMPOS_OBRIGATORIOS } from "@/lib/iavek/campos-obrigatorios";
import { camposQueFaltam } from "@/lib/iavek/passagem";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(async () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", codigo: "A1", nome: "Chevrolet Onix 2022", marca: "Chevrolet", preco_cents: 7990000, moeda: "BRL", ativo: true }] })) },
}));

const ler = (p: string) => readFileSync(p, "utf8");
const comCliente = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("o carro deixa de travar nos 3 lugares; os outros obrigatórios ficam", () => {
  it("passagem e 'Marcar agendamento': sem carro, não falta o carro, e o resto continua cobrado", () => {
    const faltam = camposQueFaltam({});
    expect(faltam).not.toContain("Carro de interesse");
    expect(faltam).toEqual(["Cidade / região", "Forma de pagamento", "Entrada (R$; 0 = sem entrada)", "Tem carro na troca?", "Prazo para comprar"]);
  });
  it("mover etapa: a lista da trava e a função do banco (0612, última definição) não têm o carro", () => {
    expect(CAMPOS_OBRIGATORIOS).not.toContain("Carro de interesse" as never);
    const b = ler("supabase/baseline.sql");
    const i = b.lastIndexOf("create or replace function public.fn_iavek_campos_que_faltam_do_lead(");
    const corpo = b.slice(i, b.indexOf("$$;", i));
    expect(corpo).not.toContain("'Carro de interesse'");
    for (const r of ["'Contexto do atendimento'", "'Cidade / região'", "'Forma de pagamento'", "'Tem carro na troca?'", "'Troca: modelo e ano'", "'Prazo para comprar'"]) expect(corpo).toContain(r);
  });
});

describe("o campo: texto livre com sugestão do estoque", () => {
  it("texto livre grava SÓ o texto (Enter) e aparece como foi escrito, sem 'Carro fora do catálogo'", async () => {
    const onChange = vi.fn();
    const { rerender } = comCliente(<CampoDoCatalogo id="c" valor={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("carro-texto"), { target: { value: "Gol 2015 prata" } });
    fireEvent.keyDown(screen.getByTestId("carro-texto"), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Gol 2015 prata");
    rerender(<QueryClientProvider client={new QueryClient()}><CampoDoCatalogo id="c" valor="Gol 2015 prata" onChange={onChange} /></QueryClientProvider>);
    expect(screen.getByTestId("carro-escolhido").textContent).toContain("Gol 2015 prata");
    expect(screen.queryByText("Carro fora do catálogo")).toBeNull();
  });
  it("escolher a sugestão grava o id do produto (selo, preço e aviso seguem valendo)", async () => {
    const onChange = vi.fn();
    comCliente(<CampoDoCatalogo id="c" valor={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("carro-texto"), { target: { value: "onix" } });
    fireEvent.click(await screen.findByTestId("sugestao-do-estoque"));
    expect(onChange).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });
});
