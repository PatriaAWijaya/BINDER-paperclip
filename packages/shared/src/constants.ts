export const COMPANY_STATUSES = ["active", "paused", "archived"] as const;
export const ISSUE_SUMMARIES_MAX_IDS = 5;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const DEPLOYMENT_MODES = ["local_trusted", "authenticated"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const DEPLOYMENT_EXPOSURES = ["private", "public"] as const;
export type DeploymentExposure = (typeof DEPLOYMENT_EXPOSURES)[number];

export const BIND_MODES = ["loopback", "lan", "tailnet", "custom"] as const;
export type BindMode = (typeof BIND_MODES)[number];

export const AUTH_BASE_URL_MODES = ["auto", "explicit"] as const;
export type AuthBaseUrlMode = (typeof AUTH_BASE_URL_MODES)[number];

export const AGENT_STATUSES = [
  "active",
  "paused",
  "idle",
  "running",
  "error",
  "pending_approval",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ADAPTER_TYPES = [
  "process",
  "http",
  "claude_local",
  "paperclip_runner",
  "opencode_local",
] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number] | (string & {});

export const AGENT_ROLES = [
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "security",
  "engineer",
  "designer",
  "pm",
  "qa",
  "devops",
  "researcher",
  "general",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO",
  cto: "CTO",
  cmo: "CMO",
  cfo: "CFO",
  security: "Security",
  engineer: "Engineer",
  designer: "Designer",
  pm: "PM",
  qa: "QA",
  devops: "DevOps",
  researcher: "Researcher",
  general: "General",
};

export const AGENT_DEFAULT_MAX_CONCURRENT_RUNS = 20;
export const WORKSPACE_BRANCH_ROUTINE_VARIABLE = "workspaceBranch";

// Config keys owned by Paperclip/company state rather than one concrete adapter.
// `paperclipSkillSync` is persisted in adapterConfig but must survive adapter swaps.
export const ADAPTER_AGNOSTIC_KEYS = [
  "env",
  "promptTemplate",
  "instructionsFilePath",
  "cwd",
  "timeoutSec",
  "graceSec",
  "bootstrapPromptTemplate",
  "paperclipSkillSync",
] as const;
export type AdapterAgnosticKey = (typeof ADAPTER_AGNOSTIC_KEYS)[number];

export const AGENT_ICON_NAMES = [
  "bot",
  "cpu",
  "brain",
  "zap",
  "rocket",
  "code",
  "terminal",
  "shield",
  "eye",
  "search",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "star",
  "heart",
  "flame",
  "bug",
  "cog",
  "database",
  "globe",
  "lock",
  "mail",
  "message-square",
  "file-code",
  "git-branch",
  "package",
  "puzzle",
  "target",
  "wand",
  "atom",
  "circuit-board",
  "radar",
  "swords",
  "telescope",
  "microscope",
  "crown",
  "gem",
  "hexagon",
  "pentagon",
  "fingerprint",
] as const;
export type AgentIconName = (typeof AGENT_ICON_NAMES)[number];

/**
 * Curated Lucide icon set for projects (PAP-68 part 3).
 *
 * The first entry, `"folder"`, is the default for any project without an
 * explicit icon. The remaining entries reuse much of the agent icon set plus a
 * handful of folder/structure icons that read well at small tile sizes.
 */
export const PROJECT_ICON_NAMES = [
  "folder",
  "rocket",
  "code",
  "terminal",
  "database",
  "globe",
  "package",
  "boxes",
  "box",
  "layers",
  "briefcase",
  "compass",
  "target",
  "flame",
  "zap",
  "star",
  "bug",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "shield",
  "lock",
  "search",
  "cog",
  "brain",
  "cpu",
  "git-branch",
  "file-code",
  "puzzle",
  "gem",
  "atom",
  "heart",
  "mail",
  "message-square",
  "crown",
  "radar",
  "telescope",
  "hexagon",
] as const;
export type ProjectIconName = (typeof PROJECT_ICON_NAMES)[number];

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Read-only task presentation. Monitoring never grants execution authority. */
export const ISSUE_DISPLAY_STATUSES = [
  "backlog", "todo", "in_progress", "monitoring", "in_review", "done", "blocked", "cancelled",
] as const;
export type IssueDisplayStatus = (typeof ISSUE_DISPLAY_STATUSES)[number];

export const INBOX_MINE_ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
] as const;
export const INBOX_MINE_ISSUE_STATUS_FILTER = INBOX_MINE_ISSUE_STATUSES.join(",");

export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export const ISSUE_REVIEW_POLICIES = ["anyone", "not_creator", "human_only"] as const;
export type IssueReviewPolicy = (typeof ISSUE_REVIEW_POLICIES)[number];
export const ISSUE_WORK_MODES = ["standard", "ask", "planning", "skill_test"] as const;
export type IssueWorkMode = (typeof ISSUE_WORK_MODES)[number];
export const ISSUE_HARNESS_KINDS = ["skill_test"] as const;
export type IssueHarnessKind = (typeof ISSUE_HARNESS_KINDS)[number];
export const MAX_ISSUE_REQUEST_DEPTH = 1024;
/**
 * Deepest task tree an agent (or automation acting for one) may create: a root
 * task plus one level of children. A deeper request is not rejected; the new
 * task is parented at this depth instead, as a sibling of the requester. Board
 * users are not limited, and existing deeper trees stay valid.
 */
export const MAX_AGENT_TASK_HIERARCHY_DEPTH = 2;

export const SUMMARY_SLOT_SCOPE_KINDS = [
  "project",
  "workspaces_overview",
  "project_workspace",
  "execution_workspace",
] as const;
export type SummarySlotScopeKind = (typeof SUMMARY_SLOT_SCOPE_KINDS)[number];
export const SUMMARY_SLOT_KEYS = ["header"] as const;
export type SummarySlotKey = (typeof SUMMARY_SLOT_KEYS)[number];
export const SUMMARY_SLOT_STATUSES = ["idle", "generating", "failed"] as const;
export type SummarySlotStatus = (typeof SUMMARY_SLOT_STATUSES)[number];

export const ISSUE_COMMENT_AUTHOR_TYPES = ["user", "agent", "system"] as const;
export type IssueCommentAuthorType = (typeof ISSUE_COMMENT_AUTHOR_TYPES)[number];

export const ISSUE_COMMENT_PRESENTATION_KINDS = ["message", "system_notice"] as const;
export type IssueCommentPresentationKind = (typeof ISSUE_COMMENT_PRESENTATION_KINDS)[number];

export const ISSUE_COMMENT_PRESENTATION_TONES = ["neutral", "info", "success", "warning", "danger"] as const;
export type IssueCommentPresentationTone = (typeof ISSUE_COMMENT_PRESENTATION_TONES)[number];

export const ISSUE_COMMENT_PRESENTATION_DENSITIES = ["compact"] as const;
export type IssueCommentPresentationDensity = (typeof ISSUE_COMMENT_PRESENTATION_DENSITIES)[number];

export const ISSUE_COMMENT_METADATA_ROW_TYPES = [
  "text",
  "code",
  "key_value",
  "issue_link",
  "agent_link",
  "run_link",
] as const;
export type IssueCommentMetadataRowType = (typeof ISSUE_COMMENT_METADATA_ROW_TYPES)[number];

export function clampIssueRequestDepth(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_ISSUE_REQUEST_DEPTH, Math.max(0, Math.floor(value)));
}

export const ISSUE_THREAD_INTERACTION_KINDS = [
  "suggest_tasks",
  "ask_user_questions",
  "request_confirmation",
  "request_checkbox_confirmation",
  "request_item_verdicts",
  "connection_intent",
] as const;
export type IssueThreadInteractionKind = (typeof ISSUE_THREAD_INTERACTION_KINDS)[number];

export const ISSUE_THREAD_INTERACTION_CANONICAL_RESOLVER_POLICIES = [
  "anyone",
  "not_creator",
  "human_only",
] as const;
export type IssueThreadInteractionCanonicalResolverPolicy =
  (typeof ISSUE_THREAD_INTERACTION_CANONICAL_RESOLVER_POLICIES)[number];

export const ISSUE_THREAD_INTERACTION_LEGACY_RESOLVER_POLICY_ALIASES = [
  "board_or_agents",
  "board_only",
] as const;
export type IssueThreadInteractionLegacyResolverPolicyAlias =
  (typeof ISSUE_THREAD_INTERACTION_LEGACY_RESOLVER_POLICY_ALIASES)[number];

/**
 * Accepted resolver-policy input values. New product surfaces should use the
 * canonical values; the two board-prefixed values remain write-compatible
 * aliases for one migration window.
 */
export const ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES = [
  ...ISSUE_THREAD_INTERACTION_CANONICAL_RESOLVER_POLICIES,
  ...ISSUE_THREAD_INTERACTION_LEGACY_RESOLVER_POLICY_ALIASES,
] as const;
export type IssueThreadInteractionResolverPolicy =
  (typeof ISSUE_THREAD_INTERACTION_RESOLVER_POLICIES)[number];

export const ISSUE_THREAD_INTERACTION_RESOLVER_POLICY_PROVENANCES = [
  "explicit",
  "inherited",
  "legacy_inherited_restriction",
] as const;
export type IssueThreadInteractionResolverPolicyProvenance =
  (typeof ISSUE_THREAD_INTERACTION_RESOLVER_POLICY_PROVENANCES)[number];

export const ISSUE_THREAD_INTERACTION_EFFECTIVE_RESOLVER_POLICY_SOURCES = [
  "requested",
  "company_cap",
  "governed_action",
] as const;
export type IssueThreadInteractionEffectiveResolverPolicySource =
  (typeof ISSUE_THREAD_INTERACTION_EFFECTIVE_RESOLVER_POLICY_SOURCES)[number];

export function normalizeIssueThreadInteractionResolverPolicy(
  policy: IssueThreadInteractionResolverPolicy,
): IssueThreadInteractionCanonicalResolverPolicy {
  if (policy === "board_or_agents") return "anyone";
  if (policy === "board_only") return "human_only";
  return policy;
}

