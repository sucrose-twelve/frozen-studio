CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid,
	"kind" varchar(20) NOT NULL,
	"role" varchar(20) NOT NULL,
	"root" varchar(10) NOT NULL,
	"path" text NOT NULL,
	"mime_type" varchar(50) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"job_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "job_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"params" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_root_path_index" ON "assets" ("root","path");--> statement-breakpoint
CREATE INDEX "assets_job_role_position_index" ON "assets" ("job_id","role","position");--> statement-breakpoint
CREATE INDEX "assets_role_created_at_index" ON "assets" ("role","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "job_inputs_job_position_index" ON "job_inputs" ("job_id","position");--> statement-breakpoint
CREATE INDEX "job_inputs_asset_index" ON "job_inputs" ("asset_id");--> statement-breakpoint
CREATE INDEX "jobs_created_at_index" ON "jobs" ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_kind_created_at_index" ON "jobs" ("kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_status_index" ON "jobs" ("status");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_asset_id_assets_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;