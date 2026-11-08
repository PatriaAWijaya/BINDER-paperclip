CREATE TABLE "binder_agent_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"model_family" text NOT NULL,
	"model_id" text NOT NULL,
	"provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_agent_models_family_check" CHECK ("binder_agent_models"."model_family" in ('meta', 'anthropic', 'google', 'openai', 'other'))
);
--> statement-breakpoint
CREATE TABLE "binder_approved_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid,
	"approval_id" uuid NOT NULL,
	"action_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_by_agent_id" uuid,
	"decided_by_user_id" text,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_approved_actions_kind_check" CHECK ("binder_approved_actions"."action_kind" in ('outreach_send', 'external_post', 'external_call', 'external_message', 'other')),
	CONSTRAINT "binder_approved_actions_status_check" CHECK ("binder_approved_actions"."status" in ('issued', 'used', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "binder_qc_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid NOT NULL,
	"binder_task_id" uuid NOT NULL,
	"qc_agent_id" uuid NOT NULL,
	"maker_agent_id" uuid NOT NULL,
	"maker_family" text NOT NULL,
	"qc_family" text NOT NULL,
	"round" integer NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_qc_assignments_round_check" CHECK ("binder_qc_assignments"."round" >= 1 and "binder_qc_assignments"."round" <= 2),
	CONSTRAINT "binder_qc_assignments_status_check" CHECK ("binder_qc_assignments"."status" in ('assigned', 'submitted', 'escalated'))
);
--> statement-breakpoint
CREATE TABLE "binder_qc_roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"last_assigned_at" timestamp with time zone,
	"assignments_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "binder_qc_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"truth_evidence" integer NOT NULL,
	"completeness" integer NOT NULL,
	"compliance" integer NOT NULL,
	"quality" integer NOT NULL,
	"total_score" integer NOT NULL,
	"passed" boolean NOT NULL,
	"hard_violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_sheet_work_product_id" uuid,
	"submitted_by_agent_id" uuid NOT NULL,
	"evidence_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_qc_scores_truth_range" CHECK ("binder_qc_scores"."truth_evidence" >= 0 and "binder_qc_scores"."truth_evidence" <= 30),
	CONSTRAINT "binder_qc_scores_completeness_range" CHECK ("binder_qc_scores"."completeness" >= 0 and "binder_qc_scores"."completeness" <= 25),
	CONSTRAINT "binder_qc_scores_compliance_range" CHECK ("binder_qc_scores"."compliance" >= 0 and "binder_qc_scores"."compliance" <= 25),
	CONSTRAINT "binder_qc_scores_quality_range" CHECK ("binder_qc_scores"."quality" >= 0 and "binder_qc_scores"."quality" <= 20),
	CONSTRAINT "binder_qc_scores_total_range" CHECK ("binder_qc_scores"."total_score" >= 0 and "binder_qc_scores"."total_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "binder_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid NOT NULL,
	"owner_agent_id" uuid NOT NULL,
	"dod" text NOT NULL,
	"binder_status" text DEFAULT 'backlog' NOT NULL,
	"revision_round" integer DEFAULT 0 NOT NULL,
	"primary_artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binder_tasks_status_check" CHECK ("binder_tasks"."binder_status" in ('backlog', 'todo', 'in_progress', 'in_review', 'revision', 'needs_owner_approval', 'escalated', 'done', 'cancelled')),
	CONSTRAINT "binder_tasks_revision_round_check" CHECK ("binder_tasks"."revision_round" >= 0 and "binder_tasks"."revision_round" <= 2)
);
--> statement-breakpoint
ALTER TABLE "binder_agent_models" ADD CONSTRAINT "binder_agent_models_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_agent_models" ADD CONSTRAINT "binder_agent_models_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_approved_actions" ADD CONSTRAINT "binder_approved_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_approved_actions" ADD CONSTRAINT "binder_approved_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_approved_actions" ADD CONSTRAINT "binder_approved_actions_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_approved_actions" ADD CONSTRAINT "binder_approved_actions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_approved_actions" ADD CONSTRAINT "binder_approved_actions_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_assignments" ADD CONSTRAINT "binder_qc_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_assignments" ADD CONSTRAINT "binder_qc_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_assignments" ADD CONSTRAINT "binder_qc_assignments_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_assignments" ADD CONSTRAINT "binder_qc_assignments_binder_task_id_binder_tasks_id_fk" FOREIGN KEY ("binder_task_id") REFERENCES "public"."binder_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_assignments" ADD CONSTRAINT "binder_qc_assignments_qc_agent_id_agents_id_fk" FOREIGN KEY ("qc_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_assignments" ADD CONSTRAINT "binder_qc_assignments_maker_agent_id_agents_id_fk" FOREIGN KEY ("maker_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_roster" ADD CONSTRAINT "binder_qc_roster_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_roster" ADD CONSTRAINT "binder_qc_roster_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_scores" ADD CONSTRAINT "binder_qc_scores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_scores" ADD CONSTRAINT "binder_qc_scores_assignment_id_binder_qc_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."binder_qc_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_scores" ADD CONSTRAINT "binder_qc_scores_score_sheet_work_product_id_issue_work_products_id_fk" FOREIGN KEY ("score_sheet_work_product_id") REFERENCES "public"."issue_work_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_qc_scores" ADD CONSTRAINT "binder_qc_scores_submitted_by_agent_id_agents_id_fk" FOREIGN KEY ("submitted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_tasks" ADD CONSTRAINT "binder_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_tasks" ADD CONSTRAINT "binder_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_tasks" ADD CONSTRAINT "binder_tasks_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_tasks" ADD CONSTRAINT "binder_tasks_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_tasks" ADD CONSTRAINT "binder_tasks_primary_artifact_id_issue_work_products_id_fk" FOREIGN KEY ("primary_artifact_id") REFERENCES "public"."issue_work_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "binder_agent_models_company_agent_unique_idx" ON "binder_agent_models" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "binder_agent_models_company_idx" ON "binder_agent_models" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_approved_actions_company_approval_unique_idx" ON "binder_approved_actions" USING btree ("company_id","approval_id");--> statement-breakpoint
CREATE INDEX "binder_approved_actions_company_status_idx" ON "binder_approved_actions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "binder_approved_actions_company_issue_idx" ON "binder_approved_actions" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_qc_assignments_company_issue_round_unique_idx" ON "binder_qc_assignments" USING btree ("company_id","issue_id","round");--> statement-breakpoint
CREATE INDEX "binder_qc_assignments_company_issue_idx" ON "binder_qc_assignments" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "binder_qc_assignments_company_qc_idx" ON "binder_qc_assignments" USING btree ("company_id","qc_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_qc_roster_company_agent_unique_idx" ON "binder_qc_roster" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "binder_qc_roster_company_idx" ON "binder_qc_roster" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_qc_scores_assignment_unique_idx" ON "binder_qc_scores" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "binder_qc_scores_company_assignment_idx" ON "binder_qc_scores" USING btree ("company_id","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_tasks_company_issue_unique_idx" ON "binder_tasks" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "binder_tasks_company_status_idx" ON "binder_tasks" USING btree ("company_id","binder_status");--> statement-breakpoint
CREATE INDEX "binder_tasks_company_owner_idx" ON "binder_tasks" USING btree ("company_id","owner_agent_id");