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
export const FUNCOES = ["sdr", "suporte", "vendedor", "apoio", "gerente"] as const;
export type Funcao = (typeof FUNCOES)[number];

export const ROTULO_DA_FUNCAO: Record<Funcao, string> = {
  sdr: "SDR",
  suporte: "SDR de suporte",
  vendedor: "Vendedor",
  apoio: "Gerente de apoio",
  gerente: "Gerente",
};

/**
 * O que cada função vê no menu (além das portas essenciais: perfil, segurança
 * e, para quem administra, equipe e organização). Item que não existe na
 * instalação, ou que o papel não abre, simplesmente não aparece.
 */
export const DESTINOS_DA_FUNCAO: Record<Funcao, readonly string[]> = {
  sdr: [
    "/app/meu-dia",
    "/app/espaco-ia",
    "/app/inbox",
    "/app/agenda",
    "/app/tasks",
    "/app/contacts",
    "/app/calls",
    "/app/templates",
  ],
  vendedor: [
    "/app/meu-dia",
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
  /** Igual ao SDR (inclui o Espaço da IA), mas sem virar guardião do lead. */
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
   * O fechador: papel manager (vê os leads e conversas dos vendedores), mas o
   * menu é só o que ajuda a fechar — sem relatórios, configurações,
   * automações, campanhas nem IA.
   */
  apoio: [
    "/app/meu-dia",
    "/app/inbox",
    "/app/kanban",
    "/app/agenda",
    "/app/tasks",
    "/app/contacts",
    "/app/products",
    "/app/proposals",
    "/app/calls",
    "/app/templates",
  ],
  /**
   * ia.vek v1.7.3 (decisão do Rodrigo, "limita"): o gerente CONTROLA E VÊ a
   * cadeira abaixo (vendedores e SDR) — funil, conversas, tarefas, agenda,
   * desempenho da equipe e a distribuição de atendimento. Nenhum gerente (nem
   * este nem o "apoio") vê configuração técnica: agentes de IA e o que os
   * ajusta, automações, webhooks, campanhas, importações, etapas do funil,
   * recursos opcionais, extensões, integrações e as configurações da empresa.
   * Admin segue vendo tudo (sem função).
   */
  gerente: [
    "/app/meu-dia",
    "/app/inbox",
    "/app/espaco-ia",
    "/app/radar",
    "/app/agenda",
    "/app/templates",
    "/app/kanban",
    "/app/contacts",
    "/app/companies",
    "/app/people",
    "/app/tasks",
    "/app/calls",
    "/app/products",
    "/app/proposals",
    "/app/ai/cases",
    "/app/ai/inbox",
    "/app/metrics",
    "/app/activities",
    "/app/faturamento",
    "/app/team",
    "/app/settings/notifications",
    "/app/settings/atendimento",
    "/app/settings/tags",
  ],
};

export function ehFuncao(v: unknown): v is Funcao {
  return typeof v === "string" && (FUNCOES as readonly string[]).includes(v);
}

/** O destino está no menu desta função? (sem função: tudo) */
export function funcaoMostra(funcao: Funcao | undefined | null, href: string): boolean {
  return !funcao || DESTINOS_DA_FUNCAO[funcao].includes(href);
}
