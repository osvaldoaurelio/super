ALTER TABLE "outbox_events" ADD COLUMN "status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE "outbox_events" SET "status" = 'published' WHERE "published_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_status_valid" CHECK ("outbox_events"."status" in ('pending', 'published', 'dead'));