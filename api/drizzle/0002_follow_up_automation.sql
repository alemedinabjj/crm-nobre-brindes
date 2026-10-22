CREATE TYPE "public"."follow_up_priority" AS ENUM('HIGH', 'NORMAL');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('OPEN', 'DONE', 'CANCELED');--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation" varchar(40) NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"reference_date" date NOT NULL,
	"created_count" integer NOT NULL,
	"canceled_count" integer NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "follow_up_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"seller_name" varchar(80) NOT NULL,
	"reason_code" varchar(40) NOT NULL,
	"priority" "follow_up_priority" NOT NULL,
	"title" varchar(200) NOT NULL,
	"details" text NOT NULL,
	"due_date" date NOT NULL,
	"status" "follow_up_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"created_by_run_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp (3) with time zone,
	CONSTRAINT "follow_up_tasks_resolved_consistency" CHECK (("follow_up_tasks"."status" = 'OPEN') = ("follow_up_tasks"."resolved_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_created_by_run_id_automation_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."automation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_tasks_one_open_per_opportunity" ON "follow_up_tasks" USING btree ("opportunity_id") WHERE "follow_up_tasks"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "follow_up_tasks_seller_status_idx" ON "follow_up_tasks" USING btree ("seller_name","status","due_date");