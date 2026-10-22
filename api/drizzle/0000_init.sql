CREATE TYPE "public"."stage" AS ENUM('PRIMEIRO_CONTATO', 'APRESENTACAO_ORCAMENTO', 'FOLLOW_UP', 'FORECAST', 'FECHAMENTO', 'PERDIDA');--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"company_name" varchar(160) NOT NULL,
	"seller_name" varchar(80) NOT NULL,
	"estimated_value" numeric(12, 2),
	"last_contact_at" date,
	"proposal_valid_until" date,
	"client_event_date" date,
	"stage" "stage" DEFAULT 'PRIMEIRO_CONTATO' NOT NULL,
	"loss_reason" text,
	"stage_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_code_unique" UNIQUE("code"),
	CONSTRAINT "opportunities_estimated_value_positive" CHECK ("opportunities"."estimated_value" IS NULL OR "opportunities"."estimated_value" > 0),
	CONSTRAINT "opportunities_lost_requires_reason" CHECK ("opportunities"."stage" <> 'PERDIDA' OR length(trim(coalesce("opportunities"."loss_reason", ''))) > 0),
	CONSTRAINT "opportunities_quote_requires_value" CHECK ("opportunities"."stage" IN ('PRIMEIRO_CONTATO', 'PERDIDA') OR "opportunities"."estimated_value" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "opportunity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"product_name" varchar(160) NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "opportunity_items_quantity_positive" CHECK ("opportunity_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stage_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage" "stage",
	"to_stage" "stage" NOT NULL,
	"reason" text,
	"changed_by" varchar(80),
	"changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_items" ADD CONSTRAINT "opportunity_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_stage_idx" ON "opportunities" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "opportunities_seller_idx" ON "opportunities" USING btree ("seller_name");--> statement-breakpoint
CREATE INDEX "opportunity_items_opportunity_idx" ON "opportunity_items" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "stage_changes_opportunity_idx" ON "stage_changes" USING btree ("opportunity_id","changed_at");