CREATE TABLE "binder_bid_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_id" uuid,
	"amount_cents" numeric(24, 7) NOT NULL,
	"spent_cents" numeric(24, 7) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by_user_id" text,
	"approved_by_user_id" text,
	"approval_id" uuid,
	"warn_level_notified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_bid_envelopes_amount_range" CHECK ("binder_bid_envelopes"."amount_cents" >= 500 and "binder_bid_envelopes"."amount_cents" <= 3000),
	CONSTRAINT "binder_bid_envelopes_spent_nonnegative" CHECK ("binder_bid_envelopes"."spent_cents" >= 0),
	CONSTRAINT "binder_bid_envelopes_spent_within_amount" CHECK ("binder_bid_envelopes"."spent_cents" <= "binder_bid_envelopes"."amount_cents"),
	CONSTRAINT "binder_bid_envelopes_status_check" CHECK ("binder_bid_envelopes"."status" in ('proposed', 'approved', 'active', 'exhausted', 'escalated', 'closed', 'cancelled')),
	CONSTRAINT "binder_bid_envelopes_warn_level_check" CHECK ("binder_bid_envelopes"."warn_level_notified" in (0, 70, 90))
);
--> statement-breakpoint
CREATE TABLE "binder_pool_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"amount_cents" numeric(24, 7) NOT NULL,
	"approval_id" uuid NOT NULL,
	"approved_by_user_id" text,
	"reference" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_pool_topups_amount_positive" CHECK ("binder_pool_topups"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "binder_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"monthly_top_up_cents" integer DEFAULT 2000 NOT NULL,
	"balance_cents" numeric(24, 7) DEFAULT '0' NOT NULL,
	"current_period" text,
	"period_start_balance_cents" numeric(24, 7) DEFAULT '0' NOT NULL,
	"warn_level_notified" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_pools_monthly_cap_nonnegative" CHECK ("binder_pools"."monthly_top_up_cents" >= 0),
	CONSTRAINT "binder_pools_balance_nonnegative" CHECK ("binder_pools"."balance_cents" >= 0),
	CONSTRAINT "binder_pools_warn_level_check" CHECK ("binder_pools"."warn_level_notified" in (0, 70, 90))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"issue_id" uuid,
	"pool_id" uuid,
	"envelope_id" uuid,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"is_memo" boolean DEFAULT false NOT NULL,
	"amount_cents" numeric(24, 7) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text,
	"related_cost_event_id" uuid,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_kind_check" CHECK ("ledger_entries"."kind" in ('top_up', 'envelope_allocate', 'usage', 'qc_cost', 'envelope_release', 'adjustment', 'rollover')),
	CONSTRAINT "ledger_entries_direction_check" CHECK ("ledger_entries"."direction" in ('credit', 'debit')),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "binder_bid_envelopes" ADD CONSTRAINT "binder_bid_envelopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_bid_envelopes" ADD CONSTRAINT "binder_bid_envelopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_bid_envelopes" ADD CONSTRAINT "binder_bid_envelopes_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_bid_envelopes" ADD CONSTRAINT "binder_bid_envelopes_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_pool_topups" ADD CONSTRAINT "binder_pool_topups_pool_id_binder_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."binder_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_pool_topups" ADD CONSTRAINT "binder_pool_topups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_pool_topups" ADD CONSTRAINT "binder_pool_topups_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_pools" ADD CONSTRAINT "binder_pools_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_pool_id_binder_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."binder_pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_envelope_id_binder_bid_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."binder_bid_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_related_cost_event_id_cost_events_id_fk" FOREIGN KEY ("related_cost_event_id") REFERENCES "public"."cost_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "binder_bid_envelopes_live_task_unique_idx" ON "binder_bid_envelopes" USING btree ("company_id","issue_id") WHERE "binder_bid_envelopes"."status" in ('proposed', 'approved', 'active', 'exhausted', 'escalated');--> statement-breakpoint
CREATE INDEX "binder_bid_envelopes_company_project_idx" ON "binder_bid_envelopes" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "binder_bid_envelopes_company_issue_idx" ON "binder_bid_envelopes" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_pool_topups_company_receipt_idx" ON "binder_pool_topups" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "binder_pool_topups_company_created_idx" ON "binder_pool_topups" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_pools_company_unique_idx" ON "binder_pools" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_company_receipt_idx" ON "ledger_entries" USING btree ("company_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_company_occurred_idx" ON "ledger_entries" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_company_project_occurred_idx" ON "ledger_entries" USING btree ("company_id","project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_company_issue_occurred_idx" ON "ledger_entries" USING btree ("company_id","issue_id","occurred_at");