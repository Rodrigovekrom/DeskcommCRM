import * as fs from "node:fs";
import * as path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { expect, test } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

/**
 * A ONDA 1 DA ADR-0005, PELA TELA: o que um módulo de dados guarda sobre uma pessoa aparece na
 * ficha dela, com os nomes que o AUTOR do módulo escolheu.
 *
 * Por que esta spec existe, e o que ela cobre que nenhum invariante cobre: o compilador, a rota e o
 * componente têm prova própria (banco real, contrato HTTP e render). Nenhuma delas responde a
 * pergunta do critério de aceite — "um leigo abre a ficha do paciente e VÊ o odontograma?". É o que
 * se mede aqui, dirigindo o browser.
 *
 * ─── O que esta spec NÃO cobre, de propósito ──────────────────────────────────────────────────
 *
 * A ADMISSÃO do pacote pelo catálogo (download com guarda de SSRF, parser estrito, recibo, 2FA do
 * administrador da instalação) é o caminho de `extensoes-declarativas.spec.ts`, que já o exercita de
 * ponta a ponta com um catálogo HTTP de ensaio. Repetir aquilo aqui mediria duas vezes a mesma coisa
 * e deixaria esta spec três vezes mais lenta. Aqui o módulo é SEMEADO no banco pelo mesmo caminho
 * que as fixtures das outras specs usam — artefato + instalação —, e o que se prova é a TELA.
 *
 * ─── Os dois casos, e por que o segundo é o que importa ───────────────────────────────────────
 *
 * 1. A ficha mostra o painel com o rótulo do autor e os valores, com dinheiro formatado.
 * 2. Com o módulo REMOVIDO, o painel desaparece e a ficha segue inteira. É o não-negociável 1 da
 *    doutrina de extensões medido no lugar onde ele seria furado primeiro: uma tela do núcleo que
 *    depende de um módulo de terceiro para funcionar.
 */

const ESPERA = 20_000;
const PUBLICADOR = "clinicae2e";
const MODULO = "odontograma";
const OBJETO = "marcacao";
const TABELA = `m_${PUBLICADOR}_${MODULO}_${OBJETO}`;
const ROTULO = "Odontograma";

function lerCreds(): { org_id: string; password: string; users: Record<string, { email: string }> } {
  const caminho = path.join(process.cwd(), ".e2e-creds.json");
  return JSON.parse(fs.readFileSync(caminho, "utf8"));
}

