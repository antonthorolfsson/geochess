CREATE TABLE "accords" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"proposer_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"status" text NOT NULL,
	"rounds" integer NOT NULL,
	"terms" text,
	"proposed_round" integer NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"respond_by" timestamp with time zone,
	"signed_round" integer,
	"signed_at" timestamp with time zone,
	"ends_round" integer,
	"ended_round" integer,
	"ended_at" timestamp with time zone,
	"broken_by" text,
	"renews" text
);
--> statement-breakpoint
CREATE TABLE "chat_reads" (
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation" text NOT NULL,
	"last_read_id" bigint NOT NULL,
	CONSTRAINT "chat_reads_campaign_id_user_id_conversation_pk" PRIMARY KEY("campaign_id","user_id","conversation")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"conversation" text NOT NULL,
	"author_id" text NOT NULL,
	"recipient_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "reputation" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "accords" ADD CONSTRAINT "accords_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accords" ADD CONSTRAINT "accords_proposer_id_users_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accords" ADD CONSTRAINT "accords_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accords_campaign" ON "accords" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "accords_respond_by" ON "accords" USING btree ("respond_by");--> statement-breakpoint
CREATE INDEX "messages_conversation" ON "messages" USING btree ("campaign_id","conversation","id");