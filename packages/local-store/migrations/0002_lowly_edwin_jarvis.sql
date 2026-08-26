ALTER TABLE `outbox` ADD `attachment_payload` text;--> statement-breakpoint
ALTER TABLE `timeline_entries` ADD `attachment_payload` text;