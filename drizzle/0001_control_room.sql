CREATE TABLE `relay_control_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`epoch` text NOT NULL,
	`revision` integer NOT NULL,
	`commit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relay_control_records` (
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`kind`, `id`)
);
--> statement-breakpoint
CREATE INDEX `relay_control_kind` ON `relay_control_records` (`kind`);