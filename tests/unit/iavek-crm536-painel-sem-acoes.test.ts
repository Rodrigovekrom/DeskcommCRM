/**
 * ia.vek CRM-536 (os feedbacks do Lucas; decisão 2A e 3A do Rodrigo): o painel das 72h (ConversaNoQuadro) sem o botão
 * "Ações". As ações do cabeçalho ficam à vista, sem os 5 repetidos; o relógio é o "Manter"; o "Agendar horário" é
 * de TODOS que atendem; e o "Pedir agendamento" do "Dados do lead" não se repete SÓ no painel (o CRMSidePanel também
 * é o da Entrada, que não muda).
 *
 * A casca do painel é grande (a conversa, o composer, a ficha): aqui a prova é pelo código-fonte, e o comportamento
 * de cada peça está nos testes de tela (ConversationHeader.test.tsx no modo "no-quadro" × a Entrada,
 * SeloCronometro72h.test.tsx) e de rota (iavek-crm536-rotas-agendar-e-manter.test.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (f: string) => readFileSync(f, "utf8");
const painel = ler("components/iavek/ConversaNoQuadro.tsx");
const lateral = ler("components/inbox/CRMSidePanel.tsx");
const inbox = ler("components/inbox/InboxLayout.tsx");

describe("CRM-536: o painel das 72h sem 'Ações'", () => {
  it("o botão 'Ações' saiu (nem o testid, nem o estado de abrir)", () => {
    expect(painel).not.toContain('data-testid="alternar-acoes"');
    expect(painel).not.toMatch(/acoesAbertas/);
    expect(painel).not.toMatch(/t\("Ações"\)/);
  });

  it("o cabeçalho fica SEMPRE à vista, no modo do painel (sem os 5 repetidos)", () => {
    expect(painel).toMatch(/<ConversationHeader[\s\S]{0,300}modo="no-quadro"/);
  });

  it("o relógio do painel é clicável (o 'Manter'), e o botão antigo saiu do painel", () => {
    expect(painel).toContain("<SeloCronometro72h contactId={conversa.contacts.id} clicavel />");
    expect(painel).not.toContain("BotaoManterEmNegociacao");
  });

  it("'Agendar horário' para todos que atendem (não mais só o vendedor); o viewer e o suporte em leitura, não", () => {
    expect(painel).toMatch(
      /const podeAtender = roleAtLeast\(activeOrg\?\.role, "agent"\) && !supportReadonly;/,
    );
    expect(painel).toMatch(
      /\{podeAtender && conversa\.contacts\?\.id && \(\s*<PedirAgendamento rotulo=\{t\("Agendar horário"\)\}/,
    );
    expect(painel).not.toMatch(
      /\{ehVendedor && conversa\.contacts\?\.id && \(\s*<PedirAgendamento/,
    );
  });

  it("o 'Pedir agendamento' do 'Dados do lead' some SÓ no painel; na Entrada, o CRMSidePanel segue igual", () => {
    expect(painel).toContain("<CRMSidePanel conversation={conversa} noQuadro />");
    expect(lateral).toMatch(/!marcaDireto&&!noQuadro\?<PedirAgendamento/);
    // a Entrada não passa o noQuadro (a referência fixa: o painel lateral dela não muda)
    expect(inbox).not.toMatch(/noQuadro/);
    expect(inbox).not.toMatch(/modo="no-quadro"/);
  });
});
