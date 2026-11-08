import type { AdapterExecutionResult } from "../../adapters/types.js";

export const controlledOrdinaryBootstrapFailure = {
  category: "service", title: "Selected model is at capacity", details: "Controlled bootstrap refusal before any domain action.",
} as const;
export const controlledOrdinaryBootstrapProtocol = JSON.stringify(controlledOrdinaryBootstrapFailure);
export const controlledOrdinaryBootstrapScript = `console.error(${JSON.stringify(controlledOrdinaryBootstrapProtocol)});process.exit(75)`;

export function controlledOrdinaryBootstrapResult(config: Record<string, unknown>, result: AdapterExecutionResult): AdapterExecutionResult {
  const args = config.args;
  if (config.command !== process.execPath || !Array.isArray(args) || args.length !== 2 || args[0] !== "-e" ||
      args[1] !== controlledOrdinaryBootstrapScript || result.exitCode !== 75 || result.signal !== null || result.timedOut ||
      result.resultJson?.stdout !== "" || result.resultJson?.stderr !== controlledOrdinaryBootstrapProtocol + "\n") return result;
  // The Codex terminal-failure classifier (classifyCodexTerminalSessionFailure)
  // died with the codex adapter. This helper only ever sees the one controlled
  // failure above ("Selected model is at capacity"), which that classifier
  // always mapped to transient_upstream with no retry time, so the
  // classification is inlined as a literal. (The stderr was already proven
  // to equal the controlled protocol by the guard above, so no parse is
  // needed.)
  const classified = { errorCode: "codex_transient_upstream", errorFamily: "transient_upstream", retryNotBefore: null } as const;
  return { ...result, ...classified, executionRecovery: { kind: "bootstrap", providerWorkStarted: false } };
}
