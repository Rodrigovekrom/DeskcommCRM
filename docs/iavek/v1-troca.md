# ia.vek CRM — da branch até a produção

Repositório: `Rodrigovekrom/DeskcommCRM`, branches **`iavek/*`** (nunca commitar
na `main`). **O sistema é nosso e não segue mais o upstream** (decisão do Rodrigo,
16/10/2026): nasceu da v1.76.0 do DeskcommCRM, e daí em diante só recebe o que nós
fazemos. Os scripts de operação moram **fora do repositório**, em
`~/projects/ia-vek-crm/` no Mac.

## Versões, branches e tags

| O quê                                   | Convenção                                    | Exemplo                  |
| --------------------------------------- | -------------------------------------------- | ------------------------ |
| Versão (o que aparece no rodapé)        | `VERSAO_IAVEK` em `lib/iavek/versao.ts`      | `ia.vek CRM v1.1`        |
| Branch da versão                        | `iavek/vX.Y`                                 | `iavek/v1.1`             |
| Branch de uma melhoria                  | `iavek/vX.Y-<assunto>`, juntada na da versão | `iavek/v1.2-relatorio`   |
| Tag da imagem (automática, do workflow) | `<branch com - no lugar de />-<sha7>`        | `iavek-v1.1-abc1234`     |
| Marco git do que foi para a produção    | `iavek-vX.Y` (tag anotada)                   | `iavek-v1.0` = `aa648ad` |

O marco é `iavek-vX.Y`, e **nunca** `vX.Y`: o repositório herdou as tags do
upstream (`v1.0.0`, `v1.1.0`…) e o workflow `publish-image.yml` publica imagem
em toda tag `v*`. O `trocar-producao.sh` aceita qualquer tag `iavek-v…-<sha7>`,
então não muda com a convenção.

## O que o fork muda

| Peça                                                                                         | Arquivos                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Paleta navy/aço (semente `#2A4A73`), superfícies frias `#F2F4F6` / `#11171F`                 | `app/globals.css`, `lib/branding/regua-do-produto.ts` (gerado)      |
| Fontes: Plus Jakarta Sans (texto), Archivo (wordmark), JetBrains Mono (números)              | `app/layout.tsx`, `app/fonts/archivo-62-125-latin.woff2`            |
| Logo: rede de nós com o nó final âmbar + wordmark `ia.vek`                                   | `lib/branding/desenho.ts`, `components/branding/MarcaDoProduto.tsx` |
| Favicon e ícone do app com o símbolo pequeno                                                 | `app/icon.tsx`, `lib/branding/icone-do-app.tsx`                     |
| Fundo de rede neural (telas de acesso)                                                       | `components/branding/FundoNeural.tsx`, `app/(public)/layout.tsx`    |
| Funcionalidades da Fenômenos (preço em 3 níveis, estoque Altimus, esteira, avisos no grupo…) | `lib/esteira/`, `lib/avisos-grupo/`, `lib/estoque/` e afins         |
| Três imagens no GHCR do fork                                                                 | `.github/workflows/iavek-imagem.yml`                                |

O logo da rede de nós aparece quando a instalação se chama **`ia.vek`**
(`APP_NAME`) e não tem logo subido em `/admin/marca`. O padrão do upstream
(`DEFAULT_APP_NAME`) não foi editado: o repositório tem testes que travam essa
constante.

**O fork não leva migration.** Configuração nova mora em `organizations.settings`
(JSON), para não colidir com a numeração do upstream. Por isso o canário, que usa
o banco da produção, prova a versão inteira.

## 1. Publicar as imagens

1. Commit numa branch `iavek/*`, com `pnpm typecheck` e `pnpm test:unit` verdes.
2. `git push origin <branch>`: o workflow `iavek-imagem` roda typecheck +
   test:unit e publica três imagens **com a mesma tag** `<branch>-<sha7>`
   (barras viram hífen, ex.: `iavek-v1.76-d4-avisos-aa648ad`):
   - `ghcr.io/rodrigovekrom/iavek-crm` (app);
   - `ghcr.io/rodrigovekrom/iavek-crm-worker` (worker);
   - `ghcr.io/rodrigovekrom/iavek-crm-scheduler` (crons do fork).
