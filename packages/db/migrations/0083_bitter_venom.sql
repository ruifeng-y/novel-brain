ALTER TABLE "genre_packs" ADD COLUMN "field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "genre_packs" AS gp
SET "field_schema" = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'key', field.key,
        'label', CASE field.key
          WHEN 'genre' THEN '题材'
          WHEN 'world' THEN '世界'
          WHEN 'map' THEN '地图'
          WHEN 'powerSystem' THEN '力量体系'
          WHEN 'factions' THEN '势力'
          WHEN 'specialElements' THEN '题材要素'
          WHEN 'blessedLands' THEN '洞天福地'
          WHEN 'militaryMerit' THEN '军功簿'
          WHEN 'platformRules' THEN '平台规则'
          ELSE field.key
        END,
        'type', CASE jsonb_typeof(field.value)
          WHEN 'array' THEN 'list'
          WHEN 'number' THEN 'number'
          WHEN 'boolean' THEN 'boolean'
          ELSE 'text'
        END,
        'required', true,
        'options', CASE
          WHEN jsonb_typeof(field.value) = 'array' THEN field.value
          ELSE '[]'::jsonb
        END
      )
      ORDER BY field.key
    )
    FROM jsonb_each(gp."fields") AS field
  ),
  '[]'::jsonb
)
WHERE gp."field_schema" = '[]'::jsonb;
