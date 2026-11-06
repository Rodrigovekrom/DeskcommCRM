/**
 * ia.vek CRM-244, Fase 2 — ordem padrão, bloco SEM RESPOSTA, não lidas de cada pessoa, "já vi" do
 * admin, quem abriu a conversa e o nome de quem respondeu (respostas do Maestro, 06/11).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contarSemRespostaPorDono } from "@/components/iavek/SemRespostaPorVendedor";
import { jaViu, naoLidasDaPessoa, vistoAteDaLinha } from "@/lib/iavek/leitura-da-conversa";
import { aplicarConversaNoQuadro, compararLeads, semRespostaPrimeiro } from "@/lib/iavek/ordem-do-quadro";
import { ACTIVITY_LABELS } from "@/lib/leads/activity-vocabulary";

const ler = (p: string) => readFileSync(p, "utf8");
const H = (h: number) => new Date(Date.UTC(2026, 10, 6, h)).toISOString();
type L = Parameters<typeof semRespostaPrimeiro>[0][number] & { id: string; created_at: string; updated_at: string; value_cents: number | null; owner_user_id: string | null; stage_id: string; contact_id: string };
const lead = (id: string, conversa: L["conversa"], extra: Partial<L> = {}): L =>
  ({ id, status: "open", created_at: H(1), updated_at: H(1), value_cents: null, owner_user_id: "v1", stage_id: "s", contact_id: "c-" + id, conversa, ...extra }) as L;

describe("B: bloco SEM RESPOSTA no topo, e a ordem pela última mensagem do lead", () => {
  it("dois sem resposta no topo; o respondido abaixo, mesmo que seja o mais recente", () => {
    const respondido = lead("resp", { id: "c1", preview: null, last_message_at: H(9), unread: 0, last_inbound_at: H(9), ultima_resposta_humana_em: H(10) });
    const sem1 = lead("sem1", { id: "c2", preview: null, last_message_at: H(8), unread: 0, last_inbound_at: H(8), ultima_resposta_humana_em: null });
    const sem2 = lead("sem2", { id: "c3", preview: null, last_message_at: H(7), unread: 0, last_inbound_at: H(7), ultima_resposta_humana_em: H(5) });
    const ordenada = [respondido, sem1, sem2].sort(compararLeads("ultima_mensagem"));
    expect(semRespostaPrimeiro(ordenada, "Em negociação").map((l) => l.id)).toEqual(["sem1", "sem2", "resp"]);
  });
  it("na coluna da IA não há bloco (a régua da marca do cartão)", () => {
    const sem = lead("sem", { id: "c", preview: null, last_message_at: H(8), unread: 0, last_inbound_at: H(8), ultima_resposta_humana_em: null });
    const outro = lead("outro", null);
    expect(semRespostaPrimeiro([outro, sem], "IA atendendo").map((l) => l.id)).toEqual(["outro", "sem"]);
  });
  it("A: sem mensagem vale a chegada; com mensagem nova sobe ao topo", () => {
    const velho = lead("velho", { id: "c", preview: null, last_message_at: H(12), unread: 0, last_inbound_at: H(12), ultima_resposta_humana_em: null }, { created_at: H(0) });
    const novoSemMsg = lead("novo", null, { created_at: H(11) });
    expect([novoSemMsg, velho].sort(compararLeads("ultima_mensagem")).map((l) => l.id)).toEqual(["velho", "novo"]);
  });
  it("as duas telas usam a ordem de cada pessoa (padrão 'Última mensagem do lead')", () => {
    expect(ler("app/app/pipelines/[id]/_client.tsx")).toMatch(/ordem=\{prefs\.ordem\}/);
    expect(ler("app/app/pipeline/_client.tsx")).toMatch(/ordem=\{prefs\.ordem\}/);
    expect(ler("components/kanban/KanbanBoard.tsx")).toMatch(/ordem === "ultima_mensagem" \? semRespostaPrimeiro\(list, nomes\.get\(stageId\)\) : list/);
  });
});

describe("H, I e estado atual: as não lidas de cada pessoa", () => {
  const entradas = [H(8), H(9), H(10)];
  it("H: o admin abriu, o vendedor não: o do vendedor continua 3", () => {
    expect(naoLidasDaPessoa(entradas, H(7), null)).toBe(3); // vendedor
    expect(naoLidasDaPessoa(entradas, H(7), H(11))).toBe(0); // admin, que abriu às 11h
  });
  it("I: o vendedor abriu às 9h30: só a das 10h fica", () => {
    expect(naoLidasDaPessoa(entradas, H(7), new Date(Date.UTC(2026, 10, 6, 9, 30)).toISOString())).toBe(1);
  });
  it("estado atual: o novo dono (nunca abriu) vê as não lidas desde a última resposta de PESSOA", () => {
    expect(naoLidasDaPessoa(entradas, H(9), null)).toBe(1);
  });
  it("'já vi' do admin: abriu depois da última mensagem do cliente", () => {
    expect(jaViu(H(11), H(10))).toBe(true);
    expect(jaViu(H(9), H(10))).toBe(false);
    expect(jaViu(null, H(10))).toBe(false);
  });
  it("só o admin recebe 'já vi' (o gerente não)", () => {
    expect(ler("app/api/v1/pipelines/[id]/board/route.ts")).toMatch(/\?\.role === "admin"/);
  });
  it("a linha da janela de 30 min guarda o visto até mais novo", () => {
    expect(vistoAteDaLinha({ performed_at: H(8), payload: { visto_ate: H(8.4 as never) } })).toBe(H(8.4 as never));
    expect(vistoAteDaLinha({ performed_at: H(8), payload: {} })).toBe(H(8));
  });
  it("tempo real: mensagem do cliente soma 1; resposta de pessoa zera", () => {
    const base = [lead("x", { id: "c", preview: null, last_message_at: H(8), unread: 0, last_inbound_at: H(8), ultima_resposta_humana_em: null, nao_lidas: 2 })];
    const chegou = aplicarConversaNoQuadro(base, { id: "c", contact_id: "c-x", last_inbound_at: H(9) });
    expect(chegou[0]!.conversa?.nao_lidas).toBe(3);
    const respondeu = aplicarConversaNoQuadro(chegou, { id: "c", contact_id: "c-x", ultima_resposta_humana_em: H(10) });
    expect(respondeu[0]!.conversa?.nao_lidas).toBe(0);
  });
  it("o cartão mostra as não lidas DE QUEM OLHA, não o contador da conversa", () => {
    const cartao = ler("components/iavek/CartaoIavek.tsx");
    expect(cartao).toMatch(/const naoLidas = espera !== null \? \(lead\.conversa\?\.nao_lidas \?\? 0\) : 0;/);
    expect(cartao).not.toMatch(/lead\.conversa\?\.unread/);
  });
});

describe("quem abriu a conversa e quem respondeu", () => {
  it("'Abriu a conversa' no histórico, uma linha por pessoa a cada 30 min", () => {
    expect(ACTIVITY_LABELS.conversation_viewed).toBe("Abriu a conversa");
    const lib = ler("lib/iavek/leitura-da-conversa.ts");
    expect(lib).toMatch(/JANELA_DA_ABERTURA_MS = 30 \* 60_000/);
    expect(lib).toMatch(/\.gte\("performed_at", new Date\(agora\.getTime\(\) - JANELA_DA_ABERTURA_MS\)/);
  });
  it("a gaveta registra a abertura ao abrir e ao fechar", () => {
    expect(ler("components/iavek/ConversaNoQuadro.tsx")).toMatch(/useAberturaDaConversa\(conversa\?\.id \?\? null\)/);
    expect(ler("hooks/iavek/useAberturaDaConversa.ts")).toMatch(/return \(\) => void marcarAbertura\(qc, conversaId\)/);
  });
  it("J: o balão de outra pessoa leva o NOME dela", () => {
    expect(ler("components/inbox/MessageBubble.tsx")).toMatch(/nomeDaEquipe\.get\(message\.sent_by_user_id\)/);
    expect(ler("components/iavek/ConversaNoQuadro.tsx")).toMatch(/<NomesDaEquipeProvider>/);
  });
});

describe("cabeçalho: sem resposta por vendedor", () => {
  it("conta por dono, com a régua da marca", () => {
    const c = (h: number) => ({ id: "c", preview: null, last_message_at: H(h), unread: 0, last_inbound_at: H(h), ultima_resposta_humana_em: null });
    const r = contarSemRespostaPorDono(
      [lead("a", c(8)), lead("b", c(9)), lead("d", c(9), { owner_user_id: "v2" }), lead("e", null), lead("f", c(9), { status: "won" } as never)],
      () => "Em negociação",
    );
    expect(Object.fromEntries(r)).toEqual({ v1: 2, v2: 1 });
  });
});

describe("cartão reatribuído: a conversa vai junto (correção da Fase 2, Maestro 06/11)", () => {
  it("só segue quando está com OUTRA pessoa (a da IA ou sem ninguém fica: a transferência silenciaria a IA)", async () => {
    const { conversaSegue } = await import("@/lib/iavek/conversa-segue-o-dono");
    expect(conversaSegue("vendedor-antigo", "vendedor-novo")).toBe(true);
    expect(conversaSegue("vendedor-novo", "vendedor-novo")).toBe(false);
    expect(conversaSegue(null, "vendedor-novo")).toBe(false);
  });
  it("a troca do responsável usa a MESMA regra da passagem (passarAConversa), sem ciclo de import", () => {
    expect(ler("app/api/v1/leads/_handler.ts")).toMatch(/if \(ownerPatch\.owner_user_id\) \{\s*try \{\s*await conversaSegueODono\(createAdminClient\(\)/);
    expect(ler("lib/iavek/conversa-segue-o-dono.ts")).toMatch(/import \{ passarAConversa \} from "@\/lib\/iavek\/passar-a-conversa";/);
    expect(ler("lib/iavek/passar-a-conversa.ts")).not.toMatch(/leads\/_handler/);
    expect(ler("lib/iavek/passar-a-conversa.ts")).toMatch(/p_reason: "transfer"/);
  });
});

describe("lote 'Atribuir': a conversa vai junto, igual ao cartão (Maestro 06/11)", () => {
  it("usa a mesma regra, só para os leads gravados, e falhar não desfaz a troca", () => {
    const lote = ler("app/api/v1/leads/bulk/route.ts");
    expect(lote).toMatch(/if \(!gravados\.has\(row\.id\) \|\| !row\.contact_id\) continue;/);
    expect(lote).toMatch(/try \{\s*await conversaSegueODono\(admin,/);
  });
});