3. Os três pacotes são **públicos**: a VPS baixa sem `docker login` (não há
   credencial do GHCR no servidor). Se algum dia virarem privados, a troca para
   no passo de baixar, com "NADA mudou", até a VPS ganhar um login
   `read:packages`.

## 2. Canário (antes de toda troca)

```bash
bash ~/projects/ia-vek-crm/canario.sh <tag>
```

Sobe o app da tag num contêiner à parte (`iavek-canario`), em
**`127.0.0.1:3901`**, na rede `deskcommcrm_internal`, com o mesmo ambiente do app
de produção (lido do contêiner, num arquivo temporário apagado com `shred`). Não
toca o contêiner de produção, o `.env` nem o compose. Para olhar, abra o túnel e
acesse `http://localhost:3901/login`:

```bash
ssh -i ~/.ssh/iavek_vps -p 22022 -L 3901:127.0.0.1:3901 root@143.95.173.212
```

O canário lê **o mesmo banco da produção**: só olhar e navegar, sem salvar
configuração por ali. O worker e o scheduler da tag não sobem no canário.

## 3. Trocar (só com OK explícito do Rodrigo para aquela troca)

Quem roda é o Rodrigo, no Terminal do Mac:

```bash
bash ~/projects/ia-vek-crm/trocar-producao.sh <tag>
```

O script, em ordem (um passo que falha impede os seguintes):

1. baixa as 3 imagens da tag (a que não existir com a tag fica como está);
2. faz o backup do banco e do WhatsApp (`backup.sh` do kit);
3. anota as imagens no ar (app, worker, scheduler, uma por linha) em
   `/root/iavek-imagem-anterior.txt`, e o histórico em `/root/iavek-trocas.log`;
4. troca `APP_IMAGE`, `WORKER_IMAGE` e `SCHEDULER_IMAGE` no `.env` e reinicia só
   esses serviços (30 a 60 s fora do ar);
5. confere: app saudável, saúde `healthy ok`, `/login` 200 e `/app` 307 pelo
   domínio, worker e scheduler rodando com a imagem nova. **Se algo falhar,
   volta sozinho** para as imagens anotadas;
6. com tudo certo, remove o canário.

O banco não muda: a troca é só de imagem.

## 4. Desfazer

```bash
bash ~/projects/ia-vek-crm/trocar-producao.sh volta
```

Volta as três imagens anotadas em `/root/iavek-imagem-anterior.txt`, com a mesma
conferência. Volta em segundos, porque o banco não muda nos dois sentidos.

**Sem cópia do `.env`.** A troca muda só as três linhas de imagem, e a volta é o
arquivo de imagens anteriores. Uma cópia inteira do `.env` guarda todas as chaves
e sobrevive às rotações (em 15/10/2026, #72, três cópias foram apagadas, uma com
chaves vivas).

## Regras

- **Script de produção nunca se executa para testar.** `trocar-producao.sh` (e
  qualquer script que mexa na produção) se valida só com `bash -n`; quem executa
  é o Rodrigo, depois de aprovar a troca.
- **Sem "Atualizar agora".** Desde a v1.1 a tela de atualização só diz que as
  atualizações são feitas pela equipe, o rodapé não consulta versão e o pedido
  `POST /api/v1/system/update` é recusado (410), mesmo que o `agent.sh` do kit
  seja religado no servidor. Nunca rodar o `update.sh` do upstream: ele troca as
  imagens do ia.vek pelas do DeskcommCRM.
- Se algum dia uma mudança precisar de migration, o canário **não** basta (ele
  usa o banco da produção): o schema precisa ser aplicado e provado antes, num
  banco à parte.
