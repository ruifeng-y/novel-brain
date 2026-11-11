ALTER TABLE "golden_three_candidates" DROP CONSTRAINT "golden_three_candidates_pins_check";--> statement-breakpoint
UPDATE "golden_three_candidates"
SET "chapter_pins" = jsonb_build_array("chapter_pins"->0)
WHERE jsonb_typeof("chapter_pins") = 'array' AND jsonb_array_length("chapter_pins") > 1;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_pins_check" CHECK (jsonb_typeof("golden_three_candidates"."chapter_pins") = 'array' and jsonb_array_length("golden_three_candidates"."chapter_pins") = 1);
