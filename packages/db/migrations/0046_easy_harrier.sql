ALTER TABLE "genre_packs" ADD COLUMN "rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "genre_packs" ADD COLUMN "ui_hints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "genre_packs" ADD COLUMN "generation_guidance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "genre_packs" ADD COLUMN "migration" jsonb;
--> statement-breakpoint
INSERT INTO "genre_packs" (
	"id", "key", "version", "label", "fields", "rules", "ui_hints",
	"generation_guidance", "migration"
) VALUES
(
	'01a1a6f9-9d9b-7000-8000-000000000001',
	'xianxia',
	1,
	'仙侠模板',
	$json${"genre":"仙侠","world":"修真文明","map":"分层地图","powerSystem":"修炼体系","factions":"宗门势力","specialElements":["灵物","记忆代价"]}$json$::jsonb,
	$json$[{"key":"costly-power","label":"力量必有代价","description":"越阶与突破必须付出寿元、资源或关系代价。"},{"key":"no-unearned-realm","label":"境界不可无过程跃升","description":"境界提升必须有可追溯的修炼、机缘或代价。"}]$json$::jsonb,
	$json${"worldLabel":"修真世界","powerSystemLabel":"修炼体系","powerLevelLabel":"境界","factionLabel":"宗门势力","itemLabel":"灵物功法"}$json$::jsonb,
	$json${"protagonistArchetypes":["被逐出宗门的杂役","失去记忆的剑修","守着残卷的散修"],"conflictSeeds":["宗门大比前的陷害","秘境开启与旧案","灵脉枯竭引发的迁徙"],"worldRuleSeeds":["境界差距不能靠情绪抹平","所有复活与延寿都有代价"],"forbiddenElements":["无代价飞升","现代枪械体系"]}$json$::jsonb,
	NULL
),
(
	'01a1a6f9-9d9b-7000-8000-000000000002',
	'xianxia',
	2,
	'仙侠模板',
	$json${"genre":"仙侠","world":"修真文明","map":"分层地图","powerSystem":"修炼体系","factions":"宗门势力","specialElements":["灵物","记忆代价","洞天福地"],"blessedLands":"洞天福地"}$json$::jsonb,
	$json$[{"key":"costly-power","label":"力量必有代价","description":"越阶与突破必须付出寿元、资源或关系代价。"},{"key":"no-unearned-realm","label":"境界不可无过程跃升","description":"境界提升必须有可追溯的修炼、机缘或代价。"},{"key":"lineage-consequence","label":"宗门因果必须回收","description":"宗门身份、师承和旧债必须影响后续选择。"}]$json$::jsonb,
	$json${"worldLabel":"修真世界","powerSystemLabel":"修炼体系","powerLevelLabel":"境界","factionLabel":"宗门势力","itemLabel":"灵物功法"}$json$::jsonb,
	$json${"protagonistArchetypes":["被逐出宗门的杂役","失去记忆的剑修","守着残卷的散修"],"conflictSeeds":["宗门大比前的陷害","秘境开启与旧案","灵脉枯竭引发的迁徙"],"worldRuleSeeds":["境界差距不能靠情绪抹平","所有复活与延寿都有代价","洞天福地会改变势力平衡"],"forbiddenElements":["无代价飞升","现代枪械体系"]}$json$::jsonb,
	$json${"fromVersion":1,"toVersion":2,"notes":["增加宗门因果规则","补充洞天福地字段"]}$json$::jsonb
),
(
	'01a1a6f9-9d9b-7000-8000-000000000101',
	'history',
	1,
	'架空历史模板',
	$json${"genre":"历史","world":"架空古代","map":"州郡舆图","powerSystem":"军制与武道","factions":"门阀与边军","specialElements":["粮道","驿传","谍报"]}$json$::jsonb,
	$json$[{"key":"no-cultivation","label":"不套用修仙境界","description":"历史题材不得出现修炼境界、法术和宗门体系。"},{"key":"logistics-matter","label":"粮道决定战争","description":"军队规模与行动必须受粮草、道路和季节约束。"},{"key":"institution-limits","label":"制度限制权力","description":"皇权、门阀、军府和地方的权限必须明确。"}]$json$::jsonb,
	$json${"worldLabel":"架空古代","powerSystemLabel":"军制与武道","powerLevelLabel":"军职层级","factionLabel":"门阀与边军","itemLabel":"军械文书"}$json$::jsonb,
	$json${"protagonistArchetypes":["寒门军校","穿越边卒","世家谋臣"],"conflictSeeds":["边军粮道被截","门阀与皇权争军权","灾年流民与城防"],"worldRuleSeeds":["粮草和道路决定行军速度","军职升迁受制度与战功共同约束","没有修仙法术与宗门"],"forbiddenElements":["修仙境界","境界","法术","宗门修炼","宗门"]}$json$::jsonb,
	NULL
),
(
	'01a1a6f9-9d9b-7000-8000-000000000102',
	'history',
	2,
	'架空历史模板',
	$json${"genre":"历史","world":"架空古代","map":"州郡舆图","powerSystem":"军制与武道","factions":"门阀与边军","specialElements":["粮道","驿传","谍报","军功簿"],"militaryMerit":"军功簿"}$json$::jsonb,
	$json$[{"key":"no-cultivation","label":"不套用修仙境界","description":"历史题材不得出现修炼境界、法术和宗门体系。"},{"key":"logistics-matter","label":"粮道决定战争","description":"军队规模与行动必须受粮草、道路和季节约束。"},{"key":"institution-limits","label":"制度限制权力","description":"皇权、门阀、军府和地方的权限必须明确。"},{"key":"merit-record","label":"军功必须可追溯","description":"升迁、封赏和兵权变化必须记录来源与程序。"}]$json$::jsonb,
	$json${"worldLabel":"架空古代","powerSystemLabel":"军制与武道","powerLevelLabel":"军职层级","factionLabel":"门阀与边军","itemLabel":"军械文书"}$json$::jsonb,
	$json${"protagonistArchetypes":["寒门军校","穿越边卒","世家谋臣"],"conflictSeeds":["边军粮道被截","门阀与皇权争军权","灾年流民与城防"],"worldRuleSeeds":["粮草和道路决定行军速度","军职升迁受制度与战功共同约束","没有修仙法术与宗门"],"forbiddenElements":["修仙境界","境界","法术","宗门修炼","宗门"]}$json$::jsonb,
	$json${"fromVersion":1,"toVersion":2,"notes":["增加军功簿字段","补充军功追溯规则"]}$json$::jsonb
),
(
	'01a1a6f9-9d9b-7000-8000-000000000201',
	'urban',
	1,
	'都市模板',
	$json${"genre":"都市","world":"现代都市","map":"城市关系图","powerSystem":"能力与资源","factions":"公司与组织","specialElements":["信息差","资本","人脉"]}$json$::jsonb,
	$json$[{"key":"no-cultivation","label":"不套用修仙体系","description":"都市题材不得出现宗门修炼和境界突破。"},{"key":"resource-constraint","label":"资源约束选择","description":"资本、人脉、时间和法律风险必须限制行动。"},{"key":"information-gap","label":"信息差推动冲突","description":"关键冲突必须来自谁知道什么以及如何验证。"}]$json$::jsonb,
	$json${"worldLabel":"现代都市","powerSystemLabel":"能力与资源","powerLevelLabel":"资源等级","factionLabel":"公司与组织","itemLabel":"资源与人脉"}$json$::jsonb,
	$json${"protagonistArchetypes":["被裁员的项目经理","小城创业者","调查记者"],"conflictSeeds":["融资对赌","旧城改造","平台算法与劳动权益"],"worldRuleSeeds":["资本与人脉都有代价","法律和舆论会约束行动","没有宗门与修仙境界"],"forbiddenElements":["修仙境界","境界","宗门修炼","宗门","法术飞升"]}$json$::jsonb,
	NULL
),
(
	'01a1a6f9-9d9b-7000-8000-000000000202',
	'urban',
	2,
	'都市模板',
	$json${"genre":"都市","world":"现代都市","map":"城市关系图","powerSystem":"能力与资源","factions":"公司与组织","specialElements":["信息差","资本","人脉","平台规则"],"platformRules":"平台规则"}$json$::jsonb,
	$json$[{"key":"no-cultivation","label":"不套用修仙体系","description":"都市题材不得出现宗门修炼和境界突破。"},{"key":"resource-constraint","label":"资源约束选择","description":"资本、人脉、时间和法律风险必须限制行动。"},{"key":"information-gap","label":"信息差推动冲突","description":"关键冲突必须来自谁知道什么以及如何验证。"},{"key":"platform-accountability","label":"平台规则必须可追责","description":"算法、合同和平台治理必须留下证据与申诉路径。"}]$json$::jsonb,
	$json${"worldLabel":"现代都市","powerSystemLabel":"能力与资源","powerLevelLabel":"资源等级","factionLabel":"公司与组织","itemLabel":"资源与人脉"}$json$::jsonb,
	$json${"protagonistArchetypes":["被裁员的项目经理","小城创业者","调查记者"],"conflictSeeds":["融资对赌","旧城改造","平台算法与劳动权益"],"worldRuleSeeds":["资本与人脉都有代价","法律和舆论会约束行动","没有宗门与修仙境界"],"forbiddenElements":["修仙境界","境界","宗门修炼","宗门","法术飞升"]}$json$::jsonb,
	$json${"fromVersion":1,"toVersion":2,"notes":["增加平台规则字段","补充平台问责规则"]}$json$::jsonb
)
ON CONFLICT ("key", "version") DO NOTHING;
--> statement-breakpoint
UPDATE "works"
SET "template_pack_id" = '01a1a6f9-9d9b-7000-8000-000000000001',
	"settings" = jsonb_set(
		"settings",
		'{genrePack}',
		jsonb_build_object(
			'key', 'xianxia',
			'version', 1,
			'fields', (
				SELECT "fields" FROM "genre_packs"
				WHERE "id" = '01a1a6f9-9d9b-7000-8000-000000000001'
			)
		),
		true
	)
