CREATE SCHEMA "otel";
--> statement-breakpoint
CREATE TYPE "otel"."span_kind" AS ENUM('llm', 'tool', 'agent', 'retrieval', 'custom');--> statement-breakpoint
CREATE TYPE "otel"."status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TABLE "otel"."spans" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"parent_span_id" text,
	"kind" "otel"."span_kind" DEFAULT 'custom' NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"status" "otel"."status" DEFAULT 'running' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otel"."traces" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"status" "otel"."status" DEFAULT 'running' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "otel"."spans" ADD CONSTRAINT "spans_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "otel"."traces"("id") ON DELETE cascade ON UPDATE no action;
-- Enable TimescaleDB (hypertable creation deferred to Phase 2 when PK becomes composite)
CREATE EXTENSION IF NOT EXISTS timescaledb;
