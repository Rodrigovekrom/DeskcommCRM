import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { criarTempos } from "@/lib/api/tempos-da-rota";
import { caminhoSemDados, medidaParaRegistro, medidaSchema } from "@/lib/iavek/medidas-de-tela";

const ID = "6c17c873-1701-4f01-a3cd-4f09efc3c1da";

describe("v1.9.16: a medição por tela não leva dado de cliente", () => {
  it("o caminho perde busca, id e número", () => {
    expect(caminhoSemDados(`/api/v1/contacts/${ID}/crm-summary?phone=+5515999998888`)).toBe("/api/v1/contacts/<id>/crm-summary");
    expect(caminhoSemDados("https://crm.exemplo/app/inbox?id=1#x")).toBe("/app/inbox");
    expect(caminhoSemDados("/api/v1/contatos/5515999998888")).toBe("/api/v1/contatos/<n>");
    expect(caminhoSemDados("/app/fulano@exemplo.com")).not.toContain("@");
  });

  it("o servidor limpa de novo o que recebe, mesmo de um navegador adulterado", () => {
    const m = medidaSchema.parse({
      tipo: "preso",
      tela: `/app/inbox/${ID}?nome=Fulano`,
      ms: 10000,
      em_voo: [{ c: `/api/v1/conversations/${ID}?search=Fulano`, ms: 9000 }],
    });
    const r = medidaParaRegistro(m);
    expect(JSON.stringify(r)).not.toContain("Fulano");
    expect(JSON.stringify(r)).not.toContain(ID);
    expect(r.tela).toBe("/app/inbox/<id>");
  });

  it("recusa campo que não é da medida", () => {
    expect(medidaSchema.safeParse({ tipo: "abrir", tela: "/app", ms: 1, texto: "Fulano" }).success).toBe(false);
    expect(medidaSchema.safeParse({ tipo: "outro", tela: "/app", ms: 1 }).success).toBe(false);
  });

  it("os tempos da rota só têm nome e milissegundos", () => {
    let t = 0;
    const tempos = criarTempos(() => t);
    t = 12;
    tempos.marcar("sessao");
    t = 40;
    tempos.marcar("consultas");
    expect(tempos.cabecalho()).toBe("sessao;dur=12, consultas;dur=28");
  });
});

describe("v1.9.16: abrir uma tela não dobra pedidos", () => {
  const ler = (f: string) => readFileSync(f, "utf8");

  it("o menu não pré-carrega o que só está visível", () => {
    for (const f of ["components/shell/Sidebar.tsx", "components/shell/NavHub.tsx"]) {
      expect(ler(f)).toContain("LinkDoMenu");
      expect(ler(f)).not.toContain('from "next/link"');
    }
    expect(ler("components/shell/LinkDoMenu.tsx")).toContain("prefetch={ativo ? null : false}");
  });

  it("a Fila já nasce com o automático lido no servidor", () => {
    expect(ler("app/app/inbox/page.tsx")).toContain("orgTemAutomatico(db, activeOrg.orgId)");
    expect(ler("components/inbox/InboxLayout.tsx")).toContain("useAutomaticoAtivo(automaticoInicial)");
    // Quem não pode consultar continua sem o dado.
    expect(ler("hooks/ai/useAutomaticoAtivo.ts")).toContain("podeConsultar && inicial !== undefined");
  });

  it("a montagem não cancela o token que os canais pediram", () => {
    const s = ler("hooks/auth/AuthProvider.tsx");
    expect(s).toContain("useEffect(() => resetRealtimeAuthentication, [");
    expect(s).not.toContain("    resetRealtimeAuthentication();\n    return resetRealtimeAuthentication;");
  });

  it("a primeira carga do quadro não recarrega selo, painel e faixa", () => {
    const s = ler("app/app/pipeline/_client.tsx");
    expect(s.match(/cargaAnterior/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