export function legacyIssueThreadInteractionResolverPolicyAlias(
  policy: IssueThreadInteractionCanonicalResolverPolicy,
): IssueThreadInteractionLegacyResolverPolicyAlias | null {
  if (policy === "anyone") return "board_or_agents";
  if (policy === "human_only") return "board_only";
  return null;
}

export const REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT = 200;
export const REQUEST_ITEM_VERDICTS_ITEM_LIMIT = REQUEST_CHECKBOX_CONFIRMATION_OPTION_LIMIT;

export const ISSUE_THREAD_INTERACTION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "answered",
  "cancelled",
  "expired",
  "failed",
] as const;
export type IssueThreadInteractionStatus = (typeof ISSUE_THREAD_INTERACTION_STATUSES)[number];

export const ISSUE_THREAD_INTERACTION_CONTINUATION_POLICIES = [
  "none",
  "wake_assignee",
  "wake_assignee_on_accept",
] as const;
export type IssueThreadInteractionContinuationPolicy =
  (typeof ISSUE_THREAD_INTERACTION_CONTINUATION_POLICIES)[number];

export const TASK_WATCHDOG_PRODUCT_BUG_ORIGIN_KIND = "task_watchdog_product_bug";

// Marks the single onboarding "first task" so surfaces can special-case it
// (e.g. suppress the seeded-description bubble and rely on a seeded greeting).
export const ONBOARDING_FIRST_TASK_ORIGIN_KIND = "onboarding_first_task";

export const ISSUE_ORIGIN_KINDS = [
  "manual",
  "routine_execution",
  "stale_active_run_evaluation",
  "harness_liveness_escalation",
  // Historical origin only; automatic productivity reviews have been retired.
  "issue_productivity_review",
  "stranded_issue_recovery",
  "task_watchdog",
  TASK_WATCHDOG_PRODUCT_BUG_ORIGIN_KIND,
  ONBOARDING_FIRST_TASK_ORIGIN_KIND,
  "chat_channel",
] as const;
export type BuiltInIssueOriginKind = (typeof ISSUE_ORIGIN_KINDS)[number];
export type PluginIssueOriginKind = `plugin:${string}`;
export type IssueOriginKind = BuiltInIssueOriginKind | PluginIssueOriginKind;
export const ISSUE_WATCHDOG_DISCOVERY_KINDS = ["product_bug", "platform_bug"] as const;
export type IssueWatchdogDiscoveryKind = (typeof ISSUE_WATCHDOG_DISCOVERY_KINDS)[number];
export const ISSUE_SURFACE_VISIBILITIES = ["default", "plugin_operation"] as const;
export type IssueSurfaceVisibility = (typeof ISSUE_SURFACE_VISIBILITIES)[number];

export const ISSUE_RECOVERY_ACTION_KINDS = [
  "missing_disposition",
  "deliberate_wait_without_target",
  "stranded_assigned_issue",
  "workspace_validation",
  "configuration_validation",
  "active_run_watchdog",
  "issue_graph_liveness",
] as const;
export type IssueRecoveryActionKind = (typeof ISSUE_RECOVERY_ACTION_KINDS)[number];

export const ISSUE_DISPOSITION_REPAIR_RETRY_REASON = "issue_disposition_repair";

export const ISSUE_RECOVERY_ACTION_STATUSES = [
  "active",
  "escalated",
  "resolved",
  "cancelled",
] as const;
export type IssueRecoveryActionStatus = (typeof ISSUE_RECOVERY_ACTION_STATUSES)[number];

export const ISSUE_RECOVERY_ACTION_OWNER_TYPES = [
  "agent",
  "user",
  "board",
  "system",
] as const;
export type IssueRecoveryActionOwnerType = (typeof ISSUE_RECOVERY_ACTION_OWNER_TYPES)[number];

export const ISSUE_RECOVERY_ACTION_OUTCOMES = [
  "restored",
  "handed_back",
  "owner_completed",
  "delegated",
  "false_positive",
  "blocked",
  "escalated",
  "cancelled",
] as const;
export type IssueRecoveryActionOutcome = (typeof ISSUE_RECOVERY_ACTION_OUTCOMES)[number];

export function pluginOperationIssueOriginKind(pluginKey: string): PluginIssueOriginKind {
  return `plugin:${pluginKey}:operation`;
}

export function isPluginOperationIssueOriginKind(originKind: string | null | undefined): boolean {
  return typeof originKind === "string" && /^plugin:[^:]+:operation(?::|$)/.test(originKind);
}

export const ISSUE_RELATION_TYPES = ["blocks"] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];

export const ISSUE_TREE_CONTROL_MODES = ["pause", "resume", "cancel", "restore"] as const;
export type IssueTreeControlMode = (typeof ISSUE_TREE_CONTROL_MODES)[number];

export const ISSUE_TREE_HOLD_STATUSES = ["active", "released"] as const;
export type IssueTreeHoldStatus = (typeof ISSUE_TREE_HOLD_STATUSES)[number];

export const ISSUE_TREE_HOLD_RELEASE_POLICY_STRATEGIES = ["manual", "after_active_runs_finish"] as const;
export type IssueTreeHoldReleasePolicyStrategy = (typeof ISSUE_TREE_HOLD_RELEASE_POLICY_STRATEGIES)[number];

export const ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY = "continuation-summary" as const;
export const SYSTEM_ISSUE_DOCUMENT_KEYS = [
  ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  "pipeline-case-body",
] as const;
export type SystemIssueDocumentKey = (typeof SYSTEM_ISSUE_DOCUMENT_KEYS)[number];

const SYSTEM_ISSUE_DOCUMENT_KEY_SET = new Set<string>(SYSTEM_ISSUE_DOCUMENT_KEYS);

export function isSystemIssueDocumentKey(key: string): key is SystemIssueDocumentKey {
  return SYSTEM_ISSUE_DOCUMENT_KEY_SET.has(key);
}
export const ISSUE_REFERENCE_SOURCE_KINDS = ["title", "description", "comment", "document"] as const;
export type IssueReferenceSourceKind = (typeof ISSUE_REFERENCE_SOURCE_KINDS)[number];

export const DOCUMENT_ANNOTATION_THREAD_STATUSES = ["open", "resolved"] as const;
export type DocumentAnnotationThreadStatus = (typeof DOCUMENT_ANNOTATION_THREAD_STATUSES)[number];

export const DOCUMENT_ANNOTATION_ANCHOR_STATES = ["active", "stale", "orphaned"] as const;
export type DocumentAnnotationAnchorState = (typeof DOCUMENT_ANNOTATION_ANCHOR_STATES)[number];

export const DOCUMENT_ANNOTATION_ANCHOR_CONFIDENCES = [
  "exact",
  "duplicate",
  "fuzzy",
  "ambiguous",
  "missing",
] as const;
export type DocumentAnnotationAnchorConfidence =
  (typeof DOCUMENT_ANNOTATION_ANCHOR_CONFIDENCES)[number];

export const EXTERNAL_OBJECT_STATUS_CATEGORIES = [
  "unknown",
  "open",
  "waiting",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "closed",
  "archived",
  "auth_required",
  "unreachable",
] as const;
export type ExternalObjectStatusCategory = (typeof EXTERNAL_OBJECT_STATUS_CATEGORIES)[number];

export const EXTERNAL_OBJECT_STATUS_TONES = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
  "muted",
] as const;
export type ExternalObjectStatusTone = (typeof EXTERNAL_OBJECT_STATUS_TONES)[number];

export const EXTERNAL_OBJECT_LIVENESS_STATES = [
  "unknown",
  "fresh",
  "stale",
  "auth_required",
  "rate_limited",
  "unreachable",
] as const;
export type ExternalObjectLivenessState = (typeof EXTERNAL_OBJECT_LIVENESS_STATES)[number];

export const EXTERNAL_OBJECT_MENTION_SOURCE_KINDS = [
  "title",
  "description",
  "comment",
  "document",
  "property",
  "plugin",
] as const;
export type ExternalObjectMentionSourceKind = (typeof EXTERNAL_OBJECT_MENTION_SOURCE_KINDS)[number];

export const EXTERNAL_OBJECT_MENTION_CONFIDENCES = ["exact", "likely", "possible"] as const;
export type ExternalObjectMentionConfidence = (typeof EXTERNAL_OBJECT_MENTION_CONFIDENCES)[number];

export const ISSUE_EXECUTION_POLICY_MODES = ["normal", "auto"] as const;
export type IssueExecutionPolicyMode = (typeof ISSUE_EXECUTION_POLICY_MODES)[number];

export const ISSUE_EXECUTION_STAGE_TYPES = ["review", "approval"] as const;
export type IssueExecutionStageType = (typeof ISSUE_EXECUTION_STAGE_TYPES)[number];

export const ISSUE_MONITOR_SCHEDULED_BY = ["assignee", "board"] as const;
export type IssueMonitorScheduledBy = (typeof ISSUE_MONITOR_SCHEDULED_BY)[number];

export const ISSUE_EXECUTION_MONITOR_KINDS = ["external_service"] as const;
export type IssueExecutionMonitorKind = (typeof ISSUE_EXECUTION_MONITOR_KINDS)[number];

export const PROVIDER_QUOTA_MONITOR_SERVICE_NAME = "AI provider quota";

export const ISSUE_EXECUTION_MONITOR_RECOVERY_POLICIES = [
  "wake_owner",
  "create_recovery_issue",
  "escalate_to_board",
] as const;
export type IssueExecutionMonitorRecoveryPolicy =
  (typeof ISSUE_EXECUTION_MONITOR_RECOVERY_POLICIES)[number];

export const ISSUE_EXECUTION_STATE_STATUSES = ["idle", "pending", "changes_requested", "completed"] as const;
export type IssueExecutionStateStatus = (typeof ISSUE_EXECUTION_STATE_STATUSES)[number];

export const ISSUE_EXECUTION_MONITOR_STATE_STATUSES = ["scheduled", "triggered", "cleared"] as const;
export type IssueExecutionMonitorStateStatus = (typeof ISSUE_EXECUTION_MONITOR_STATE_STATUSES)[number];

