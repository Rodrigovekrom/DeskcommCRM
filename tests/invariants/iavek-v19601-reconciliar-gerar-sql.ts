/**
 * ia.vek v1.9.60.1 (Maestro 232512): monta o SQL da comparação do passo 6 da esteira (reconciliarFollowup) ANTIGO
 * (v1.9.60) x NOVO num banco de TESTE, tudo numa transação DESFEITA: a semente sintética, o SQL antigo e as fotos,
 * 'rollback to savepoint', o SQL novo e as fotos, e 'rollback' no fim (nada fica no banco). Imprime o SQL no stdout.
 * Os casos são os mesmos da invariante (tests/invariants/iavek-v19601-reconciliar-casos.ts).
 *   pnpm tsx tests/invariants/iavek-v19601-reconciliar-gerar-sql.ts            # o SQL
 *   pnpm tsx tests/invariants/iavek-v19601-reconciliar-gerar-sql.ts --esperado # 2 linhas: o retorno e as tarefas esperadas
 */
import { SQL_RECONCILIAR_FOLLOWUP } from "@/lib/esteira/reconciliar-followup-sql";
import {
  FOTOS_SQL, RETORNO_ESPERADO, SQL_ANTIGO_V1960, comParametros, sementeSql, tarefasEsperadas,
} from "./iavek-v19601-reconciliar-casos";

if (process.argv.includes("--esperado")) {
  process.stdout.write(`${RETORNO_ESPERADO}\n${tarefasEsperadas()}\n`);
} else {
  process.stdout.write(
    [
      "begin;",
      sementeSql(),
      "savepoint antes;",
      "\\echo ==ANTIGO",
      `${comParametros(SQL_ANTIGO_V1960)};`,
      FOTOS_SQL,
      "rollback to savepoint antes;",
      "\\echo ==NOVO",
      `${comParametros(SQL_RECONCILIAR_FOLLOWUP)};`,
      FOTOS_SQL,
      "rollback to savepoint antes;",
      "rollback;",
      "\\echo ==FIM",
      "",
    ].join("\n"),
  );
}
