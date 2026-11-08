/**
 * Relocated from the deleted `@paperclipai/adapter-codex-local` package
 * (`parse.ts` — `classifyCodexAuthRefreshFailure`) during the
 * adapter-deletion phase. Classifies Codex OAuth refresh-token failures
 * from CLI/API error text. Used by the Codex quota reader
 * (`codex-quota.ts`). The rest of `parse.ts` (JSONL parser, harness-crash
 * and quota classifiers) died with the codex_local adapter: their only
 * users were the adapter's execute path and two tests' codex branches.
 */
const CODEX_REFRESH_TOKEN_REUSED_RE =
  /(?:refresh[_\s-]?token[_\s-]?reused|refresh token (?:has )?already been used|token reuse detected)/i;
const CODEX_REFRESH_TOKEN_EXPIRED_RE =
  /(?:refresh[_\s-]?token[_\s-]?expired|refresh token (?:has )?expired|expired refresh token)/i;
const CODEX_REFRESH_TOKEN_INVALIDATED_RE =
  /(?:refresh[_\s-]?token[_\s-]?(?:invalidated|revoked|invalid)|refresh token (?:has been )?(?:invalidated|revoked|invalid)|invalid refresh token|missing bearer)/i;
const CODEX_OAUTH_INVALID_GRANT_RE = /\binvalid_grant\b/i;
const CODEX_CONTEXTUAL_REFRESH_AUTH_INVALIDATED_RE =
  /(?:(?:oauth|refresh|access[_\s-]?token|bearer|credential).{0,80}(?:\b401\b|unauthori[sz]ed|\binvalid[\s-]grant\b)|(?:\b401\b|unauthori[sz]ed|\binvalid[\s-]grant\b).{0,80}(?:oauth|refresh|access[_\s-]?token|bearer|credential))/i;

export type CodexAuthRefreshFailureClass =
  | "refresh_token_reused"
  | "refresh_token_expired"
  | "refresh_token_invalidated";

function buildCodexErrorHaystack(input: {
  stdout?: string | null;
  stderr?: string | null;
  errorMessage?: string | null;
}): string {
  return [
    input.errorMessage ?? "",
    input.stdout ?? "",
    input.stderr ?? "",
  ]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function classifyCodexAuthRefreshFailure(input: {
  stdout?: string | null;
  stderr?: string | null;
  errorMessage?: string | null;
}): CodexAuthRefreshFailureClass | null {
  const haystack = buildCodexErrorHaystack(input);

  if (CODEX_REFRESH_TOKEN_REUSED_RE.test(haystack)) return "refresh_token_reused";
  if (CODEX_REFRESH_TOKEN_EXPIRED_RE.test(haystack)) return "refresh_token_expired";
  if (CODEX_REFRESH_TOKEN_INVALIDATED_RE.test(haystack)) return "refresh_token_invalidated";
  if (CODEX_OAUTH_INVALID_GRANT_RE.test(haystack)) return "refresh_token_invalidated";
  if (CODEX_CONTEXTUAL_REFRESH_AUTH_INVALIDATED_RE.test(haystack)) return "refresh_token_invalidated";
  return null;
}
