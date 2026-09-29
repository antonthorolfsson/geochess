CREATE TABLE "peace_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"war_id" text NOT NULL,
	"proposer_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"terms" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"respond_by" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "fortified_until" integer;--> statement-breakpoint
ALTER TABLE "wars" ADD COLUMN "reserves" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "peace_offers" ADD CONSTRAINT "peace_offers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peace_offers" ADD CONSTRAINT "peace_offers_war_id_wars_id_fk" FOREIGN KEY ("war_id") REFERENCES "public"."wars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peace_offers" ADD CONSTRAINT "peace_offers_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peace_offers" ADD CONSTRAINT "peace_offers_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "peace_offers_war" ON "peace_offers" USING btree ("war_id","status");--> statement-breakpoint
CREATE INDEX "peace_offers_campaign" ON "peace_offers" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "peace_offers_respond_by" ON "peace_offers" USING btree ("respond_by");