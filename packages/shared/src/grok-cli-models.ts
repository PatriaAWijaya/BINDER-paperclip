/**
 * Grok CLI model catalog and pure model helpers.
 *
 * Relocated from the deleted `@paperclipai/adapter-grok-local` package
 * (its `src/index.ts`) during the adapter-deletion phase. The data describes
 * the Grok CLI binary — the model catalog and reasoning-effort support —
 * not the adapter: the Paperclip Runner's `grok` provider and the
 * AI-connection router still need it, so it lives here in
 * `@paperclipai/shared` as the single source of truth for both server and UI.
 */

export const DEFAULT_GROK_LOCAL_MODEL = "grok-build";

export const grokModels = [
  { id: DEFAULT_GROK_LOCAL_MODEL, label: DEFAULT_GROK_LOCAL_MODEL },
  { id: "grok-4.7", label: "Grok 4.7" },
  { id: "grok-4.6", label: "Grok 4.6" },
  { id: "grok-4.5", label: "Grok 4.5" },
];

export function grokLocalReasoningEffortsForModel(model: string): readonly string[] {
  return model.trim() === "grok-4.7" || model.trim() === "grok-4.6"
    ? ["low", "medium", "high", "xhigh"]
    : ["low", "medium", "high"];
}
