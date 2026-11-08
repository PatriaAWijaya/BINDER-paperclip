import { describe, expect, it } from "vitest";
import { listClaudeSkills } from "@paperclipai/adapter-claude-local/server";

describe("default operational skill delivery", () => {
  // The feedback skills (complain + suggestion-box) were deliberately removed
  // from the BINDER set in Fase 3.1 (`PAPERCLIP_FEEDBACK_SKILL_KEYS` is empty
  // in adapter-utils), so the defaults resolve to the operational skill only.
  // This test failed at the Tahap 5 baseline for that reason: it still
  // expected the feedback skills. Updated to the Fase 3.1 reality, 8 Nov 2026.
  // The Codex case (listCodexSkills for "codex_local") and the second test
  // ("mounts both skills and their shared helper for Codex, Claude and the
  // Codex sandbox home") died with the adapter deletion.
  const keys = ["paperclipai/paperclip/paperclip"];
  const feedbackKeys = ["paperclipai/paperclip/complain", "paperclipai/paperclip/suggestion-box"];

  it.each([undefined, []])("resolves defaults for Claude with selection %s", async (desiredSkills) => {
    const config = desiredSkills ? { paperclipSkillSync: { desiredSkills } } : {};
    const snapshot = await listClaudeSkills({ agentId: "agent", companyId: "company", adapterType: "claude_local", config });
    expect(snapshot.desiredSkills).toEqual(expect.arrayContaining(keys));
    expect(snapshot.entries.filter(e => keys.includes(e.key)).every(e => e.state === "configured")).toBe(true);
    for (const key of feedbackKeys) {
      expect(snapshot.desiredSkills).not.toContain(key);
    }
  });
});
