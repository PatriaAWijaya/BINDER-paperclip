/**
 * Per-company secret-mutation lock + account-home directory guard.
 *
 * Relocated from the deleted `@paperclipai/adapter-codex-local` package
 * (`codex-auth-cache.ts`) during the adapter-deletion phase: the lock is a
 * generic per-company mutex used by the secrets service and other writers,
 * not Codex-specific behaviour. Only the lock-directory name changed
 * (`codex-account-home-secret-mutation-lock` ->
 * `account-home-secret-mutation-lock`); the semantics are identical.
 *
 * The legacy account-home cache root (`codex-auth-cache/`) is retained ONLY
 * as an on-disk path for `assertAccountHomeDirStillValid`: existing
 * `local_encrypted` secrets may still name directories under it, and the
 * fail-closed check must keep working for those legacy values. No Codex
 * adapter code remains; nothing new is ever created under that root.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { resolvePaperclipInstanceRootForAdapter } from "./server-utils.js";
import { withDirectoryMergeLock } from "./workspace-restore-merge.js";

// A private directory (owner rwx only). 0o700 has no group/other bits, so a
// standard umask can never widen it.
const PRIVATE_DIR_MODE = 0o700;

// Legacy on-disk root for account-home credential directories created before
// the Codex adapter was deleted. See the file header.
const LEGACY_ACCOUNT_HOME_CACHE_DIR_NAME = "codex-auth-cache";

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Sanitizes one raw value to a single safe path segment. Rejects an empty value,
 * a relative segment (`.` or `..`), a path separator (`/` or `\`), and a NUL
 * byte, so the value can never become a path traversal. Returns the trimmed,
 * safe segment.
 */
export function toSafePathSegment(value: string, label: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) {
    throw new Error(`account-home secret mutation lock: ${label} is empty`);
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error(`account-home secret mutation lock: ${label} is a relative path segment`);
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new Error(`account-home secret mutation lock: ${label} contains a path separator`);
  }
  // Defense in depth: a safe segment is exactly its own basename. Anything else
  // carries a separator or a relative segment the checks above must have caught.
  if (path.basename(trimmed) !== trimmed) {
    throw new Error(`account-home secret mutation lock: ${label} is not a single path segment`);
  }
  return trimmed;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  const existing = await lstat(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("account-home secret mutation lock: lock path is a symlink or a non-directory");
    }
    return;
  }
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

/**
 * Resolves the per-company lock directory under the instance-scoped
 * `companies/<companyId>/` tree. The root is always company-scoped, so a
 * secret mutation can never cross a company boundary. `companyId` is
 * sanitized to a single safe path segment, so a traversal value can never
 * make the lock directory escape the `companies/` directory.
 */
function resolveAccountHomeSecretMutationLockDir(
  env: NodeJS.ProcessEnv = process.env,
  companyId: string,
): string {
  const safeCompanyId = toSafePathSegment(companyId, "companyId");
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return path.resolve(instanceRoot, "companies", safeCompanyId, "account-home-secret-mutation-lock");
}

/**
 * Resolves the legacy per-company account-home cache root (see file header).
 * Only used by {@link assertAccountHomeDirStillValid} for legacy secret
 * values. Never creates anything.
 */
function resolveLegacyAccountHomeCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  companyId: string,
): string {
  const safeCompanyId = toSafePathSegment(companyId, "companyId");
  const instanceRoot = resolvePaperclipInstanceRootForAdapter({
    homeDir: nonEmpty(env.PAPERCLIP_HOME) ?? undefined,
    instanceId: nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? undefined,
    env,
  });
  return path.resolve(instanceRoot, "companies", safeCompanyId, LEGACY_ACCOUNT_HOME_CACHE_DIR_NAME);
}

// An outer credential transaction acquires this lock before database row locks.
// Nested secret-service writes must share that ownership, not acquire it again.
// Expire ownership on return so detached work cannot inherit a released lock.
const secretMutationOwnership = new AsyncLocalStorage<Map<string, { active: boolean }>>();

/**
 * Serializes one company's secret mutations (create/rotate/delete) so a
 * write and the account-home cleanup's check-and-delete cannot interleave.
 * Two different companies never share a lock. A caller already holding this
 * lock (e.g. an outer credential transaction calling into a secrets-service
 * write) runs straight through instead of deadlocking on itself.
 */
export async function withAccountHomeSecretMutationLock<T>(
  env: NodeJS.ProcessEnv = process.env,
  companyId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockDir = resolveAccountHomeSecretMutationLockDir(env, companyId);
  await ensurePrivateDir(lockDir);
  const key = await realpath(lockDir);
  const inherited = secretMutationOwnership.getStore();
  if (inherited?.get(key)?.active) return fn();
  return withDirectoryMergeLock(lockDir, async () => {
    const ownership = { active: true };
    const scope = new Map(inherited);
    scope.set(key, ownership);
    try { return await secretMutationOwnership.run(scope, fn); }
    finally { ownership.active = false; }
  }, env);
}

/**
 * Confirms a `local_encrypted` secret value that names a directory under this
 * company's legacy account-home cache root still exists on disk. Call this
 * inside {@link withAccountHomeSecretMutationLock}, before a create or a
 * rotate commits the value.
 *
 * The lock alone stops a write and the account-home cleanup's
 * check-and-delete from interleaving; it does not stop them from running in
 * either order. When the cleanup's check-and-delete runs first — it finds no
 * secret names the directory, because this write had not committed yet, and
 * removes the directory — a write that was only queued behind the lock still
 * goes on, once the lock frees, to commit the very directory the cleanup
 * just removed. That would leave an active secret naming a directory that
 * does not exist. This check closes that window: a write whose value would
 * name a directory the cleanup already removed fails instead of committing.
 *
 * A value outside this company's cache root is left alone. Only a value
 * under the cache root can ever be an account-home directory, so this never
 * rejects an unrelated `local_encrypted` secret write, such as an API key or
 * a hand-typed token.
 */
export async function assertAccountHomeDirStillValid(
  env: NodeJS.ProcessEnv = process.env,
  companyId: string,
  value: string,
): Promise<void> {
  const cacheRoot = resolveLegacyAccountHomeCacheDir(env, companyId);
  if (!value.startsWith(cacheRoot + path.sep)) return;
  const exists = await lstat(value)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  if (!exists) {
    throw new Error(
      "account-home directory no longer exists; refusing to write a secret that names it",
    );
  }
}
