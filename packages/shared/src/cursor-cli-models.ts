/**
 * Relocated from the deleted `@paperclipai/adapter-cursor-local` package
 * (`index.ts`) during the adapter-deletion phase. Cursor CLI model catalog
 * (fallback IDs) + default model. The Cursor CLI still exists as a runner
 * provider; only the adapter package is gone. Import via subpath
 * `@paperclipai/shared/cursor-cli-models` (NOT added to the shared index:
 * the bare `models` name would collide with the Codex catalog).
 */
export const DEFAULT_CURSOR_LOCAL_MODEL = "auto";

const CURSOR_FALLBACK_MODEL_IDS = [
  "auto",
  "composer-2.5",
  "claude-opus-5-5",
  "claude-fable-5-1",
  "claude-sonnet-5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gemini-3.8-flash",
  "muse-spark-1.3",
  "grok-4.7",
  "grok-4.6",
  "grok-4.5",
  "composer-1.5",
  "composer-1",
  "gpt-5.3-codex-low",
  "gpt-5.3-codex-low-fast",
  "gpt-5.3-codex",
  "gpt-5.3-codex-fast",
  "gpt-5.3-codex-high",
  "gpt-5.3-codex-high-fast",
  "gpt-5.3-codex-xhigh",
  "gpt-5.3-codex-xhigh-fast",
  "gpt-5.3-codex-spark-preview",
  "gpt-5.2",
  "gpt-5.2-codex-low",
  "gpt-5.2-codex-low-fast",
  "gpt-5.2-codex",
  "gpt-5.2-codex-fast",
  "gpt-5.2-codex-high",
  "gpt-5.2-codex-high-fast",
  "gpt-5.2-codex-xhigh",
  "gpt-5.2-codex-xhigh-fast",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-max-high",
  "gpt-5.2-high",
  "gpt-5.1-high",
  "gpt-5.1-codex-mini",
  "opus-4.6-thinking",
  "opus-4.6",
  "opus-4.5",
  "opus-4.5-thinking",
  "sonnet-4.6",
  "sonnet-4.6-thinking",
  "sonnet-4.5",
  "sonnet-4.5-thinking",
  "gemini-3.1-pro",
  "gemini-3-pro",
  "gemini-3-flash",
  "grok",
  "kimi-k2.5",
];

export const cursorModels = CURSOR_FALLBACK_MODEL_IDS.map((id) => ({ id, label: id }));
