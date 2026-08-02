CREATE TABLE `finding_marks` (
	`finding_id` text PRIMARY KEY NOT NULL,
	`fixed` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
