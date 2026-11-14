DROP INDEX "outbox_unpublished_idx";--> statement-breakpoint
ALTER TABLE "outbox_events" RENAME COLUMN "published_at" TO "processed_at";--> statement-breakpoint
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_status_valid";--> statement-breakpoint
UPDATE "outbox_events"
SET
  "status" = 'pending',
  "processed_at" = NULL,
  "attempts" = 0,
  "last_error" = NULL
WHERE "status" IN ('pending', 'published');--> statement-breakpoint
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_status_valid"
  CHECK ("outbox_events"."status" in ('pending', 'processed', 'dead'));--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."status" = 'pending';