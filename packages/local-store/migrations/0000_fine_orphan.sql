CREATE TABLE `conversation_cursors` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`last_seen_seq` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`client_id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`content_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timeline_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`envelope_id` text,
	`sender_id` text,
	`sender_device_id` text,
	`seq` integer,
	`content_type` text,
	`payload` text,
	`created_at` integer NOT NULL,
	`gap_from_seq` integer,
	`gap_to_seq` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_entries_envelope_id_unique` ON `timeline_entries` (`envelope_id`);--> statement-breakpoint
CREATE INDEX `timeline_entries_conversation_id_idx` ON `timeline_entries` (`conversation_id`,`id`);