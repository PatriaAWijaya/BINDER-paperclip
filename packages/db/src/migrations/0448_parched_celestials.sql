CREATE TABLE "binder_desktop_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid NOT NULL,
	"binder_task_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by_agent_id" uuid NOT NULL,
	"runtime" text NOT NULL,
	"vm_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"snapshot_requested" boolean DEFAULT false NOT NULL,
	"idle_timeout_seconds" integer,
	"pagu_vm_cents" numeric(24, 7),
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"vm_stopped_at" timestamp with time zone,
	"vm_stop_failed" boolean DEFAULT false NOT NULL,
	"artifacts_returned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_note" text,
	"checkpoint_note" text,
	"review_pending_reason" text,
	"cost_vm_cents" numeric(24, 7) DEFAULT '0' NOT NULL,
	"cost_token_cents" numeric(24, 7) DEFAULT '0' NOT NULL,
	"cost_tools_cents" numeric(24, 7) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_desktop_jobs_status_check" CHECK ("binder_desktop_jobs"."status" in ('queued', 'running', 'need_approval', 'done', 'failed')),
	CONSTRAINT "binder_desktop_jobs_runtime_check" CHECK ("binder_desktop_jobs"."runtime" in ('local_vm_docker_podman', 'boat', 'mac_patria_per_task', 'test_double')),
	CONSTRAINT "binder_desktop_jobs_attempt_check" CHECK ("binder_desktop_jobs"."attempt" >= 1),
	CONSTRAINT "binder_desktop_jobs_idle_timeout_check" CHECK ("binder_desktop_jobs"."idle_timeout_seconds" is null or "binder_desktop_jobs"."idle_timeout_seconds" >= 0),
	CONSTRAINT "binder_desktop_jobs_pagu_vm_check" CHECK ("binder_desktop_jobs"."pagu_vm_cents" is null or "binder_desktop_jobs"."pagu_vm_cents" >= 0),
	CONSTRAINT "binder_desktop_jobs_costs_nonnegative" CHECK ("binder_desktop_jobs"."cost_vm_cents" >= 0 and "binder_desktop_jobs"."cost_token_cents" >= 0 and "binder_desktop_jobs"."cost_tools_cents" >= 0),
	CONSTRAINT "binder_desktop_jobs_snapshot_requires_limits" CHECK (not "binder_desktop_jobs"."snapshot_requested" or ("binder_desktop_jobs"."idle_timeout_seconds" is not null and "binder_desktop_jobs"."idle_timeout_seconds" > 0 and "binder_desktop_jobs"."pagu_vm_cents" is not null and "binder_desktop_jobs"."pagu_vm_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "binder_gate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid,
	"agent_id" uuid NOT NULL,
	"action_kind" text NOT NULL,
	"approved_action_id" uuid,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_gate_decisions_decision_check" CHECK ("binder_gate_decisions"."decision" in ('allowed', 'denied')),
	CONSTRAINT "binder_gate_decisions_action_kind_check" CHECK ("binder_gate_decisions"."action_kind" in ('kirim', 'publish', 'bayar', 'ubah_akses', 'deploy', 'tulis_eksternal', 'hapus'))
);
--> statement-breakpoint
ALTER TABLE "binder_desktop_jobs" ADD CONSTRAINT "binder_desktop_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_desktop_jobs" ADD CONSTRAINT "binder_desktop_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_desktop_jobs" ADD CONSTRAINT "binder_desktop_jobs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_desktop_jobs" ADD CONSTRAINT "binder_desktop_jobs_binder_task_id_binder_tasks_id_fk" FOREIGN KEY ("binder_task_id") REFERENCES "public"."binder_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_desktop_jobs" ADD CONSTRAINT "binder_desktop_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_desktop_jobs" ADD CONSTRAINT "binder_desktop_jobs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_gate_decisions" ADD CONSTRAINT "binder_gate_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_gate_decisions" ADD CONSTRAINT "binder_gate_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_gate_decisions" ADD CONSTRAINT "binder_gate_decisions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_gate_decisions" ADD CONSTRAINT "binder_gate_decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "binder_desktop_jobs_company_task_attempt_unique_idx" ON "binder_desktop_jobs" USING btree ("company_id","binder_task_id","attempt");--> statement-breakpoint
CREATE INDEX "binder_desktop_jobs_company_issue_idx" ON "binder_desktop_jobs" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "binder_desktop_jobs_company_status_idx" ON "binder_desktop_jobs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "binder_desktop_jobs_company_agent_idx" ON "binder_desktop_jobs" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "binder_gate_decisions_company_issue_idx" ON "binder_gate_decisions" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "binder_gate_decisions_company_decision_idx" ON "binder_gate_decisions" USING btree ("company_id","decision");--> statement-breakpoint
CREATE INDEX "binder_gate_decisions_company_agent_idx" ON "binder_gate_decisions" USING btree ("company_id","agent_id");