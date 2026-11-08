import type { CLIAdapterModule } from "@paperclipai/adapter-utils";
import { printClaudeStreamEvent } from "@paperclipai/adapter-claude-local/cli";
import { printOpenCodeStreamEvent } from "@paperclipai/adapter-opencode-local/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const openCodeLocalCLIAdapter: CLIAdapterModule = {
  type: "opencode_local",
  formatStdoutEvent: printOpenCodeStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [
    claudeLocalCLIAdapter,
    openCodeLocalCLIAdapter,
    processCLIAdapter,
    httpCLIAdapter,
  ].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
