# CRM-244 — Pipeline: 5 correções · testes de aceite (A a J)

Fonte: texto do Rodrigo colado no chat, repassado pelo Maestro em 06/11, com os ajustes das decisões aprovadas (Notion 06/11 01:03Z).

## Decisões aprovadas
1. Trocar o responsável: só guardião, gerente e admin. Vendedor NÃO vê a opção (esconder na tela e negar no servidor).
2. A ordem nova é o PADRÃO de todos, no Pipeline e na tela de cada funil. As outras ordens continuam como opção.
3. Só resposta de PESSOA tira o lead de "sem resposta". Resposta da IA não tira.
4. O cartão sobe pela última mensagem do lead; lead sem nenhuma mensagem usa a data em que chegou.
5. Fila: v1.9.25 primeiro. Depois, empilhado: Fase 1 (responsável), Fase 2 (ordem + sem resposta + contador + não reordenar + leitura por pessoa + nome no balão), Fase 3 ("Criar resposta rápida" no "/"), Fase 4 (busca nome/telefone/carro, contagem, limpar; totais R$ do funil inteiro).

## Ajustes que valem sobre o texto original
- Dúvida vai ao Maestro; nunca decidir sozinho.
- Vendedor no responsável: confirmar que a opção NÃO aparece e que o servidor nega.
- Lead sem nenhuma mensagem usa a data em que chegou. Lead COM mensagem: a data de criação NÃO influencia a posição.
- "Sem resposta" = última mensagem da conversa é do lead. Só resposta de PESSOA (vendedor, gerente, admin) tira; a da IA não tira.
- Fora do escopo, não mexer: etapas do pipeline, estoque, metas, layout geral.
- Um commit por fase. Ao fim de cada fase, PASSOU ou FALHOU com evidência. Medida de tempo em cada fase (meta < 1 s por clique; se piorar o quadro, parar e avisar).
- Tudo no banco de TESTE. Nada em produção. Produção só depois do rodízio do Guardião Leads provado.
- Causa da lista de Responsável vazia: não chutar; espera tela, login, aparelho e print do Rodrigo.

## Testes de aceite
- **A.** Lead criado há 2 dias, na última posição da coluna, manda mensagem nova -> o card sobe ao topo da coluna em tempo real.
- **B.** Dois leads sem resposta + um já respondido -> os dois sem resposta ficam no topo; o respondido, abaixo.
- **C.** Vendedor abre a conversa, não responde e fecha -> o card continua no bloco "SEM RESPOSTA".
- **D.** Vendedor responde o lead -> o card sai do bloco "SEM RESPOSTA".
- **E.** Gerente abre o seletor de responsável -> lista todos os usuários (com busca por nome); a troca é salva e aparece no histórico com quem trocou e quando. (+ vendedor: a opção não aparece.)
- **F.** Digitar "/" no campo de mensagem -> com respostas cadastradas, a lista aparece e filtra; sem respostas, aparece "Criar resposta rápida" (o botão fica no topo nos dois casos). Enter ou clique insere sem enviar. Respostas são por usuário.
- **G.** Buscar "José" no pipeline -> encontra o card em qualquer coluna (busca por nome, telefone e carro; mostra quantidade e botão de limpar; totais em R$ continuam do funil inteiro).
- **H.** Admin abre uma conversa com 3 mensagens não lidas e fecha -> o card do vendedor continua com contador 3 e no topo.
- **I.** Vendedor responsável abre a conversa -> o contador dele zera, mas o card continua em "SEM RESPOSTA" até ele responder.
- **J.** Admin responde o lead pela conversa -> o card sai de "SEM RESPOSTA" e o histórico mostra o nome do admin como autor da resposta.

## Detalhes que contam na Fase 2
- Não reordenar enquanto o usuário arrasta um card ou está com ele aberto; aplicar a nova ordem ao soltar ou fechar.
- Contador de "sem resposta" no cabeçalho fixo, por vendedor.
- Card reatribuído: o novo responsável recebe o contador no estado atual.
- Histórico do card registra quem visualizou e quando. Admin tem marca discreta de "já vi" sem mexer no do vendedor.

## Relatório final
Status dos pontos 1 a 5, resultado de A a J e qualquer dúvida que surgiu.

## Por fase (preencher)
| Fase | Commit | Testes | Resultado | Tempo |
|---|---|---|---|---|
| 1 | | E | | |
| 2 | | A B C D H I J | | |
| 3 | | F | | |
| 4 | | G | | |
