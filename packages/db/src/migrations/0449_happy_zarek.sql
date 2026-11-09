ALTER TABLE "issues" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "postiz_post_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "postiz_state" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "postiz_pushed_at" timestamp with time zone;