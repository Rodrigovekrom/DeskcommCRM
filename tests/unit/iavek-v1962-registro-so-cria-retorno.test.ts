/**
 * ia.vek v1.9.62 (0649, Lupa 203241): o registro de ligação cria a próxima com a atual AINDA aberta. O gatilho da 0640
 * (trg_iavek_ligacao_nasceu) cancela as anteriores quando nasce uma L2–L7 ou 'quente', e mataria a atual no meio. Então
 * o registro SÓ pode criar 'ligacao:retentativa' e 'ligacao:retorno': esta trava quebra se alguém mudar isso.
 */
import { describe, expect, it } from "vitest";

import { PADRAO_DA_ESTEIRA } from "@/lib/esteira/config";
import { efeitosDoRegistro, type RegistroDeLigacao } from "@/lib/esteira/registro-de-ligacao";

const AGORA = new Date("2026-11-23T15:00:00Z");
const D = "2026-11-24T15:00:00Z";
const REGISTROS: RegistroDeLigacao[] = [
  { atendeu: false, resumo: "caixa postal" },
  { atendeu: true, resumo: "vai vir", proximo: { tipo: "agendou", data: D } },
  { atendeu: true, resumo: "liga amanhã", proximo: { tipo: "retornar", data: D } },
  { atendeu: true, resumo: "não quer", proximo: { tipo: "sem_interesse", motivo: "no_response" } as never },
];
const KINDS = ["ligacao:L1", "ligacao:L2", "ligacao:L3", "ligacao:L4", "ligacao:retorno", "ligacao:retentativa", "ligacao:quente"];

describe("o registro de ligação só cria retentativa e retorno", () => {
  it("em toda combinação de registro, tarefa de origem e situação do negócio", () => {
    const criadas = new Set<string>();
    for (const r of REGISTROS)
      for (const k of KINDS)
        for (const negocio of [null, { pipelineId: "p", status: "open" }, { pipelineId: "p", status: "lost" }])
          for (const e of efeitosDoRegistro(r, { source_kind: k }, negocio as never, PADRAO_DA_ESTEIRA, AGORA))
            if (e.tipo === "nova_ligacao") criadas.add(e.sourceKind);
    expect([...criadas].sort()).toEqual(["ligacao:retentativa", "ligacao:retorno"]);
    for (const k of criadas) expect(k).not.toMatch(/^ligacao:(L[1-7]|quente)$/);
  });
});
