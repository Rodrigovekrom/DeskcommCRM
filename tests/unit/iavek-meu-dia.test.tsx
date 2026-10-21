/**
 * ia.vek v1.6 (parte B): o "Meu dia" de cada função — as contas puras, a tela
 * inicial por função e os três painéis (SDR, Vendedor, Gerente) com dados e
 * com estado vazio amigável.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  org: {
    orgId: "o",
    role: "agent",
    interface_settings: { preset: "completa", funcao: "sdr" },
  } as Record<string, unknown>,
  resposta: {} as unknown,
  // ia.vek v1.7.6: o Meu dia também busca os pedidos de agendamento (e os tipos).
  pedidos: { pedidos: [], pode_decidir: false } as unknown,
  user: { id: "eu" } as Record<string, unknown>,
  get: vi.fn(),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: mocks.org, user: mocks.user }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (url: string) => {
      mocks.get(url);
      // ia.vek v1.7.6: cada URL com a sua resposta — <PedidosDeAgendamento/> lê
      // `pedidos`/`pode_decidir`, e a lista de tipos é um array.
      if (url.startsWith("/api/v1/iavek/pedidos-de-agendamento")) {
        return Promise.resolve({ data: mocks.pedidos });
      }
      if (url.startsWith("/api/v1/agenda/tipos")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: mocks.resposta });
    },
    patch: vi.fn(),
  },
}));

import {
  atrasosPorPessoa,
  limitesDoDia,
  perdasPorMotivo,
  porPrazo,
  tarefasPorPessoa,
} from "@/lib/iavek/meu-dia";
import { homeDaInterface } from "@/lib/navigation/interface";
import { MeuDia, funcaoDoDia } from "@/components/iavek/MeuDia";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<MeuDia />, { wrapper });
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.get.mockClear();
  mocks.pedidos = { pedidos: [], pode_decidir: false };
  mocks.user = { id: "eu" };
});

describe("contas do Meu dia", () => {
  it("hoje é o dia do fuso da loja (São Paulo, UTC-3)", () => {
    const { inicio, fim } = limitesDoDia(new Date("2026-10-17T02:00:00Z"), "America/Sao_Paulo");
    expect(inicio.toISOString()).toBe("2026-10-16T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-10-17T03:00:00.000Z");
  });

  it("leads com menos tempo primeiro", () => {
    expect(
      porPrazo([{ fim_em: "2026-10-20" }, { fim_em: "2026-10-18" }]).map((l) => l.fim_em),
    ).toEqual(["2026-10-18", "2026-10-20"]);
  });

  it("atrasos por pessoa separam ligações, próximos passos e outras", () => {
    expect(
      atrasosPorPessoa([
        { assigned_to: "a", source_kind: "ligacao:L1" },
        { assigned_to: "a", source_kind: "proximo_passo" },
        { assigned_to: "b", source_kind: null },
        { assigned_to: "a", source_kind: "ligacao:L2" },
      ]),
    ).toEqual([
      { user_id: "a", ligacoes: 2, proximos_passos: 1, outras: 0 },
      { user_id: "b", ligacoes: 0, proximos_passos: 0, outras: 1 },
    ]);
  });

  it("perdas agrupadas por motivo, sem motivo vira 'Sem motivo'", () => {
    expect(
      perdasPorMotivo([
        { lost_reason: "Preço" },
        { lost_reason: null },
        { lost_reason: " Preço " },
      ]),
    ).toEqual([
      { motivo: "Preço", total: 2 },
      { motivo: "Sem motivo", total: 1 },
    ]);
  });
});

describe("tela inicial por função", () => {
  it("quem tem função começa pelo Meu dia; sem função, nada muda", () => {
    expect(homeDaInterface({ preset: "completa", funcao: "sdr" }, false, "agent")).toBe(
      "/app/meu-dia",
    );
    expect(homeDaInterface({ preset: "completa", funcao: "gerente" }, false, "manager")).toBe(
      "/app/meu-dia",
    );
    expect(homeDaInterface({ preset: "completa" }, false, "agent")).toBe("/app/inbox");
  });

  it("sem função: gerente e admin veem o dia do Gerente; os outros, o do Vendedor", () => {
    expect(funcaoDoDia(undefined, "admin")).toBe("gerente");
    expect(funcaoDoDia(undefined, "manager")).toBe("gerente");
    expect(funcaoDoDia(undefined, "agent")).toBe("vendedor");
    expect(funcaoDoDia("sdr", "admin")).toBe("sdr");
  });
});

describe("painéis do Meu dia", () => {
  it("SDR: a fila das 72h e a meta, e os MESMOS blocos do vendedor", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "sdr" };
    mocks.resposta = {
      funcao: "sdr",
      pessoal: { agendamentos: [], leads: [], ligacoes: [], proximos_passos: [], propostas: [] },
      sdr: {
        leads_novos: [
          {
            id: "l1",
            title: "Onix",
            contact_id: "c1",
            contato_nome: "Ana",
            fim_em: new Date(Date.now() + 3 * 3_600_000).toISOString(),
            conversation_id: "cv1",
          },
        ],
        agendamentos: { hoje: 3, meta: 10 },
      },
    };
    montar();
    expect(await screen.findByText("Ana")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/iavek/meu-dia?funcao=sdr");
    expect(screen.getByRole("link", { name: /Ana/ }).getAttribute("href")).toBe(
      "/app/inbox?id=cv1",
    );
    expect(screen.getByTestId("contador-agendamentos").textContent).toContain("de 10 da meta");
    expect(screen.getByText("Meus leads")).toBeTruthy();
    expect(screen.getByText("Nenhuma ligação para hoje.")).toBeTruthy();
  });

  it("Vendedor: mesma tela, sem a fila do SDR; tudo vazio mostra os estados amigáveis", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "vendedor" };
    mocks.resposta = {
      funcao: "vendedor",
      pessoal: { agendamentos: [], leads: [], ligacoes: [], proximos_passos: [], propostas: [] },
    };
    montar();
    expect(await screen.findByText("Nenhuma visita ou test drive marcado para hoje.")).toBeTruthy();
    expect(screen.getByText("Nenhum lead com você agora.")).toBeTruthy();
    expect(screen.getByText("Nenhuma proposta em aberto.")).toBeTruthy();
    expect(screen.queryByText("Leads novos (72h)")).toBeNull();
  });

  it("o lead que eu GUARDO mostra com quem está e o próximo passo do dono", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "sdr" };
    mocks.resposta = {
      funcao: "sdr",
      pessoal: {
        agendamentos: [],
        ligacoes: [],
        proximos_passos: [],
        propostas: [],
        leads: [
          {
            id: "g1",
            title: "Hilux",
            etapa: "Negociação",
            contato_nome: "Bia",
            conversation_id: "cv9",
            papel: "guardiao",
            dono_nome: "Bruno",
            proximo_passo_do_dono: null,
          },
        ],
      },
      sdr: { leads_novos: [], agendamentos: { hoje: 0, meta: null } },
    };
    montar();
    const lista = await screen.findByTestId("meus-leads");
    expect(lista.textContent).toContain("Com Bruno");
    expect(lista.textContent).toContain("Sem próximo passo marcado");
    expect(screen.getByTestId("selo-guardiao").textContent).toBe("Você é o guardião");
  });

  it("Gerente: números do dia, atrasos por pessoa e o funil de 30 dias", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.resposta = {
      funcao: "gerente",
      gerente: {
        leads_novos_hoje: 4,
        estourando: [],
        atrasos_por_pessoa: [
          { user_id: "u1", nome: "Bruno", ligacoes: 2, proximos_passos: 1, outras: 0 },
        ],
        funil_30d: { agendou: 10, veio: 6, comprou: 2 },
        conversas_abertas: { com_pessoa: 3, com_ia_ou_sem_dono: 7 },
        perdas_30d: [{ motivo: "Preço", total: 2 }],
        meta_agendamentos_dia: null,
      },
    };
    montar();
    expect((await screen.findByTestId("gerente-novos-hoje")).textContent).toContain("4");
    expect(screen.getByTestId("tabela-atrasos").textContent).toContain("Bruno");
    expect(screen.getByTestId("funil-30d").textContent).toContain("10");
    expect(screen.getByText("Preço")).toBeTruthy();
  });

  it("v1.7.5: o 'apoio' gravado abre o dia do GERENTE", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "apoio" };
    mocks.org.role = "manager";
    expect(funcaoDoDia("apoio", "manager")).toBe("gerente");
    mocks.resposta = { funcao: "gerente", gerente: GERENTE_VAZIO };
    montar();
    await screen.findByTestId("gerente-novos-hoje");
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/iavek/meu-dia?funcao=gerente");
    expect(screen.getByTestId("meu-dia").getAttribute("data-funcao")).toBe("gerente");
  });

  it("v1.7.5: Tarefas da equipe — quem tem o quê, atrasadas, concluídas e filtro por vendedor", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    mocks.resposta = {
      funcao: "gerente",
      gerente: {
        ...GERENTE_VAZIO,
        tarefas_da_equipe: {
          por_pessoa: [
            { user_id: "u1", nome: "Bruno", abertas: 2, atrasadas: 1, concluidas: 0 },
            { user_id: "u2", nome: "Carla", abertas: 0, atrasadas: 0, concluidas: 1 },
          ],
          itens: [
            tarefa("t1", "Ligar para o Zé", "pending", ontem, "u1", "Bruno"),
            tarefa("t2", "Mandar proposta", "pending", amanha, "u1", "Bruno"),
            tarefa("t3", "Confirmar visita", "done", ontem, "u2", "Carla"),
          ],
        },
      },
    };
    montar();
    const lista = await screen.findByTestId("lista-tarefas-equipe");
    // Abertas (padrão): as duas do Bruno; a concluída da Carla não.
    expect(lista.textContent).toContain("Ligar para o Zé");
    expect(lista.textContent).toContain("Mandar proposta");
    expect(lista.textContent).not.toContain("Confirmar visita");
    expect(screen.getByTestId("tabela-tarefas-equipe").textContent).toContain("Carla");

    fireEvent.click(screen.getByTestId("tarefas-equipe-atrasadas"));
    expect(screen.getByTestId("lista-tarefas-equipe").textContent).toContain("Ligar para o Zé");
    expect(screen.getByTestId("lista-tarefas-equipe").textContent).not.toContain("Mandar proposta");

    fireEvent.click(screen.getByTestId("tarefas-equipe-concluidas"));
    expect(screen.getByTestId("lista-tarefas-equipe").textContent).toContain("Confirmar visita");

    // Filtro por vendedor: Bruno não tem concluída.
    fireEvent.change(screen.getByTestId("tarefas-equipe-vendedor"), { target: { value: "u1" } });
    expect(screen.getByTestId("lista-tarefas-equipe").textContent).toContain(
      "Nenhuma tarefa concluída nos últimos 7 dias.",
    );
  });
});

// ia.vek v1.7.6: meta e capacidade são do admin; o gerente só lê. Propostas
// aguardando aprovação e pedidos de agendamento aparecem no dia.
describe("Meu dia v1.7.6", () => {
  it("gerente vê a meta só para leitura, sem campo de meta nem de capacidade", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.org.role = "manager";
    mocks.resposta = { funcao: "gerente", gerente: { ...GERENTE_VAZIO, meta_agendamentos_dia: 8 } };
    montar();
    const leitura = await screen.findByTestId("meta-agendamentos-leitura");
    expect(leitura.textContent).toContain("8");
    expect(screen.queryByTestId("meta-agendamentos")).toBeNull();
    expect(screen.queryByTestId("capacidade-por-horario")).toBeNull();
  });

  it("admin da loja vê os campos de meta e de capacidade por horário", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.org.role = "admin";
    mocks.resposta = {
      funcao: "gerente",
      gerente: { ...GERENTE_VAZIO, meta_agendamentos_dia: 8, agenda_capacidade_por_horario: 2 },
    };
    montar();
    const meta = (await screen.findByTestId("meta-agendamentos")) as HTMLInputElement;
    expect(meta.value).toBe("8");
    expect((screen.getByTestId("capacidade-por-horario") as HTMLInputElement).value).toBe("2");
    expect(screen.queryByTestId("meta-agendamentos-leitura")).toBeNull();
  });

  it("super-admin da plataforma (fora do suporte) também edita, mesmo como gerente na loja", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.org.role = "manager";
    mocks.user = { id: "eu", is_platform_admin: true, support: null };
    mocks.resposta = { funcao: "gerente", gerente: GERENTE_VAZIO };
    montar();
    expect(await screen.findByTestId("meta-agendamentos")).toBeTruthy();
  });

  it("gerente vê as propostas aguardando aprovação, com vendedor e link", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.org.role = "manager";
    mocks.resposta = {
      funcao: "gerente",
      gerente: {
        ...GERENTE_VAZIO,
        propostas_aguardando_aprovacao: [
          {
            id: "p1",
            titulo: "Hilux 2026",
            total_cents: 1_500_000,
            moeda: "BRL",
            lead_id: "l1",
            pedida_em: new Date().toISOString(),
            vendedor_nome: "Bruno",
            contato_nome: "Ana",
          },
        ],
      },
    };
    montar();
    expect(await screen.findByText("Propostas aguardando aprovação")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Ana/ });
    expect(link.getAttribute("href")).toBe("/app/proposals/p1");
    expect(link.textContent).toContain("Bruno");
  });

  it("lista vazia de propostas aguardando mostra o estado amigável", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.org.role = "manager";
    mocks.resposta = { funcao: "gerente", gerente: { ...GERENTE_VAZIO, propostas_aguardando_aprovacao: [] } };
    montar();
    expect(await screen.findByText("Nenhuma proposta esperando a sua aprovação.")).toBeTruthy();
  });

  it("o Meu dia busca os pedidos de agendamento e mostra os pendentes a quem decide", async () => {
    mocks.org.interface_settings = { preset: "completa", funcao: "gerente" };
    mocks.org.role = "admin";
    mocks.pedidos = {
      pode_decidir: true,
      pedidos: [
        {
          id: "pd1",
          contact_id: "c1",
          conversation_id: null,
          quando: new Date(Date.now() + 86_400_000).toISOString(),
          event_type_id: null,
          observacao: null,
          origem: "pessoa",
          status: "pendente",
          motivo_da_recusa: null,
          contato_nome: "Carlos",
          pedido_por_nome: "Bia",
        },
      ],
    };
    mocks.resposta = { funcao: "gerente", gerente: GERENTE_VAZIO };
    montar();
    const bloco = await screen.findByTestId("bloco-pedidos-de-agendamento");
    expect(bloco.textContent).toContain("Pedidos de agendamento");
    expect(bloco.textContent).toContain("Carlos");
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/iavek/pedidos-de-agendamento");
  });
});

describe("tarefas por pessoa (v1.7.5)", () => {
  it("conta abertas, atrasadas e concluídas, quem tem mais atraso primeiro", () => {
    const agora = new Date("2026-10-21T12:00:00Z");
    expect(
      tarefasPorPessoa(
        [
          { assigned_to: "a", status: "pending", due_date: "2026-10-22T00:00:00Z" },
          { assigned_to: "b", status: "in_progress", due_date: "2026-10-20T00:00:00Z" },
          { assigned_to: "b", status: "pending", due_date: null },
          { assigned_to: "a", status: "done", due_date: "2026-10-19T00:00:00Z" },
          { assigned_to: null, status: "cancelled", due_date: null },
        ],
        agora,
      ),
    ).toEqual([
      { user_id: "b", abertas: 2, atrasadas: 1, concluidas: 0 },
      { user_id: "a", abertas: 1, atrasadas: 0, concluidas: 1 },
      { user_id: null, abertas: 0, atrasadas: 0, concluidas: 0 },
    ]);
  });
});

const GERENTE_VAZIO = {
  leads_novos_hoje: 0,
  estourando: [],
  atrasos_por_pessoa: [],
  funil_30d: { agendou: 0, veio: 0, comprou: 0 },
  conversas_abertas: { com_pessoa: 0, com_ia_ou_sem_dono: 0 },
  perdas_30d: [],
  meta_agendamentos_dia: null,
};

function tarefa(
  id: string,
  title: string,
  status: string,
  due_date: string,
  assigned_to: string,
  responsavel_nome: string,
) {
  return {
    id,
    title,
    status,
    due_date,
    source_kind: null,
    contact_id: null,
    contato_nome: null,
    conversation_id: null,
    assigned_to,
    responsavel_nome,
  };
}
