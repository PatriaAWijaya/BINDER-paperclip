import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

vi.mock("@paperclipai/adapter-utils/execution-target", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/execution-target")>();
  return { ...actual, runAdapterExecutionTargetProcess: vi.fn() };
});
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";
import { execute as opencode } from "@paperclipai/adapter-opencode-local/server";

const roots: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe("legacy environment tool access on resumed conversations", () => {
  // The it.each used to cover gemini_local, kimi_local, cursor and pi_local
  // too. Those adapters died with the adapter deletion, so only the
  // opencode_local row remains (the Pi node:os homedir mock, the Pi
  // session.jsonl setup and the kimi/pi stdout branches died with them).
  // Deleted 8 Nov 2026.
  it("refreshes opencode_local without dropping its conversation", async () => {
    const type = "opencode_local" as const;
    const execute = opencode;
    const resumeFlag = "--session";
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-cli-tool-refresh-")); roots.push(root);
    const command = path.join(root, "agent");
    await fs.writeFile(command, "#!/bin/sh\nprintf 'provider  model\\nopenai  gpt-5\\n'\n", { mode: 0o755 });
    const sessionId = "existing-session";
    const stdout = JSON.stringify({ type: "text", sessionID: sessionId, part: { text: "done" } });
    const invocations: Array<{ args: string[]; env: Record<string, string> }> = [];
    vi.mocked(runAdapterExecutionTargetProcess).mockImplementation(async (_runId, _target, _command, args, options) => {
      invocations.push({ args, env: options.env ?? {} });
      return { exitCode: 0, signal: null, timedOut: false, stdout, stderr: "", pid: null, startedAt: null };
    });
    const getFreshSessionHandoff = vi.fn(async () => "FRESH_HANDOFF_ONLY");
    const ctx: AdapterExecutionContext = {
      getFreshSessionHandoff,
      runId: "refresh", agent: { id: "agent", companyId: "company", name: "Agent", adapterType: type, adapterConfig: {} },
      runtime: { sessionId, sessionParams: { sessionId, cwd: root }, sessionDisplayId: sessionId, taskKey: null },
      config: { command, cwd: root, model: "openai/gpt-5", engine: "cli", env: { HOME: root, XDG_CONFIG_HOME: root, OPENCODE_ALLOW_ALL_MODELS: "1" } },
      context: { refreshTools: true, paperclipFreshSessionHandoffMarkdown: "FRESH_HANDOFF_ONLY" }, onLog: async () => {},
      runtimeTools: { version: 1, guidance: "Tools available", mcpEndpoint: "https://example.test/current-tools/mcp",
        rest: { connectionsSearch: "https://example.test/search", connectionRequest: "https://example.test/request" },
        bearerToken: "current-tool-token", expiresAt: "2027-01-01T00:00:00Z", tools: ["connections_search", "connection_request"] },
    };
    const result = await execute(ctx);
    expect(result.exitCode).toBe(0);
    const invocation = invocations.at(-1)!;
    expect(invocation.args[invocation.args.indexOf(resumeFlag) + 1]).toBe(sessionId);
    expect(invocation.env.PAPERCLIP_RUNTIME_TOOLS_MCP_URL).toBe(ctx.runtimeTools!.mcpEndpoint);
    expect(invocation.env.PAPERCLIP_RUNTIME_TOOLS_TOKEN).toBe("current-tool-token");
    expect(invocation.args.join(" ")).not.toContain("FRESH_HANDOFF_ONLY");
    expect(result.sessionParams?.sessionId).toBe(sessionId);
    // Revocation likewise gets the current environment on the same session.
    await execute({ ...ctx, runtimeTools: undefined });
    expect(invocations.at(-1)!.env.PAPERCLIP_RUNTIME_TOOLS_MCP_URL).toBeUndefined();
    expect(getFreshSessionHandoff).not.toHaveBeenCalled();
  });
});
