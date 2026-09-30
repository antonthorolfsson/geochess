ALTER TABLE "campaigns" ADD COLUMN "turn_order" jsonb;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "turn_passed" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "turn_user_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "turn_deadline" timestamp with time zone;