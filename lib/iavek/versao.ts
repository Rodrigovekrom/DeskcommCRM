/**
 * A VERSÃO DO ia.vek CRM (decisão do Rodrigo, 16/10/2026).
 *
 * O sistema é nosso e não segue mais o upstream: "ia.vek CRM v1" é o que estava
 * em produção na tag `iavek-v1.76-d4-avisos-aa648ad` (marco git `v1.0`), e cada
 * melhoria é v1.1, v1.2… Sobe este número no mesmo commit que fecha a versão;
 * o marco git `vX.Y` vai no commit que for para a produção.
 */
export const VERSAO_IAVEK = "1.9.9";

/** O rótulo discreto do rodapé do menu lateral. */
export const ROTULO_DA_VERSAO = `ia.vek CRM v${VERSAO_IAVEK}`;

/**
 * O "Atualizar agora" do upstream (agente do host + `update.sh`) troca as
 * imagens do ia.vek pelas do DeskcommCRM. Desligado no app: o pedido é recusado
 * mesmo que alguém religue o `agent.sh` no servidor. Atualizar é o fluxo de
 * troca (`trocar-producao.sh`), nunca este.
 */
export const ATUALIZACAO_DO_UPSTREAM = false;
