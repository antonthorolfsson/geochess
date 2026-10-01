CREATE TABLE "friends" (
	"user_id" text NOT NULL,
	"friend_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_user_id_friend_id_pk" PRIMARY KEY("user_id","friend_id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"campaign_id" text NOT NULL,
	"user_id" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "friend_code" text;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_friend_id_users_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_user" ON "invitations" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_friend_code_unique" UNIQUE("friend_code");--> statement-breakpoint
-- Everyone who has drafted a campaign together is friends already (bots aside), as the draft makes them from now on.
INSERT INTO "friends" ("user_id", "friend_id")
SELECT DISTINCT a."user_id", b."user_id"
FROM "members" a
JOIN "members" b ON b."campaign_id" = a."campaign_id" AND b."user_id" <> a."user_id"
JOIN "campaigns" c ON c."id" = a."campaign_id"
WHERE c."status" <> 'lobby' AND left(a."user_id", 4) <> 'bot_' AND left(b."user_id", 4) <> 'bot_'
ON CONFLICT DO NOTHING;
