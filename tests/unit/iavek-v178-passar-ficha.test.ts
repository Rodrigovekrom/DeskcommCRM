import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CAMPOS_PADRAO_DA_FICHA, conferirDados, cpfValido, podeVerDados, type QuemNaFicha } from "@/lib/iavek/fichas";

/** ia.vek v1.7.8 — Passar Ficha. */
describe("conferência dos dados", () => {
  it("CPF com dígito verificador", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("529.982.247-26")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });

  it("os campos iniciais pedidos pelo dono estão lá", () => {
    const chaves = CAMPOS_PADRAO_DA_FICHA.map((c) => c.key);
    for (const k of ["nome_completo", "cpf", "rg", "data_nascimento", "renda_mensal", "profissao", "endereco", "veiculo_interesse", "valor_veiculo", "entrada"]) {
      expect(chaves).toContain(k);
    }
  });

  it("problema nomeia o CAMPO e nunca devolve o valor", () => {
    const { problemas } = conferirDados(CAMPOS_PADRAO_DA_FICHA, { cpf: "123.456.789-00", nome_completo: "Fulano" });
    expect(problemas.some((p) => p.startsWith("CPF:"))).toBe(true);
    expect(problemas.join(" ")).not.toContain("123.456.789-00");
    expect(problemas.some((p) => p.startsWith("Renda mensal:"))).toBe(true);
  });

  it("só as chaves da lista entram nos dados", () => {
    const { dados } = conferirDados(CAMPOS_PADRAO_DA_FICHA, { cpf: "52998224725", invasor: "x" });
    expect(Object.keys(dados)).toEqual(["cpf"]);
  });
});

describe("quem vê os dados", () => {
  const base: QuemNaFicha = { userId: "u", orgId: "o", role: "agent", analista: false, admin: false, gerente: false, idioma: "pt-BR", suporteSoLeitura: false };
  it("vendedor dono e quem enviou veem; outro vendedor e o gerente não", () => {
    expect(podeVerDados(base, { enviada_por: "u" }, "x")).toBe(true);
    expect(podeVerDados(base, { enviada_por: "x" }, "u")).toBe(true);
    expect(podeVerDados(base, { enviada_por: "x" }, "y")).toBe(false);
    expect(podeVerDados({ ...base, role: "manager", gerente: true }, { enviada_por: "x" }, "y")).toBe(false);
  });
  it("analista e admin veem", () => {
    expect(podeVerDados({ ...base, role: null, analista: true }, { enviada_por: "x" }, "y")).toBe(true);
    expect(podeVerDados({ ...base, role: "admin", admin: true }, { enviada_por: "x" }, "y")).toBe(true);
  });
});

describe("LGPD: os dados da ficha nunca vão para log, auditoria nem IA", () => {
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const c = join(dir, n);
      return statSync(c).isDirectory() ? arquivos(c) : /\.ts$/.test(n) ? [c] : [];
    });
  const rotas = arquivos(join(process.cwd(), "app/api/v1/iavek/fichas"));

  it("nenhuma rota da ficha põe `dados` em audit/logger/console", () => {
    for (const f of rotas) {
      const src = readFileSync(f, "utf8");
      for (const bloco of src.match(/(audit|logger\.\w+|console\.\w+)\(\{?[\s\S]*?\}\)?;/g) ?? []) {
        expect(bloco, f).not.toMatch(/\bdados\b|\bcpf\b|\brenda/);
      }
    }
  });

  it("nada de IA ou de proposta lê as tabelas da ficha", () => {
    const fora = [...arquivos(join(process.cwd(), "lib/mcp")), ...arquivos(join(process.cwd(), "lib/propostas")), ...arquivos(join(process.cwd(), "lib/agent-engine"))];
    for (const f of fora) expect(readFileSync(f, "utf8"), f).not.toMatch(/iavek_fichas|iavek_ficha_documentos/);
  });
});

describe("a função do vínculo (e com ela o isolamento do analista) só muda por caminho de admin", () => {
  /**
   * `interface_settings.funcao = 'analista_ficha'` é o que fecha o CRM para o
   * analista (migration 0586). Quem grava `interface_settings` HOJE, e por que é
   * seguro: a rota de Equipe (requireRole admin), o aceite de convite (o
   * conteúdo vem do convite que o admin criou) e a criação de tenant (platform
   * admin). Uma rota nova de "preferência de visualização" que grave aqui
   * reabriria a porta — ela tem de guardar a preferência em OUTRA chave/tabela,
   * ou entrar nesta lista com a prova de que não toca `funcao`.
   */
  const PERMITIDOS = new Set([
    "app/api/v1/team/[user_id]/interface/route.ts",
    "lib/auth/aplicar-convite.ts",
    "app/api/v1/admin/tenants/route.ts",
    // Só o TIPO gerado do parâmetro p_interface_settings das RPCs — não escreve nada.
    "lib/database.types.ts",
  ]);
  const varrer = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const c = join(dir, n);
      return statSync(c).isDirectory() ? varrer(c) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [c] : [];
    });
  it("nenhum outro arquivo escreve interface_settings em user_organizations", () => {
    const raiz = process.cwd();
    const escritores = ["app", "lib", "workers"]
      .flatMap((d) => varrer(join(raiz, d)))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return /from\("user_organizations"\)[\s\S]{0,300}\.(update|upsert|insert)\([\s\S]{0,200}interface_settings/.test(src) ||
          /p_interface_settings/.test(src);
      })
      .map((f) => f.slice(raiz.length + 1));
    expect(escritores.filter((f) => !PERMITIDOS.has(f))).toEqual([]);
    // a rota de Equipe continua exigindo admin
    expect(readFileSync(join(raiz, "app/api/v1/team/[user_id]/interface/route.ts"), "utf8")).toMatch(/requireRole\("admin"/);
  });
});
