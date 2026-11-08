/**
 * Per-identity Codex credential-cache helpers.
 *
 * Relocated from the deleted `@paperclipai/adapter-codex-local` package
 * (`codex-auth-cache.ts` and `codex-home.ts`) during the adapter-deletion
 * phase. Only the helpers something still needs are kept here:
 * `isCodexAuthCacheEnabled`, `readSubscriptionAccountId`, and
 * `writeCodexAuthCacheEntry` (the native runtime's copy-back), plus
 * `resolveCodexAuthCacheDir` (the canonical per-company cache-dir resolver,
 * used by the agent-instance-secrets test fixture paths) and
 * `resolveManagedCodexHomeDir` (the managed per-company `codex-home`
 * resolver, used by the runner-e2e Codex subscription fixture). The rest of
 * the cache subsystem (vend, clear, device-login promotion, entry-dir
 * management) died with the adapter.
 *
 * The cache root (`codex-auth-cache/`) is an on-disk path for credentials
 * created before the adapter was deleted; nothing new is created under it
 * except the copy-back's additive per-identity slot write.
 */
import path from "node:path";
import { resolvePaperclipInstanceRootForAdapter } from "@paperclipai/adapter-utils/server-utils";
import { toSafePathSegment } from "@paperclipai/adapter-utils/account-home-secret-mutation-lock";
import { writeCredentialSeedOrNewer } from "./codex-auth-seed-write.js";

// One default-on off-switch. When the flag is an explicit falsy value the cache
// write becomes a no-op. The host default overwrite is unchanged in both states.
export const CODEX_AUTH_CACHE_OFF_SWITCH_ENV = "PAPERCLIP_CODEX_AUTH_CACHE";

const FALSY_ENV_RE = /^(0|false|no|off)$/i;

/**
 * True when the cache is enabled. The cache is on by default. It turns off only
 * when {@link CODEX_AUTH_CACHE_OFF_SWITCH_ENV} is an explicit falsy value
 * (`0`, `false`, `no`, or `off`).
 */
export function isCodexAuthCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CODEX_AUTH_CACHE_OFF_SWITCH_ENV];
  if (typeof raw !== "string") return true;
  return !FALSY_ENV_RE.test(raw.trim());
}

/**
 * Reads the subscription `account_id` from Codex `auth.json` bytes. Returns
 * null for an API-key credential, an unparseable payload, a blank account id,
 * or a credential with no token material.
 */
export function readSubscriptionAccountId(bytes: Buffer): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const apiKey = record.OPENAI_API_KEY;
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    return null;
  }
  const tokens = record.tokens;
  if (tokens === null || typeof tokens !== "object" || Array.isArray(tokens)) {
    return null;
  }
  const tokenRecord = tokens as Record<string, unknown>;
  const rawAccountId = typeof tokenRecord.account_id === "string" ? tokenRecord.account_id : "";
  // A blank-or-whitespace-only value is absent; a value with real content
  // keeps its exact, untrimmed form.
  const accountId = rawAccountId.trim().length > 0 ? rawAccountId : "";
  const hasTokenMaterial = ["id_token", "access_token", "refresh_token"].some((key) => {
    const value = tokenRecord[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (!accountId || !hasTokenMaterial) {
    return null;
  }
  return accountId;
}

export type WriteCodexAuthCacheEntryOutcome = "written" | "kept-slot";

/**
 * Writes `sandboxAuthBytes` into its per-identity cache slot when the slot is
 * absent, or when the source is a strictly-newer same-identity subscription
 * credential (seed mode). The mutation runs under the merge lock on the slot
 * directory, through the shared {@link writeCredentialSeedOrNewer} writer. Never
 * logs token bytes or a raw `account_id`.
 */
export async function writeCodexAuthCacheEntry(input: {
  sandboxAuthBytes: Buffer;
  cacheEntryPath: string;
  log: (line: string) => void | Promise<void>;
  /** Environment for the merge lock root. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}): Promise<WriteCodexAuthCacheEntryOutcome> {
  const outcome = await writeCredentialSeedOrNewer({
    sourceBytes: input.sandboxAuthBytes,
    destinationPath: input.cacheEntryPath,
    seedIfDestAbsent: true,
    log: input.log,
    writtenLine: "[paperclip] Codex auth cache: wrote the per-identity cache slot at mode 0600.",
    keptLine:
      "[paperclip] Codex auth cache: kept the cache slot (source is not a strictly-newer same-identity subscription credential).",
    tempPrefix: "auth.json.cache-source",
    errorLabel: "codex auth cache",
    env: input.env,
  });
  return outcome === "written" ? "written" : "kept-slot";
}

const CACHE_DIR_NAME = "codex-auth-cache";

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolves the per-company Codex credential-cache directory:
 * `<instanceRoot>/companies/<companyId>/codex-auth-cache/`. The cache root
 * is an on-disk path for credentials created before the adapter was deleted.
 */
export function resolveCodexAuthCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  companyId: string,
): string {
  const safeCompanyId = toSafePathSegment(companyId, "companyId");
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return path.resolve(instanceRoot, "companies", safeCompanyId, CACHE_DIR_NAME);
}

/**
 * Resolves the managed per-company Codex home directory:
 * `<instanceRoot>/companies/<companyId>/codex-home/`, or the shared
 * `<instanceRoot>/codex-home/` when no company is given. Relocated verbatim
 * from the deleted `@paperclipai/adapter-codex-local` package
 * (`codex-home.ts`); the runner-e2e Codex subscription fixture seeds a
 * login into this directory, and the runner's Codex provider reads it.
 */
export function resolveManagedCodexHomeDir(
  env: NodeJS.ProcessEnv,
  companyId?: string,
): string {
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return companyId
    ? path.resolve(instanceRoot, "companies", companyId, "codex-home")
    : path.resolve(instanceRoot, "codex-home");
}
