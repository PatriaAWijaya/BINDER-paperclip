import { codexLocalReasoningEffortsForModel, isCodexLocalKnownModel } from "@paperclipai/shared";
import { claudeLocalReasoningEffortsForModel } from "@paperclipai/adapter-claude-local";
import { resolvePaperclipRunnerModel } from "@paperclipai/adapter-utils";
import { aiConnectionBindingSchema, aiRuntimeConnectionBindingSchema, agentHarnessType, type Agent, type IssueAssigneeAdapterOverrides } from "@paperclipai/shared";

export interface ComposerRunSettings {
  model: string | null;
  effort: string | null;
  fast: boolean;
}

export const DEFAULT_COMPOSER_RUN_SETTINGS: ComposerRunSettings = { model: null, effort: null, fast: false };
export const EFFORT_LABELS: Record<string, string> = {
  off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High",
  xhigh: "Extra High", max: "Max", ultra: "Ultra",
};

const MODEL_ADAPTERS = new Set([
  "claude_local", "opencode_local", "paperclip_runner",
]);

export function supportsComposerModel(agent: Agent | undefined): boolean {
  return Boolean(agent && MODEL_ADAPTERS.has(agent.adapterType)
    && !(agent.adapterType === "paperclip_runner" && agent.adapterConfig.provider === "muse"));
}

/** Resolve visible defaults; host environment and a local CLI's own config are unknown. */
export function composerDefaultModel(agent: Agent | undefined): string {
  if (!agent) return "";
  const config = agent.adapterConfig;
  const configured = typeof config.model === "string" ? config.model.trim() : "";
  if (configured) return configured;
  if (agent.adapterType === "claude_local") {
    const env = config.env && typeof config.env === "object" && !Array.isArray(config.env)
      ? config.env as Record<string, unknown> : {};
    // The server merges host env too, which may select a different model or
    // Bedrock/Vertex. Without an explicit agent setting, the default is unknown.
    return typeof env.ANTHROPIC_MODEL === "string" ? env.ANTHROPIC_MODEL.trim() : "";
  }
  if (agent.adapterType === "paperclip_runner") {
    const provider = composerCatalogProvider(agent);
    if (provider === "codex" || provider === "opencode") return resolvePaperclipRunnerModel(provider, config.model);
    if (provider === "acpx" && config.acpxAgent === "grok") return "grok-4.7";
    if (provider === "acpx" && config.acpxAgent === "kimi") return "";
    if (provider === "acpx" && config.acpxAgent !== "grok") return resolvePaperclipRunnerModel(provider, config.model);
  }
  return "";
}

export function composerCatalogProvider(agent: Agent | undefined): string | undefined {
  if (!agent) return undefined;
  if (agent.adapterType === "paperclip_runner") return String(agent.adapterConfig.provider ?? "codex");
  if (agent.adapterType !== "opencode_local") return undefined;
  const binding = aiConnectionBindingSchema.safeParse(agent.runtimeConfig?.aiConnection).data;
  const configuredModel = agent.adapterConfig.model;
  return binding?.provider === "openrouter" || typeof configuredModel === "string" && configuredModel.startsWith("openrouter/")
    ? "openrouter" : undefined;
}

export function composerEfforts(agent: Agent | undefined, model: string, catalogIds: readonly string[]): readonly string[] {
  if (!agent) return [];
  const effectiveModel = model.trim() || "";
  if (!effectiveModel) return [];
  const pool = aiRuntimeConnectionBindingSchema.safeParse(agent.runtimeConfig?.aiConnection).data?.mode === "router";
  if (pool && agent.adapterType === "paperclip_runner") return isCodexLocalKnownModel(effectiveModel) ? codexLocalReasoningEffortsForModel(effectiveModel) : /^claude-/.test(effectiveModel) ? claudeLocalReasoningEffortsForModel(effectiveModel) : [];
  if (agent.adapterType === "paperclip_runner" && composerCatalogProvider(agent) === "codex") {
    return isCodexLocalKnownModel(effectiveModel) ? codexLocalReasoningEffortsForModel(effectiveModel) : [];
  }
  if (!catalogIds.includes(effectiveModel)) return [];
  if (agentHarnessType(agent.adapterType, agent.adapterConfig) === "claude_local") return claudeLocalReasoningEffortsForModel(effectiveModel);
  return [];
}

export function composerFastAvailable(agent: Agent | undefined, model: string): boolean {
  // Fast mode was codex_local-only; the Paperclip Runner drops fastMode from
  // its config, so no kept adapter offers it.
  return false;
}

export function readComposerRunSettings(overrides: IssueAssigneeAdapterOverrides | null | undefined, adapterType: string | undefined): ComposerRunSettings {
  const config = overrides?.adapterConfig ?? {};
  const effortKey = composerEffortKey(adapterType);
  const effortValue = effortKey && (config[effortKey]
    ?? (adapterType === "paperclip_runner" ? config.reasoningEffort ?? config.effort : undefined));
  return {
    model: typeof config.model === "string" ? config.model : null,
    effort: typeof effortValue === "string" ? effortValue : null,
    fast: false,
  };
}

function composerEffortKey(adapterType: string | undefined): string | null {
  if (adapterType === "paperclip_runner") return "modelReasoningEffort";
  if (adapterType === "claude_local") return "effort";
  if (adapterType === "opencode_local") return "variant";
  return null;
}

export function mergeComposerRunSettings(
  previous: IssueAssigneeAdapterOverrides | null | undefined,
  adapterType: string | undefined,
  settings: ComposerRunSettings,
  reassigned = false,
): IssueAssigneeAdapterOverrides | null {
  const config = { ...(reassigned ? {} : previous?.adapterConfig) };
  delete config.model;
  delete config.modelReasoningEffort;
  delete config.reasoningEffort;
  delete config.effort;
  delete config.thinking;
  delete config.variant;
  delete config.fastMode;
  if (settings.model) config.model = settings.model;
  const effortKey = composerEffortKey(adapterType);
  if (settings.effort && effortKey) config[effortKey] = settings.effort;
  const useProjectWorkspace = reassigned ? undefined : previous?.useProjectWorkspace;
  return Object.keys(config).length || useProjectWorkspace !== undefined
    ? { ...(Object.keys(config).length ? { adapterConfig: config } : {}), ...(useProjectWorkspace !== undefined ? { useProjectWorkspace } : {}) }
    : null;
}
