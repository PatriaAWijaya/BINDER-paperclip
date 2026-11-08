import { trace, type Span } from "@opentelemetry/api";
import { withDatabaseOperation } from "@paperclipai/db";

type BudgetOperation = "budget.accounting.lock_wait" | "budget.accounting.recover"
  | "budget.accounting.settlement" | "budget.accounting.transaction"
  | "budget.admission.evaluate" | "budget.admission.inspect" | "budget.admission.reconcile" | "budget.admission.reserve"
  | "budget.cancellation.deliver" | "budget.enforcement.deliver"
  | "budget.enforcement.scope" | "budget.exposure.evaluate"
  | "binder.funding.top_up" | "binder.funding.envelope_create"
  | "binder.funding.envelope_approve" | "binder.funding.charge"
  | "binder.task.create" | "binder.task.transition" | "binder.task.submit_work"
  | "binder.task.owner_decision" | "binder.qc.register" | "binder.qc.assign"
  | "binder.qc.submit" | "binder.action.request" | "binder.action.issue"
  | "binder.action.use" | "binder.action.revoke"
  | "binder.ceo.register" | "binder.ceo.update_budget" | "binder.ceo.update_matrix"
  | "binder.ceo.update_model";

/** Operator-gated OpenTelemetry only; these spans contain no prompt, receipt,
 * credential, or provider error text. Diagnostics never change accounting. */
type BudgetAttributes = {
  "budget.accounting.owner"?: "run" | "decision" | "classifier" | "fast_response" | "browser";
  "budget.enforcement.queue_delay_ms"?: number;
  "budget.policy_count"?: number;
};

export function withBudgetSpan<T>(name: BudgetOperation, work: () => Promise<T>, attributes?: BudgetAttributes) {
  return withDatabaseOperation(name, async () => {
    if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) return work();
    let operation: Promise<T> | undefined;
    const run = (span?: Span) => operation ??= Promise.resolve().then(work).finally(() => {
      try { span?.end(); } catch { /* Diagnostics cannot change accounting. */ }
    });
    try {
      const traced = trace.getTracer("paperclip.budgets").startActiveSpan(name, { attributes }, span => run(span));
      // Some external SDK implementations can fail before or after the callback.
      // Own the accounting promise so either failure still executes work once.
      void Promise.resolve(traced).catch(() => undefined);
    } catch { /* Preserve the accounting operation if span creation fails. */ }
    return operation ?? run();
  });
}
