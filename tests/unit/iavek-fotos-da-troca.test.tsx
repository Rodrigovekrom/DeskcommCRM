/**
 * ia.vek v1.5 (parte C): as fotos do carro da troca — referências marcadas no
 * lead, upload como anexo de nota interna, e "foto expirada" quando a retenção
 * da organização apaga o arquivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const N1 = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  fotos: [] as unknown[],
  patch: vi.fn(async (_p: string, _b: unknown) => ({})),
  upload: vi.fn(async () => ({
    storage_path: "o/c/note-x.jpg",
    media_mime: "image/jpeg",
    media_size_bytes: 10,
  })),
  nota: vi.fn(async (_a: unknown) => ({ data: { id: "33333333-3333-4333-8333-333333333333" } })),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(async () => ({ data: { fotos: mocks.fotos } })), patch: mocks.patch },
}));
vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: mocks.upload }),
}));
vi.mock("@/hooks/inbox/useCreateNote", () => ({
  useCreateNote: () => ({ mutateAsync: mocks.nota }),
}));

import {
  MAX_FOTOS_DA_TROCA,
  alternarRef,
  fotoDaMensagem,
  fotoDaNota,
  refsMarcadas,
} from "@/lib/iavek/fotos-da-troca";
import { FotosDaTroca } from "@/components/inbox/FotosDaTroca";

function foto(ref: string, extra: Record<string, unknown> = {}) {
  const [tipo, id] = ref.split(":");
  return {
    ref,
    origem: tipo === "m" ? "mensagem" : "nota",
    id,
    conversation_id: "conv",
    created_at: "2026-10-17T10:00:00Z",
    de: "cliente",
    expirada: false,
    url: `/x/${id}`,
    ...extra,
  };
}

function montar(customFields: Record<string, unknown> | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const onSalvo = vi.fn();
  render(
    <FotosDaTroca
      contactId="contato"
      conversationId="conv"
      lead={{ id: "lead-1", custom_fields: customFields }}
      onSalvo={onSalvo}
    />,
    { wrapper },
  );
  return onSalvo;
}

beforeEach(() => {
  mocks.patch.mockClear();
  mocks.upload.mockClear();
  mocks.nota.mockClear();
  mocks.fotos = [];
});

describe("regras das fotos da troca", () => {
  it("mensagem recebida é do cliente; sem arquivo ou com media_status expired, expirou", () => {
    const base = { id: M1, conversation_id: "c", created_at: "x", media_url: null, metadata: {} };
    expect(
      fotoDaMensagem({ ...base, direction: "inbound", media_storage_path: "p" }),
    ).toMatchObject({
      ref: `m:${M1}`,
      de: "cliente",
      expirada: false,
      url: `/api/v1/messages/${M1}/media`,
    });
    expect(
      fotoDaMensagem({ ...base, direction: "inbound", media_storage_path: null }).expirada,
    ).toBe(true);
    expect(
      fotoDaMensagem({
        ...base,
        direction: "inbound",
        media_storage_path: "p",
        metadata: { media_status: "expired" },
      }).expirada,
    ).toBe(true);
    expect(
      fotoDaNota({ id: N1, conversation_id: "c", created_at: "x", media_storage_path: null }),
    ).toMatchObject({
      ref: `n:${N1}`,
      expirada: true,
      url: `/api/v1/conversations/c/notes/${N1}/media`,
    });
  });

  it("lê a lista do lead com tolerância e alterna sem repetir nem passar do teto", () => {
    expect(refsMarcadas({ troca_fotos: [`m:${M1}`, "lixo", 3, `n:${N1}`] })).toEqual([
      `m:${M1}`,
      `n:${N1}`,
    ]);
    expect(refsMarcadas({ troca_fotos: "x" })).toEqual([]);
    expect(alternarRef([`m:${M1}`], `m:${M1}`)).toEqual([]);
    expect(alternarRef([`m:${M1}`], `m:${M2}`)).toEqual([`m:${M1}`, `m:${M2}`]);
    const cheia = Array.from(
      { length: MAX_FOTOS_DA_TROCA },
      (_, i) => `m:${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    expect(alternarRef(cheia, `m:${M2}`)).toHaveLength(MAX_FOTOS_DA_TROCA);
  });
});

describe("galeria na ficha", () => {
  it("mostra a marcada e 'foto expirada' para a que venceu", async () => {
    mocks.fotos = [foto(`m:${M1}`), foto(`m:${M2}`, { expirada: true })];
    montar({ troca_fotos: [`m:${M1}`, `m:${M2}`] });
    expect(await screen.findByAltText("Foto do carro da troca")).toBeTruthy();
    expect(screen.getByTestId("foto-expirada")).toBeTruthy();
  });

  it("escolher da conversa marca a foto no lead", async () => {
    mocks.fotos = [foto(`m:${M1}`), foto(`m:${M2}`)];
    const onSalvo = montar(null);
    fireEvent.click(screen.getByText("Escolher da conversa"));
    const botoes = await screen.findAllByRole("button", { pressed: false });
    fireEvent.click(botoes[1]!);
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    expect(mocks.patch.mock.calls[0]).toEqual([
      "/api/v1/leads/lead-1",
      { custom_fields: { troca_fotos: [`m:${M2}`] } },
    ]);
    await waitFor(() => expect(onSalvo).toHaveBeenCalled());
  });

  it("subir foto vira nota interna 'Foto do carro da troca' e entra marcada", async () => {
    montar({ troca_fotos: [`m:${M1}`] });
    const input = screen.getByTestId("subir-foto-da-troca") as HTMLInputElement;
    const arquivo = new File(["x"], "carro.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [arquivo] } });
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv", destino: "nota" }),
    );
    expect(mocks.nota.mock.calls[0]![0]).toMatchObject({
      conversation_id: "conv",
      body: "Foto do carro da troca",
      anexo: { storage_path: "o/c/note-x.jpg" },
    });
    expect(mocks.patch.mock.calls[0]![1]).toEqual({
      custom_fields: { troca_fotos: [`m:${M1}`, `n:${N1}`] },
    });
  });
});
