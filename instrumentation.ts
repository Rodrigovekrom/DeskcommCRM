import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // ia.vek v1.9.51.4 (Lupa 192902 c): o atraso do laço do app no log (lib/iavek/atraso-do-laco.ts).
    const { ligarAtrasoDoLaco } = await import("./lib/iavek/atraso-do-laco");
    ligarAtrasoDoLaco();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
