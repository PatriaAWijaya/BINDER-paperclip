/**
 * Relocated from the deleted `@paperclipai/adapter-kimi-local` package
 * (`index.ts`) during the adapter-deletion phase. Kimi CLI model catalog +
 * default model + thinking-effort helpers. The Kimi CLI still exists as a
 * runner provider; only the adapter package is gone. Import via subpath
 * `@paperclipai/shared/kimi-cli-models` (NOT added to the shared index:
 * the bare `models` name would collide with the Codex catalog).
 */
export const DEFAULT_KIMI_LOCAL_MODEL = "kimi-code/kimi-for-coding";

export const kimiModels = [
  { id: DEFAULT_KIMI_LOCAL_MODEL, label: "K2.8 Preview" },
  { id: "kimi-code/kimi-for-coding-highspeed", label: "K2.7 Coding Highspeed" },
  { id: "kimi-code/k3", label: "K3" },
  { id: "kimi-code/k3-256k", label: "K3 (256K)" },
];

/**
 * Kimi thinking-effort tiers. Kimi's catalog exposes these via each model's
 * `support_efforts`; note there is no "medium" tier (Kimi collapses it onto
 * "high"). Sending an effort a model does not support makes the provider
 * reject the request, so effort is only forwarded for effort-capable models.
 */
export const KIMI_SUPPORTED_EFFORTS = ["low", "high", "max"] as const;
export type KimiEffort = (typeof KIMI_SUPPORTED_EFFORTS)[number];

/**
 * Models that advertise `support_efforts` in Kimi's model catalog. Keep in
 * sync with `kimiModels` above; only these accept KIMI_MODEL_THINKING_EFFORT.
 */
export const EFFORT_CAPABLE_MODELS = new Set<string>([
  DEFAULT_KIMI_LOCAL_MODEL,
  "kimi-code/k3",
  "kimi-code/k3-256k",
]);

export function modelSupportsEffort(model: string): boolean {
  return EFFORT_CAPABLE_MODELS.has(model.trim());
}

/**
 * Map a Paperclip effort value onto Kimi's supported thinking-effort set.
 * Returns null for values Kimi cannot honor so the caller leaves Kimi's own
 * default_effort in place instead of forwarding an invalid tier.
 */
export function resolveKimiThinkingEffort(effort: string): KimiEffort | null {
  const normalized = effort.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "medium") return "high";
  return (KIMI_SUPPORTED_EFFORTS as readonly string[]).includes(normalized)
    ? (normalized as KimiEffort)
    : null;
}