export const ISSUE_EXECUTION_MONITOR_CLEAR_REASONS = [
  "manual",
  "triggered",
  "done",
  "cancelled",
  "invalid_status",
  "invalid_assignee",
  "dispatch_skipped",
  "timeout_exceeded",
  "max_attempts_exhausted",
] as const;
export type IssueExecutionMonitorClearReason = (typeof ISSUE_EXECUTION_MONITOR_CLEAR_REASONS)[number];

export const ISSUE_EXECUTION_DECISION_OUTCOMES = ["approved", "changes_requested"] as const;
export type IssueExecutionDecisionOutcome = (typeof ISSUE_EXECUTION_DECISION_OUTCOMES)[number];

export const GOAL_LEVELS = ["company", "team", "agent", "task"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export const GOAL_STATUSES = ["planned", "active", "achieved", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ENVIRONMENT_DRIVERS = ["local", "ssh", "sandbox", "plugin"] as const;
export type EnvironmentDriver = (typeof ENVIRONMENT_DRIVERS)[number];

export const ENVIRONMENT_STATUSES = ["active", "archived"] as const;
export type EnvironmentStatus = (typeof ENVIRONMENT_STATUSES)[number];

export const ENVIRONMENT_LEASE_STATUSES = ["active", "released", "expired", "failed", "retained", "pending_cleanup"] as const;
export type EnvironmentLeaseStatus = (typeof ENVIRONMENT_LEASE_STATUSES)[number];

export const ENVIRONMENT_LEASE_POLICIES = [
  "ephemeral",
  "reuse_by_environment",
  "reuse_by_execution_workspace",
  "retain_on_failure",
] as const;
export type EnvironmentLeasePolicy = (typeof ENVIRONMENT_LEASE_POLICIES)[number];

export const ENVIRONMENT_LEASE_CLEANUP_STATUSES = ["pending", "success", "failed"] as const;
export type EnvironmentLeaseCleanupStatus = (typeof ENVIRONMENT_LEASE_CLEANUP_STATUSES)[number];

export const ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_KINDS = [
  "snapshot",
  "image",
  "provider_template",
  "unknown",
] as const;
export type EnvironmentCustomImageTemplateKind = (typeof ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_KINDS)[number];

export const ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_STATUSES = [
  "active",
  "superseded",
  "revoked",
  "failed",
] as const;
export type EnvironmentCustomImageTemplateStatus = (typeof ENVIRONMENT_CUSTOM_IMAGE_TEMPLATE_STATUSES)[number];

export const ENVIRONMENT_CUSTOM_IMAGE_SETUP_SESSION_STATUSES = [
  "starting",
  "waiting_for_user",
  "capturing",
  "promoted",
  "cancelled",
  "timed_out",
  "failed",
] as const;
export type EnvironmentCustomImageSetupSessionStatus =
  (typeof ENVIRONMENT_CUSTOM_IMAGE_SETUP_SESSION_STATUSES)[number];

export const ENVIRONMENT_CUSTOM_IMAGE_SETUP_CONNECTION_TYPES = [
  "ssh",
  "browser_terminal",
  "unknown",
] as const;
export type EnvironmentCustomImageSetupConnectionType =
  (typeof ENVIRONMENT_CUSTOM_IMAGE_SETUP_CONNECTION_TYPES)[number];

export const ROUTINE_STATUSES = ["active", "paused", "archived"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export const ROUTINE_CONCURRENCY_POLICIES = ["coalesce_if_active", "always_enqueue", "skip_if_active"] as const;
export type RoutineConcurrencyPolicy = (typeof ROUTINE_CONCURRENCY_POLICIES)[number];

export const ROUTINE_CATCH_UP_POLICIES = ["skip_missed", "enqueue_missed_with_cap"] as const;
export type RoutineCatchUpPolicy = (typeof ROUTINE_CATCH_UP_POLICIES)[number];

export const ROUTINE_ACTIVITY_GATE_POLICIES = ["always", "require_external_activity"] as const;
export type RoutineActivityGatePolicy = (typeof ROUTINE_ACTIVITY_GATE_POLICIES)[number];

export const ROUTINE_ACTIVITY_GATE_SCOPES = ["company", "project"] as const;
export type RoutineActivityGateScope = (typeof ROUTINE_ACTIVITY_GATE_SCOPES)[number];

export const ROUTINE_TRIGGER_KINDS = ["schedule", "webhook", "api"] as const;
export type RoutineTriggerKind = (typeof ROUTINE_TRIGGER_KINDS)[number];

export const ROUTINE_TRIGGER_SIGNING_MODES = ["bearer", "app_webhook", "hmac_sha256", "github_hmac", "fireflies_hmac", "none"] as const;
export type RoutineTriggerSigningMode = (typeof ROUTINE_TRIGGER_SIGNING_MODES)[number];

export const ROUTINE_VARIABLE_TYPES = ["text", "textarea", "number", "boolean", "select", "date"] as const;
export type RoutineVariableType = (typeof ROUTINE_VARIABLE_TYPES)[number];

export const ROUTINE_RUN_STATUSES = [
  "received",
  "coalesced",
  "skipped",
  "issue_created",
  "completed",
  "failed",
 ] as const;
export type RoutineRunStatus = (typeof ROUTINE_RUN_STATUSES)[number];

export const ROUTINE_RUN_SOURCES = ["schedule", "manual", "api", "webhook"] as const;
export type RoutineRunSource = (typeof ROUTINE_RUN_SOURCES)[number];

// "import" marks agents parked by a company import (safety default) so the UI
// can explain the pause and offer a scoped bulk-resume; "system" remains the
// reason for platform-managed pauses (plugins, built-ins).
export const PAUSE_REASONS = ["manual", "budget", "system", "company_archived", "import", "setup"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export const PROJECT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
] as const;

export const APPROVAL_TYPES = [
  "hire_agent",
  "approve_ceo_strategy",
  "budget_override_required",
  "request_board_approval",
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "revision_requested",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SECRET_PROVIDERS = [
  "local_encrypted",
  "aws_secrets_manager",
  "gcp_secret_manager",
  "vault",
] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const SECRET_PROVIDER_CONFIG_STATUSES = [
  "ready",
  "warning",
  "coming_soon",
  "disabled",
] as const;
export type SecretProviderConfigStatus = (typeof SECRET_PROVIDER_CONFIG_STATUSES)[number];

export const SECRET_PROVIDER_CONFIG_HEALTH_STATUSES = [
  "ready",
  "warning",
  "error",
  "coming_soon",
  "disabled",
] as const;
export type SecretProviderConfigHealthStatus =
  (typeof SECRET_PROVIDER_CONFIG_HEALTH_STATUSES)[number];

export const SECRET_STATUSES = ["active", "disabled", "archived", "deleted"] as const;
export type SecretStatus = (typeof SECRET_STATUSES)[number];

export const SECRET_SCOPES = ["company", "user", "instance"] as const;
export type SecretScope = (typeof SECRET_SCOPES)[number];

export const SECRET_MANAGED_MODES = ["paperclip_managed", "external_reference"] as const;
export type SecretManagedMode = (typeof SECRET_MANAGED_MODES)[number];

export const SECRET_VERSION_STATUSES = [
  "current",
  "previous",
  "disabled",
  "destroyed",
  "failed",
] as const;
export type SecretVersionStatus = (typeof SECRET_VERSION_STATUSES)[number];

export const SECRET_BINDING_TARGET_TYPES = [
  "agent",
  "project",
  "environment",
  "routine",
  "plugin",
  "issue",
  "run",
  "tool_connection",
  "system",
] as const;
export type SecretBindingTargetType = (typeof SECRET_BINDING_TARGET_TYPES)[number];

export const SECRET_ACCESS_OUTCOMES = [
  "success",
  "failure",
  "missing",
  "inactive",
  "not_allowed",
  "optional_omitted",
  "provider_error",
] as const;
export type SecretAccessOutcome = (typeof SECRET_ACCESS_OUTCOMES)[number];

export const SECRET_PROJECTION_CLASSES = ["unclassified", "class_3_static_lease"] as const;
export type SecretProjectionClass = (typeof SECRET_PROJECTION_CLASSES)[number];

export const CLASS3_STATIC_LEASE_ALLOWLIST = [
  {
    key: "slack.bot_token",
    label: "Slack bot token",
    targetType: "agent",
    configPath: "env.SLACK_BOT_TOKEN",
    envKey: "SLACK_BOT_TOKEN",
  },
  {
    key: "slack.bot_token",
    label: "Slack bot token",
    targetType: "routine",
    configPath: "env.SLACK_BOT_TOKEN",
    envKey: "SLACK_BOT_TOKEN",
  },
  {
    key: "slack.bot_token",
    label: "Slack bot token governance connection",
    targetType: "tool_connection",
    configPath: "credentials.bot_token",
    envKey: "SLACK_BOT_TOKEN",
  },
  {
    key: "discord.bot_token",
    label: "Discord bot token",
    targetType: "agent",
    configPath: "env.DISCORD_BOT_TOKEN",
    envKey: "DISCORD_BOT_TOKEN",
  },
  {
    key: "discord.bot_token",
    label: "Discord bot token",
    targetType: "routine",
    configPath: "env.DISCORD_BOT_TOKEN",
    envKey: "DISCORD_BOT_TOKEN",
  },
  {
    key: "discord.bot_token",
    label: "Discord bot token governance connection",
    targetType: "tool_connection",
    configPath: "credentials.bot_token",
    envKey: "DISCORD_BOT_TOKEN",
  },
] as const;
export type Class3StaticLeaseAllowlistKey = (typeof CLASS3_STATIC_LEASE_ALLOWLIST)[number]["key"];

export const STORAGE_PROVIDERS = ["local_disk", "s3"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const BILLING_TYPES = [
  "metered_api",
  "subscription_included",
  "subscription_overage",
  "credits",
  "fixed",
  "unknown",
] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export const COST_STATUSES = ["reported", "estimated", "unpriced"] as const;
export type CostStatus = (typeof COST_STATUSES)[number];

export const FINANCE_EVENT_KINDS = [
  "inference_charge",
  "platform_fee",
  "credit_purchase",
  "credit_refund",
  "credit_expiry",
  "byok_fee",
  "gateway_overhead",
  "log_storage_charge",
  "logpush_charge",
  "provisioned_capacity_charge",
  "training_charge",
  "custom_model_import_charge",
  "custom_model_storage_charge",
  "manual_adjustment",
] as const;
export type FinanceEventKind = (typeof FINANCE_EVENT_KINDS)[number];

export const FINANCE_DIRECTIONS = ["debit", "credit"] as const;
export type FinanceDirection = (typeof FINANCE_DIRECTIONS)[number];

export const FINANCE_UNITS = [
  "input_token",
  "output_token",
  "cached_input_token",
  "request",
  "credit_usd",
  "credit_unit",
  "model_unit_minute",
  "model_unit_hour",
  "gb_month",
  "train_token",
  "unknown",
] as const;
export type FinanceUnit = (typeof FINANCE_UNITS)[number];

export const BUDGET_SCOPE_TYPES = ["company", "agent", "project"] as const;
export type BudgetScopeType = (typeof BUDGET_SCOPE_TYPES)[number];

export const BUDGET_METRICS = ["billed_cents"] as const;
export type BudgetMetric = (typeof BUDGET_METRICS)[number];

export const BUDGET_WINDOW_KINDS = ["calendar_month_utc", "lifetime"] as const;
export type BudgetWindowKind = (typeof BUDGET_WINDOW_KINDS)[number];

export const BUDGET_THRESHOLD_TYPES = ["soft", "hard"] as const;
export type BudgetThresholdType = (typeof BUDGET_THRESHOLD_TYPES)[number];

export const BUDGET_INCIDENT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type BudgetIncidentStatus = (typeof BUDGET_INCIDENT_STATUSES)[number];

export const BUDGET_INCIDENT_RESOLUTION_ACTIONS = [
  "keep_paused",
  "raise_budget_and_resume",
] as const;
export type BudgetIncidentResolutionAction = (typeof BUDGET_INCIDENT_RESOLUTION_ACTIONS)[number];

/**
 * BINDER funding (PRD Bab 3 / v1.16): pool top-up per company + amplop bid
 * per tugas + ledger kanonik. Angka-angka ini adalah pagu yang ditetapkan
 * owner dan bisa diubah owner kapan pun atas alasan strategis (PRD Bab 14);
 * konstanta di sini adalah nilai default, bukan nilai yang dikunci.
 */
// Default top-up bulanan pool per company: $20 (dalam sen).
export const BINDER_POOL_DEFAULT_MONTHLY_CENTS = 2000;
// Amplop bid per tugas: $5 s.d. $30 (dalam sen).
export const BINDER_ENVELOPE_MIN_CENTS = 500;
export const BINDER_ENVELOPE_MAX_CENTS = 3000;
// Ambang peringatan pool/amplop (P0-4): persen dana yang sudah terpakai.
export const BINDER_WARN_PERCENT_70 = 70;
export const BINDER_WARN_PERCENT_90 = 90;

/** Jenis pergerakan dana yang tercatat di ledger kanonik BINDER. */
export const BINDER_LEDGER_KINDS = [
  "top_up",
  "envelope_allocate",
  "usage",
  "qc_cost",
  "envelope_release",
  "adjustment",
  "rollover",
] as const;
export type BinderLedgerKind = (typeof BINDER_LEDGER_KINDS)[number];

/** Status amplop bid per tugas. */
export const BINDER_ENVELOPE_STATUSES = [
  "proposed",
  "approved",
  "active",
  "exhausted",
  "escalated",
  "closed",
  "cancelled",
] as const;
export type BinderEnvelopeStatus = (typeof BINDER_ENVELOPE_STATUSES)[number];

/** Status amplop yang masih hidup (satu amplop hidup per tugas). */
export const BINDER_ENVELOPE_LIVE_STATUSES = [
  "proposed",
  "approved",
  "active",
  "exhausted",
  "escalated",
] as const;
export type BinderEnvelopeLiveStatus = (typeof BINDER_ENVELOPE_LIVE_STATUSES)[number];

/**
 * BINDER alur task + QC (PRD Bab 6.4; rencana Tahap 3 Fase 3.3).
 * Mesin: Backlog → Todo → In Progress → In Review (QC) → Butuh Approval
 * Patria → Done/Cancelled; Revisi sesudah QC gagal (maks 2 putaran, lalu
 * eskalasi); Eskalasi = owner memutuskan langkah berikut.
 * Keluar dari In Review HANYA lewat submitQcScore, dan masuk ke In Review
 * HANYA lewat submitWorkForReview (wajib artifact utama) — transisi
 * generik menolak keduanya, supaya mesin tidak bisa dilompati.
 */
export const BINDER_TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "revision",
  "needs_owner_approval",
  "escalated",
  "done",
  "cancelled",
] as const;
export type BinderTaskStatus = (typeof BINDER_TASK_STATUSES)[number];

/** Transisi yang diizinkan antar status task BINDER. */
export const BINDER_TASK_TRANSITIONS: Record<BinderTaskStatus, readonly BinderTaskStatus[]> = {
  backlog: ["todo", "cancelled"],
  // 'todo' dari 'in_progress' ditambahkan Tahap 5 (TRD Bab 4 / PRD Bab 6.3):
  // VM timeout / job desktop gagal → task kembali ke Todo dengan catatan
  // gagal. Jalur generik (transitionBinderTask) tetap memeriksa admission
  // pendanaan saat masuk 'todo'; jalur kegagalan Sync (failDesktopJob)
  // memakai applyBinderTransition langsung — task sudah lolos admission
  // saat masuk In Progress, pengembalian karena gagal adalah pembukuan,
  // bukan pekerjaan baru.
  todo: ["in_progress", "cancelled"],
  in_progress: ["todo", "in_review", "cancelled"],
  in_review: ["needs_owner_approval", "revision", "escalated"],
  revision: ["in_progress", "cancelled"],
  needs_owner_approval: ["done", "revision", "escalated", "cancelled"],
  escalated: ["in_progress", "cancelled"],
  done: [],
  cancelled: [],
};

/**
 * Cermin status task BINDER ke status `issues` Paperclip (supaya board /
 * query yang sudah ada tetap jalan). 'revision' masih dikerjakan maker
 * (in_progress); 'needs_owner_approval' masih dalam review (in_review);
 * 'escalated' tertahan menunggu keputusan owner (blocked).
 */
export const BINDER_TASK_ISSUE_STATUS_MIRROR: Record<BinderTaskStatus, string> = {
  backlog: "backlog",
  todo: "todo",
  in_progress: "in_progress",
  in_review: "in_review",
  revision: "in_progress",
  needs_owner_approval: "in_review",
  escalated: "blocked",
  done: "done",
  cancelled: "cancelled",
};

/** Pemetaan kolom Kanban Patria. */
export const BINDER_TASK_KANBAN_COLUMNS: Record<string, readonly BinderTaskStatus[]> = {
  Antrian: ["backlog", "todo"],
  Dikerjakan: ["in_progress"],
  Revisi: ["revision"],
  "Butuh Approval": ["needs_owner_approval", "escalated"],
  Selesai: ["done"],
};

/** Rubrik QC (P0-3): Kebenaran/bukti 30, Kelengkapan 25, Kepatuhan 25, Kualitas 20. */
export const BINDER_QC_RUBRIC_MAX = {
  truthEvidence: 30,
  completeness: 25,
  compliance: 25,
  quality: 20,
} as const;
/** Skor minimal QC lolos: ≥ 75 + nol hard violation. */
export const BINDER_QC_PASS_SCORE = 75;
/** Maksimal putaran revisi QC: 2 — sesudah itu eskalasi ke owner. */
export const BINDER_QC_MAX_REVISIONS = 2;

/** Pelanggaran keras QC (P0-2): satu saja = QC gagal apa pun skornya. */
export const BINDER_HARD_VIOLATION_CODES = [
  "secret_in_packet",
  "external_action_without_approval",
  "cross_company_data",
  "private_content_in_shared_memory",
  "fabricated_evidence",
  "spending_beyond_hard_stop",
] as const;
export type BinderHardViolationCode = (typeof BINDER_HARD_VIOLATION_CODES)[number];

/** Family model agen — untuk aturan QC beda family (P0-1). */
export const BINDER_MODEL_FAMILIES = ["meta", "anthropic", "google", "openai", "other"] as const;
export type BinderModelFamily = (typeof BINDER_MODEL_FAMILIES)[number];

/** Jenis aksi eksternal yang butuh approved_action_id (P1-11). */
export const BINDER_APPROVED_ACTION_KINDS = [
  "outreach_send",
  "external_post",
  "external_call",
  "external_message",
  "other",
] as const;
export type BinderApprovedActionKind = (typeof BINDER_APPROVED_ACTION_KINDS)[number];

/**
 * Biaya default satu review QC: $1 (100 sen). Pagu owner — bisa diubah
 * kapan pun atas alasan strategis (PRD Bab 14); dibebankan ke pool,
 * BUKAN ke amplop tugas (P1-10). Nilai ini default sampai Patria
 * menetapkan harga review QC yang sebenarnya.
 */
export const BINDER_QC_REVIEW_COST_CENTS = 100;

/**
 * Sync Internal + Gate Internal BINDER (PRD Bab 6.3; TRD Bab 4–5;
 * Backend Schematic Bab 5.1 — kosong, lihat catatan di bawah; Rencana
 * Tahap 5). Sync adalah satu-satunya jembatan resmi BINDER ↔ Mesin
 * Desktop; Gate adalah fungsi penegak yang bisa diuji tanpa UI.
 *
 * CATATAN KONTRAK (celah dokumen, dilaporkan Tahap 5): Backend
 * Schematic v0.3 Bab 5.1 ("Sync Internal — operasi internal") dan Bab 5.2
 * ("Gate Internal — operasi internal") KOSONG — tidak ada tanda tangan
 * operasi di sana. Dokumen itu sendiri menyatakan antarmuka sebenarnya
 * "ditulis di adapter masing-masing setelah Gerbang Fase 0, dan tidak
 * boleh ditebak di sini sebagai endpoint upstream yang pasti". Maka
 * operasi di bawah ini diambil dari TRD Bab 4 (alur kontraktual +
 * ketahanan) + TRD Bab 3.3 (field wajib VMJob) + PRD Bab 6.3 (kontrak),
 * BUKAN dari tebakan endpoint upstream. Bila Bab 5.1/5.2 diisi kemudian,
 * konstanta dan validator ini dicocokkan ulang oleh Code Builder.
 */

/** Status job desktop (TRD Bab 3.3; PRD Bab 6.3). */
export const BINDER_DESKTOP_JOB_STATUSES = [
  "queued",
  "running",
  "need_approval",
  "done",
  "failed",
] as const;
export type BinderDesktopJobStatus = (typeof BINDER_DESKTOP_JOB_STATUSES)[number];

/**
 * Pemetaan status job desktop → status task BINDER (PRD Bab 6.4).
 * Status job TIDAK menggantikan status task — pemetaan ini hanya memberi
 * tahu status task apa yang sepadan; perubahan status task tetap lewat
 * mesin transisi BINDER (submitWorkForReview / failDesktopJob).
 * 'done' memetakan ke 'in_review' HANYA bila artifact kembali (aturan
 * ditegakkan fungsi pemeta, bukan konstanta ini — lihat
 * mapDesktopJobStatusToBinderTaskStatus di service Sync).
 */
export const BINDER_DESKTOP_JOB_STATUS_TO_BINDER_TASK: Record<
  BinderDesktopJobStatus,
  BinderTaskStatus
> = {
  queued: "todo",
  running: "in_progress",
  need_approval: "needs_owner_approval",
  done: "in_review",
  failed: "todo",
} as const;

/** Runtime Mesin Desktop (TRD Bab 3.3). 'test_double' = adapter palsu untuk uji — BUKAN VM nyata, tidak pernah dipakai di luar test. */
export const BINDER_DESKTOP_RUNTIMES = [
  "local_vm_docker_podman",
  "boat",
  "mac_patria_per_task",
  "test_double",
] as const;
export type BinderDesktopRuntime = (typeof BINDER_DESKTOP_RUNTIMES)[number];

/**
 * Jenis aksi eksternal yang dijaga Gate (TRD Bab 5). Semua jenis ini
 * WAJIB lewat Gate; tanpa `approved_action_id` yang valid, Gate menolak.
 */
export const BINDER_GATE_ACTION_KINDS = [
  "kirim",
  "publish",
  "bayar",
  "ubah_akses",
  "deploy",
  "tulis_eksternal",
  "hapus",
] as const;
export type BinderGateActionKind = (typeof BINDER_GATE_ACTION_KINDS)[number];

/**
 * Cakupan: `approved_action_id` jenis apa yang mengesahkan aksi Gate jenis
 * apa. Kosa kata keduanya BERBEDA (TRD Bab 5 memakai kirim/publish/bayar/
 * ubah_akses/deploy/tulis_eksternal/hapus; P1-11 memakai outreach_send/
 * external_post/external_call/external_message/other) dan TRD tidak
 * mendefinisikan pemetaannya — peta ini adalah keputusan Tahap 5,
 * konservatif: 'other' hanya mengesahkan bayar/ubah_akses/deploy/
 * tulis_eksternal/hapus (aksi yang tidak punya jenis P1-11 sendiri);
 * kirim/publish/tulis_eksternal dipetakan ke jenis P1-11 yang sepadan.
 * Bila TRD diperbarui dengan pemetaan resmi, peta ini diganti.
 */
export const BINDER_GATE_ACTION_TO_APPROVED_KINDS: Record<
  BinderGateActionKind,
  readonly BinderApprovedActionKind[]
> = {
  kirim: ["outreach_send", "external_message", "external_call"],
  publish: ["external_post"],
  bayar: ["other"],
  ubah_akses: ["other"],
  deploy: ["other"],
  tulis_eksternal: ["external_post", "external_message", "other"],
  hapus: ["other"],
} as const;

/**
 * Peran divisi untuk aturan tolak TRD Bab 5 (nilai kolom `agents.role`
 * yang disetel saat hire, Tahap 8). 'general' = tanpa aturan peran
 * khusus. Aturan: Leads Generator — SEMUA aksi eksternal ditolak di
 * Fase 1 tanpa pengecualian (walau ada approved_action_id); Finance —
 * bayar (tulis pembayaran/refund/trading) ditolak tanpa pengecualian;
 * Code Builder — deploy produksi tanpa persetujuan Patria ditolak
 * (persetujuan = approved_action_id yang valid; aturan umum Gate sudah
 * menolak tanpa id, jadi tidak ada cabang tambahan untuknya).
 */
export const BINDER_GATE_DIVISION_ROLES = ["leads", "finance", "code_builder"] as const;
export type BinderGateDivisionRole = (typeof BINDER_GATE_DIVISION_ROLES)[number];

/**
 * Versi kontrak adapter Sync Internal (pin versi SDK — PRD Bab 6.3 /
 * Rencana Tahap 5 poin 1). Adapter desktop WAJIB mendeklarasikan versi
 * ini; ketidakcocokan → Sync gagal aman (tidak ada job dibuat, tidak ada
 * aksi eksternal yang lolos). Dibaca ulang tiap upgrade adapter.
 */
export const BINDER_SYNC_ADAPTER_CONTRACT_VERSION = "1" as const;

/**
 * BINDER CEO Edison (PRD Bab 7; rencana Tahap 3 Fase 3.4, poin 5).
 * Satu owner, satu CEO untuk seluruh akun — CEO melayani semua company,
 * bukan satu CEO per company. Nama default CEO: Edison.
 * Model utama default Meta Muse Spark 1.3 via opencode_local → fallback
 * default Claude via claude_local (diputuskan Patria 7 Nov 2026 09:39 WIB).
 * Gemini + Codex NONAKTIF di konfigurasi aktif (bisa didaftarkan kembali
 * lewat Profil Model bila Patria memutuskan).
 *
 * KONFIGURASI BISA DIGANTI, BUKAN HARDCODE (DIPUTUSKAN Patria 8 Nov 2026
 * 07:22 WIB, syarat kebergunaan aplikasi; PRD v1.44 Bab 7): provider /
 * model / kunci-sebagai-referensi disimpan sebagai data konfigurasi dan
 * diganti lewat `registerCeo` / `updateCeoModel` — ganti model = ganti
 * konfigurasi, bukan ganti kode (pergantian tetap hanya di checkpoint).
 * Nilai di bawah ini adalah DEFAULT, bukan nilai yang dikunci di kode.
 * Kunci API TIDAK PERNAH disimpan sebagai nilai — hanya referensi env
 * pola `{env:NAMA_VAR}` (pola konfigurasi OpenCode); nilai kunci milik
 * user perorangan, dipasang user sendiri, tidak tercatat di log/artefak.
 * Runtime default sandbox; desktop hanya untuk verifikasi visual
 * strategi bila perlu. Budget token usulan $20/bulan — pagu owner, bisa
 * diubah kapan pun (PRD Bab 14).
 * Model id OpenCode memakai format provider/model ('meta/muse-spark-1.3'
 * — terbukti live Tahap 1 di MacBook via OpenCode).
 */
export const BINDER_CEO_NAME = "Edison";
export const BINDER_CEO_ROLE = "ceo";
export const BINDER_CEO_TITLE = "CEO/Orchestrator";
/** Adapter Paperclip untuk model utama CEO (Meta via OpenCode). */
export const BINDER_CEO_PRIMARY_ADAPTER_TYPE = "opencode_local";
export const BINDER_CEO_PRIMARY_MODEL_FAMILY = "meta" as const;
export const BINDER_CEO_PRIMARY_MODEL_ID = "muse-spark-1.3";
export const BINDER_CEO_PRIMARY_MODEL_OPENCODE = "meta/muse-spark-1.3";
/** Referensi kunci provider utama — placeholder env, BUKAN nilai kunci. */
export const BINDER_CEO_PRIMARY_API_KEY_REF = "{env:META_API_KEY}";
/** Adapter Paperclip untuk fallback CEO (Claude). */
export const BINDER_CEO_FALLBACK_ADAPTER_TYPE = "claude_local";
export const BINDER_CEO_FALLBACK_MODEL_FAMILY = "anthropic" as const;
export const BINDER_CEO_FALLBACK_MODEL_ID = "claude-sonnet-5-5";
/** Referensi kunci provider fallback — placeholder env, BUKAN nilai kunci. */
export const BINDER_CEO_FALLBACK_API_KEY_REF = "{env:ANTHROPIC_API_KEY}";
/** Runtime default CEO: sandbox (OpenSandbox; PRD Bab 6.2). */
export const BINDER_CEO_RUNTIME_DEFAULT = "sandbox";
/** Budget token usulan CEO: $20/bulan (dalam sen). */
export const BINDER_CEO_BUDGET_MONTHLY_CENTS = 2000;

/**
 * Provider yang bisa diuji via Test Connection hero (PRD Bab 7; rencana
 * Tahap 3 Fase 3.5). Hanya provider dengan endpoint daftar model publik
 * (GET /v1/models, tanpa biaya inferensi): Meta (api.meta.ai) dan
 * Anthropic (api.anthropic.com). Gemini/Codex menyusul bila Patria
 * memutuskan. Kunci TIDAK PERNAH disimpan — Test Connection memakai kunci
 * sementara sekali pakai, atau referensi `{env:NAMA_VAR}` yang sudah
 * terpasang di server (P1-24).
 */
export const BINDER_TEST_CONNECTION_PROVIDERS = ["meta", "anthropic"] as const;
export type BinderTestConnectionProvider = (typeof BINDER_TEST_CONNECTION_PROVIDERS)[number];
/** Batas waktu satu percobaan Test Connection (15 detik). */
export const BINDER_TEST_CONNECTION_TIMEOUT_MS = 15_000;

/**
 * Matriks konektor CEO (Rencana Tahap 3 poin 5): Allowed HANYA untuk baca
 * yang aman; Ask first untuk semua tulis dan aksi destruktif; Off untuk
 * yang tidak dibutuhkan — TANPA konektor kirim eksternal.
 * Kelas konektor adalah kosakata kebijakan BINDER menurut KEMAMPUAN
 * (bukan nama produk Paperclip), supaya matriks tetap berlaku apa pun
 * katalog konektor saat itu; pemetaan ke konektor konkret Paperclip
 * ditegakkan Gate Internal (Tahap 5).
 */
export const BINDER_CONNECTOR_MODES = ["allowed", "ask_first", "off"] as const;
export type BinderConnectorMode = (typeof BINDER_CONNECTOR_MODES)[number];
/** Kelas baca — satu-satunya yang boleh 'allowed'. */
export const BINDER_CONNECTOR_READ_CLASSES = [
  "workspace_read",
  "docs_read",
  "web_read",
] as const;
/** Kelas tulis/destruktif — 'ask_first' atau 'off', TIDAK BOLEH 'allowed'. */
export const BINDER_CONNECTOR_WRITE_CLASSES = [
  "workspace_write",
  "docs_write",
  "command_run",
  "destructive",
] as const;
/** Kelas kirim eksternal — WAJIB 'off' (CEO tanpa konektor kirim eksternal). */
export const BINDER_CONNECTOR_SEND_CLASSES = [
  "email_send",
  "external_message",
  "external_post",
  "outreach_send",
  "external_call",
] as const;
export const BINDER_CONNECTOR_CLASSES = [
  ...BINDER_CONNECTOR_READ_CLASSES,
  ...BINDER_CONNECTOR_WRITE_CLASSES,
  ...BINDER_CONNECTOR_SEND_CLASSES,
] as const;
export type BinderConnectorClass = (typeof BINDER_CONNECTOR_CLASSES)[number];
/** Matriks default CEO Edison (PRD Bab 7; Rencana Tahap 3 poin 5). */
export const BINDER_CEO_CONNECTOR_MATRIX: Record<BinderConnectorClass, BinderConnectorMode> = {
  workspace_read: "allowed",
  docs_read: "allowed",
  web_read: "allowed",
  workspace_write: "ask_first",
  docs_write: "ask_first",
  command_run: "ask_first",
  destructive: "ask_first",
  email_send: "off",
  external_message: "off",
  external_post: "off",
  outreach_send: "off",
  external_call: "off",
};

export const HEARTBEAT_INVOCATION_SOURCES = [
  "timer",
  "assignment",
  "on_demand",
  "automation",
] as const;
export type HeartbeatInvocationSource = (typeof HEARTBEAT_INVOCATION_SOURCES)[number];

export const WAKEUP_TRIGGER_DETAILS = ["manual", "ping", "callback", "system"] as const;
export type WakeupTriggerDetail = (typeof WAKEUP_TRIGGER_DETAILS)[number];

export const WAKEUP_REQUEST_STATUSES = [
  "queued",
  "deferred_issue_execution",
  "claimed",
  "coalesced",
  "skipped",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WakeupRequestStatus = (typeof WAKEUP_REQUEST_STATUSES)[number];

export const HEARTBEAT_RUN_STATUSES = [
  "queued",
  "scheduled_retry",
  "running",
  "succeeded",
  "interrupted",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type HeartbeatRunStatus = (typeof HEARTBEAT_RUN_STATUSES)[number];

export const RUN_LIVENESS_STATES = [
  "completed",
  "advanced",
  "plan_only",
  "empty_response",
  "blocked",
  "failed",
  "needs_followup",
] as const;
export type RunLivenessState = (typeof RUN_LIVENESS_STATES)[number];

export const LIVE_EVENT_TYPES = [
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "heartbeat.run.progress",
  "heartbeat.run.event",
  "heartbeat.run.log",
  "heartbeat.run.activity",
  "agent.session.goal.changed",
  "agent.status",
  "agent.runtime_state.updated",
  "activity.logged",
  "external_object.updated",
  "plugin.ui.updated",
  "plugin.worker.crashed",
  "plugin.worker.restarted",
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export const PRINCIPAL_TYPES = ["user", "agent"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const MEMBERSHIP_STATUSES = ["pending", "active", "suspended", "archived"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const COMPANY_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "operator",
  "viewer",
  "member",
] as const;
export type CompanyMembershipRole = (typeof COMPANY_MEMBERSHIP_ROLES)[number];

export const HUMAN_COMPANY_MEMBERSHIP_ROLES = [
  "owner",
  "admin",
  "operator",
  "viewer",
] as const;
export type HumanCompanyMembershipRole = (typeof HUMAN_COMPANY_MEMBERSHIP_ROLES)[number];

export const HUMAN_COMPANY_MEMBERSHIP_ROLE_LABELS: Record<HumanCompanyMembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

export const INSTANCE_USER_ROLES = ["instance_admin"] as const;
export type InstanceUserRole = (typeof INSTANCE_USER_ROLES)[number];

export const INVITE_TYPES = ["company_join", "bootstrap_ceo"] as const;
export type InviteType = (typeof INVITE_TYPES)[number];

export const INVITE_JOIN_TYPES = ["human", "agent", "both"] as const;
export type InviteJoinType = (typeof INVITE_JOIN_TYPES)[number];

export const JOIN_REQUEST_TYPES = ["human", "agent"] as const;
export type JoinRequestType = (typeof JOIN_REQUEST_TYPES)[number];

export const JOIN_REQUEST_STATUSES = ["pending_approval", "approved", "rejected"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

export const PERMISSION_KEYS = [
  "agents:create",
  "agents:read",
  "agents:configure",
  "agents:suggest-changes",
  "skills:create",
  "skills:suggest-changes",
  "environments:manage",
  "tools:admin",
  "tools:manage_connections",
  "tools:manage_profiles",
  "tools:view_audit",
  "audit:view_agent_actions",
  "commentary:view",
  "tools:use",
  "tools:manage_runtime",
  "inbox:manage",
  "users:invite",
  "users:manage_permissions",
  "tasks:assign",
  "tasks:assign_scope",
  "tasks:manage_active_checkouts",
  "joins:approve",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const TOOL_APPLICATION_TYPES = ["rest_api", "mcp_http", "mcp_stdio", "paperclip_plugin", "a2a", "chat"] as const;
export type ToolApplicationType = (typeof TOOL_APPLICATION_TYPES)[number];

export const TOOL_APPLICATION_STATUSES = ["draft", "active", "disabled", "archived"] as const;
export type ToolApplicationStatus = (typeof TOOL_APPLICATION_STATUSES)[number];

export const TOOL_CONNECTION_KINDS = ["managed"] as const;
export type ToolConnectionKind = (typeof TOOL_CONNECTION_KINDS)[number];

export const TOOL_CONNECTION_HEALTH_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "failed",
  "unchecked",
  "ok",
  "error",
  "missing_secret",
] as const;
export type ToolConnectionHealthStatus = (typeof TOOL_CONNECTION_HEALTH_STATUSES)[number];

/**
 * Health states that mean an app needs the user's attention (a bad/missing key
 * or a degraded connection). Single source of truth shared by the needs-
 * attention aggregation and the prosumer Apps surfaces so their counts agree.
 */
export const TOOL_CONNECTION_ATTENTION_HEALTH_STATUSES: readonly ToolConnectionHealthStatus[] = [
  "degraded",
  "failed",
  "error",
  "missing_secret",
];

export function isToolConnectionAttentionHealth(status: ToolConnectionHealthStatus): boolean {
  return TOOL_CONNECTION_ATTENTION_HEALTH_STATUSES.includes(status);
}

export const TOOL_CATALOG_ENTRY_KINDS = ["tool", "resource", "prompt"] as const;
export type ToolCatalogEntryKind = (typeof TOOL_CATALOG_ENTRY_KINDS)[number];

export const TOOL_CATALOG_ENTRY_STATUSES = ["active", "disabled", "quarantined", "removed"] as const;
export type ToolCatalogEntryStatus = (typeof TOOL_CATALOG_ENTRY_STATUSES)[number];

export const TOOL_RISK_LEVELS = ["low", "medium", "high", "critical", "read", "write", "destructive"] as const;
export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

export const TOOL_PROFILE_STATUSES = ["draft", "active", "disabled", "archived"] as const;
export type ToolProfileStatus = (typeof TOOL_PROFILE_STATUSES)[number];

export const TOOL_PROFILE_DEFAULT_ACTIONS = ["deny", "allow"] as const;
export type ToolProfileDefaultAction = (typeof TOOL_PROFILE_DEFAULT_ACTIONS)[number];

export const TOOL_PROFILE_ENTRY_SELECTOR_TYPES = [
  "application",
  "connection",
  "catalog_entry",
  "tool_name",
  "risk_level",
] as const;
export type ToolProfileEntrySelectorType = (typeof TOOL_PROFILE_ENTRY_SELECTOR_TYPES)[number];

export const TOOL_PROFILE_ENTRY_EFFECTS = ["include", "exclude"] as const;
export type ToolProfileEntryEffect = (typeof TOOL_PROFILE_ENTRY_EFFECTS)[number];

export const TOOL_PROFILE_BINDING_TARGET_TYPES = ["company", "agent", "project", "routine", "issue", "gateway"] as const;
export type ToolProfileBindingTargetType = (typeof TOOL_PROFILE_BINDING_TARGET_TYPES)[number];

export const TOOL_MCP_GATEWAY_STATUSES = ["draft", "active", "disabled", "archived"] as const;
export type ToolMcpGatewayStatus = (typeof TOOL_MCP_GATEWAY_STATUSES)[number];

export const TOOL_MCP_GATEWAY_DEFAULT_PROFILE_MODES = [
  "gateway_only",
  "inherit_context_then_gateway",
  "gateway_then_context",
] as const;
export type ToolMcpGatewayDefaultProfileMode = (typeof TOOL_MCP_GATEWAY_DEFAULT_PROFILE_MODES)[number];

export const TOOL_MCP_GATEWAY_CONTEXT_SCOPE_TYPES = [
  "none",
  "company",
  "project",
  "routine",
  "issue",
  "agent",
] as const;
export type ToolMcpGatewayContextScopeType = (typeof TOOL_MCP_GATEWAY_CONTEXT_SCOPE_TYPES)[number];

export const TOOL_MCP_GATEWAY_TOKEN_SUBJECT_TYPES = ["gateway_client", "heartbeat_run", "board_user", "agent"] as const;
export type ToolMcpGatewayTokenSubjectType = (typeof TOOL_MCP_GATEWAY_TOKEN_SUBJECT_TYPES)[number];

export const TOOL_MCP_GATEWAY_TOKEN_ACTIONS = [
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
] as const;
export type ToolMcpGatewayTokenAction = (typeof TOOL_MCP_GATEWAY_TOKEN_ACTIONS)[number];

export const CONNECTION_TOKEN_ISSUANCE_PATHS = ["exchange", "oauth_access", "static"] as const;
export type ConnectionTokenIssuancePath = (typeof CONNECTION_TOKEN_ISSUANCE_PATHS)[number];

export const CONNECTION_TOKEN_ISSUANCE_OUTCOMES = [
  "success",
  "denied",
  "rate_limited",
  "use_env_lease",
  "upstream_error",
  "failure",
] as const;
export type ConnectionTokenIssuanceOutcome = (typeof CONNECTION_TOKEN_ISSUANCE_OUTCOMES)[number];

export const TOOL_POLICY_TYPES = [
  "allow",
  "block",
  "require_approval",
  "trust_rule",
  "rate_limit",
] as const;
export type ToolPolicyType = (typeof TOOL_POLICY_TYPES)[number];

export const TOOL_POLICY_DECISIONS = ["allow", "deny", "require_approval", "rate_limited", "defer_runtime"] as const;
export type ToolPolicyDecision = (typeof TOOL_POLICY_DECISIONS)[number];

export const TOOL_INVOCATION_STATUSES = [
  "pending",
  "authorized",
  "denied",
  "awaiting_approval",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "rate_limited",
] as const;
export type ToolInvocationStatus = (typeof TOOL_INVOCATION_STATUSES)[number];

export const TOOL_INVOCATION_APPROVAL_STATES = [
  "not_required",
  "required",
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export type ToolInvocationApprovalState = (typeof TOOL_INVOCATION_APPROVAL_STATES)[number];

export const TOOL_ACTION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "executing",
  "rejected",
  "expired",
  "cancelled",
  "executed",
  "failed",
] as const;
export type ToolActionRequestStatus = (typeof TOOL_ACTION_REQUEST_STATUSES)[number];

export const TOOL_AUDIT_EVENT_TYPES = [
  "discovery",
  "policy_decision",
  "invocation_created",
  "call_started",
  "call_completed",
  "call_failed",
  "call_denied",
  "approval_requested",
  "approval_resolved",
  "session_revoked",
  "trust_rule_created",
  "trust_rule_revoked",
  "trust_rule_used",
  "runtime_started",
  "runtime_stopped",
  "rate_limited",
] as const;
export type ToolAuditEventType = (typeof TOOL_AUDIT_EVENT_TYPES)[number];

export const TOOL_AUDIT_OUTCOMES = ["pending", "success", "failure", "denied", "timeout", "cancelled"] as const;
export type ToolAuditOutcome = (typeof TOOL_AUDIT_OUTCOMES)[number];

/**
 * Connection-level lifecycle events surfaced on the per-app Activity tab
 * alongside tool-call events (PAP-11284). These are derived from the
 * company activity log rows scoped to a single tool connection.
 */
export const TOOL_CONNECTION_LIFECYCLE_EVENT_TYPES = [
  "app_connected",
  "app_paused",
  "app_resumed",
  "allowlist_changed",
  "reconnected",
  "disconnected",
  "actions_quarantined",
] as const;
export type ToolConnectionLifecycleEventType = (typeof TOOL_CONNECTION_LIFECYCLE_EVENT_TYPES)[number];

export const TOOL_RUNTIME_KINDS = ["remote_session", "local_stdio"] as const;
export type ToolRuntimeKind = (typeof TOOL_RUNTIME_KINDS)[number];

export const TOOL_RUNTIME_SLOT_STATUSES = ["starting", "running", "idle", "stopped", "failed", "disabled", "error"] as const;
export type ToolRuntimeSlotStatus = (typeof TOOL_RUNTIME_SLOT_STATUSES)[number];

export const TOOL_RATE_LIMIT_WINDOW_KINDS = ["minute", "hour", "day", "month"] as const;
export type ToolRateLimitWindowKind = (typeof TOOL_RATE_LIMIT_WINDOW_KINDS)[number];

export const TOOL_ACCESS_ACTIVITY_ACTIONS = [
  "tool_application.created",
  "tool_application.updated",
  "tool_application.archived",
  "tool_connection.created",
  "tool_connection.updated",
  "tool_connection.tested",
  "tool_connection.catalog_refreshed",
  "tool_profile.created",
  "tool_profile.updated",
  "tool_profile.duplicated",
  "tool_profile.deleted",
  "tool_profile.new_tools_reviewed",
  "tool_profile.bound",
  "tool_profile.unbound",
  "tool_policy.created",
  "tool_policy.updated",
  "tool_policy.disabled",
  "tool_trust_rule.created",
  "tool_trust_rule.revoked",
  "tool_runtime_slot.started",
  "tool_runtime_slot.stopped",
  "tool_action_request.created",
  "tool_action_request.resolved",
] as const;
export type ToolAccessActivityAction = (typeof TOOL_ACCESS_ACTIVITY_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Plugin System — see doc/plugins/PLUGIN_SPEC.md for the full specification
// ---------------------------------------------------------------------------

/**
 * The current version of the Plugin API contract.
 *
 * Increment this value whenever a breaking change is made to the plugin API
 * so that the host can reject incompatible plugin manifests.
 *
 * @see PLUGIN_SPEC.md §4 — Versioning
 */
export const PLUGIN_API_VERSION = 1 as const;

/**
 * Lifecycle statuses for an installed plugin.
 *
 * State machine: installed → ready | error, ready → disabled | error | upgrade_pending | uninstalled,
 * disabled → ready | uninstalled, error → ready | uninstalled,
 * upgrade_pending → ready | error | uninstalled, uninstalled → installed (reinstall).
 *
 * @see {@link PluginStatus} — inferred union type
 * @see PLUGIN_SPEC.md §21.3 `plugins.status`
 */
export const PLUGIN_STATUSES = [
  "installed",
  "ready",
  "disabled",
  "error",
  "upgrade_pending",
  "uninstalled",
] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/**
 * Plugin classification categories. A plugin declares one or more categories
 * in its manifest to describe its primary purpose.
 *
 * @see PLUGIN_SPEC.md §6.2
 */
export const PLUGIN_CATEGORIES = [
  "connector",
  "workspace",
  "automation",
  "ui",
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/**
 * Named permissions the host grants to a plugin. Plugins declare required
 * capabilities in their manifest; the host enforces them at runtime via the
 * plugin capability validator.
 *
 * Grouped into: Data Read, Data Write, Plugin State, Runtime/Integration,
 * Agent Tools, and UI.
 *
 * @see PLUGIN_SPEC.md §15 — Capability Model
 */
export const PLUGIN_CAPABILITIES = [
  "ai.connections.route",
  // Data Read
  "companies.read",
  "projects.read",
  "projects.instance-secrets",
  "projects.git-credentials",
  "project.workspaces.read",
  "execution.workspaces.read",
  "workspaces.manage",
  "issues.read",
  "issue.relations.read",
  "issue.subtree.read",
  "issue.comments.read",
  // Read pending issue-thread interactions (decision cards) on an issue.
  "issue.interactions.read",
  // Read issue attachment metadata and, via the capability-scoped host
  // bridge, attachment content bytes (bytes-only, company-scoped, audit-logged).
  "issue.attachments.read",
  // Read company approvals (list + get). The host redacts approval payloads to
  // match the web app's own approval read surface.
  "approvals.read",
  "issue.documents.read",
  "agents.read",
  "agents.lifecycle.manage",
  "goals.read",
  "goals.create",
  "goals.update",
  "activity.read",
  "costs.read",
  "issues.orchestration.read",
  "access.members.read",
  "access.invites.read",
  "authorization.grants.read",
  "authorization.policies.read",
  "authorization.audit.read",
  "database.namespace.read",
  // Data Write
  "issues.create",
  "issues.update",
  "issue.relations.write",
  "issues.checkout",
  "issues.wakeup",
  "issue.comments.create",
  "issue.comments.create_human_attributed",
  "issue.interactions.create",
  // Respond to (accept/reject) an issue-thread interaction on behalf of a
  // paired board user. Impersonation surface: the host independently
  // re-verifies the actor is an active human member of the company at apply
  // time (never trusts plugin-supplied identity), matching the web app's
  // board-only interaction resolve route.
  "issue.interactions.respond",
  // Decide (approve/reject) a company approval on behalf of a paired board
  // user. Same apply-time active-human-member re-verification as above; the
  // web app's approval decision routes are board-only.
  "approvals.respond",
  "issue.documents.write",
  "projects.managed",
  "routines.managed",
  "skills.managed",
  "agents.pause",
  "agents.resume",
  "agents.invoke",
  "agents.managed",
  "access.members.write",
  "access.invites.write",
  "authorization.grants.write",
  "authorization.policies.write",
  "agent.sessions.create",
  "agent.sessions.list",
  "agent.sessions.send",
  "agent.sessions.close",
  "activity.log.write",
  "metrics.write",
  "telemetry.track",
  "database.namespace.migrate",
  "database.namespace.write",
  "external.objects.detect",
  "external.objects.read",
  "external.objects.write",
  "external.objects.refresh",
  // Plugin State
  "plugin.state.read",
  "plugin.state.write",
  // Runtime / Integration
  "events.subscribe",
  "events.emit",
  "jobs.schedule",
  "webhooks.receive",
  "api.routes.register",
  "http.outbound",
  "secrets.read-ref",
  "environment.drivers.register",
  "local.folders",
  // Agent Tools
  "agent.tools.register",
  // UI
  "instance.settings.register",
  "ui.sidebar.register",
  "ui.page.register",
  "ui.detailTab.register",
  "ui.dashboardWidget.register",
  "ui.commentAnnotation.register",
  "ui.action.register",
] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_DATABASE_NAMESPACE_MODES = ["schema"] as const;
export type PluginDatabaseNamespaceMode = (typeof PLUGIN_DATABASE_NAMESPACE_MODES)[number];

export const PLUGIN_DATABASE_NAMESPACE_STATUSES = [
  "active",
  "migration_failed",
] as const;
export type PluginDatabaseNamespaceStatus = (typeof PLUGIN_DATABASE_NAMESPACE_STATUSES)[number];

export const PLUGIN_DATABASE_MIGRATION_STATUSES = [
  "applied",
  "failed",
] as const;
export type PluginDatabaseMigrationStatus = (typeof PLUGIN_DATABASE_MIGRATION_STATUSES)[number];

export const PLUGIN_DATABASE_CORE_READ_TABLES = [
  "companies",
  "projects",
  "goals",
  "agents",
  "issues",
  "issue_documents",
  "issue_relations",
  "issue_comments",
  "heartbeat_runs",
  "cost_events",
  "approvals",
  "issue_approvals",
  "budget_incidents",
] as const;
export type PluginDatabaseCoreReadTable = (typeof PLUGIN_DATABASE_CORE_READ_TABLES)[number];

export const PLUGIN_API_ROUTE_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export type PluginApiRouteMethod = (typeof PLUGIN_API_ROUTE_METHODS)[number];

export const PLUGIN_API_ROUTE_AUTH_MODES = ["board", "agent", "board-or-agent", "webhook"] as const;
export type PluginApiRouteAuthMode = (typeof PLUGIN_API_ROUTE_AUTH_MODES)[number];

export const PLUGIN_API_ROUTE_CHECKOUT_POLICIES = [
  "none",
  "required-for-agent-in-progress",
  "always-for-agent",
] as const;
export type PluginApiRouteCheckoutPolicy = (typeof PLUGIN_API_ROUTE_CHECKOUT_POLICIES)[number];

/**
 * UI extension slot types. Each slot type corresponds to a mount point in the
 * Paperclip UI where plugin components can be rendered.
 *
 * @see PLUGIN_SPEC.md §19 — UI Extension Model
 */
export const PLUGIN_UI_SLOT_TYPES = [
  "page",
  "detailTab",
  "taskDetailView",
  "dashboardWidget",
  "sidebar",
  "routeSidebar",
  "sidebarPanel",
  "projectSidebarItem",
  "globalToolbarButton",
  "appShellOverlay",
  "organizationSwitcher",
  "toolbarButton",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "settingsPage",
  "companySettingsPage",
] as const;
export type PluginUiSlotType = (typeof PLUGIN_UI_SLOT_TYPES)[number];

export const WORKSPACE_OVERVIEW_DEFAULT_LIMIT = 50;
export const HEARTBEAT_RUN_LIST_DEFAULT_LIMIT = 200;
export const HEARTBEAT_RUN_LIST_MAX_LIMIT = 1000;
export const WORKSPACE_OVERVIEW_MAX_LIMIT = 100;
export const WORKSPACE_OVERVIEW_LINKED_ISSUE_LIMIT = 4;

/**
 * Reserved company-scoped route segments that plugin page routes may not claim.
 *
 * These map to first-class host pages under `/:companyPrefix/...`.
 */
export const PLUGIN_RESERVED_COMPANY_ROUTE_SEGMENTS = [
  "dashboard",
  "onboarding",
  "companies",
  "company",
  "settings",
  "plugins",
  "org",
  "agents",
  "projects",
  "issues",
  "goals",
  "approvals",
  "costs",
  "activity",
  "inbox",
  "workspaces",
  "design-guide",
  "tests",
] as const;
export type PluginReservedCompanyRouteSegment =
  (typeof PLUGIN_RESERVED_COMPANY_ROUTE_SEGMENTS)[number];

/**
 * Reserved route segments under `/:companyPrefix/company/settings/...` that
 * plugin company settings pages may not claim.
 */
export const PLUGIN_RESERVED_COMPANY_SETTINGS_ROUTE_SEGMENTS = [
  "general",
  "environments",
  "access",
  "members",
  "invites",
  "secrets",
  "instance",
] as const;
export type PluginReservedCompanySettingsRouteSegment =
  (typeof PLUGIN_RESERVED_COMPANY_SETTINGS_ROUTE_SEGMENTS)[number];

/**
 * Launcher placement zones describe where a plugin-owned launcher can appear
 * in the host UI. These are intentionally aligned with current slot surfaces
 * so manifest authors can describe launch intent without coupling to a single
 * component implementation detail.
 */
export const PLUGIN_LAUNCHER_PLACEMENT_ZONES = [
  "page",
  "detailTab",
  "taskDetailView",
  "dashboardWidget",
  "sidebar",
  "sidebarPanel",
  "projectSidebarItem",
  "globalToolbarButton",
  "toolbarButton",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "settingsPage",
] as const;
export type PluginLauncherPlacementZone = (typeof PLUGIN_LAUNCHER_PLACEMENT_ZONES)[number];

/**
 * Launcher action kinds describe what the launcher does when activated.
 */
export const PLUGIN_LAUNCHER_ACTIONS = [
  "navigate",
  "openModal",
  "openDrawer",
  "openPopover",
  "performAction",
  "deepLink",
] as const;
export type PluginLauncherAction = (typeof PLUGIN_LAUNCHER_ACTIONS)[number];

/**
 * Optional size hints the host can use when rendering plugin-owned launcher
 * destinations such as overlays, drawers, or full page handoffs.
 */
export const PLUGIN_LAUNCHER_BOUNDS = [
  "inline",
  "compact",
  "default",
  "wide",
  "full",
] as const;
export type PluginLauncherBounds = (typeof PLUGIN_LAUNCHER_BOUNDS)[number];

/**
 * Render environments describe the container a launcher expects after it is
 * activated. The current host may map these to concrete UI primitives.
 */
export const PLUGIN_LAUNCHER_RENDER_ENVIRONMENTS = [
  "hostInline",
  "hostOverlay",
  "hostRoute",
  "external",
  "iframe",
] as const;
export type PluginLauncherRenderEnvironment =
  (typeof PLUGIN_LAUNCHER_RENDER_ENVIRONMENTS)[number];

/**
 * Entity types that a `detailTab` UI slot can attach to.
 *
 * @see PLUGIN_SPEC.md §19.3 — Detail Tabs
 */
export const PLUGIN_UI_SLOT_ENTITY_TYPES = [
  "project",
  "issue",
  "agent",
  "goal",
  "run",
  "comment",
  "execution_workspace",
  "project_workspace",
] as const;
export type PluginUiSlotEntityType = (typeof PLUGIN_UI_SLOT_ENTITY_TYPES)[number];

/**
 * Scope kinds for plugin state storage. Determines the granularity at which
 * a plugin stores key-value state data.
 *
 * @see PLUGIN_SPEC.md §21.3 `plugin_state.scope_kind`
 */
export const PLUGIN_STATE_SCOPE_KINDS = [
  "instance",
  "company",
  "project",
  "project_workspace",
  "agent",
  "issue",
  "goal",
  "run",
] as const;
export type PluginStateScopeKind = (typeof PLUGIN_STATE_SCOPE_KINDS)[number];

/** Statuses for a plugin's scheduled job definition. */
export const PLUGIN_JOB_STATUSES = [
  "active",
  "paused",
  "failed",
] as const;
export type PluginJobStatus = (typeof PLUGIN_JOB_STATUSES)[number];

/** Statuses for individual job run executions. */
export const PLUGIN_JOB_RUN_STATUSES = [
  "pending",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type PluginJobRunStatus = (typeof PLUGIN_JOB_RUN_STATUSES)[number];

/** What triggered a particular job run. */
export const PLUGIN_JOB_RUN_TRIGGERS = [
  "schedule",
  "manual",
  "retry",
] as const;
export type PluginJobRunTrigger = (typeof PLUGIN_JOB_RUN_TRIGGERS)[number];

/** Statuses for inbound webhook deliveries. */
export const PLUGIN_WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "success",
  "failed",
] as const;
export type PluginWebhookDeliveryStatus = (typeof PLUGIN_WEBHOOK_DELIVERY_STATUSES)[number];

/**
 * Core domain event types that plugins can subscribe to via the
 * `events.subscribe` capability.
 *
 * @see PLUGIN_SPEC.md §16 — Event System
 */
export const PLUGIN_EVENT_TYPES = [
  "company.created",
  "company.updated",
  "project.created",
  "project.updated",
  "project.workspace_created",
  "project.workspace_updated",
  "project.workspace_deleted",
  "issue.created",
  "issue.updated",
  "issue.comment.created",
  "issue.document.created",
  "issue.document.updated",
  "issue.document.deleted",
  "issue.relations.updated",
  "issue.checked_out",
  "issue.released",
  "issue.assignment_wakeup_requested",
  "agent.created",
  "agent.updated",
  "agent.status_changed",
  "agent.error_cleared",
  "agent.run.started",
  "agent.run.finished",
  "agent.run.failed",
  "agent.run.cancelled",
  "goal.created",
  "goal.updated",
  "approval.created",
  "approval.decided",
  "budget.incident.opened",
  "budget.incident.resolved",
  "cost_event.created",
  "activity.logged",
] as const;
export type PluginEventType = (typeof PLUGIN_EVENT_TYPES)[number];

/**
 * Error codes returned by the plugin bridge when a UI → worker call fails.
 *
 * @see PLUGIN_SPEC.md §19.7 — Error Propagation Through The Bridge
 */
export const PLUGIN_BRIDGE_ERROR_CODES = [
  "WORKER_UNAVAILABLE",
  "CAPABILITY_DENIED",
  "INVOCATION_SCOPE_DENIED",
  "WORKER_ERROR",
  "TIMEOUT",
  "UNKNOWN",
] as const;
export type PluginBridgeErrorCode = (typeof PLUGIN_BRIDGE_ERROR_CODES)[number];