function banco(): SupabaseClient {
  const { url, serviceRole } = credenciaisSupabaseDeTeste();
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function manifesto() {
  return {
    format_version: 1,
    profile: "data",
    publisher: PUBLICADOR,
    name: MODULO,
    version: "1.0.0",
    license: "MIT",
    host_api: { min: 2, max: 2 },
    permissions: ["dados.proprios"],
    dependencies: [],
    data: {
      mode: "declarado",
      objetos: [
        {
          slug: OBJETO,
          rotulo: { "pt-BR": ROTULO },
          campos: [
            { slug: "dente", tipo: "inteiro", obrigatorio: true },
            { slug: "condicao", tipo: "texto", obrigatorio: true },
            { slug: "valor", tipo: "dinheiro" },
          ],
          refs: [{ slug: "paciente", entidade: "contato", obrigatorio: true, ao_apagar: "cascata" }],
        },
      ],
    },
    display: {
      title: { "pt-BR": ROTULO },
      summary: { "pt-BR": "Dente a dente" },
      category: "productivity",
      icon: "ListChecks",
    },
    configuration: {},
    contributions: {},
  };
}

/** Semeia o módulo como se a instalação já tivesse acontecido, e COMPILA pelo caminho real. */
async function instalarModuloDeDados(db: SupabaseClient, orgId: string) {
  const m = manifesto();
  const doc = JSON.stringify(m);
  const sha = await import("node:crypto").then((c) =>
    c.createHash("sha256").update(doc).digest("hex"),
  );

  const { data: catalogo } = await db
    .from("extension_catalogs")
    .upsert(
      { origin: `http://127.0.0.1:56999/${PUBLICADOR}`, revision: 1, digest: sha, snapshot: {} },
      { onConflict: "origin" },
    )
    .select("id")
    .single();

  const { data: artefato, error: erroArtefato } = await db
    .from("extension_artifacts")
    .upsert(
      { sha256: sha, byte_length: Buffer.byteLength(doc), manifest: m, document: doc },
      { onConflict: "sha256" },
    )
    .select("id")
    .single();
  if (erroArtefato) throw new Error(`artefato: ${erroArtefato.message}`);

  await db.from("extension_installations").upsert(
    {
      catalog_id: catalogo!.id,
      artifact_id: artefato!.id,
      publisher: PUBLICADOR,
      name: MODULO,
      version: "1.0.0",
      removed_at: null,
    },
    { onConflict: "catalog_id,publisher,name" },
  );

  // O compilador de verdade — a mesma função que a conclusão da instalação chama.
  const { error: erroCompilar } = await db.rpc("fn_modulo_dados_compilar", {
    p_artifact_id: artefato!.id,
  });
  if (erroCompilar) throw new Error(`compilar: ${erroCompilar.message}`);

  const { data: contato, error: erroContato } = await db
    .from("contacts")
    .insert({ organization_id: orgId, name: "Paciente do Odontograma E2E" })
    .select("id")
    .single();
  if (erroContato) throw new Error(`contato: ${erroContato.message}`);

  const { error: erroFicha } = await db.from(TABELA).insert({
    organization_id: orgId,
    paciente_id: contato!.id,
    dente: 11,
    condicao: "restaurado",
    valor_cents: 12500,
    valor_moeda: "BRL",
  });
  if (erroFicha) throw new Error(`ficha: ${erroFicha.message}`);

  return { contatoId: contato!.id as string, artefatoId: artefato!.id as string };
}

async function entrar(page: import("@playwright/test").Page) {
  const creds = lerCreds();
  const usuario = creds.users.manager ?? creds.users.admin;
  if (!usuario) throw new Error(".e2e-creds.json sem usuário");
  await page.goto("/login");
  await page.locator("#email").fill(usuario.email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: ESPERA });
  return creds;
}

test("a ficha do contato mostra o que o módulo de dados guarda, com o rótulo do autor", async ({
  page,
}) => {
  const creds = lerCreds();
  if (!creds.org_id) throw new Error(".e2e-creds.json sem org_id");
  const db = banco();
  const { contatoId } = await instalarModuloDeDados(db, creds.org_id);

  await entrar(page);
  await page.goto(`/app/contacts/${contatoId}`);

  // O rótulo é o que o AUTOR declarou — não o slug do objeto, não o nome da tabela.
  await expect(page.getByText(ROTULO, { exact: true })).toBeVisible({ timeout: ESPERA });
  await expect(page.getByText("restaurado")).toBeVisible({ timeout: ESPERA });

  // Dinheiro formatado. O banco guarda 12500 centavos; a tela que mostrasse "12500" estaria
  // mostrando o banco por dentro.
  await expect(page.getByText(/125,00/)).toBeVisible({ timeout: ESPERA });
  await expect(page.getByText("12500", { exact: true })).toHaveCount(0);
});

test("módulo removido: o painel sai e a ficha do contato segue inteira", async ({ page }) => {
  const creds = lerCreds();
  const db = banco();
  const { contatoId } = await instalarModuloDeDados(db, creds.org_id);

  // Remover é LÓGICO e preserva dados (não-negociável 7): as tabelas ficam, as telas saem.
  const { error } = await db
    .from("extension_installations")
    .update({ removed_at: new Date().toISOString() })
    .eq("publisher", PUBLICADOR)
    .eq("name", MODULO);
  if (error) throw new Error(`remover: ${error.message}`);

  await entrar(page);
  await page.goto(`/app/contacts/${contatoId}`);

  // A ficha carregou — é esta asserção que dá sentido à de baixo. Sem ela, "não vejo o painel"
  // também passaria numa página que não carregou nada.
  await expect(page.getByText("Paciente do Odontograma E2E").first()).toBeVisible({
    timeout: ESPERA,
  });
  await expect(page.getByText(ROTULO, { exact: true })).toHaveCount(0);

  // E o dado NÃO foi apagado: remover é lógico.
  const { count } = await db
    .from(TABELA)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", creds.org_id);
  expect(count ?? 0).toBeGreaterThan(0);
});
