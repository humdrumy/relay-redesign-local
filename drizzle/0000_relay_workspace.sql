CREATE TABLE `relay_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer NOT NULL
);
