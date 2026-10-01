ALTER TABLE "members" ADD COLUMN "claimed_rating" integer;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "rating" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lichess_ratings" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lichess_ratings_at" timestamp with time zone;