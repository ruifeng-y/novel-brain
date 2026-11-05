import { Injectable } from "@nestjs/common";
import {
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  type StoryBibleCard,
  type StoryBibleCardKey,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import type { StoryBibleWorkContext } from "./story-bible.repository";

@Injectable()
export class StoryBibleGenerator {
  generate(context: StoryBibleWorkContext): StoryBibleCard[] {
    const premise =
      context.idea?.trim() ||
      `《${context.title}》讲述一名普通修士在仙途中寻找自身来历与选择的故事。`;
    const worldRules = [
      {
        id: uuidv7(),
        name: "境界差距",
        constraint: "境界差距不能靠情绪直接抹平，越阶必须付出寿元、资源或关系代价。",
        scope: "所有战斗与冲突",
        exceptions: [],
      },
      {
        id: uuidv7(),
        name: "力量来源",
        constraint: "所有力量都有来源与限制，不存在无代价复活。",
        scope: "修炼、法术、物品与复活",
        exceptions: [],
      },
      {
        id: uuidv7(),
        name: "知识边界",
        constraint: "关键真相必须由可追溯的线索支撑，人物不能凭空知道。",
        scope: "角色认知与信息揭示",
        exceptions: [],
      },
    ];
    const contents: Record<StoryBibleCardKey, string> = {
      oneSentence: premise,
      sellingPoints: [
        "1. 每次成长都需要付出清晰代价，爽感与压力同步推进。",
        "2. 主角的选择会改变身边人的立场，关系变化推动剧情。",
        "3. 开篇埋下的身世线索贯穿主线，并在结局前完成回收。",
      ].join("\n"),
      protagonist: `主角：从底层起步，必须在不暴露真实来历的情况下争取生存空间。核心欲望是被认可，核心恐惧是再次失去重要之人。`,
      goldenFinger: `金手指：${context.title}的核心机缘。获得超出常人的能力时，必须支付不可逆的代价；每次使用都有明确边界，并随主线逐步成长。`,
      worldLaws: worldRules
        .map((rule, index) => `${index + 1}. ${rule.name}：${rule.constraint}`)
        .join("\n"),
      mainPlot: `主线：主角从被边缘化的处境出发，追查自身与核心机缘的来历，在宗门、盟友与敌对势力之间做出选择，最终直面故事开篇留下的最大秘密。`,
      subplots: [
        "1. 师门关系：从互相利用到建立信任，再因立场不同产生裂痕。",
        "2. 身世线索：分散在早期细节中的证据逐步拼合，指向主线真相。",
      ].join("\n"),
      ending: `结局方向：主角在守护重要之人与完成个人目标之间作出不可逆选择，回收开篇承诺，同时保留余韵。`,
      readerPromise: [
        "升级爽感：成长必须可见，但每次突破都有代价。",
        "长线伏笔：重要线索早期埋设，后文给出可验证的回收。",
        "人物底线：反派有目标与逻辑，主角不靠降智冲突取胜。",
        "节奏承诺：每三章至少推进一次目标、冲突或关键信息。",
      ].join("\n"),
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
