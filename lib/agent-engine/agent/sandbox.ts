import type pg from "pg";
import { loadAgentVersionConfig } from "./agent-config";
import { runAgentPreview, type InboundTurnDeps } from "./inbound-turn";
import { newPreviewResult, scenarioContext } from "./preview";
export async function testAgentVersion(
  pool: pg.Pool,
  deps: InboundTurnDeps,
  input: {
    organizationId: string;
    agentId: string;
    versionId: string;
    runId: string;
    sampleMessage: string;
    sampleContact?: { name?: string; phone?: string };
    channelId: string | null;
    simulacaoDePreco?: { perguntasAnteriores: number; produtoCodigo: string | null };
    /** Falas antes da mensagem de teste (ia.vek): o cenário do meio da conversa. */
    historico?: Array<{ autor: "cliente" | "ia"; texto: string }>;
  },
) {
  const agent = await loadAgentVersionConfig(
    pool,
    input.organizationId,
    input.agentId,
    input.versionId,
  );
  if (!agent) throw new Error("preview_version_unavailable");
  const result = newPreviewResult();
  const agora = (deps.clock?.() ?? new Date()).getTime();
  const historico = input.historico ?? [];
  const context = scenarioContext(
    [
      // As falas do histórico ganham horários anteriores, um minuto entre cada,
      // para a ordem da conversa ser a ordem em que foram escritas.
      ...historico.map((f, i) => ({
        direction: f.autor === "cliente" ? ("inbound" as const) : ("outbound" as const),
        body: f.texto,
        sent_at: new Date(agora - (historico.length - i) * 60_000).toISOString(),
      })),
      {
        direction: "inbound",
        body: input.sampleMessage,
        sent_at: new Date(agora).toISOString(),
      },
    ],
    input.sampleContact,
  );
  await runAgentPreview(deps, pool, {
    kind: "sandbox",
    organizationId: input.organizationId,
    runId: input.runId,
    agent,
    context,
    contactId: null,
    channelId: input.channelId,
    ...(input.simulacaoDePreco || historico.length > 0
      ? {
          simulacaoDePreco: {
            perguntasAnteriores: input.simulacaoDePreco?.perguntasAnteriores ?? 0,
            produtoCodigo: input.simulacaoDePreco?.produtoCodigo ?? null,
            historicoDoCliente: historico.filter((f) => f.autor === "cliente").map((f) => f.texto),
          },
        }
      : {}),
    result,
  });
  return result;
}
