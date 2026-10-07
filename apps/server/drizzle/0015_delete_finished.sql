ALTER TABLE "campaigns" ADD COLUMN "delete_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "campaigns_delete_at" ON "campaigns" USING btree ("delete_at");--> statement-breakpoint
-- Campaigns that finished before automatic deletion get the full week from now, not from when they ended.
UPDATE "campaigns" SET "delete_at" = now() + interval '7 days' WHERE "status" = 'finished';