ALTER TABLE "games" ADD COLUMN "otb_offer_by" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "over_the_board_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "report" jsonb;