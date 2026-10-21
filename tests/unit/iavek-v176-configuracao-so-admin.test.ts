/**
 * ia.vek v1.7.6 — CERCA: configuração é só do admin.
 *
 * Decisão do dono do produto (21/10/2026): quem dita a estratégia é o admin;
 * gerente, SDR, suporte e vendedor operam. Cada (rota, método) abaixo grava
 * configuração ou é operação de estratégia, e o handler TEM de exigir admin
 * (`requireRole("admin"`, `role: "admin"` no resolveAuthDual, ou o contexto
 * local com "admin"). Rebaixar qualquer um volta a abrir a porta que a v1.7.6
 * fechou — e a RLS (migration 0581) é a segunda camada, não a única.
 *
 * Leitura estática do arquivo, de propósito: a régua é o que está ESCRITO no
 * handler daquele método, não um mock que pode concordar com qualquer coisa.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SO_ADMIN = [
  "agenda/configuracao PATCH",
  "agenda/enderecos POST",
  "agenda/excecoes POST",
  "agenda/excecoes DELETE",
  "agenda/google/calendarios/atualizar POST",
  "agenda/google/calendarios PATCH",
  "agenda/google/desconectar DELETE",
  "agenda/tipos/reativar POST",
  "agenda/tipos POST",
  "agenda/tipos PATCH",
  "agenda/tipos DELETE",
  "ai/followup-flows/[id]/disable POST",
  "ai/followup-flows/[id]/duplicate POST",
  "ai/followup-flows/[id]/publish POST",
  "ai/followup-flows/[id]/rollback POST",
  "ai/followup-flows/[id] PATCH",
  "ai/followup-flows/[id] DELETE",
  "ai/followup-flows/from-model POST",
  "ai/followup-flows POST",
  "ai/followups/enrollments/[id]/cancel POST",
  "ai/followups/enrollments/[id]/pause POST",
  "ai/followups/enrollments/[id]/resume POST",
  "ai/followups/enrollments/[id]/skip POST",
  "ai/followups/enrollments/[id]/snooze POST",
  "ai/followups/enrollments POST",
  "ai/followups/promises/[id]/cancel POST",
  "ai/knowledge/reindex-all POST",
  "ai/knowledge/sources/[id]/reindex POST",
  "ai/knowledge/sources POST",
  "ai/knowledge/sources/upload POST",
  "ai/memory/entries/[id] PATCH",
  "ai/memory/entries POST",
  "ai/pacing PUT",
  "ai/routers/[id]/test POST",
  "ai/skills/[name]/install POST",
  "ai/skills/[name]/restore POST",
  "ai/skills/[name] PUT",
  "ai/skills/[name] DELETE",
  "ai/skills/import POST",
  "automation-rules/[id] PATCH",
  "automation-rules/[id] DELETE",
  "automation-rules POST",
  "automation-rules/runs/[runId]/resend POST",
  "campaign-suppressions/[id] DELETE",
  "campaign-suppressions POST",
  "campaign-templates/[id] PATCH",
  "campaign-templates/[id] DELETE",
  "campaign-templates POST",
  "campaigns/[id]/[acao] POST",
  "campaigns/[id] PATCH",
  "campaigns/preview POST",
  "campaigns POST",
  "channel-sessions/[id]/groups PUT",
  "channels/partner/templates/media POST",
  "companies/[id]/enrich POST",
  "companies/[id] DELETE",
  "companies POST",
  "company-people POST",
  "contacts/[id]/personal POST",
  "contacts/[id]/personal DELETE",
  "contacts/import POST",
  "contacts/merge POST",
  "financeiro/catalogo/[tipo] POST",
  "financeiro/catalogo/[tipo] PATCH",
  "financeiro/catalogo/[tipo] DELETE",
  "financeiro/comandas/[id]/estornar POST",
  "honorarios/contratos/[id]/parcelas POST",
  "honorarios/contratos POST",
  "honorarios/parcelas/[id]/pagar POST",
  "iavek/meu-dia PATCH",
  "imports POST",
  "leads/bulk POST",
  "leads/import POST",
  "metrics/atrito PATCH",
  "people POST",
  "phone-numbers/[id] PATCH",
  "phone-numbers POST",
  "pipelines/[id]/agent-mapping PUT",
  "pipelines/[id] PATCH",
  "pipelines/[id] DELETE",
  "pipelines/[id]/stages/[stageId] PATCH",
  "pipelines/[id]/stages/[stageId] DELETE",
  "pipelines/[id]/stages POST",
  "pipelines POST",
  "products/[id]/fotos POST",
  "products/[id]/fotos PUT",
  "products/[id] PATCH",
  "products/[id] DELETE",
  "products/import POST",
  "products POST",
  "settings/assinatura PATCH",
  "settings/campanhas PATCH",
  "settings/proposal-templates/[slug] PATCH",
  "settings/proposal-templates/[slug] DELETE",
  "settings/proposal-templates/importar POST",
  "settings/proposal-templates POST",
  "settings/proposals PATCH",
  "settings/routing/channels PATCH",
  "settings/routing PATCH",
  "settings/sons POST",
  "settings/sons DELETE",
  "tags/vocabulario POST",
  "webhook-sources/[id] PATCH",
  "webhook-sources/[id] DELETE",
  "webhook-sources POST",
  "messages/[id]/hide POST",
  "messages/[id]/hide DELETE",
  "agenda/google/connect GET",
  "ai/knowledge/sources/[id] PATCH",
  "ai/knowledge/sources/[id] DELETE",
];

function corpoDoMetodo(fonte: string, metodo: string): string | null {
  const partes = fonte.split(
    /(export (?:async )?(?:function|const) (?:GET|POST|PATCH|PUT|DELETE)\b)/,
  );
  for (let i = 1; i < partes.length; i += 2) {
    if (partes[i]!.endsWith(metodo)) return partes[i + 1]!;
  }
  return null;
}

describe("ia.vek v1.7.6: configuração só do admin (rota a rota)", () => {
  it.each(SO_ADMIN)("%s exige admin", (entrada) => {
    const [rota, metodo] = [
      entrada.slice(0, entrada.lastIndexOf(" ")),
      entrada.slice(entrada.lastIndexOf(" ") + 1),
    ];
    const fonte = readFileSync(join(process.cwd(), "app/api/v1", rota, "route.ts"), "utf8");
    const corpo = corpoDoMetodo(fonte, metodo);
    expect(corpo, `${rota} não exporta ${metodo}`).not.toBeNull();
    // Quando o portão mora num ajudante do próprio arquivo (o handler não chama
    // requireRole), a régua é o arquivo inteiro.
    const temRegua = /requireRole\(|\brole:\s*"|resolveContext\(/.test(corpo!);
    const alvo = temRegua ? corpo! : fonte;
    // Nenhuma régua abaixo de admin...
    expect(alvo).not.toMatch(/requireRole\(\s*"(viewer|agent|manager)"/);
    expect(alvo).not.toMatch(/\brole:\s*"(viewer|agent|manager)"/);
    // ...e alguma régua de admin (direta ou pelo contexto local).
    expect(alvo).toMatch(
      /requireRole\(\s*"admin"|\brole:\s*"admin"|resolveContext\(requestId, "admin"\)/,
    );
  });
});