WHERE "genre" = 'xianxia'
	AND ("template_pack_id" IS NULL OR "template_pack_id" = '01a1a6f9-9d9b-7000-8000-000000000001')
	AND NOT ("settings" ? 'genrePack');
--> statement-breakpoint
UPDATE "works"
SET "template_pack_id" = '01a1a6f9-9d9b-7000-8000-000000000101',
	"settings" = jsonb_set(
		"settings",
		'{genrePack}',
		jsonb_build_object(
			'key', 'history',
			'version', 1,
			'fields', (
				SELECT "fields" FROM "genre_packs"
				WHERE "id" = '01a1a6f9-9d9b-7000-8000-000000000101'
			)
		),
		true
	)
WHERE "genre" = 'history'
	AND ("template_pack_id" IS NULL OR "template_pack_id" = '01a1a6f9-9d9b-7000-8000-000000000101')
	AND NOT ("settings" ? 'genrePack');
--> statement-breakpoint
UPDATE "works"
SET "template_pack_id" = '01a1a6f9-9d9b-7000-8000-000000000201',
	"settings" = jsonb_set(
		"settings",
		'{genrePack}',
		jsonb_build_object(
			'key', 'urban',
			'version', 1,
			'fields', (
				SELECT "fields" FROM "genre_packs"
				WHERE "id" = '01a1a6f9-9d9b-7000-8000-000000000201'
			)
		),
		true
	)
WHERE "genre" = 'urban'
	AND ("template_pack_id" IS NULL OR "template_pack_id" = '01a1a6f9-9d9b-7000-8000-000000000201')
	AND NOT ("settings" ? 'genrePack');
