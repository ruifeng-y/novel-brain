import { Injectable } from "@nestjs/common";
import {
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  genrePackGenerationGuidanceSchema,
  type StoryBibleCard,
  type StoryBibleCardKey,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import type { StoryBibleWorkContext } from "./story-bible.repository";

interface GenreTemplate {
  premise: string;
  sellingPoints: string[];
  protagonist: string;
  advantage: string;
  worldRules: Array<{ name: string; constraint: string; scope: string }>;
  mainPlot: string;
  subplots: string[];
  ending: string;
  readerPromise: string[];
}

@Injectable()
export class StoryBibleGenerator {
  generate(context: StoryBibleWorkContext): StoryBibleCard[] {
    const template = templateFor(context);
    const guidance = genrePackGenerationGuidanceSchema.safeParse(context.generationGuidance);
    if (guidance.success) {
      template.sellingPoints = [
        ...template.sellingPoints,
        `题材承诺：${guidance.data.worldRuleSeeds.slice(0, 2).join("；")}`,
      ];
      template.subplots = [
        ...template.subplots,
        ...guidance.data.conflictSeeds.slice(0, 2).map((seed) => `冲突种子：${seed}`),
      ];
      template.readerPromise = [
        ...template.readerPromise,
        "题材边界：遵守本题材包的世界规则和术语。",
      ];
    }
    const premise = context.idea?.trim() || template.premise;
    const worldRules = template.worldRules.map((rule) => ({
      id: uuidv7(),
      ...rule,
      exceptions: [],
    }));
    const contents: Record<StoryBibleCardKey, string> = {
      oneSentence: premise,
      sellingPoints: numbered(template.sellingPoints),
      protagonist: template.protagonist,
      goldenFinger: template.advantage,
      worldLaws: worldRules
        .map((rule, index) => `${index + 1}. ${rule.name}：${rule.constraint}`)
        .join("\n"),
      mainPlot: template.mainPlot,
      subplots: numbered(template.subplots),
      ending: template.ending,
      readerPromise: bulleted(template.readerPromise),
    };

    return STORY_BIBLE_CARD_KEYS.map((key) => ({
      key,
      title: STORY_BIBLE_CARD_TITLES[key],
      content: contents[key],
      complete: true,
      worldRules: key === "worldLaws" ? worldRules : [],
    }));
  }
}

function templateFor(context: StoryBibleWorkContext): GenreTemplate {
  switch (context.genre) {
    case "history":
      return {
        premise: `《${context.title}》讲述一名寒门军校在架空王朝的粮道、军权和门阀夹缝中守住边城的故事。`,
        sellingPoints: [
          "粮道与军制决定胜负，计策必须落到补给、地形和人心。",
          "主角靠军功与制度博弈上升，不依赖修仙境界。",
          "门阀、边军与皇权的立场变化会持续改写局势。",
        ],
        protagonist:
          "主角：寒门出身，懂粮道与军务，却必须在门阀和军府之间隐藏真实目标。核心欲望是守住边城与军功，核心恐惧是再次因无权而失去同伴。",
        advantage:
          "核心优势：对粮道、驿传和军功簿的熟悉。每次调用资源都要承担政治后果，不能凭空获得兵权或物资。",
        worldRules: [
          {
            name: "粮道约束",
            constraint: "军队规模、行军速度和驻守时间必须受粮草、道路与季节限制。",
            scope: "战争、迁徙与城防",
          },
          {
            name: "制度权限",
            constraint: "皇权、军府、门阀与地方的权限必须明确，升迁和调兵需要程序或战功依据。",
            scope: "政治与军事行动",
          },
          {
            name: "知识边界",
            constraint: "关键情报必须通过谍报、文书或亲历获得，人物不能凭空预知。",
            scope: "谍报与信息揭示",
          },
        ],
        mainPlot:
          "主线：主角从边军底层起步，追查一场粮道断绝背后的门阀交易，在边城存亡与个人军功之间作出选择。",
        subplots: [
          "军府内部：寒门军官与世家将领从互相提防到有限合作。",
          "旧案线索：多年前的军粮案逐步指向朝中权力更替。",
        ],
        ending: "结局方向：主角以可验证的军功和制度程序守住边城，但必须承担权力重组后的长期代价。",
        readerPromise: [
          "谋略可信：计策受粮道、地形、情报与制度约束。",
          "成长可见：军职与影响力提升必须有战功和程序依据。",
          "人物底线：敌对人物有利益与立场，不靠降智推动冲突。",
          "节奏承诺：每三章至少推进一次军务、情报或政治目标。",
        ],
      };
    case "urban":
      return {
        premise: `《${context.title}》讲述一名被裁员的项目经理在现代都市中追查平台规则与旧城改造利益链的故事。`,
        sellingPoints: [
          "资本、人脉、法律与舆论共同约束选择，不靠修仙体系解决问题。",
          "信息差和验证过程推动冲突，反转必须留下证据。",
          "主角靠组织能力与资源整合成长，每次行动都有现实代价。",
        ],
        protagonist:
          "主角：熟悉项目管理和资源协调，却因一次裁员跌出原有圈层。核心欲望是重新掌控职业命运，核心恐惧是再次被组织当作可替换零件。",
        advantage:
          "核心资源：信息整合与跨圈层协作能力。每次调动人脉或资本都要付出信用、时间或法律风险。",
        worldRules: [
          {
            name: "资源约束",
            constraint: "资本、人脉、时间和法律风险必须限制行动，关键资源不能凭空出现。",
            scope: "商业、职场与城市治理",
          },
          {
            name: "信息验证",
            constraint: "关键信息必须通过文件、采访、数据或亲历获得，并保留来源。",
            scope: "调查与冲突升级",
          },
          {
            name: "平台责任",
            constraint: "算法、合同和组织决策必须留下可追溯证据与申诉路径。",
            scope: "平台治理与组织冲突",
          },
        ],
        mainPlot:
          "主线：主角在旧城改造项目中追查一份被隐藏的平台评估报告，在职业复出、伙伴利益与公共责任之间作出选择。",
        subplots: [
          "前同事关系：从利益交换到重新建立信任。",
          "家庭压力：职业选择与家庭责任持续互相拉扯。",
        ],
        ending: "结局方向：主角公开关键证据并建立新的协作机制，但必须承担职业与关系上的长期后果。",
        readerPromise: [
          "现实约束：资本、法律、舆论和组织规则共同生效。",
          "成长可见：主角的资源和信用变化有来源、有代价。",
          "人物底线：对手有组织目标与行动逻辑。",
          "节奏承诺：每三章至少推进一次调查、谈判或关系变化。",
        ],
      };
    case "xianxia":
    default:
      return {
        premise: `《${context.title}》讲述一名普通修士在仙途中寻找自身来历与选择的故事。`,
        sellingPoints: [
          "每次成长都需要付出清晰代价，爽感与压力同步推进。",
          "主角的选择会改变身边人的立场，关系变化推动剧情。",
          "开篇埋下的身世线索贯穿主线，并在结局前完成回收。",
        ],
        protagonist:
          "主角：从底层起步，必须在不暴露真实来历的情况下争取生存空间。核心欲望是被认可，核心恐惧是再次失去重要之人。",
        advantage:
          "金手指：核心机缘。获得超出常人的能力时，必须支付不可逆的代价；每次使用都有明确边界，并随主线逐步成长。",
        worldRules: [
          {
            name: "境界差距",
            constraint: "境界差距不能靠情绪直接抹平，越阶必须付出寿元、资源或关系代价。",
            scope: "所有战斗与冲突",
          },
          {
            name: "力量来源",
            constraint: "所有力量都有来源与限制，不存在无代价复活。",
            scope: "修炼、法术、物品与复活",
          },
          {
            name: "知识边界",
            constraint: "关键真相必须由可追溯的线索支撑，人物不能凭空知道。",
            scope: "角色认知与信息揭示",
          },
        ],
        mainPlot:
          "主线：主角从被边缘化的处境出发，追查自身与核心机缘的来历，在宗门、盟友与敌对势力之间做出选择，最终直面故事开篇留下的最大秘密。",
        subplots: [
          "师门关系：从互相利用到建立信任，再因立场不同产生裂痕。",
          "身世线索：分散在早期细节中的证据逐步拼合，指向主线真相。",
        ],
        ending:
          "结局方向：主角在守护重要之人与完成个人目标之间作出不可逆选择，回收开篇承诺，同时保留余韵。",
        readerPromise: [
          "升级爽感：成长必须可见，但每次突破都有代价。",
          "长线伏笔：重要线索早期埋设，后文给出可验证的回收。",
          "人物底线：反派有目标与逻辑，主角不靠降智冲突取胜。",
          "节奏承诺：每三章至少推进一次目标、冲突或关键信息。",
        ],
      };
  }
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function bulleted(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
