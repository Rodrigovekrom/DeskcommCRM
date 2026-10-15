# ia.vek CRM v1 — da branch até a produção

Fork: `Rodrigovekrom/DeskcommCRM`, branch **`iavek/v1.76`**.
Base: **v1.76.0 do upstream**, a mesma versão que roda em `crm.iavekcrm.com`
(medido em `/api/v1/health` em 08/10/2026). O que a branch muda é só visual:
nenhuma migration, nenhum schema, nenhuma rota.

## O que a v1 entrega

| Peça                                                                            | Arquivos                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Paleta navy/aço (semente `#2A4A73`), superfícies frias `#F2F4F6` / `#11171F`    | `app/globals.css`, `lib/branding/regua-do-produto.ts` (gerado)      |
| Fontes: Plus Jakarta Sans (texto), Archivo (wordmark), JetBrains Mono (números) | `app/layout.tsx`, `app/fonts/archivo-62-125-latin.woff2`            |
| Logo: rede de nós com o nó final âmbar + wordmark `ia.vek`                      | `lib/branding/desenho.ts`, `components/branding/MarcaDoProduto.tsx` |
| Favicon e ícone do app com o símbolo pequeno                                    | `app/icon.tsx`, `lib/branding/icone-do-app.tsx`                     |
| Fundo de rede neural (telas de acesso)                                          | `components/branding/FundoNeural.tsx`, `app/(public)/layout.tsx`    |
| Imagem no GHCR do fork                                                          | `.github/workflows/iavek-imagem.yml`                                |

O logo da rede de nós aparece quando a instalação se chama **`ia.vek`**
(`APP_NAME=ia.vek`) e não tem logo subido em `/admin/marca`. O padrão do
upstream (`DEFAULT_APP_NAME`) não foi editado: o repositório tem testes que
travam essa constante, e o caminho que o upstream manda seguir é o `APP_NAME`.

## 1. Publicar a imagem

1. Dar ao `gh` a permissão de workflow (só uma vez): `gh auth refresh -s workflow`
2. `git push origin iavek/v1.76` — o workflow `iavek-imagem` roda typecheck +
   test:unit e publica `ghcr.io/rodrigovekrom/iavek-crm:iavek-v1.76-<sha7>`.
   O resumo do run mostra a linha `APP_IMAGE=…` pronta.
3. O pacote nasce **privado** no GHCR. Ou torna público (Package settings →
   Change visibility), ou a VPS faz `docker login ghcr.io` com um token
   `read:packages`.

## 2. Validar antes da troca

Como a versão é a mesma (1.76.0) e a diferença é só visual, o caminho mais
curto é um **canário no próprio VPS**: subir a imagem nova num contêiner à
parte, numa porta interna, sem worker nem scheduler, e abrir pelo túnel SSH.

```bash
# no VPS. O env sai do contêiner que está no ar, e NÃO do .env: o
# `docker run --env-file` mantém as aspas que o compose tira, e o app recusa
# o valor ("Variáveis de ambiente inválidas").
umask 077
docker inspect deskcommcrm-app-1 --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -v '^$' > /root/iavek-canario.env
docker run -d --name iavek-canario --env-file /root/iavek-canario.env \
  --network deskcommcrm_internal -p 127.0.0.1:3901:3000 \
  ghcr.io/rodrigovekrom/iavek-crm:<tag>
shred -u /root/iavek-canario.env   # o contêiner já leu; o arquivo tem as chaves
# no Mac
ssh -i ~/.ssh/iavek_vps -p 22022 -L 3901:127.0.0.1:3901 root@143.95.173.212
# abrir http://localhost:3901/login ; ao terminar:
docker rm -f iavek-canario
```

A rede `deskcommcrm_internal` é a do compose: sem ela o canário não alcança o
Redis nem o WAHA pelo nome.

Ele lê o MESMO banco da produção — por isso só olhar e navegar; nenhuma
configuração salva ali. (Staging completo com o projeto Supabase separado
`deskcomm-crm` é possível, mas exige aplicar o `baseline.sql` nele e um segundo
conjunto de chaves; para uma mudança só visual o canário prova o mesmo.)

## 3. Trocar

```bash
cd ~/DeskcommCRM            # a pasta onde o install.sh rodou
bash hostgator-setup-kit/backup.sh
grep '^APP_IMAGE=' .env      # anote a imagem atual: é a volta
# no .env:
#   APP_IMAGE=ghcr.io/rodrigovekrom/iavek-crm:<tag>
#   APP_NAME=ia.vek
bash -c 'source hostgator-setup-kit/_common.sh && enter_project && dc up -d app'
```

Conferir: `/` responde 200, `/app` responde 307 e `/login` mostra o logo novo.
Se em `/admin/marca` houver nome ou logo gravados, eles vencem o `.env`
(o banco está acima): deixe o nome como `ia.vek` e o logo vazio.

## 4. Desfazer

```bash
# APP_IMAGE de volta para a imagem anotada no passo 3
sed -i 's#^APP_IMAGE=.*#APP_IMAGE="<imagem anterior>"#' .env
bash -c 'source hostgator-setup-kit/_common.sh && enter_project && dc up -d app'
```

Volta em segundos: o banco não muda nos dois sentidos.

**Sem cópia do `.env`.** A troca muda só o `APP_IMAGE`, então a volta é ele.
Uma cópia inteira do `.env` guarda TODAS as chaves e sobrevive às rotações: em
15/10/2026 (#72) foram apagadas três (`.env.antes-iavek`, `.env.antes-chaves*`),
uma delas com as chaves novas vivas. Se uma troca futura precisar de cópia,
apague-a com `shred -u` assim que a troca for conferida.

## Atenção depois da troca

- **Não clicar em "Atualizar agora"** no CRM. O agente roda o `update.sh` do
  upstream, que regrava `APP_IMAGE` com a imagem do upstream — a marca some
  (nada quebra, mas a v1 é desfeita).
- Atualizar passa a ser: trazer a tag nova do upstream para o fork
  (`git merge v1.77.0` numa branch `iavek/v1.77`), testes, imagem, canário, troca.
