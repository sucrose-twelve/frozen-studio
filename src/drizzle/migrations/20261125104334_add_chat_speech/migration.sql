ALTER TABLE "characters" ADD COLUMN "voice" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "speech_job_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "speech_text" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_speech_job_id_jobs_id_fkey" FOREIGN KEY ("speech_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL;