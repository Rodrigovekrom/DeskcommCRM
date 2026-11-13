#!/usr/bin/env bash
# ia.vek (Maestro 030547): a imagem iavek-v1.9.X só sai se o rótulo do app (VERSAO_IAVEK) for 1.9.X.
# Já aconteceu 2 vezes (a 50 e a 51/52 mostrando a versão anterior no rodapé). Roda no começo do CI (iavek-imagem).
#   bash scripts/iavek-conferir-versao.sh iavek/v1.9.52     # o ramo (no CI: github.ref_name)
# Ramo fora do formato exato iavek/vX.Y.Z (ex.: iavek/v1.9.52-antiga-sobre-50): não confere, só avisa.
set -euo pipefail
RAMO="${1:?uso: $0 <ramo>}"
ARQ="$(cd "$(dirname "$0")/.." && pwd)/lib/iavek/versao.ts"
if [[ ! "$RAMO" =~ ^iavek/v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "conferir-versao: o ramo '$RAMO' não é iavek/vX.Y.Z; não confere."
  exit 0
fi
ESPERADA="${BASH_REMATCH[1]}"
NO_APP="$(sed -n 's/^export const VERSAO_IAVEK = "\([^"]*\)";.*/\1/p' "$ARQ")"
[ -n "$NO_APP" ] || { echo "ERRO: não achei 'export const VERSAO_IAVEK = \"...\";' em lib/iavek/versao.ts."; exit 1; }
if [ "$NO_APP" != "$ESPERADA" ]; then
  echo "ERRO: o ramo é $RAMO, mas o app mostra v$NO_APP (lib/iavek/versao.ts). Suba o VERSAO_IAVEK para \"$ESPERADA\" (e o teste do rótulo)."
  exit 1
fi
echo "conferir-versao: ok (ramo $RAMO = VERSAO_IAVEK $NO_APP)"
