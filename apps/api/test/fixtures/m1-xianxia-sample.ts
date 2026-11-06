import { createHash } from "node:crypto";

export const M1_XIANXIA_SAMPLE_VERSION = "m1-xianxia-sample-v1" as const;
export const M1_XIANXIA_SAMPLE_SEED = 20261106 as const;
export const M1_XIANXIA_SAMPLE_CHAPTER_COUNT = 40 as const;
export const M1_XIANXIA_SAMPLE_TARGET_CHARS = 120_000 as const;
export const M1_XIANXIA_SAMPLE_EXPECTED_CHARACTERS = 122_696 as const;
export const M1_XIANXIA_SAMPLE_SOURCE_HASH =
  "b7df9ec5e031ac593f8c2d34dab08ddecf79ec94aee44e3aef09bd11dd285466" as const;

const BASE_SENTENCES = [
  "山雨压在荒寺的瓦上，沈砚把断臂藏进袖中，沿着石阶往北走。",
  "顾青跟在他身后三步，剑鞘上的铜环一声一声敲着夜色。",
  "血河宗的追兵举着火把，火光在山道尽头连成一条赤线。",
  "沈砚停在一株枯松前，听见忘川书在怀里翻页。",
  "书页上没有字，只有他曾经忘记的一段呼吸。",
  "他看见母亲把旧信压在箱底，也看见父亲在雨里回头。",
  "顾青问他看见了什么，他只说风太大。",
  "远处钟声未响，天门方向的云却先裂开了一道缝。",
  "山门前的石兽缺了一只眼睛，雨水从空洞里流下来。",
  "沈砚把最后一枚铜钱按在碑上，碑文短暂地亮了一瞬。",
  "追兵在山道上停住，像是听见了不属于这座山的回声。",
  "顾青握剑的手很稳，袖口却已经被雨浸透。",
  "忘川书翻到第七页，纸面浮出一行陌生人的笔迹。",
  "沈砚没有伸手去碰，他知道每一页都要用记忆来换。",
  "风从北面来，带着血河城特有的铁锈味。",
  "两人沿着断崖绕行，脚下的碎石不断滚进深谷。",
  "顾青忽然停下，说前面有人刚刚走过。",
  "沈砚看见泥地里有一枚血河宗的铜牌，牌背刻着旧日期。",
  "旧日期正是父母出事的那一夜。",
  "他把铜牌收进袖中，没有让顾青看见。",
  "山中的雾越来越重，火把只能照出三步远。",
  "有人在雾里低声念经，声音像从水底传来。",
  "沈砚认出那是太玄门送葬时才用的经文。",
  "顾青问他是否害怕，他说怕，但不能退。",
  "两人继续往北，身后的火光没有追上来。",
  "天快亮时，荒寺的钟终于响了一声。",
  "钟声落下，山道两侧的雨幕同时静了一瞬。",
  "沈砚在石阶上看见自己的影子，影子比他多出一只手。",
  "他闭上眼睛，听见忘川书又翻过一页。",
  "再睁眼时，前路已经多出一条从未走过的小径。",
] as const;

const PARAGRAPH_BREAK_EVERY = 3;

export interface M1XianxiaSampleChapter {
  number: number;
  title: string;
  content: string;
}

export interface M1XianxiaSample {
  version: typeof M1_XIANXIA_SAMPLE_VERSION;
  seed: typeof M1_XIANXIA_SAMPLE_SEED;
  chapterCount: typeof M1_XIANXIA_SAMPLE_CHAPTER_COUNT;
  targetCharacters: typeof M1_XIANXIA_SAMPLE_TARGET_CHARS;
  actualCharacters: number;
  sourceHash: string;
  chapters: M1XianxiaSampleChapter[];
}

export function createM1XianxiaSample(): M1XianxiaSample {
  const chapters = Array.from({ length: M1_XIANXIA_SAMPLE_CHAPTER_COUNT }, (_, index) =>
    generateChapter(index + 1),
  );
  const actualCharacters = chapters.reduce((total, chapter) => total + chapter.content.length, 0);
  const sourceHash = createHash("sha256")
    .update(
      chapters
        .map((chapter) => `${chapter.number}\u0000${chapter.title}\u0000${chapter.content}`)
        .join("\u0001"),
    )
    .digest("hex");
  return {
    version: M1_XIANXIA_SAMPLE_VERSION,
    seed: M1_XIANXIA_SAMPLE_SEED,
    chapterCount: M1_XIANXIA_SAMPLE_CHAPTER_COUNT,
    targetCharacters: M1_XIANXIA_SAMPLE_TARGET_CHARS,
    actualCharacters,
    sourceHash,
    chapters,
  };
}

export function sampleChapter(number: number): string {
  return generateChapter(number).content;
}

function generateChapter(number: number): M1XianxiaSampleChapter {
  const random = mulberry32(M1_XIANXIA_SAMPLE_SEED + number * 7919);
  const paragraphs: string[] = [];
  let sentenceCount = 0;
  let length = 0;
  while (length < 3_200) {
    const sentence = BASE_SENTENCES[Math.floor(random() * BASE_SENTENCES.length)]!;
    paragraphs.push(sentence);
    length += sentence.length + 1;
    sentenceCount += 1;
    if (sentenceCount % PARAGRAPH_BREAK_EVERY === 0) {
      length += 2;
    }
  }
  if (number === 1) {
    paragraphs.unshift("沈砚把父母的旧信压在箱底。");
  }
  if (number === 8) {
    paragraphs.push("沈砚踏入筑基，又在一炷香内踏入金丹。");
  }
  if (number === 12) {
    paragraphs.push("罗刹长老胜券在握，只派两名弟子追赶，自己回城庆功。");
    paragraphs.push("沈砚反杀追兵，带着顾青脱身。");
  }
  if (number === 20) {
    paragraphs.push("沈砚收起断刀，转身离开，不再战斗。");
  }
  if (number === 24) {
    paragraphs.push("沈砚忽然明白，父母死于仇杀。");
  }
  if (number === 30) {
    paragraphs.push("天门洞开。");
  }
  if (number === 31) {
    paragraphs.push("沈砚走进血河城。");
  }
  const content = paragraphs
    .map((paragraph, index) =>
      index % PARAGRAPH_BREAK_EVERY === 0 ? `\n\n${paragraph}` : paragraph,
    )
    .join("")
    .trim();
  return {
    number,
    title: `忘川 ${number}`,
    content,
  };
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
