ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "price_history" DROP CONSTRAINT "price_history_idempotency_unique";--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_type_idempotency_unique" UNIQUE("type","idempotency_key");--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_source_idempotency_unique" UNIQUE("source","idempotency_key");