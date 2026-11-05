import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (f: string) => readFileSync(f, "utf8");
const baseline = ler("supabase/baseline.sql");

describe("v1.9.19.1: contatos por função", () => {
  it("as regras de acesso usam o recorte, no baseline e só uma vez", () => {
    for (const nome of ["read", "write"]) {
      const m = baseline.match(new RegExp(`create policy "tenant_isolation_contacts_${nome}"[^\\n]*`, "g")) ?? [];
      expect(m).toHaveLength(1);
      expect(m[0]).toMatch(/fn_iavek_contatos_do_vendedor/);
    }
  });
  it("abrir conversa confere também quem chega pelo telefone", () => {
    const s = ler("app/api/v1/conversations/open-with-contact/route.ts");
    expect(s.indexOf("contatoExistenteDaAbertura(admin")).toBeLessThan(s.indexOf("openSharedContactConversation(admin"));
    expect(s).toMatch(/contatoNoAlcance\(authz\.supabase/);
  });
  it.each(["app/api/v1/contacts/[id]/avatar/route.ts"])(
    "%s confere o alcance antes de usar a chave de serviço",
    (f) => {
      const s = ler(f);
      expect(s.indexOf("contatoNoAlcance(")).toBeGreaterThan(-1);
      expect(s.indexOf("contatoNoAlcance(")).toBeLessThan(s.indexOf("createAdminClient()"));
    },
  );
  it("excluir, importar e duplicados saem da tela do vendedor", () => {
    expect(ler("app/app/contacts/_client.tsx")).toMatch(/!ehVendedor && \(\s*<>\s*<Button variant="outline" onClick=\{\(\) => setDuplicadosOpen/);
    expect(ler("components/contacts/ContactsTable.tsx")).toMatch(/!ehVendedor && \(\s*<Button/);
    expect(ler("app/api/v1/contacts/duplicates/route.ts")).toMatch(/funcaoNaOrganizacao/);
    expect(ler("app/api/v1/contacts/[id]/route.ts")).toMatch(/funcaoNaOrganizacao/);
  });
});
