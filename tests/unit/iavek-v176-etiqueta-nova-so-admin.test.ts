/**
 * ia.vek v1.7.6: criar etiqueta nova é só do admin. Quem opera aplica as que
 * existem; um nome novo digitado é recusado com 403 e a lista das novas.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { etiquetasNovas, recusaEtiquetaNova } from "@/lib/iavek/etiquetas";

function banco(role: string | null, vocabulario: string[], erro?: string) {
  const rpc = vi.fn(async (nome: string) => {
    if (erro) return { data: null, error: { message: erro } };
    if (nome === "fn_user_role_in_org") return { data: role, error: null };
    if (nome === "fn_vocabulario_de_tags")
      return { data: vocabulario.map((tag) => ({ tag })), error: null };
    return { data: null, error: { message: `rpc inesperada: ${nome}` } };
  });
  return { rpc } as unknown as SupabaseClient & { rpc: typeof rpc };
}

const base = { orgId: "org-1", requestId: "req-1" };

describe("etiquetasNovas", () => {
  it("ignora maiúsculas e espaços, e não repete", () => {
    expect(etiquetasNovas(["Troca ", "quente", "NOVA", "nova"], ["troca", "Quente"])).toEqual([
      "nova",
    ]);
    expect(etiquetasNovas([], ["x"])).toEqual([]);
    expect(etiquetasNovas(["  "], [])).toEqual([]);
  });
});

describe("recusaEtiquetaNova", () => {
  it("vendedor (agent) aplicando etiqueta que existe: passa", async () => {
    const r = await recusaEtiquetaNova({
      ...base,
      supabase: banco("agent", ["troca", "financiamento"]),
      tags: ["Troca"],
      role: "agent",
    });
    expect(r).toBeNull();
  });

  it("vendedor e gerente criando etiqueta nova: 403 com a lista", async () => {
    for (const role of ["agent", "manager"]) {
      const r = await recusaEtiquetaNova({
        ...base,
        supabase: banco(role, ["troca"]),
        tags: ["troca", "minha-tag"],
        role,
      });
      expect(r?.status).toBe(403);
      const corpo = (await r!.json()) as {
        error: { code: string; details: { etiquetas_novas: string[] } };
      };
      expect(corpo.error.code).toBe("tag_creation_admin_only");
      expect(corpo.error.details.etiquetas_novas).toEqual(["minha-tag"]);
    }
  });

  it("admin cria etiqueta nova sem consultar o vocabulário", async () => {
    const sb = banco("admin", []);
    const r = await recusaEtiquetaNova({ ...base, supabase: sb, tags: ["nova"], role: "admin" });
    expect(r).toBeNull();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("sem papel informado, lê do banco (fn_user_role_in_org)", async () => {
    const sb = banco("agent", []);
    const r = await recusaEtiquetaNova({ ...base, supabase: sb, tags: ["nova"] });
    expect(r?.status).toBe(403);
    expect(sb.rpc).toHaveBeenCalledWith("fn_user_role_in_org", { p_org: "org-1" });
  });

  it("sem etiquetas no pedido não consulta nada", async () => {
    const sb = banco("agent", []);
    expect(await recusaEtiquetaNova({ ...base, supabase: sb, tags: undefined })).toBeNull();
    expect(await recusaEtiquetaNova({ ...base, supabase: sb, tags: [] })).toBeNull();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("erro ao ler o vocabulário fecha (500), nunca deixa passar", async () => {
    const r = await recusaEtiquetaNova({
      ...base,
      supabase: banco("agent", [], "caiu"),
      tags: ["troca"],
      role: "agent",
    });
    expect(r?.status).toBe(500);
  });
});
