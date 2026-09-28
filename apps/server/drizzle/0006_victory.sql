CREATE TABLE "campaign_results" (
	"campaign_id" text PRIMARY KEY NOT NULL,
	"winner_ids" jsonb NOT NULL,
	"round" integer NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_awards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"mission_key" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"round" integer NOT NULL,
	"awarded_at" timestamp with time zone NOT NULL,
	"claim_id" bigint
);
--> statement-breakpoint
CREATE TABLE "mission_claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"mission_key" text NOT NULL,
	"status" text NOT NULL,
	"started_round" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"eligible_round" integer NOT NULL,
	"eligible_at" timestamp with time zone,
	"time_reached" boolean DEFAULT false NOT NULL,
	"blocked_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ended_round" integer,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mission_players" (
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"baseline" jsonb NOT NULL,
	"baseline_value" integer NOT NULL,
	"seed" bigint NOT NULL,
	"options" jsonb NOT NULL,
	"secret_id" text,
	"secret" jsonb,
	"selected_at" timestamp with time zone,
	"auto_assigned" boolean DEFAULT false NOT NULL,
	"no_secret" boolean DEFAULT false NOT NULL,
	"revealed_at" timestamp with time zone,
	"revealed_round" integer,
	"reveal_reason" text,
	CONSTRAINT "mission_players_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "round_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "selection_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_results" ADD CONSTRAINT "campaign_results_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_awards" ADD CONSTRAINT "mission_awards_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_awards" ADD CONSTRAINT "mission_awards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_claims" ADD CONSTRAINT "mission_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_players" ADD CONSTRAINT "mission_players_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_players" ADD CONSTRAINT "mission_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mission_awards_once" ON "mission_awards" USING btree ("campaign_id","user_id","mission_key");--> statement-breakpoint
CREATE INDEX "mission_claims_campaign" ON "mission_claims" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "mission_claims_due" ON "mission_claims" USING btree ("status","eligible_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_claims_one_pending" ON "mission_claims" USING btree ("campaign_id","user_id","mission_key") WHERE "mission_claims"."status" = 'pending';