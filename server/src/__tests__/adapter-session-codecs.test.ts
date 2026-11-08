import { describe, expect, it } from "vitest";
import { sessionCodec as claudeSessionCodec } from "@paperclipai/adapter-claude-local/server";
import {
  sessionCodec as opencodeSessionCodec,
  isOpenCodeUnknownSessionError,
} from "@paperclipai/adapter-opencode-local/server";
import { sessionCodec as acpxSessionCodec } from "@paperclipai/adapter-utils/acpx-engine/session-codec";

describe("adapter session codecs", () => {
  it("normalizes claude session params with cwd", () => {
    const parsed = claudeSessionCodec.deserialize({
      session_id: "claude-session-1",
      folder: "/tmp/workspace",
      prompt_bundle_key: "bundle-1",
    });
    expect(parsed).toEqual({
      sessionId: "claude-session-1",
      cwd: "/tmp/workspace",
      promptBundleKey: "bundle-1",
    });

    const serialized = claudeSessionCodec.serialize(parsed);
    expect(serialized).toEqual({
      sessionId: "claude-session-1",
      cwd: "/tmp/workspace",
      promptBundleKey: "bundle-1",
    });
    expect(claudeSessionCodec.getDisplayId?.(serialized ?? null)).toBe("claude-session-1");
  });

  it("preserves Claude MCP identity across persistence so resumed turns keep their context", () => {
    const params = {
      sessionId: "11111111-1111-4111-8111-111111111111",
      cwd: "/tmp/workspace",
      mcpServerIdentity: JSON.stringify([{
        name: "Paperclip projects",
        url: "http://localhost:3100/api/mcp/project-tools",
        connectionId: "paperclip-project-tools",
      }]),
    };
    expect(claudeSessionCodec.deserialize(claudeSessionCodec.serialize(params))).toEqual(params);
  });

  it("preserves claude ACP session params for ACP lane resumes", () => {
    const parsed = claudeSessionCodec.deserialize({
      sessionKey: "paperclip:company:agent:task:fingerprint",
      runtimeSessionName: "runtime-session-1",
      acpxRecordId: "record-1",
      acpSessionId: "acp-session-1",
      agentSessionId: "agent-session-1",
      agent: "claude",
      cwd: "/tmp/claude-acp",
      mode: "persistent",
      stateDir: "/tmp/claude-acp-state",
      configFingerprint: "fingerprint",
      workspaceId: "workspace-1",
    });

    expect(parsed).toMatchObject({
      runtimeSessionName: "runtime-session-1",
      acpSessionId: "acp-session-1",
      agent: "claude",
      cwd: "/tmp/claude-acp",
      configFingerprint: "fingerprint",
      workspaceId: "workspace-1",
    });
    expect(claudeSessionCodec.serialize(parsed)).toEqual(parsed);
    expect(claudeSessionCodec.getDisplayId?.(parsed)).toBe("runtime-session-1");
  });

  // The codex session-codec tests lived here (normalize + ACP-lane resume).
  // The codex adapter and its sessionCodec died with the adapter deletion.
  // Deleted 8 Nov 2026.

  it("normalizes opencode session params with cwd", () => {
    const parsed = opencodeSessionCodec.deserialize({
      sessionID: "opencode-session-1",
      cwd: "/tmp/opencode",
    });
    expect(parsed).toEqual({
      sessionId: "opencode-session-1",
      cwd: "/tmp/opencode",
    });

    const serialized = opencodeSessionCodec.serialize(parsed);
    expect(serialized).toEqual({
      sessionId: "opencode-session-1",
      cwd: "/tmp/opencode",
    });
    expect(opencodeSessionCodec.getDisplayId?.(serialized ?? null)).toBe("opencode-session-1");
  });

  // The cursor session-codec test lived here. The cursor adapter and its
  // sessionCodec died with the adapter deletion. Deleted 8 Nov 2026.

  // The gemini session-codec tests lived here (normalize + ACP-lane resume).
  // The gemini adapter and its sessionCodec died with the adapter deletion.
  // Deleted 8 Nov 2026.

  it("preserves acpx session params required for compatibility checks", () => {
    const parsed = acpxSessionCodec.deserialize({
      sessionKey: "paperclip:company:agent:task:fingerprint",
      runtimeSessionName: "runtime-session-1",
      acpxRecordId: "record-1",
      acpSessionId: "acp-session-1",
      agentSessionId: "agent-session-1",
      agent: "claude",
      cwd: "/tmp/acpx",
      mode: "persistent",
      stateDir: "/tmp/acpx-state",
      configFingerprint: "fingerprint",
      workspaceId: "workspace-1",
      repoUrl: "https://example.com/repo.git",
      repoRef: "main",
      remoteExecution: {
        environmentId: "environment-1",
        leaseId: "lease-1",
      },
    });

    expect(parsed).toMatchObject({
      sessionKey: "paperclip:company:agent:task:fingerprint",
      runtimeSessionName: "runtime-session-1",
      acpxRecordId: "record-1",
      acpSessionId: "acp-session-1",
      agentSessionId: "agent-session-1",
      agent: "claude",
      cwd: "/tmp/acpx",
      mode: "persistent",
      stateDir: "/tmp/acpx-state",
      configFingerprint: "fingerprint",
      workspaceId: "workspace-1",
      repoUrl: "https://example.com/repo.git",
      repoRef: "main",
      remoteExecution: {
        environmentId: "environment-1",
        leaseId: "lease-1",
      },
    });
    expect(acpxSessionCodec.serialize(parsed)).toEqual(parsed);
    expect(acpxSessionCodec.getDisplayId?.(parsed)).toBe("runtime-session-1");
  });
});

// The "codex resume recovery detection" describe lived here. Its classifier
// (isCodexUnknownSessionError) died with the codex adapter. Deleted 8 Nov 2026.

describe("opencode resume recovery detection", () => {
  it("detects unknown session errors from opencode output", () => {
    expect(
      isOpenCodeUnknownSessionError(
        "",
        "NotFoundError: Resource not found: /Users/test/.local/share/opencode/storage/session/proj/ses_missing.json",
      ),
    ).toBe(true);
    expect(
      isOpenCodeUnknownSessionError(
        "{\"type\":\"step_finish\",\"part\":{\"reason\":\"stop\"}}",
        "",
      ),
    ).toBe(false);
  });
});

// The "cursor resume recovery detection" describe lived here. Its classifier
// (isCursorUnknownSessionError) died with the cursor adapter. Deleted 8 Nov 2026.

// The "gemini resume recovery detection" describe lived here. Its classifier
// (isGeminiSessionUnrecoverableError) died with the gemini adapter. Deleted
// 8 Nov 2026.
