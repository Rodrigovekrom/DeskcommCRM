/**
 * ia.vek v1.6: a FUNÇÃO de quem trabalha na loja (SDR, vendedor, gerente).
 *
 * Mora em `interface_settings.funcao` do vínculo (sem migration) e decide só o
 * que a pessoa VÊ — menu e tela inicial. Permissão continua sendo do PAPEL
 * (viewer/agent/manager/admin): uma função nunca abre o que o papel não abre.
 * Sem função, nada muda (a interface de sempre).
 */
// ia.vek v1.7.1: "apoio" (Gerente de apoio, o fechador) e "suporte" (SDR de
// suporte, que observa a IA). Só "sdr" vira GUARDIÃO do lead: o gatilho da
// migration 0579 compara a função com 'sdr' exato, e nenhum outro valor dispara.
//
// ia.vek v1.7.5 (decisão do Rodrigo): só existe UM cargo de gerente. "apoio"
// continua no vocabulário GRAVADO (vínculos e convites antigos têm o valor, e
// nada da produção é reescrito), mas na TELA é apelido de "gerente"
// (`funcaoDaTela`) e saiu das listas de escolha (`FUNCOES_DE_ESCOLHA`).
// ia.vek v1.7.8: "analista_ficha" — vê SÓ as fichas (Passar Ficha). Para este
// vínculo o banco fecha o CRM inteiro (migration 0586: fn_user_org_ids e
// fn_user_role_in_org não o contam), e o layout o leva para /fichas.
export const FUNCOES = ["sdr", "suporte", "vendedor", "apoio", "gerente", "analista_ficha"] as const;
export type Funcao = (typeof FUNCOES)[number];

/** O que se ESCOLHE hoje (convite, Equipe, Ver como): sem o "apoio". */
export const FUNCOES_DE_ESCOLHA = [
  "sdr",
  "suporte",
  "vendedor",
  "gerente",
  "analista_ficha",
] as const satisfies readonly Funcao[];

/**
 * A função que a TELA usa: o "apoio" gravado vira "gerente" (mesmo menu, mesmo
 * Meu dia, mesmo Kanban). Valor desconhecido ou ausente: sem função.
 */
export function funcaoDaTela(v: unknown): Funcao | null {
  if (!ehFuncao(v)) return null;
  return v === "apoio" ? "gerente" : v;
}

export const ROTULO_DA_FUNCAO: Record<Funcao, string> = {
  sdr: "SDR",
  suporte: "SDR de suporte",
  vendedor: "Vendedor",
  apoio: "Gerente de apoio",
  gerente: "Gerente",
  analista_ficha: "Analista de ficha",
};

/**
 * O que cada função vê no menu (além das portas essenciais: perfil, segurança
 * e, para quem administra, equipe e organização). Item que não existe na
 * instalação, ou que o papel não abre, simplesmente não aparece.
 */
const MENU_GERENTE = ["/app/meu-dia", "/app/agenda", "/app/kanban", "/app/inbox"] as const;

export const DESTINOS_DA_FUNCAO: Record<Funcao, readonly string[]> = {
  sdr: [
    "/app/meu-dia",
    "/app/inbox",
    "/app/agenda",
    "/app/tasks",
    "/app/contacts",
    "/app/calls",
    "/app/templates",
  ],
  vendedor: [
    "/app/meu-dia",
    // v1.7.7: a carteira dele no Kanban (antes de tudo o que é lista).
    "/app/pipeline",
    "/app/inbox",
    "/app/agenda",
    "/app/kanban",
    "/app/tasks",
    "/app/contacts",
    "/app/products",
    "/app/proposals",
    "/app/calls",
    "/app/templates",
  ],
  /**
   * Igual ao SDR, mas sem virar guardião do lead — e é a ÚNICA função que vê o
   * Espaço da IA (v1.7.5: "só admin tem a visão + SDR de suporte").
   */
  suporte: [
    "/app/meu-dia",
    "/app/espaco-ia",
    "/app/inbox",
    "/app/agenda",
    "/app/tasks",
    "/app/contacts",
    "/app/calls",
    "/app/templates",
  ],
  /**
   * ia.vek v1.7.5 (pedido do Rodrigo): o gerente CONTROLA e ACOMPANHA a equipe,
   * e o menu dele é só isto, em dois grupos com nome próprio
   * (`MENU_DO_GERENTE`). Saem Espaço da IA, Radar, respostas rápidas, contatos,
   * tarefas soltas (viraram um bloco do Meu dia), casos, desempenho, atividades,
   * equipe, distribuição, etiquetas e notificações. É APRESENTAÇÃO: o que ele
   * pode abrir continua decidido pelo papel e pela RLS — o contato aberto a
   * partir do Kanban, por exemplo, segue abrindo.
   */
  gerente: MENU_GERENTE,
  /** v1.7.5: apelido do gerente (ver `funcaoDaTela`). */
  apoio: MENU_GERENTE,
  /** v1.7.8: o analista não usa o /app — o layout o leva para /fichas. */
  analista_ficha: [],
};

export function ehFuncao(v: unknown): v is Funcao {
  return typeof v === "string" && (FUNCOES as readonly string[]).includes(v);
}

/** O destino está no menu desta função? (sem função: tudo) */
export function funcaoMostra(funcao: Funcao | undefined | null, href: string): boolean {
  const f = funcaoDaTela(funcao);
  return !f || DESTINOS_DA_FUNCAO[f].includes(href);
}

/**
 * ia.vek v1.7.5: o menu do gerente, com os grupos e rótulos que o Rodrigo pediu.
 * A ordem aqui é a ordem na barra. Só desenho: quem decide se o destino existe
 * para a pessoa continua sendo `DESTINOS_DA_FUNCAO` + papel.
 */
export const MENU_DO_GERENTE = [
  {
    id: "iavek-controle",
    label: "Controle e análise",
    itens: [
      { href: "/app/meu-dia", label: "Meu dia" },
      { href: "/app/agenda", label: "Agenda da loja" },
    ],
  },
  {
    id: "iavek-acompanhamento",
    label: "Acompanhamento",
    itens: [
      { href: "/app/kanban", label: "Kanban por vendedor" },
      { href: "/app/inbox", label: "Atendimento do lead" },
    ],
  },
] as const;

export const ESPACO_DA_IA = "/app/espaco-ia";

/**
 * ia.vek v1.7.5: quem vê o Espaço da IA — o admin (sem função) e a função
 * "suporte". Com função, a função decide (por isso o "Ver como gerente" de um
 * admin mostra o que o gerente vê, sem o Espaço). Vale para o menu E para a rota.
 */
export function veEspacoDaIa(
  funcao: Funcao | undefined | null,
  role: string | null | undefined,
  platform = false,
): boolean {
  if (funcaoDaTela(funcao)) return funcao === "suporte";
  return platform || role === "admin";
}
