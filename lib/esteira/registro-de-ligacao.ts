/**
 * O REGISTRO DA LIGAÇÃO (ia.vek D3): os 3 campos aprovados pelo Rodrigo e o que
 * cada resposta faz no CRM.
 *
 *   1. Atendeu?            sim / não
 *   2. Resumo              uma frase
 *   3. Próximo passo       agendou (com data) / retornar (em data) / sem interesse (com motivo)
 *
 * Efeitos (decididos aqui, puros; quem executa é a rota):
 *   - sempre: a tarefa fecha e a linha "Ligação registrada" entra na timeline;
 *   - não atendeu: mais UMA tentativa no mesmo dia (2 h úteis, até o fim do
 *     expediente); a retentativa que também não atende não gera outra;
 *   - agendou: o negócio vai para a coluna de compromisso (entrada) ou
 *     "Reengajou" (follow-up), e as outras ligações pendentes são canceladas;
 *   - retornar: nasce a ligação de retorno na data combinada;
 *   - sem interesse: o negócio fecha como perdido com o motivo, e as ligações
 *     pendentes são canceladas.
 */
import { z } from "zod";

import { CANONICAL_LOST_REASONS } from "@/lib/schemas/leads";

import type { ConfigDaEsteira } from "./config";
import { dentroDoExpediente, fimDoExpediente, somarHorasUteis } from "./horas-uteis";
import { sourceKindDaLigacao } from "./rodada";

/** Os motivos que a pessoa escolhe (o do sistema, troca de funil, fica de fora). */
export const MOTIVOS_SEM_INTERESSE = CANONICAL_LOST_REASONS.filter(
  (m) => m !== "moved_to_another_pipeline",
) as Exclude<(typeof CANONICAL_LOST_REASONS)[number], "moved_to_another_pipeline">[];

const data = z.string().datetime({ offset: true });

export const registroDeLigacaoSchema = z
  .strictObject({
    atendeu: z.boolean(),
    resumo: z.string().trim().min(3).max(280),
    proximo: z
      .discriminatedUnion("tipo", [
        z.strictObject({ tipo: z.literal("agendou"), data }),
        z.strictObject({ tipo: z.literal("retornar"), data }),
        z.strictObject({
          tipo: z.literal("sem_interesse"),
          motivo: z.enum(MOTIVOS_SEM_INTERESSE as [string, ...string[]]),
          detalhe: z.string().trim().max(200).optional(),
        }),
      ])
      .optional(),
  })
  .refine((r) => !r.atendeu || r.proximo !== undefined, {
    message: "Quando o cliente atendeu, diga o próximo passo.",
    path: ["proximo"],
  });
export type RegistroDeLigacao = z.infer<typeof registroDeLigacaoSchema>;

export type Efeito =
  | { tipo: "nova_ligacao"; sourceKind: string; venceEm: Date; titulo: string }
  | { tipo: "mover"; etapaId: string }
  | { tipo: "perder"; motivo: string; detalhe: string | null }
  | { tipo: "cancelar_ligacoes_pendentes" };

export interface SituacaoDoNegocio {
  pipelineId: string;
  status: string;
}

export function efeitosDoRegistro(
  r: RegistroDeLigacao,
  tarefa: { source_kind: string },
  negocio: SituacaoDoNegocio | null,
  cfg: ConfigDaEsteira,
  agora: Date,
): Efeito[] {
  const efeitos: Efeito[] = [];
  if (!r.atendeu) {
    if (tarefa.source_kind !== sourceKindDaLigacao("retentativa")) {
      const duas = somarHorasUteis(agora, 2, cfg.horario);
      const fim = dentroDoExpediente(agora, cfg.horario) ? fimDoExpediente(agora, cfg.horario) : null;
      const venceEm = fim && duas > fim ? fim : duas;
      efeitos.push({
        tipo: "nova_ligacao",
        sourceKind: sourceKindDaLigacao("retentativa"),
        venceEm,
        titulo: "Ligar de novo (não atendeu) — {{contact.name}}",
      });
    }
    return efeitos;
  }
  const p = r.proximo!;
  const aberto = negocio?.status === "open";
  if (p.tipo === "agendou") {
    if (aberto && cfg.funis) {
      const { entrada, followup } = cfg.funis;
      if (negocio!.pipelineId === entrada.pipeline_id && entrada.etapas_de_compromisso[0]) {
        efeitos.push({ tipo: "mover", etapaId: entrada.etapas_de_compromisso[0] });
      } else if (negocio!.pipelineId === followup.pipeline_id) {
        efeitos.push({ tipo: "mover", etapaId: followup.etapa_reengajou });
      }
    }
    efeitos.push({ tipo: "cancelar_ligacoes_pendentes" });
  } else if (p.tipo === "retornar") {
    efeitos.push({
      tipo: "nova_ligacao",
      sourceKind: sourceKindDaLigacao("retorno"),
      venceEm: new Date(p.data),
      titulo: "Ligar (retorno combinado) — {{contact.name}}",
    });
  } else {
    efeitos.push({ tipo: "cancelar_ligacoes_pendentes" });
    if (aberto) efeitos.push({ tipo: "perder", motivo: p.motivo, detalhe: p.detalhe ?? null });
  }
  return efeitos;
}
