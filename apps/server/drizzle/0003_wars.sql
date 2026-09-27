CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"war_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"armageddon" boolean DEFAULT false NOT NULL,
	"white_id" text NOT NULL,
	"black_id" text NOT NULL,
	"time_control" jsonb NOT NULL,
	"moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fen" text NOT NULL,
	"clocks" jsonb,
	"status" text NOT NULL,
	"result" text,
	"reason" text,
	"draw_offer_by" text,
	"starts_at" timestamp with time zone,
	"last_move_at" timestamp with time zone,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wars" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"attacker_id" text NOT NULL,
	"defender_id" text NOT NULL,
	"target_id" text NOT NULL,
	"launch_id" text NOT NULL,
	"stake" jsonb NOT NULL,
	"redirected_from" text,
	"status" text NOT NULL,
	"counter" jsonb,
	"outcome" text,
	"declared_round" integer NOT NULL,
	"resolved_round" integer,
	"respond_by" timestamp with time zone,
	"declared_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_war_id_wars_id_fk" FOREIGN KEY ("war_id") REFERENCES "public"."wars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_white_id_users_id_fk" FOREIGN KEY ("white_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_black_id_users_id_fk" FOREIGN KEY ("black_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wars" ADD CONSTRAINT "wars_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wars" ADD CONSTRAINT "wars_attacker_id_users_id_fk" FOREIGN KEY ("attacker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wars" ADD CONSTRAINT "wars_defender_id_users_id_fk" FOREIGN KEY ("defender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_war" ON "games" USING btree ("war_id");--> statement-breakpoint
CREATE INDEX "games_deadline" ON "games" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "wars_campaign" ON "wars" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "wars_respond_by" ON "wars" USING btree ("respond_by");