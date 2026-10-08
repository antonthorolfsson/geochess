ALTER TABLE "campaigns" ADD COLUMN "next_round_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "round_paused_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "campaigns_next_round_at" ON "campaigns" USING btree ("next_round_at");