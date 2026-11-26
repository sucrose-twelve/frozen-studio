CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL,
	"avatar_asset_id" uuid,
	"portrait_asset_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"speaking_style" text DEFAULT '' NOT NULL,
	"scenario" text DEFAULT '' NOT NULL,
	"greetings" jsonb DEFAULT '[]' NOT NULL,
	"example_dialogues" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "characters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"chat_id" uuid NOT NULL,
	"parent_id" uuid,
	"role" varchar(20) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"job_id" uuid,
	"tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"character_id" uuid NOT NULL,
	"persona_id" uuid,
	"title" varchar(200) DEFAULT '' NOT NULL,
	"head_message_id" uuid,
	"settings" jsonb NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "personas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "characters_name_index" ON "characters" ("name");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_created_at_index" ON "chat_messages" ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_parent_index" ON "chat_messages" ("parent_id");--> statement-breakpoint
CREATE INDEX "chat_messages_job_index" ON "chat_messages" ("job_id");--> statement-breakpoint
CREATE INDEX "chats_character_last_message_at_index" ON "chats" ("character_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_avatar_asset_id_assets_id_fkey" FOREIGN KEY ("avatar_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_portrait_asset_id_assets_id_fkey" FOREIGN KEY ("portrait_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_parent_id_chat_messages_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_job_id_jobs_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_character_id_characters_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_persona_id_personas_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE SET NULL;