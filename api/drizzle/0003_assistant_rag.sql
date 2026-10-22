CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
-- unaccent() não é IMMUTABLE (depende do dicionário configurado), e colunas
-- geradas exigem funções imutáveis. O wrapper fixa o dicionário e assume a
-- imutabilidade, que é o padrão recomendado para indexar texto sem acento.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $fn$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $fn$;--> statement-breakpoint
CREATE TABLE "assistant_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"tool_calls" jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"guardrail_flags" jsonb NOT NULL,
	"model" varchar(80) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" varchar(120) PRIMARY KEY NOT NULL,
	"document_slug" varchar(80) NOT NULL,
	"document_title" varchar(200) NOT NULL,
	"category" varchar(40) NOT NULL,
	"section" varchar(200) NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector(768),
	"embedding_model" varchar(80),
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('portuguese', immutable_unaccent(coalesce("knowledge_chunks"."document_title", '') || ' ' || coalesce("knowledge_chunks"."section", ''))), 'A') || setweight(to_tsvector('portuguese', immutable_unaccent(coalesce("knowledge_chunks"."content", ''))), 'B')) STORED,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assistant_interactions_created_idx" ON "assistant_interactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_document_idx" ON "knowledge_chunks" USING btree ("document_slug");