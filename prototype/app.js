const pageLabels = {
  dashboard: "工作台",
  "new-project": "新建作品",
  "work-overview": "作品总览",
  bible: "故事圣经",
  settings: "设定中心",
  outline: "大纲工作台",
  foreshadows: "伏笔账本",
  writing: "写作台",
  batch: "批量生产",
  changes: "修改与版本",
  "export-publish": "导出与发布",
  "entity-detail": "档案详情",
  "work-settings": "作品设置",
  legal: "法律与合规",
  help: "帮助",
  states: "界面状态",
  auth: "登录与注册",
  "account-settings": "账号与模型",
};

const validPages = new Set(Object.keys(pageLabels));
const pageTitles = {
  dashboard: "工作台 · 墨舟",
  "new-project": "新建作品 · 墨舟",
  "work-overview": "作品总览 · 墨舟",
  bible: "故事圣经 · 墨舟",
  settings: "设定中心 · 墨舟",
  outline: "大纲工作台 · 墨舟",
  foreshadows: "伏笔账本 · 墨舟",
  writing: "写作台 · 墨舟",
  batch: "批量生产 · 墨舟",
  changes: "修改与版本 · 墨舟",
  "export-publish": "导出与发布 · 墨舟",
  "entity-detail": "档案详情 · 墨舟",
  "work-settings": "作品设置 · 墨舟",
  legal: "法律与合规 · 墨舟",
  help: "帮助 · 墨舟",
  states: "界面状态 · 墨舟",
  auth: "登录与注册 · 墨舟",
  "account-settings": "账号与模型 · 墨舟",
};

const accountPages = new Set([
  "dashboard",
  "new-project",
  "account-settings",
  "states",
  "auth",
  "legal",
  "help",
]);
const workPages = new Set([
  "work-overview",
  "bible",
  "settings",
  "outline",
  "foreshadows",
  "writing",
  "batch",
  "changes",
  "export-publish",
  "entity-detail",
  "work-settings",
]);

const chapters = {
  45: {
    title: "血河渡口",
    paragraphs: [
      "血河渡口的灯一直亮着，像一只不肯闭上的眼睛。",
      "沈砚把斗笠压得更低，混在赶夜路的商队里。他听见有人在讨论血河宗，说最近南境不太平，连着三座小镇都被抽干了水。",
      "顾青走在他半步之后，剑没有出鞘，手却始终按在剑柄上。",
      "“别回头。”顾青低声说，“他们已经看见我们了。”",
    ],
  },
  46: {
    title: "夜船",
    paragraphs: [
      "夜船靠岸时，河面上浮着一层薄雾。",
      "沈砚先看见的是船头那盏白灯笼，然后才看见灯下的人。那人穿着一身洗得发白的青衫，正低头擦一枚半旧的玉佩。",
      "顾青的脚步停了一瞬。",
      "很轻的一瞬，但沈砚还是看见了。",
      "“上船。”顾青说。",
      "沈砚没有问那枚玉佩是谁的。他只是把左袖往里收了收，遮住袖口没有干透的血。",
    ],
  },
  47: {
    title: "断臂之后",
    paragraphs: [
      "血从袖口滴下来，落在青石板上，像一串没有写完的省略号。",
      "沈砚把左臂往袖中缩了缩，指节已经发白。他听见身后脚步声逼近，知道血河宗的人没有走远。",
      "“你还能打？”顾青问。",
      "“能。”",
      "沈砚没有回头。他试着抬起左手，骨头里立刻传来一阵钝痛，像有人拿烧红的铁签慢慢搅动。那本古书在识海里翻了一页，纸声很轻，却让他想起一件已经想不起来的事。",
      '<span class="comment-mark" data-comment="这里左臂还断着，不能双手结印。建议改成单手结印，或让顾青替他挡下第一击。">他双手结印，灵力在掌心凝成一道细线。</span>',
      "顾青的眼神变了。",
      "那道细线没有撑过一息，便碎成满掌的血。沈砚踉跄半步，右膝重重跪地，却趁势把断臂藏到身后。",
      "“我说了，能。”",
      "顾青没有拆穿他。他只是把手按在剑柄上，望向夜色里越来越近的火光。",
      "“那就跑。”",
    ],
  },
  48: {
    title: "一只手也能结印",
    paragraphs: [
      "天快亮的时候，沈砚终于承认自己跑不动了。",
      "左臂已经彻底失去知觉，像一截挂在肩上的枯枝。顾青把他按在一棵老树后，抬手示意他别出声。",
      "追兵的火光从坡下掠过，越来越近。",
      "沈砚咬住袖口，用右手掐了一个残缺的印。识海里的古书没有翻页，只是轻轻震了一下。",
      "他忽然想起一个不属于自己的动作：单手持剑，以身作阵。",
      "顾青回头看了他一眼。",
      "那一眼里没有惊讶，只有一种很慢的、终于确认了什么的了然。",
    ],
  },
  49: {
    title: "顾青的试探",
    paragraphs: [
      "顾青没有问他从哪里学来的那招。",
      "他只是把半枚青玉放在石头上，推到沈砚面前。",
      "“你见过这个吗？”",
      "沈砚低头看了一眼。玉上有一道旧裂纹，裂纹里嵌着一点暗红，像干涸的血。",
      "他确实见过。在忘川村那场大火之后，在母亲把他塞进地窖之前。",
      "但他摇了摇头。",
      "顾青看着他，很久没有说话。",
    ],
  },
};

const entityProfiles = {
  "shen-yan": {
    id: "shen-yan",
    name: "沈砚",
    avatar: "沈",
    avatarClass: "",
    kicker: "人物档案",
    role: "主角",
    roleTone: "live",
    arc: "外门杂役 → 执剑人 → 天门守门人",
    status: "已锁定",
    source: "作者创建",
    aliases: "小砚、沈执剑",
    type: "人物",
    scope: "全书",
    summary:
      "外冷内热的边城少年，靠忘川书逆天改命，正在寻找母亲失踪的真相。他以为父母死于自杀，但这条认知会在第 120 章被推翻。",
    tags: ["主角", "记忆代价", "身世之谜", "左臂骨折"],
    quickFacts: [
      { label: "当前境界", value: "练气七层", meta: "第 31 章突破" },
      { label: "当前位置", value: "东境 · 忘川渡", meta: "第 46 章抵达" },
      {
        label: "身体状态",
        value: "左臂骨折",
        meta: "第 47 章起 · 预计第 53 章痊愈",
        tone: "alert",
      },
      { label: "记忆完整度", value: "62 / 100", meta: "忘川书代价", tone: "gold" },
    ],
    drives: [
      { label: "欲望", value: "证明自己不靠太玄门也能活" },
      { label: "恐惧", value: "再次被亲近的人抛弃" },
      { label: "秘密", value: "忘川书每用一次，就吞掉一段记忆" },
    ],
    knowledge: [
      {
        state: "相信",
        tone: "gold",
        text: "父母是自杀",
        reveal: "第 1–119 章",
        detail: "第 120 章真相揭开后，才改为“知道是仇杀”。此前内心戏不得让他主动怀疑。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "玄微真人是灭门决策者",
        reveal: "第 120 章揭示",
        detail: "当前把掌门视为正道支柱，不能提前露出敌意。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "顾青受命监视自己",
        reveal: "第 68 章怀疑 · 第 74 章确认",
        detail: "当前仍把顾青当作可信的师兄。",
      },
      {
        state: "知道",
        tone: "jade",
        text: "忘川书会吞噬记忆",
        reveal: "第 31 章起",
        detail: "但不知道缺失书页里藏着前人的完整人格。",
      },
      {
        state: "隐藏",
        tone: "",
        text: "自己已经能单手结印",
        reveal: "第 48 章",
        detail: "不能让顾青看见完整过程。",
      },
    ],
    customFields: [
      { label: "血脉来源", value: "人族" },
      { label: "记忆完整度", value: "62 / 100" },
      { label: "本命法宝", value: "忘川书" },
      { label: "是否已飞升", value: "否" },
      { label: "人物小传", value: "边城长大，母亲失踪后独自入山。" },
    ],
    relations: [
      {
        type: "师兄弟",
        tone: "jade",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "表面照拂，实际受命监视；卷三立场决裂。",
        knowledge: "沈砚信任顾青；顾青知道沈砚身世。",
      },
      {
        type: "仇敌 · 未知",
        tone: "alert",
        name: "玄微真人",
        target: "人物",
        entityId: "xuanwei",
        note: "杀亲嫌疑；沈砚当前把对方视为正道支柱。",
        knowledge: "沈砚不知道；玄微真人知道全部真相。",
      },
      {
        type: "本命法宝",
        tone: "gold",
        name: "忘川书",
        target: "物品",
        note: "每使用一次失去一段重要记忆，书页会逐渐减少。",
        knowledge: "沈砚知道代价，不知道缺失书页的去向。",
      },
      {
        type: "出身宗门",
        tone: "",
        name: "太玄门",
        target: "势力",
        note: "外门杂役，当前已离开山门。",
        knowledge: "沈砚不知道宗门以记忆为贡品维持护山大阵。",
      },
      {
        type: "被追杀",
        tone: "alert",
        name: "血河宗",
        target: "势力",
        note: "血河夜行后持续追捕，目标也是忘川书。",
        knowledge: "沈砚知道被追，不知道对方掌握多少。",
      },
      {
        type: "身世线索",
        tone: "gold",
        name: "半枚青玉",
        target: "物品",
        note: "顾青随身携带；与忘川村旧案有关。",
        knowledge: "沈砚见过，但选择否认。",
      },
    ],
    history: [
      { chapter: "第 1 章", title: "练气三层", note: "外门杂役，隐藏忘川书", tone: "done" },
      {
        chapter: "第 16 章",
        title: "父母之死被伪装成自杀",
        note: "角色认知：相信父母自杀",
        tone: "done",
      },
      { chapter: "第 31 章", title: "练气七层", note: "第一次借前人经验破阵", tone: "done" },
      { chapter: "第 46 章", title: "夜船见青玉", note: "认出旧玉，但选择否认", tone: "done" },
      {
        chapter: "第 47 章",
        title: "左臂骨折",
        note: "不能双手结印，预计第 53 章痊愈",
        tone: "active",
      },
      {
        chapter: "第 53 章",
        title: "预计痊愈",
        note: "状态有效期结束；若延期需走修改请求",
        tone: "future",
      },
      {
        chapter: "第 58 章",
        title: "预计突破失败",
        note: "大纲预留：第一次筑基失败",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 2,860 字",
      },
      {
        page: "outline",
        icon: "list-tree",
        title: "第 48 章 · 一只手也能结印",
        meta: "章纲引用 · POV 沈砚",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 主角卡",
        meta: "故事圣经引用",
      },
      {
        page: "writing",
        chapter: "49",
        icon: "file-text",
        title: "第 49 章 · 顾青的试探",
        meta: "正文引用 · 青玉与身世",
      },
      {
        page: "settings",
        tab: "confirmed",
        icon: "badge-check",
        title: "已确认设定 · 左臂骨折",
        meta: "世界事实 · 第 47–53 章",
      },
    ],
    health: {
      score: 86,
      summary: "核心信息完整，仍有 3 个待补项",
      items: [
        { tone: "jade", title: "基础档案完整", note: "名称、类型、摘要、标签齐全" },
        { tone: "gold", title: "声纹样本不足", note: "只有 1 段对话样本，建议补到 3 段" },
        { tone: "alert", title: "母亲档案缺失", note: "父母之死伏笔需要关联母亲人物卡" },
        { tone: "gold", title: "左臂状态有效期", note: "第 53 章必须回收或续期" },
      ],
    },
  },
  "gu-qing": {
    id: "gu-qing",
    name: "顾青",
    avatar: "顾",
    avatarClass: "jade-avatar",
    kicker: "人物档案",
    role: "核心配角",
    roleTone: "",
    arc: "太玄门内门弟子 → 监视者 → 立场动摇",
    status: "已锁定",
    source: "作者创建",
    aliases: "顾师兄",
    type: "人物",
    scope: "全书",
    summary:
      "太玄门内门师兄，天赋极佳。表面照拂沈砚，实则受命监视他。青玉让他第一次开始怀疑师门，也让他成为最早知道沈砚身世的人。",
    tags: ["核心配角", "监视者", "青玉", "立场动摇"],
    quickFacts: [
      { label: "当前境界", value: "筑基三层", meta: "第 1 章起" },
      { label: "当前位置", value: "东境 · 忘川渡", meta: "第 46 章" },
      { label: "关键持有", value: "半枚青玉", meta: "与沈砚身世有关", tone: "gold" },
      { label: "立场", value: "动摇", meta: "第 68 章开始怀疑师门", tone: "gold" },
    ],
    drives: [
      { label: "欲望", value: "证明师门清白" },
      { label: "恐惧", value: "发现自己守的并不是正道" },
      { label: "秘密", value: "受命监视沈砚，并知道他的身世" },
    ],
    knowledge: [
      {
        state: "知道",
        tone: "jade",
        text: "沈砚的真实身世",
        reveal: "第 1 章起",
        detail: "一直没有告诉沈砚；卷三决裂前仍在替师门隐瞒。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "玄微真人参与灭门",
        reveal: "第 74 章确认",
        detail: "此前相信掌门只是掩盖旧案，而不是决策者。",
      },
      {
        state: "怀疑",
        tone: "gold",
        text: "沈砚身怀古书",
        reveal: "第 47 章",
        detail: "从断臂后的单手结印开始怀疑，但还没有拿到证据。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "沈砚已经察觉青玉",
        reveal: "第 49 章",
        detail: "沈砚当面否认见过青玉，顾青没有拆穿。",
      },
    ],
    customFields: [
      { label: "血脉来源", value: "人族" },
      { label: "师承", value: "太玄门 · 玄微真人" },
      { label: "本命法器", value: "听潮剑" },
      { label: "是否已飞升", value: "否" },
      { label: "人物小传", value: "自幼被太玄门收养，把宗门当作唯一的家。" },
    ],
    relations: [
      {
        type: "师兄弟",
        tone: "jade",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "表面照拂，实际受命监视；第 74 章后开始真正动摇。",
        knowledge: "顾青知道沈砚身世；沈砚不知道顾青知道。",
      },
      {
        type: "师徒",
        tone: "",
        name: "玄微真人",
        target: "人物",
        entityId: "xuanwei",
        note: "授业恩师，也是下达监视命令的人。",
        knowledge: "顾青信任掌门；掌门不知道顾青已经开始怀疑。",
      },
      {
        type: "持有",
        tone: "gold",
        name: "半枚青玉",
        target: "物品",
        note: "夜船上第一次出示；与忘川村旧案有关。",
        knowledge: "顾青知道来历，但一直没有解释。",
      },
      {
        type: "配剑",
        tone: "",
        name: "听潮剑",
        target: "物品",
        note: "太玄门内门弟子配剑，剑身会记录持剑者的杀意。",
        knowledge: "顾青知道剑的记录能力，沈砚不知道。",
      },
      {
        type: "出身宗门",
        tone: "jade",
        name: "太玄门",
        target: "势力",
        note: "自幼被宗门收养，内门重点弟子。",
        knowledge: "顾青不知道宗门以记忆为贡品。",
      },
    ],
    history: [
      { chapter: "第 1 章", title: "筑基三层", note: "以内门师兄身份接近沈砚", tone: "done" },
      { chapter: "第 46 章", title: "夜船出示青玉", note: "第一次让沈砚看见旧玉", tone: "done" },
      { chapter: "第 47 章", title: "看见沈砚断臂", note: "开始怀疑他隐藏了手段", tone: "done" },
      {
        chapter: "第 48 章",
        title: "确认沈砚能单手结印",
        note: "没有拆穿，但判断他身怀古书",
        tone: "active",
      },
      { chapter: "第 49 章", title: "用青玉试探", note: "沈砚当面否认", tone: "future" },
      { chapter: "第 68 章", title: "开始怀疑师门", note: "计划节点", tone: "future" },
      { chapter: "第 74 章", title: "确认灭门真相", note: "立场正式动摇", tone: "future" },
      { chapter: "卷三", title: "与沈砚决裂", note: "具体章节待大纲锁定", tone: "future" },
    ],
    references: [
      {
        page: "writing",
        chapter: "46",
        icon: "file-text",
        title: "第 46 章 · 夜船",
        meta: "正文引用 · 青玉首次出现",
      },
      {
        page: "writing",
        chapter: "48",
        icon: "file-text",
        title: "第 48 章 · 一只手也能结印",
        meta: "正文引用 · 顾青的确认",
      },
      {
        page: "writing",
        chapter: "49",
        icon: "file-text",
        title: "第 49 章 · 顾青的试探",
        meta: "正文引用 · 青玉与否认",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "顾青的玉佩",
        meta: "伏笔引用 · 第 64 章计划回收",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 配角卡",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 78,
      summary: "人物动机成立，但立场转变缺少中间事件",
      items: [
        { tone: "jade", title: "基础档案完整", note: "身份、欲望、秘密和关系齐全" },
        { tone: "gold", title: "声纹样本不足", note: "只有 2 段对话样本，建议补到 3 段" },
        { tone: "alert", title: "立场转变过快", note: "第 68 章怀疑到第 74 章确认之间缺少触发事件" },
        { tone: "gold", title: "青玉来源未关联", note: "需要补充青玉与忘川村旧案的具体来源" },
      ],
    },
  },
  xuanwei: {
    id: "xuanwei",
    name: "玄微真人",
    avatar: "玄",
    avatarClass: "cinnabar-avatar",
    kicker: "人物档案",
    role: "反派",
    roleTone: "alert",
    arc: "太玄门掌门 → 灭门决策者 → 天门守门人",
    status: "已锁定",
    source: "作者创建",
    aliases: "玄微、掌门",
    type: "人物",
    scope: "全书",
    summary:
      "太玄门掌门，正道魁首。为了守住天门，他参与了沈砚父母的灭门案，并把真相伪装成自杀。他相信自己在做必要之恶。",
    tags: ["反派", "灭门真相", "天门守门人", "记忆贡品"],
    quickFacts: [
      { label: "当前境界", value: "金丹九层", meta: "人界篇巅峰" },
      { label: "当前位置", value: "太玄门 · 山门", meta: "第 47 章" },
      { label: "隐藏动机", value: "守住天门", meta: "不惜以记忆为贡品", tone: "alert" },
      { label: "掌握真相", value: "全部", meta: "包括沈砚身世", tone: "gold" },
    ],
    drives: [
      { label: "欲望", value: "守住天门，避免人界被灵气反噬" },
      { label: "恐惧", value: "天门开启后旧案曝光，宗门崩塌" },
      { label: "秘密", value: "沈砚父母的死是他亲自做的决策" },
    ],
    knowledge: [
      {
        state: "知道",
        tone: "jade",
        text: "沈砚的真实身世",
        reveal: "第 1 章起",
        detail: "一直知道，并安排顾青监视。",
      },
      {
        state: "知道",
        tone: "jade",
        text: "忘川书在沈砚身上",
        reveal: "第 31 章后确认",
        detail: "但不清楚书页缺失的完整机制。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "顾青已经动摇",
        reveal: "第 74 章后",
        detail: "仍相信顾青会以宗门为重。",
      },
      {
        state: "相信",
        tone: "gold",
        text: "沈砚仍被蒙在鼓里",
        reveal: "第 1–119 章",
        detail: "第 120 章真相揭开后失效。",
      },
    ],
    customFields: [
      { label: "血脉来源", value: "人族" },
      { label: "宗门职位", value: "太玄门掌门" },
      { label: "本命法宝", value: "镇门印" },
      { label: "是否已飞升", value: "否" },
      { label: "人物小传", value: "亲眼见过天门失控，从此把守门视为高于一切的使命。" },
    ],
    relations: [
      {
        type: "杀亲 · 未知",
        tone: "alert",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "灭门案决策者；当前以正道长辈身份照拂沈砚。",
        knowledge: "玄微真人知道全部真相；沈砚不知道。",
      },
      {
        type: "师徒",
        tone: "",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "授业恩师，也是监视命令的下达者。",
        knowledge: "玄微真人不知道顾青已经开始怀疑。",
      },
      {
        type: "掌门",
        tone: "jade",
        name: "太玄门",
        target: "势力",
        note: "以记忆为贡品维持护山大阵。",
        knowledge: "完全掌握贡品机制和旧案。",
      },
      {
        type: "守护",
        tone: "gold",
        name: "天门",
        target: "地点",
        note: "天门开启会引发灵气反噬，守门是他的核心动机。",
        knowledge: "知道天门只认完整记忆。",
      },
      {
        type: "利用",
        tone: "alert",
        name: "记忆贡品",
        target: "规则",
        note: "以弟子记忆维持护山大阵，是宗门最高机密。",
        knowledge: "只有掌门和少数长老知道。",
      },
    ],
    history: [
      {
        chapter: "十六年前",
        title: "决定灭门",
        note: "为守住天门，参与忘川村灭门案",
        tone: "done",
      },
      {
        chapter: "三年前",
        title: "安排沈砚入宗",
        note: "以杂役身份把沈砚放在眼皮底下",
        tone: "done",
      },
      { chapter: "第 18 章", title: "首次正面出场", note: "以正道魁首身份救下沈砚", tone: "done" },
      {
        chapter: "第 47 章",
        title: "下令追查忘川书",
        note: "开始怀疑沈砚已经激活古书",
        tone: "active",
      },
      { chapter: "第 52 章", title: "与沈砚夜谈", note: "试探他对父母之死的记忆", tone: "future" },
      { chapter: "第 120 章", title: "真相揭开", note: "灭门决策者身份暴露", tone: "future" },
    ],
    references: [
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 追兵命令",
      },
      {
        page: "outline",
        icon: "list-tree",
        title: "第 52 章 · 掌门夜谈",
        meta: "章纲引用 · 核心反转铺垫",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 反派卡",
        meta: "故事圣经引用",
      },
      {
        page: "settings",
        tab: "confirmed",
        icon: "badge-check",
        title: "已确认设定 · 灭门真相",
        meta: "世界事实 · 第 120 章前保密",
      },
    ],
    health: {
      score: 82,
      summary: "动机成立，但救人与灭门之间缺少桥接",
      items: [
        { tone: "jade", title: "反派动机完整", note: "守天门、记忆贡品和旧案形成闭环" },
        { tone: "alert", title: "第 18 章救人动机待补", note: "需要解释他为何亲自救下沈砚" },
        { tone: "gold", title: "与顾青的边界未定", note: "需要明确监视命令的范围和期限" },
        { tone: "gold", title: "天门守身份未关联", note: "建议关联世界规则中的天门条目" },
      ],
    },
  },
  taixuan: {
    id: "taixuan",
    name: "太玄门",
    avatar: "太",
    markClass: "faction-mark jade",
    kicker: "势力档案",
    role: "正道魁首",
    roleTone: "live",
    arc: "东境第一宗门 → 记忆贡品体系 → 护山大阵崩塌",
    status: "已锁定",
    source: "题材包生成 + 作者确认",
    aliases: "太玄、东境第一宗",
    type: "势力",
    scope: "全书",
    summary:
      "东境第一宗门，表面守序，内部以弟子记忆为贡品维持护山大阵。它既是沈砚的出身，也是灭门旧案和天门秘密的核心节点。",
    tags: ["正道魁首", "记忆贡品", "护山大阵", "主角出身"],
    quickFacts: [
      { label: "掌门", value: "玄微真人", meta: "金丹九层" },
      { label: "控制区", value: "东境三十六城", meta: "人界篇" },
      { label: "核心资源", value: "记忆贡品", meta: "护山大阵燃料", tone: "alert" },
      { label: "当前状态", value: "表面稳定", meta: "内部旧案将爆", tone: "gold" },
    ],
    driveTitle: "势力目标",
    driveHint: "目标、资源与软肋",
    drives: [
      { label: "目标", value: "守住天门与东境秩序" },
      { label: "资源", value: "记忆贡品、护山大阵、三十六城" },
      { label: "软肋", value: "灭门旧案与贡品真相" },
    ],
    knowledgeTitle: "信息边界",
    knowledgeHint: "公开信息与门派机密",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "东境第一宗门",
        reveal: "全书",
        detail: "正道魁首，控制东境三十六城，弟子遍布各国。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "护山大阵以记忆为贡品",
        reveal: "第 74 章后逐步揭开",
        detail: "只有掌门和少数长老知道完整机制。",
      },
      {
        state: "机密",
        tone: "alert",
        text: "参与忘川村灭门案",
        reveal: "第 120 章揭示",
        detail: "对外伪装成自杀，内部只有玄微真人知道全部真相。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "顾青已经开始动摇",
        reveal: "第 74 章后",
        detail: "宗门仍认为顾青会以师门为重。",
      },
    ],
    customFields: [
      { label: "势力类型", value: "正道宗门" },
      { label: "控制区", value: "东境三十六城" },
      { label: "护山大阵", value: "记忆贡品驱动" },
      { label: "掌门", value: "玄微真人" },
      { label: "最高机密", value: "忘川村灭门案" },
    ],
    tabLabels: { relations: "势力关系", history: "兴衰时间线" },
    relationsTitle: "势力关系",
    relations: [
      {
        type: "掌门",
        tone: "jade",
        name: "玄微真人",
        target: "人物",
        entityId: "xuanwei",
        note: "金丹九层，正道魁首，掌握护山大阵与旧案。",
        knowledge: "宗门知道他是掌门；不知道他参与灭门。",
      },
      {
        type: "内门弟子",
        tone: "",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "重点培养对象，受命监视沈砚。",
        knowledge: "宗门不知道他已经开始怀疑师门。",
      },
      {
        type: "外门出身",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "外门杂役，当前已离开山门。",
        knowledge: "宗门知道他的身世；他不知道宗门参与了灭门。",
      },
      {
        type: "敌对",
        tone: "alert",
        name: "血河宗",
        target: "势力",
        note: "争夺忘川书与南境控制权，卷三全面冲突。",
        knowledge: "双方都知道对方在找忘川书，但都不知道全部底牌。",
      },
      {
        type: "守护",
        tone: "gold",
        name: "天门",
        target: "地点",
        note: "护山大阵的最终目的，也是灭门案动机来源。",
        knowledge: "只有掌门和守门长老知道天门真相。",
      },
      {
        type: "依赖",
        tone: "alert",
        name: "记忆贡品",
        target: "规则",
        note: "以弟子记忆维持大阵，是宗门最高机密。",
        knowledge: "普通弟子只知道需要定期闭关。",
      },
    ],
    historyTitle: "兴衰时间线",
    historyHint: "按故事时间记录宗门状态变化",
    history: [
      {
        chapter: "十六年前",
        title: "参与忘川村灭门案",
        note: "为守住天门，玄微真人做出决策",
        tone: "done",
      },
      {
        chapter: "三年前",
        title: "收沈砚入外门",
        note: "以杂役身份把沈砚放在眼皮底下",
        tone: "done",
      },
      {
        chapter: "第 18 章",
        title: "掌门救下沈砚",
        note: "以正道魁首身份建立信任",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "追查忘川书",
        note: "开始怀疑沈砚已经激活古书",
        tone: "active",
      },
      {
        chapter: "第 74 章",
        title: "顾青动摇",
        note: "宗门内部出现第一道裂缝",
        tone: "future",
      },
      {
        chapter: "第 120 章",
        title: "旧案曝光",
        note: "护山大阵与记忆贡品真相同时揭开",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 宗门追兵",
      },
      {
        page: "outline",
        icon: "list-tree",
        title: "第 52 章 · 掌门夜谈",
        meta: "章纲引用 · 宗门旧案",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 势力卡",
        meta: "故事圣经引用",
      },
      {
        page: "settings",
        tab: "confirmed",
        icon: "badge-check",
        title: "已确认设定 · 记忆贡品",
        meta: "世界事实 · 门派最高机密",
      },
    ],
    health: {
      score: 86,
      summary: "势力目标完整，仍有 3 个边界待确认",
      items: [
        { tone: "jade", title: "势力目标完整", note: "目标、资源、软肋和掌门动机齐全" },
        { tone: "gold", title: "与血河宗边界待确认", note: "第 3 卷控制区有重叠" },
        { tone: "alert", title: "第 18 章救人动机待补", note: "需要解释掌门为何亲自救下沈砚" },
        { tone: "gold", title: "记忆贡品规则未关联", note: "建议关联世界规则中的护山大阵条目" },
      ],
    },
  },
  xuehe: {
    id: "xuehe",
    name: "血河宗",
    avatar: "血",
    markClass: "faction-mark cinnabar",
    kicker: "势力档案",
    role: "魔道大宗",
    roleTone: "alert",
    arc: "南境魔道 → 忘川书争夺者 → 卷三全面冲突",
    status: "已锁定",
    source: "题材包生成",
    aliases: "血河、血河魔宗",
    type: "势力",
    scope: "全书",
    summary:
      "以血河为修炼根基的魔道大宗，正在寻找忘川书的下落。它既是沈砚的追兵，也是太玄门旧案的镜像：两边都在用别人的记忆换自己的秩序。",
    tags: ["主要反派", "忘川书", "南境", "卷三冲突"],
    quickFacts: [
      { label: "宗主", value: "血河老祖", meta: "卷三正面出场" },
      { label: "控制区", value: "南境血河", meta: "三座小镇已被抽干" },
      { label: "当前目标", value: "夺取忘川书", meta: "第 47 章起", tone: "alert" },
      { label: "对沈砚", value: "持续追杀", meta: "血河夜行后", tone: "alert" },
    ],
    driveTitle: "势力目标",
    driveHint: "目标、资源与软肋",
    drives: [
      { label: "目标", value: "夺取忘川书，打开血河底层" },
      { label: "资源", value: "血河、被抽干的小镇、南境暗线" },
      { label: "软肋", value: "血河老祖旧伤与宗门内斗" },
    ],
    knowledgeTitle: "信息边界",
    knowledgeHint: "公开信息与宗门机密",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "南境魔道大宗",
        reveal: "全书",
        detail: "以血河为修炼根基，和太玄门争夺南境控制权。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "正在寻找忘川书",
        reveal: "第 45 章起",
        detail: "派出的追兵只知道要找一本古书，不知道完整用途。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "沈砚已经能单手结印",
        reveal: "第 48 章后",
        detail: "追兵仍按普通练气修士评估沈砚。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "顾青已经动摇",
        reveal: "第 74 章后",
        detail: "血河宗仍把顾青视为太玄门的稳定棋子。",
      },
    ],
    customFields: [
      { label: "势力类型", value: "魔道宗门" },
      { label: "控制区", value: "南境血河" },
      { label: "宗主", value: "血河老祖" },
      { label: "核心目标", value: "忘川书" },
      { label: "当前冲突", value: "卷三全面战争" },
    ],
    tabLabels: { relations: "势力关系", history: "兴衰时间线" },
    relationsTitle: "势力关系",
    relations: [
      {
        type: "追杀",
        tone: "alert",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "血河夜行后持续追捕，目标也是忘川书。",
        knowledge: "血河宗知道沈砚身上有古书；不知道他已经能单手结印。",
      },
      {
        type: "争夺",
        tone: "alert",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "争夺忘川书与南境控制权，卷三全面冲突。",
        knowledge: "双方都知道对方在找忘川书，但都不知道全部底牌。",
      },
      {
        type: "交易",
        tone: "gold",
        name: "无相楼",
        target: "势力",
        entityId: "wuxiang",
        note: "买卖记忆与身份，偶尔交换南境情报。",
        knowledge: "血河宗不知道无相楼已经接触顾青。",
      },
      {
        type: "目标",
        tone: "gold",
        name: "忘川书",
        target: "物品",
        entityId: "wangchuan-book",
        note: "认为忘川书能打开血河底层。",
        knowledge: "不知道书页缺失会带来什么后果。",
      },
      {
        type: "据点",
        tone: "",
        name: "南境血河",
        target: "地点",
        note: "血河宗的核心修炼地，也是卷三主战场。",
        knowledge: "血河宗知道血河正在枯竭。",
      },
    ],
    historyTitle: "兴衰时间线",
    historyHint: "按故事时间记录宗门状态变化",
    history: [
      { chapter: "十年前", title: "血河旧案", note: "宗门内部清洗，旧案被压下", tone: "done" },
      {
        chapter: "第 45 章",
        title: "血河渡口出现",
        note: "追兵第一次进入主线视野",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "伏击沈砚",
        note: "沈砚左臂骨折，忘川书暴露风险上升",
        tone: "done",
      },
      {
        chapter: "第 48 章",
        title: "追兵逼近",
        note: "沈砚被迫尝试单手结印",
        tone: "active",
      },
      {
        chapter: "卷三",
        title: "全面冲突",
        note: "与太玄门争夺忘川书和南境控制权",
        tone: "future",
      },
      {
        chapter: "第 120 章",
        title: "血河真相",
        note: "血河枯竭与天门开启的关系揭开",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "45",
        icon: "file-text",
        title: "第 45 章 · 血河渡口",
        meta: "正文引用 · 追兵首次出现",
      },
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 伏击与断臂",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "血河旧案",
        meta: "伏笔引用 · 已放弃，需确认是否重开",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 反派势力",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 74,
      summary: "目标明确，但宗主与旧案信息不足",
      items: [
        { tone: "jade", title: "势力目标明确", note: "忘川书、血河和南境冲突形成闭环" },
        { tone: "alert", title: "宗主档案缺失", note: "血河老祖还没有人物卡" },
        { tone: "gold", title: "与太玄门边界未定", note: "需要明确卷三之前的摩擦事件" },
        { tone: "alert", title: "血河旧案伏笔已放弃", note: "但势力页仍在引用，需恢复或删除引用" },
      ],
    },
  },
  wuxiang: {
    id: "wuxiang",
    name: "无相楼",
    avatar: "无",
    markClass: "faction-mark gold",
    kicker: "势力档案",
    role: "中立情报组织",
    roleTone: "gold",
    arc: "忘川渡情报网 → 记忆交易 → 身世线索中转站",
    status: "已锁定",
    source: "作者创建",
    aliases: "无相、忘川楼",
    type: "势力",
    scope: "全书",
    summary:
      "买卖记忆与身份的情报组织，不站队，只认代价。它不直接争夺忘川书，却掌握着能改变沈砚身世线的钥匙。",
    tags: ["中立", "情报", "记忆交易", "身世线索"],
    quickFacts: [
      { label: "楼主", value: "无相先生", meta: "身份不明" },
      { label: "据点", value: "忘川渡口", meta: "中立地带" },
      { label: "主营业务", value: "记忆与身份交易", meta: "只认代价", tone: "gold" },
      { label: "当前立场", value: "中立", meta: "不站队，不做免费情报" },
    ],
    driveTitle: "势力目标",
    driveHint: "目标、资源与原则",
    drives: [
      { label: "目标", value: "让每一段记忆都能被定价" },
      { label: "资源", value: "情报网络、记忆交易渠道、忘川渡据点" },
      { label: "原则", value: "不站队，只认代价" },
    ],
    knowledgeTitle: "信息边界",
    knowledgeHint: "公开信息与交易机密",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "买卖记忆与身份",
        reveal: "全书",
        detail: "只要付得起代价，无相楼可以出卖任何人的过去。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "掌握沈砚身世的一部分",
        reveal: "第 80 章后",
        detail: "无相先生知道青玉的来历，但不会免费给出。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "顾青已经动摇",
        reveal: "第 74 章后",
        detail: "无相楼仍把顾青当作太玄门的稳定买家。",
      },
      {
        state: "原则",
        tone: "",
        text: "不站队，只认代价",
        reveal: "全书",
        detail: "即使知道真相，也不会主动介入太玄门与血河宗的冲突。",
      },
    ],
    customFields: [
      { label: "势力类型", value: "情报组织" },
      { label: "楼主", value: "无相先生" },
      { label: "据点", value: "忘川渡口" },
      { label: "交易物", value: "记忆、身份、旧案线索" },
      { label: "立场", value: "中立" },
    ],
    tabLabels: { relations: "势力关系", history: "兴衰时间线" },
    relationsTitle: "势力关系",
    relations: [
      {
        type: "潜在客户",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "无相楼知道他身世的一部分，但只在合适的价格下出售。",
        knowledge: "无相楼知道沈砚在找母亲；沈砚不知道无相楼知道。",
      },
      {
        type: "交易对象",
        tone: "",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "通过青玉线索接触顾青，试探太玄门的态度。",
        knowledge: "无相楼不知道顾青已经开始怀疑师门。",
      },
      {
        type: "忌惮",
        tone: "alert",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "不正面冲突，但掌握太玄门旧案的零碎证据。",
        knowledge: "太玄门知道无相楼危险，但暂时无法清除。",
      },
      {
        type: "交易",
        tone: "gold",
        name: "血河宗",
        target: "势力",
        entityId: "xuehe",
        note: "偶尔交换南境情报，不参与忘川书争夺。",
        knowledge: "双方都保留底牌。",
      },
      {
        type: "据点",
        tone: "",
        name: "忘川渡",
        target: "地点",
        note: "中立据点，也是沈砚第一次见到青玉的地方。",
        knowledge: "无相楼控制渡口的一部分暗线。",
      },
    ],
    historyTitle: "兴衰时间线",
    historyHint: "按故事时间记录组织状态变化",
    history: [
      {
        chapter: "第 46 章",
        title: "忘川渡出现",
        note: "无相楼的暗线第一次进入主线",
        tone: "done",
      },
      {
        chapter: "第 49 章",
        title: "接触顾青",
        note: "用青玉试探太玄门的态度",
        tone: "active",
      },
      {
        chapter: "第 64 章",
        title: "青玉交易",
        note: "计划揭示青玉与沈砚身世的关系",
        tone: "future",
      },
      {
        chapter: "第 80 章",
        title: "身世线索",
        note: "无相先生第一次给出母亲失踪的方向",
        tone: "future",
      },
      {
        chapter: "第 120 章",
        title: "旧案证据",
        note: "无相楼掌握的零碎证据与灭门真相拼接",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "46",
        icon: "file-text",
        title: "第 46 章 · 夜船",
        meta: "正文引用 · 忘川渡与青玉",
      },
      {
        page: "writing",
        chapter: "49",
        icon: "file-text",
        title: "第 49 章 · 顾青的试探",
        meta: "正文引用 · 青玉交易",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "顾青的玉佩",
        meta: "伏笔引用 · 第 64 章计划回收",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 中立势力",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 80,
      summary: "组织规则完整，但主线连接仍偏弱",
      items: [
        { tone: "jade", title: "组织规则完整", note: "交易原则、据点和立场清晰" },
        { tone: "alert", title: "楼主档案缺失", note: "无相先生还没有人物卡" },
        { tone: "gold", title: "与主线连接偏弱", note: "建议在第 49 章增加一次明确交易" },
        { tone: "gold", title: "记忆交易规则未关联", note: "建议关联金手指与记忆代价规则" },
      ],
    },
  },
  "wangchuan-book": {
    id: "wangchuan-book",
    name: "忘川书",
    avatar: "书",
    markClass: "item-mark",
    kicker: "物品档案",
    role: "核心金手指",
    roleTone: "alert",
    arc: "未知古书 → 沈砚本命法宝 → 缺页真相",
    status: "已锁定",
    source: "作者创建",
    aliases: "古书、忘川",
    type: "物品 / 金手指",
    scope: "全书",
    summary:
      "吞噬记忆，返还前人战斗经验。书页会随着使用逐渐减少，缺失的书页里藏着前人完整的战斗人格。它是沈砚逆天改命的根，也是他失去自己的开始。",
    tags: ["核心金手指", "记忆代价", "缺页", "天门"],
    quickFacts: [
      { label: "品阶", value: "未知", meta: "超出人界体系" },
      { label: "归属", value: "沈砚", meta: "本命法宝" },
      { label: "已用页数", value: "12 / 49", meta: "每用一次少一页", tone: "alert" },
      { label: "核心代价", value: "记忆", meta: "越珍贵越有效", tone: "gold" },
    ],
    driveTitle: "规则与代价",
    driveHint: "能力必须同时定义规则、代价和限制",
    drives: [
      { label: "规则", value: "吞噬记忆，返还前人战斗经验" },
      { label: "代价", value: "每用一次失去一段重要记忆" },
      { label: "限制", value: "书页减少，不能连续翻页" },
    ],
    knowledgeTitle: "秘密与认知",
    knowledgeHint: "谁知道忘川书的哪一层真相",
    knowledge: [
      {
        state: "沈砚知道",
        tone: "jade",
        text: "使用会吞噬记忆",
        reveal: "第 31 章起",
        detail: "但不知道缺失书页里藏着前人的完整人格。",
      },
      {
        state: "沈砚不知道",
        tone: "alert",
        text: "缺页会形成独立人格",
        reveal: "第 120 章揭示",
        detail: "缺失书页不是消失，而是以另一种形式存在。",
      },
      {
        state: "玄微真人知道",
        tone: "gold",
        text: "忘川书在沈砚身上",
        reveal: "第 31 章后确认",
        detail: "但不清楚书页缺失的完整机制。",
      },
      {
        state: "顾青怀疑",
        tone: "gold",
        text: "沈砚身怀古书",
        reveal: "第 47 章",
        detail: "从单手结印开始怀疑，还没有拿到证据。",
      },
    ],
    customFields: [
      { label: "物品类型", value: "本命法宝 / 金手指" },
      { label: "品阶", value: "未知" },
      { label: "归属", value: "沈砚" },
      { label: "总页数", value: "49" },
      { label: "已用页数", value: "12" },
    ],
    tabLabels: { relations: "关联", history: "流转历史" },
    relationsTitle: "关联",
    relations: [
      {
        type: "本命法宝",
        tone: "alert",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "每使用一次失去一段重要记忆。",
        knowledge: "沈砚知道代价，不知道缺页去向。",
      },
      {
        type: "追查",
        tone: "alert",
        name: "玄微真人",
        target: "人物",
        entityId: "xuanwei",
        note: "知道忘川书存在，想用它守住天门。",
        knowledge: "玄微真人不知道缺页已经形成人格。",
      },
      {
        type: "怀疑",
        tone: "gold",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "从单手结印开始怀疑，还没有证据。",
        knowledge: "顾青不知道忘川书的完整规则。",
      },
      {
        type: "规则关联",
        tone: "gold",
        name: "天门",
        target: "地点",
        note: "天门只认完整记忆，忘川书却在吞噬记忆。",
        knowledge: "沈砚不知道两者的冲突。",
      },
      {
        type: "吞噬",
        tone: "alert",
        name: "记忆",
        target: "规则",
        note: "越珍贵的记忆，返还的经验越完整。",
        knowledge: "沈砚知道代价，不知道记忆去了哪里。",
      },
      {
        type: "隐藏",
        tone: "gold",
        name: "缺页",
        target: "物品",
        note: "缺失书页里藏着前人完整的战斗人格。",
        knowledge: "目前只有读者和作者知道。",
      },
    ],
    historyTitle: "流转历史",
    historyHint: "记录物品出现、转移和能力变化",
    history: [
      { chapter: "第 1 章", title: "首次出现", note: "沈砚在忘川村废墟中得到古书", tone: "done" },
      { chapter: "第 18 章", title: "第一次翻页", note: "沈砚忘记一段童年记忆", tone: "done" },
      {
        chapter: "第 31 章",
        title: "借前人经验破阵",
        note: "第一次主动使用，确认代价",
        tone: "done",
      },
      {
        chapter: "第 46 章",
        title: "缺页伏笔",
        note: "书页减少的速度开始异常",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "断臂后翻页",
        note: "在重伤状态下强行使用",
        tone: "active",
      },
      {
        chapter: "第 120 章",
        title: "缺页真相",
        note: "缺失书页与前人战斗人格的关系揭开",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "18",
        icon: "file-text",
        title: "第 18 章 · 第一次翻页",
        meta: "正文引用 · 记忆代价首次出现",
      },
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 重伤使用",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "忘川书缺页",
        meta: "伏笔引用 · 计划第 46 章回收，已过期",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 金手指卡",
        meta: "故事圣经引用",
      },
      {
        page: "settings",
        tab: "confirmed",
        icon: "badge-check",
        title: "已确认设定 · 记忆代价",
        meta: "世界事实 · 第 31 章起",
      },
    ],
    health: {
      score: 78,
      summary: "核心规则完整，但缺页回收已经过期",
      items: [
        { tone: "jade", title: "规则与代价完整", note: "能力、代价和限制形成闭环" },
        { tone: "gold", title: "总页数未在正文出现", note: "建议在第 58 章前明确 49 页上限" },
        {
          tone: "alert",
          title: "缺页回收已过期",
          note: "计划第 46 章回收，当前已写到第 47 章",
        },
        { tone: "gold", title: "与天门规则未关联", note: "建议关联天门只认完整记忆的规则" },
      ],
    },
  },
  "tingchao-sword": {
    id: "tingchao-sword",
    name: "听潮剑",
    avatar: "剑",
    markClass: "item-mark jade-mark",
    kicker: "物品档案",
    role: "法器",
    roleTone: "",
    arc: "太玄门制式配剑 → 顾青随身法器 → 立场见证者",
    status: "已锁定",
    source: "题材包生成",
    aliases: "听潮",
    type: "物品",
    scope: "全书",
    summary:
      "太玄门内门弟子配剑，剑身会记录持剑者的杀意。它不主动说话，却把顾青每一次动摇都留在剑里。",
    tags: ["法器", "顾青", "杀意记录", "太玄门"],
    quickFacts: [
      { label: "品阶", value: "玄阶", meta: "内门弟子配剑" },
      { label: "归属", value: "顾青", meta: "随身携带" },
      { label: "能力", value: "记录杀意", meta: "剑身留痕", tone: "gold" },
      { label: "当前状态", value: "未出鞘", meta: "第 47 章" },
    ],
    driveTitle: "规则与代价",
    driveHint: "能力必须同时定义规则、代价和限制",
    drives: [
      { label: "规则", value: "记录持剑者每一次杀意" },
      { label: "代价", value: "杀意越重，剑越难收回鞘中" },
      { label: "限制", value: "不能伪造记录，也不能主动示警" },
    ],
    knowledgeTitle: "秘密与认知",
    knowledgeHint: "谁知道听潮剑的哪一层真相",
    knowledge: [
      {
        state: "顾青知道",
        tone: "jade",
        text: "剑会记录杀意",
        reveal: "第 1 章起",
        detail: "因此他在沈砚面前很少真正出鞘。",
      },
      {
        state: "沈砚不知道",
        tone: "alert",
        text: "剑身记录着顾青的杀意",
        reveal: "第 74 章后",
        detail: "沈砚一直以为那只是一把普通的玄阶法器。",
      },
      {
        state: "玄微真人知道",
        tone: "gold",
        text: "听潮剑会留下立场证据",
        reveal: "第 1 章起",
        detail: "这也是他把剑赐给顾青的原因之一。",
      },
    ],
    customFields: [
      { label: "物品类型", value: "法器" },
      { label: "品阶", value: "玄阶" },
      { label: "归属", value: "顾青" },
      { label: "能力", value: "记录杀意" },
      { label: "限制", value: "不能主动示警" },
    ],
    tabLabels: { relations: "关联", history: "流转历史" },
    relationsTitle: "关联",
    relations: [
      {
        type: "持有",
        tone: "jade",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "太玄门内门弟子配剑，剑身记录他的杀意。",
        knowledge: "顾青知道剑的记录能力，但不知道剑会如何影响他的选择。",
      },
      {
        type: "制式",
        tone: "",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "内门弟子制式配剑，由掌门赐下。",
        knowledge: "宗门知道剑的记录能力，普通弟子不知道。",
      },
      {
        type: "潜在冲突",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "顾青每次对沈砚起杀意，都会留在剑身。",
        knowledge: "沈砚不知道剑的记录能力。",
      },
      {
        type: "记录",
        tone: "alert",
        name: "杀意",
        target: "规则",
        note: "剑身会留下持剑者每一次真实的杀意。",
        knowledge: "只有持剑者和赐剑者能读懂部分痕迹。",
      },
    ],
    historyTitle: "流转历史",
    historyHint: "记录物品出现、转移和能力变化",
    history: [
      { chapter: "第 1 章", title: "赐予顾青", note: "作为内门弟子身份象征", tone: "done" },
      { chapter: "第 47 章", title: "始终未出鞘", note: "顾青在沈砚面前压制杀意", tone: "done" },
      {
        chapter: "第 48 章",
        title: "顾青按剑",
        note: "第一次对沈砚产生明确杀意",
        tone: "active",
      },
      {
        chapter: "第 74 章",
        title: "剑身留痕",
        note: "顾青发现自己的杀意已经无法掩饰",
        tone: "future",
      },
      {
        chapter: "卷三",
        title: "可能断裂",
        note: "与顾青立场决裂同步发生",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 剑未出鞘",
      },
      {
        page: "writing",
        chapter: "48",
        icon: "file-text",
        title: "第 48 章 · 一只手也能结印",
        meta: "正文引用 · 顾青按剑",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 配角法器",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 82,
      summary: "能力完整，但代价与主线联动不足",
      items: [
        { tone: "jade", title: "能力规则完整", note: "记录杀意、不能示警、不能伪造" },
        { tone: "gold", title: "代价需要量化", note: "建议明确杀意反噬的具体表现" },
        { tone: "gold", title: "与顾青立场转变无联动", note: "建议第 74 章用剑身记录作为证据" },
        { tone: "gold", title: "品阶体系未关联", note: "建议关联力量体系中的法器品阶" },
      ],
    },
  },
  "qingyu": {
    id: "qingyu",
    name: "半枚青玉",
    avatar: "玉",
    markClass: "item-mark gold-mark",
    kicker: "物品档案",
    role: "身世线索",
    roleTone: "gold",
    arc: "忘川村旧物 → 顾青随身线索 → 身世真相钥匙",
    status: "已锁定",
    source: "作者创建",
    aliases: "青玉、旧玉",
    type: "物品 / 线索",
    scope: "全书",
    summary:
      "顾青随身携带的旧玉，与沈砚身世有关。玉上有一道旧裂纹，裂纹里嵌着一点暗红，像干涸的血。它只有半枚，另一半在哪里，是身世线的关键问题。",
    tags: ["身世线索", "顾青", "忘川村", "旧案"],
    quickFacts: [
      { label: "品阶", value: "无", meta: "非战斗物品" },
      { label: "持有者", value: "顾青", meta: "随身携带" },
      { label: "关联", value: "沈砚身世", meta: "忘川村旧案", tone: "gold" },
      { label: "线索状态", value: "第 64 章揭示", meta: "计划回收", tone: "gold" },
    ],
    driveTitle: "线索与代价",
    driveHint: "线索必须定义来源、关联和风险",
    drives: [
      { label: "线索", value: "忘川村旧案与沈砚身世" },
      { label: "缺口", value: "另一半青玉下落不明" },
      { label: "风险", value: "血河宗也在寻找旧案证据" },
    ],
    knowledgeTitle: "秘密与认知",
    knowledgeHint: "谁知道青玉的哪一层真相",
    knowledge: [
      {
        state: "顾青知道",
        tone: "jade",
        text: "青玉与沈砚身世有关",
        reveal: "第 1 章起",
        detail: "他一直带着青玉，但没有告诉沈砚来历。",
      },
      {
        state: "沈砚见过",
        tone: "gold",
        text: "夜船上的半枚青玉",
        reveal: "第 46 章",
        detail: "他认出了旧玉，但在第 49 章当面否认。",
      },
      {
        state: "玄微真人知道",
        tone: "alert",
        text: "青玉来自忘川村灭门案",
        reveal: "第 1 章起",
        detail: "他知道另一半青玉在哪里，但不会主动说。",
      },
      {
        state: "读者不知道",
        tone: "",
        text: "另一半青玉的下落",
        reveal: "第 64 章后",
        detail: "目前只确认青玉与母亲失踪有关。",
      },
    ],
    customFields: [
      { label: "物品类型", value: "线索" },
      { label: "品阶", value: "无" },
      { label: "持有者", value: "顾青" },
      { label: "关联人物", value: "沈砚、玄微真人" },
      { label: "计划回收", value: "第 64 章" },
    ],
    tabLabels: { relations: "关联", history: "流转历史" },
    relationsTitle: "关联",
    relations: [
      {
        type: "持有",
        tone: "jade",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "随身携带青玉，但没有解释来历。",
        knowledge: "顾青知道青玉与沈砚身世有关。",
      },
      {
        type: "身世线索",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "青玉与忘川村旧案和母亲失踪有关。",
        knowledge: "沈砚见过青玉，但选择否认。",
      },
      {
        type: "来源",
        tone: "alert",
        name: "忘川村",
        target: "地点",
        note: "十六年前灭门案的发生地。",
        knowledge: "沈砚只记得大火和母亲把他塞进地窖。",
      },
      {
        type: "旧案",
        tone: "alert",
        name: "玄微真人",
        target: "人物",
        entityId: "xuanwei",
        note: "知道青玉来自灭门案，也知道另一半下落。",
        knowledge: "玄微真人知道全部真相。",
      },
      {
        type: "争夺",
        tone: "alert",
        name: "血河宗",
        target: "势力",
        entityId: "xuehe",
        note: "也在寻找忘川村旧案证据。",
        knowledge: "血河宗不知道青玉在顾青身上。",
      },
    ],
    historyTitle: "流转历史",
    historyHint: "记录线索出现、转移和揭示",
    history: [
      {
        chapter: "十六年前",
        title: "从忘川村流出",
        note: "灭门案后被顾青带回太玄门",
        tone: "done",
      },
      { chapter: "第 46 章", title: "夜船出现", note: "顾青第一次让沈砚看见青玉", tone: "done" },
      {
        chapter: "第 49 章",
        title: "顾青试探",
        note: "沈砚当面否认见过青玉",
        tone: "active",
      },
      {
        chapter: "第 64 章",
        title: "计划揭示",
        note: "青玉与沈砚身世的关系公开",
        tone: "future",
      },
      {
        chapter: "第 120 章",
        title: "身世真相",
        note: "另一半青玉与母亲失踪同时揭开",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "46",
        icon: "file-text",
        title: "第 46 章 · 夜船",
        meta: "正文引用 · 青玉首次出现",
      },
      {
        page: "writing",
        chapter: "49",
        icon: "file-text",
        title: "第 49 章 · 顾青的试探",
        meta: "正文引用 · 青玉与否认",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "顾青的玉佩",
        meta: "伏笔引用 · 第 64 章计划回收",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 身世线索",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 84,
      summary: "线索完整，但另一半来源仍未定义",
      items: [
        { tone: "jade", title: "线索功能完整", note: "来源、持有者、关联人物和回收章齐全" },
        { tone: "gold", title: "另一半青玉未定义", note: "建议在第 64 章前明确另一半下落" },
        { tone: "alert", title: "母亲档案缺失", note: "青玉需要关联沈砚母亲的人物卡" },
        { tone: "gold", title: "回收章未锁定", note: "第 64 章仍是计划值，需要大纲确认" },
      ],
    },
  },
  "map-renjie": {
    id: "map-renjie",
    name: "人界",
    avatar: "人",
    markClass: "faction-mark blue",
    kicker: "地图档案",
    role: "世界层级",
    roleTone: "",
    arc: "故事主舞台 → 灵气稀薄 → 天门之下",
    status: "已锁定",
    source: "题材包生成",
    aliases: "人间",
    type: "地图 / 世界层级",
    scope: "全书",
    summary:
      "故事的主舞台，灵气稀薄，宗门与王朝在有限的资源上争夺。飞升灵界是少数人的出口，天门则是人界与仙界之间最不稳定的一道门。",
    tags: ["主舞台", "人界", "灵气稀薄", "天门"],
    quickFacts: [
      { label: "地图层级", value: "第 1 层", meta: "全书主舞台" },
      { label: "灵气浓度", value: "稀薄", meta: "资源争夺的根源" },
      { label: "飞升出口", value: "灵界", meta: "需渡三劫" },
      { label: "当前状态", value: "天门将开", meta: "第 120 章", tone: "gold" },
    ],
    driveTitle: "地图规则",
    driveHint: "层级、规则与连接",
    drives: [
      { label: "层级", value: "人界 → 东境 → 忘川渡 → 太玄门山门" },
      { label: "规则", value: "灵气稀薄，境界提升需要资源" },
      { label: "连接", value: "飞升灵界，天门通往仙界" },
    ],
    knowledgeTitle: "地图认知",
    knowledgeHint: "谁知道世界的哪一层结构",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "人界分为东西南北四境",
        reveal: "全书",
        detail: "东境由太玄门控制，南境是血河宗的地盘。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "天门连接人界与仙界",
        reveal: "第 52 章后",
        detail: "只有掌门和守门长老知道天门的完整规则。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "仙界规则已经残缺",
        reveal: "第 120 章",
        detail: "沈砚以为飞升是终点，实际上只是另一层牢笼。",
      },
    ],
    customFields: [
      { label: "地图类型", value: "世界层级" },
      { label: "上级地图", value: "无" },
      { label: "下级地图", value: "东境、南境、西境、北境" },
      { label: "飞升出口", value: "灵界" },
      { label: "当前焦点", value: "东境" },
    ],
    tabLabels: { relations: "地点关系", history: "控制变化" },
    relationsTitle: "地点关系",
    relations: [
      {
        type: "下级区域",
        tone: "jade",
        name: "东境",
        target: "地点",
        entityId: "map-dongjing",
        note: "当前故事的主舞台，太玄门控制三十六城。",
        knowledge: "读者知道东境，但不知道天门在其境内。",
      },
      {
        type: "飞升出口",
        tone: "gold",
        name: "灵界",
        target: "地图层级",
        note: "渡三劫后可飞升，宗门祖地所在。",
        knowledge: "只有高阶修士知道灵界的真实情况。",
      },
      {
        type: "天门连接",
        tone: "alert",
        name: "仙界",
        target: "地图层级",
        note: "天门之后的层级，规则残缺。",
        knowledge: "玄微真人知道部分真相；沈砚不知道。",
      },
      {
        type: "当前威胁",
        tone: "alert",
        name: "天门",
        target: "地点",
        note: "三个月后开启，会引发灵气反噬。",
        knowledge: "沈砚只知道天门重要，不知道代价。",
      },
    ],
    historyTitle: "控制变化",
    historyHint: "记录世界层级和势力范围变化",
    history: [
      { chapter: "十六年前", title: "忘川村灭门", note: "天门旧案被人为掩盖", tone: "done" },
      { chapter: "三年前", title: "沈砚进入太玄门", note: "故事主线开始", tone: "done" },
      {
        chapter: "第 47 章",
        title: "东境动荡",
        note: "血河宗追兵进入东境",
        tone: "active",
      },
      {
        chapter: "第 120 章",
        title: "天门开启",
        note: "人界、灵界和仙界的关系揭开",
        tone: "future",
      },
    ],
    references: [
      {
        page: "settings",
        tab: "map",
        icon: "map",
        title: "设定中心 · 地图",
        meta: "地图引用 · 人界 · 东境",
      },
      {
        page: "settings",
        tab: "world",
        icon: "globe-2",
        title: "世界规则 · 三重界面",
        meta: "世界规则引用",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 世界铁律",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 88,
      summary: "世界层级清晰，天门规则仍待补全",
      items: [
        { tone: "jade", title: "层级结构完整", note: "人界、灵界、仙界三层已定义" },
        { tone: "gold", title: "四境边界未展开", note: "目前只详细定义东境和南境" },
        { tone: "alert", title: "天门规则未关联", note: "需要关联世界铁律和守门人设定" },
      ],
    },
  },
  "map-dongjing": {
    id: "map-dongjing",
    name: "东境",
    avatar: "东",
    markClass: "faction-mark jade",
    kicker: "地图档案",
    role: "主舞台区域",
    roleTone: "live",
    arc: "三十六城 → 太玄门控制 → 血河入侵",
    status: "已锁定",
    source: "题材包生成",
    aliases: "东境三十六城",
    type: "地图 / 区域",
    scope: "全书",
    summary:
      "太玄门控制的东境三十六城，是故事前两卷的主要舞台。表面秩序稳定，内部靠记忆贡品维持护山大阵，边境则不断被血河宗渗透。",
    tags: ["东境", "太玄门", "三十六城", "主舞台"],
    quickFacts: [
      { label: "上级地图", value: "人界", meta: "第 1 层" },
      { label: "控制势力", value: "太玄门", meta: "正道魁首" },
      { label: "城市数量", value: "三十六城", meta: "东境全境" },
      { label: "当前状态", value: "血河夜行", meta: "第 47 章", tone: "alert" },
    ],
    driveTitle: "区域规则",
    driveHint: "控制、资源与冲突",
    drives: [
      { label: "控制", value: "太玄门控制三十六城" },
      { label: "资源", value: "灵脉、商路和记忆贡品" },
      { label: "冲突", value: "血河宗从南境渗透" },
    ],
    knowledgeTitle: "地图认知",
    knowledgeHint: "谁知道东境的哪一层真相",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "太玄门控制东境",
        reveal: "全书",
        detail: "三十六城名义上由太玄门庇护。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "护山大阵需要记忆贡品",
        reveal: "第 74 章后",
        detail: "各城定期输送弟子进入山门闭关。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "血河宗已经渗透边城",
        reveal: "第 47 章",
        detail: "太玄门直到血河夜行才发现追兵规模。",
      },
    ],
    customFields: [
      { label: "地图类型", value: "区域" },
      { label: "上级地图", value: "人界" },
      { label: "控制势力", value: "太玄门" },
      { label: "城市数量", value: "36" },
      { label: "当前焦点", value: "忘川渡" },
    ],
    tabLabels: { relations: "地点关系", history: "控制变化" },
    relationsTitle: "地点关系",
    relations: [
      {
        type: "上级地图",
        tone: "",
        name: "人界",
        target: "地图层级",
        entityId: "map-renjie",
        note: "东境是人界四境之一。",
        knowledge: "公开信息。",
      },
      {
        type: "控制",
        tone: "jade",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "控制三十六城，维持表面秩序。",
        knowledge: "东境百姓知道太玄门，不知道记忆贡品。",
      },
      {
        type: "中立据点",
        tone: "gold",
        name: "忘川渡",
        target: "地点",
        entityId: "map-wangchuan",
        note: "东境边缘的中立渡口。",
        knowledge: "无相楼控制部分暗线。",
      },
      {
        type: "入侵",
        tone: "alert",
        name: "血河宗",
        target: "势力",
        entityId: "xuehe",
        note: "从南境渗透边城，追查忘川书。",
        knowledge: "太玄门低估了渗透规模。",
      },
      {
        type: "当前人物",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "正在东境忘川渡一带逃亡。",
        knowledge: "沈砚不知道东境即将全面戒严。",
      },
    ],
    historyTitle: "控制变化",
    historyHint: "记录区域控制权和局势变化",
    history: [
      {
        chapter: "三年前",
        title: "太玄门完成控制",
        note: "三十六城名义上归入太玄门",
        tone: "done",
      },
      {
        chapter: "第 45 章",
        title: "边城被抽干",
        note: "血河宗追兵开始暴露",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "血河夜行",
        note: "东境进入实质戒严",
        tone: "active",
      },
      {
        chapter: "卷三",
        title: "全面冲突",
        note: "东境与南境边界成为主战场",
        tone: "future",
      },
    ],
    references: [
      {
        page: "settings",
        tab: "map",
        icon: "map",
        title: "设定中心 · 地图",
        meta: "地图引用 · 东境",
      },
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 东境追兵",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 势力卡",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 84,
      summary: "区域控制清晰，边城渗透线待补",
      items: [
        { tone: "jade", title: "控制关系完整", note: "太玄门、忘川渡和血河宗边界清晰" },
        { tone: "gold", title: "三十六城只落地 3 个", note: "建议补充边城、主城和山门" },
        { tone: "alert", title: "血河渗透线缺失", note: "需要明确第 45 章前后的边城事件" },
      ],
    },
  },
  "map-wangchuan": {
    id: "map-wangchuan",
    name: "忘川渡",
    avatar: "渡",
    markClass: "faction-mark gold",
    kicker: "地图档案",
    role: "中立据点",
    roleTone: "gold",
    arc: "忘川渡口 → 无相楼暗线 → 青玉交易",
    status: "已锁定",
    source: "作者创建",
    aliases: "忘川渡口",
    type: "地图 / 地点",
    scope: "全书",
    summary:
      "东境边缘的中立渡口，无相楼在这里经营记忆与身份交易。沈砚第一次看见半枚青玉，就在这里的夜船上。",
    tags: ["中立据点", "无相楼", "夜船", "青玉"],
    quickFacts: [
      { label: "上级地图", value: "东境", meta: "东境边缘" },
      { label: "控制势力", value: "中立", meta: "无相楼暗线" },
      { label: "关键场景", value: "夜船", meta: "第 46 章" },
      { label: "当前状态", value: "青玉交易", meta: "第 49 章", tone: "gold" },
    ],
    driveTitle: "地点规则",
    driveHint: "控制、资源与风险",
    drives: [
      { label: "控制", value: "名义中立，无相楼控制暗线" },
      { label: "资源", value: "渡口、夜船和记忆交易渠道" },
      { label: "风险", value: "血河宗追兵与太玄门眼线" },
    ],
    knowledgeTitle: "地点认知",
    knowledgeHint: "谁知道忘川渡的哪一层真相",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "东境边缘的中立渡口",
        reveal: "全书",
        detail: "商队、散修和逃犯都会在这里换船。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "无相楼控制渡口暗线",
        reveal: "第 46 章后",
        detail: "夜船上的白灯笼是无相楼的标记。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "青玉会在夜船上出现",
        reveal: "第 46 章",
        detail: "沈砚上船前不知道顾青带着青玉。",
      },
    ],
    customFields: [
      { label: "地图类型", value: "地点" },
      { label: "上级地图", value: "东境" },
      { label: "控制势力", value: "中立 / 无相楼暗线" },
      { label: "关键场景", value: "夜船" },
      { label: "首次出现", value: "第 45 章" },
    ],
    tabLabels: { relations: "地点关系", history: "控制变化" },
    relationsTitle: "地点关系",
    relations: [
      {
        type: "上级地图",
        tone: "",
        name: "东境",
        target: "地点",
        entityId: "map-dongjing",
        note: "位于东境边缘，名义上归太玄门管辖。",
        knowledge: "公开信息。",
      },
      {
        type: "暗线控制",
        tone: "gold",
        name: "无相楼",
        target: "势力",
        entityId: "wuxiang",
        note: "控制渡口的一部分情报和交易渠道。",
        knowledge: "无相楼知道夜船上的每一笔交易。",
      },
      {
        type: "经过",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "第 46 章夜船上第一次看见青玉。",
        knowledge: "沈砚不知道无相楼在暗中观察。",
      },
      {
        type: "经过",
        tone: "",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "在夜船上出示半枚青玉。",
        knowledge: "顾青知道无相楼的人在船上。",
      },
      {
        type: "关键物品",
        tone: "gold",
        name: "半枚青玉",
        target: "物品",
        entityId: "qingyu",
        note: "夜船上出现的身世线索。",
        knowledge: "沈砚见过，但选择否认。",
      },
    ],
    historyTitle: "控制变化",
    historyHint: "记录地点控制权和关键事件",
    history: [
      {
        chapter: "第 45 章",
        title: "血河渡口",
        note: "沈砚混在商队里第一次抵达",
        tone: "done",
      },
      {
        chapter: "第 46 章",
        title: "夜船",
        note: "顾青出示青玉，无相楼暗线出现",
        tone: "done",
      },
      {
        chapter: "第 49 章",
        title: "青玉试探",
        note: "沈砚当面否认见过青玉",
        tone: "active",
      },
      {
        chapter: "第 64 章",
        title: "青玉交易",
        note: "无相楼计划揭示青玉来历",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "46",
        icon: "file-text",
        title: "第 46 章 · 夜船",
        meta: "正文引用 · 忘川渡与青玉",
      },
      {
        page: "settings",
        tab: "map",
        icon: "map",
        title: "设定中心 · 地图",
        meta: "地图引用 · 忘川渡",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "顾青的玉佩",
        meta: "伏笔引用 · 第 64 章计划回收",
      },
    ],
    health: {
      score: 82,
      summary: "地点功能完整，暗线控制仍需明确",
      items: [
        { tone: "jade", title: "地点功能完整", note: "渡口、夜船和青玉场景形成闭环" },
        { tone: "gold", title: "无相楼控制范围未定", note: "建议明确渡口哪些区域归无相楼" },
        { tone: "gold", title: "旅行时间未标注", note: "东境到忘川渡需要 7 天，已在时间线中" },
      ],
    },
  },
  "map-taixuan-gate": {
    id: "map-taixuan-gate",
    name: "太玄门山门",
    avatar: "门",
    markClass: "faction-mark jade",
    kicker: "地图档案",
    role: "当前场景",
    roleTone: "live",
    arc: "外门山门 → 护山大阵 → 掌门夜谈",
    status: "已锁定",
    source: "题材包生成",
    aliases: "太玄山门",
    type: "地图 / 地点",
    scope: "全书",
    summary:
      "太玄门的外门山门，表面是弟子修行之地，地下却藏着以记忆为贡品的护山大阵。第 47 章之后，这里会成为沈砚与掌门第一次正面交锋的舞台。",
    tags: ["太玄门", "护山大阵", "当前场景", "掌门夜谈"],
    quickFacts: [
      { label: "上级地图", value: "东境", meta: "太玄门控制区" },
      { label: "所属势力", value: "太玄门", meta: "正道魁首" },
      { label: "当前场景", value: "第 47 章", meta: "断臂之后" },
      { label: "核心秘密", value: "护山大阵", meta: "记忆贡品", tone: "alert" },
    ],
    driveTitle: "地点规则",
    driveHint: "控制、资源与风险",
    drives: [
      { label: "控制", value: "太玄门内门与长老共管" },
      { label: "资源", value: "灵脉、护山大阵和记忆贡品" },
      { label: "风险", value: "大阵真相随时可能暴露" },
    ],
    knowledgeTitle: "地点认知",
    knowledgeHint: "谁知道山门的哪一层真相",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "太玄门修行之地",
        reveal: "全书",
        detail: "外门弟子在山门修行，内门弟子进入后山。",
      },
      {
        state: "机密",
        tone: "alert",
        text: "地下藏着护山大阵",
        reveal: "第 74 章后",
        detail: "大阵以记忆贡品维持，只有掌门和长老知道。",
      },
      {
        state: "不知道",
        tone: "gold",
        text: "沈砚已经离开山门",
        reveal: "第 47 章",
        detail: "宗门仍以为他会按计划返回。",
      },
    ],
    customFields: [
      { label: "地图类型", value: "地点" },
      { label: "上级地图", value: "东境" },
      { label: "所属势力", value: "太玄门" },
      { label: "关键场景", value: "掌门夜谈" },
      { label: "当前章节", value: "第 47 章" },
    ],
    tabLabels: { relations: "地点关系", history: "控制变化" },
    relationsTitle: "地点关系",
    relations: [
      {
        type: "所属",
        tone: "jade",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "山门是太玄门的核心修行地。",
        knowledge: "宗门完全控制山门。",
      },
      {
        type: "掌门",
        tone: "alert",
        name: "玄微真人",
        target: "人物",
        entityId: "xuanwei",
        note: "在山门地下维持护山大阵。",
        knowledge: "玄微真人知道大阵的全部真相。",
      },
      {
        type: "弟子",
        tone: "",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "内门弟子，熟悉山门和后山路径。",
        knowledge: "顾青不知道大阵的完整机制。",
      },
      {
        type: "离开",
        tone: "gold",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "外门杂役，第 47 章后已经离开。",
        knowledge: "沈砚不知道山门地下的秘密。",
      },
      {
        type: "隐藏",
        tone: "alert",
        name: "护山大阵",
        target: "规则",
        note: "以记忆贡品维持，是宗门最高机密。",
        knowledge: "只有掌门和少数长老知道。",
      },
    ],
    historyTitle: "控制变化",
    historyHint: "记录地点控制权和关键事件",
    history: [
      {
        chapter: "三年前",
        title: "沈砚进入外门",
        note: "以杂役身份被安排在眼皮底下",
        tone: "done",
      },
      {
        chapter: "第 18 章",
        title: "掌门救下沈砚",
        note: "在山门建立信任",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "沈砚离开山门",
        note: "宗门开始追查忘川书",
        tone: "active",
      },
      {
        chapter: "第 52 章",
        title: "掌门夜谈",
        note: "在山门试探沈砚的记忆",
        tone: "future",
      },
    ],
    references: [
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 山门追兵",
      },
      {
        page: "outline",
        icon: "list-tree",
        title: "第 52 章 · 掌门夜谈",
        meta: "章纲引用 · 山门场景",
      },
      {
        page: "settings",
        tab: "map",
        icon: "map",
        title: "设定中心 · 地图",
        meta: "地图引用 · 太玄门山门",
      },
    ],
    health: {
      score: 80,
      summary: "场景功能完整，护山大阵入口未标注",
      items: [
        { tone: "jade", title: "场景功能完整", note: "山门、后山和大阵入口关系清晰" },
        { tone: "alert", title: "大阵入口未标注", note: "建议在地图上补一个隐藏节点" },
        { tone: "gold", title: "掌门夜谈地点未锁定", note: "第 52 章需要明确具体房间" },
      ],
    },
  },
  "world-rules": {
    id: "world-rules",
    name: "三重界面",
    avatar: "界",
    markClass: "faction-mark blue",
    kicker: "世界规则",
    role: "核心规则",
    roleTone: "gold",
    arc: "人界 → 灵界 → 仙界",
    status: "已锁定",
    source: "题材包生成 + 作者确认",
    aliases: "世界结构、三重界面",
    type: "世界规则",
    scope: "全书",
    summary:
      "人界、灵界、仙界构成三层世界。人界灵气稀薄，灵界是宗门祖地，仙界在天门之后且规则残缺。三层之间不是简单的等级关系，而是资源、记忆和天门规则共同维持的脆弱结构。",
    tags: ["三重界面", "飞升", "天门", "灵气"],
    quickFacts: [
      { label: "世界层级", value: "3 层", meta: "人界 / 灵界 / 仙界" },
      { label: "当前舞台", value: "人界 · 东境", meta: "第 1–2 卷" },
      { label: "飞升出口", value: "灵界", meta: "需渡三劫" },
      { label: "天门连接", value: "仙界", meta: "第 120 章开启", tone: "gold" },
    ],
    driveTitle: "规则结构",
    driveHint: "三层世界如何连接",
    drives: [
      { label: "人界", value: "灵气稀薄，宗门与王朝争夺资源" },
      { label: "灵界", value: "灵气充盈，宗门祖地与高阶修士居所" },
      { label: "仙界", value: "天门之后，规则残缺，飞升并非终点" },
    ],
    knowledgeTitle: "规则认知",
    knowledgeHint: "谁知道世界的哪一层真相",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "世界分为人界、灵界、仙界",
        reveal: "全书",
        detail: "三重界面是修行世界的常识，但飞升后的真实情况很少有人知道。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "天门只认完整记忆",
        reveal: "第 52 章后",
        detail: "玄微真人知道天门规则的一部分，忘川书却在吞噬沈砚的记忆。",
      },
      {
        state: "不知道",
        tone: "alert",
        text: "仙界规则已经残缺",
        reveal: "第 120 章",
        detail: "沈砚以为飞升是终点，实际上只是另一层牢笼。",
      },
    ],
    customFields: [
      { label: "世界层级", value: "人界 / 灵界 / 仙界" },
      { label: "飞升条件", value: "渡三劫" },
      { label: "天门条件", value: "完整记忆" },
      { label: "灵气规则", value: "人界稀薄，灵界充盈" },
      { label: "题材适配", value: "都市 / 历史可只保留一层世界" },
    ],
    tabLabels: { relations: "规则关联", history: "规则变化" },
    relationsTitle: "规则关联",
    relations: [
      {
        type: "下层世界",
        tone: "jade",
        name: "人界",
        target: "地图层级",
        entityId: "map-renjie",
        note: "故事主舞台，灵气稀薄，资源争夺激烈。",
        knowledge: "公开信息。",
      },
      {
        type: "飞升层",
        tone: "gold",
        name: "灵界",
        target: "地图层级",
        note: "宗门祖地，灵气充盈，第 3 卷开启。",
        knowledge: "只有高阶修士知道灵界的真实情况。",
      },
      {
        type: "天门之后",
        tone: "alert",
        name: "仙界",
        target: "地图层级",
        note: "规则残缺，天门开启后才可进入。",
        knowledge: "玄微真人知道部分真相；沈砚不知道。",
      },
      {
        type: "连接点",
        tone: "alert",
        name: "天门",
        target: "地点",
        note: "人界与仙界的唯一稳定通道。",
        knowledge: "只有掌门和守门长老知道完整规则。",
      },
      {
        type: "规则冲突",
        tone: "alert",
        name: "忘川书",
        target: "物品",
        entityId: "wangchuan-book",
        note: "天门只认完整记忆，忘川书却在吞噬记忆。",
        knowledge: "沈砚不知道两者的冲突。",
      },
    ],
    historyTitle: "规则变化",
    historyHint: "记录世界规则被揭示或改写的节点",
    history: [
      {
        chapter: "十六年前",
        title: "天门异动",
        note: "忘川村灭门案发生，旧案被伪装成自杀",
        tone: "done",
      },
      { chapter: "第 1 章", title: "人界篇开启", note: "故事从东境边城开始", tone: "done" },
      {
        chapter: "第 47 章",
        title: "天门将开",
        note: "灵气开始异常，三层世界出现裂缝",
        tone: "active",
      },
      {
        chapter: "第 120 章",
        title: "天门开启",
        note: "仙界规则残缺的真相揭开",
        tone: "future",
      },
    ],
    references: [
      {
        page: "settings",
        tab: "world",
        icon: "globe-2",
        title: "设定中心 · 世界规则",
        meta: "世界规则引用 · 三重界面",
      },
      {
        page: "settings",
        tab: "map",
        icon: "map",
        title: "设定中心 · 地图",
        meta: "地图引用 · 人界 / 东境",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 世界铁律",
        meta: "故事圣经引用",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
    ],
    health: {
      score: 88,
      summary: "三层世界结构完整，灵界规则仍待展开",
      items: [
        { tone: "jade", title: "三层结构完整", note: "人界、灵界、仙界的定位和连接清晰" },
        { tone: "gold", title: "灵界规则未展开", note: "第 3 卷前需要补飞升后的资源与势力" },
        { tone: "alert", title: "天门条件未量化", note: "需要明确“完整记忆”的判定方式" },
        { tone: "gold", title: "题材适配规则未关联", note: "都市 / 历史可只保留一层世界" },
      ],
    },
  },
  "power-system": {
    id: "power-system",
    name: "九境十三层",
    avatar: "境",
    markClass: "faction-mark gold",
    kicker: "力量体系",
    role: "修炼规则",
    roleTone: "gold",
    arc: "练气 → 筑基 → 金丹 → 元婴 → 渡劫",
    status: "已锁定",
    source: "题材包生成 + 作者调整",
    aliases: "修炼体系、境界体系",
    type: "力量体系",
    scope: "全书",
    summary:
      "人界主流修炼体系，共九境十三层。突破需要资源、寿元或记忆作为代价，境界差距不能靠纯数值碾压。忘川书可以让人越阶借用前人经验，但代价是不可逆的记忆损失。",
    tags: ["九境", "十三层", "突破代价", "战斗逻辑"],
    quickFacts: [
      { label: "当前境界", value: "练气七层", meta: "沈砚" },
      { label: "下一瓶颈", value: "筑基", meta: "第 58 章预计失败", tone: "gold" },
      { label: "突破代价", value: "寿元或记忆", meta: "记忆越珍贵越稳" },
      { label: "越阶限制", value: "不可无代价越阶", meta: "除非禁术或忘川书", tone: "alert" },
    ],
    driveTitle: "体系规则",
    driveHint: "境界、突破与战斗",
    drives: [
      { label: "境界", value: "练气 → 筑基 → 金丹 → 元婴 → 渡劫" },
      { label: "突破", value: "消耗寿元或记忆，越珍贵的记忆越稳" },
      { label: "战斗", value: "境界 + 功法 + 环境，不做纯数值碾压" },
    ],
    knowledgeTitle: "规则认知",
    knowledgeHint: "谁知道修炼体系的哪一层规则",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "人界主流五境",
        reveal: "全书",
        detail: "练气、筑基、金丹、元婴、渡劫是宗门弟子共同知道的境界。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "记忆可以替代寿元",
        reveal: "第 31 章后",
        detail: "沈砚用忘川书突破时，第一次发现记忆也能成为代价。",
      },
      {
        state: "缺口",
        tone: "alert",
        text: "金丹到元婴缺少瓶颈设定",
        reveal: "待补",
        detail: "需要在第 3 卷前补充元婴突破条件和失败后果。",
      },
    ],
    customFields: [
      { label: "境界数量", value: "五境" },
      { label: "层级", value: "十三层" },
      { label: "突破条件", value: "资源 + 寿元 / 记忆" },
      { label: "战斗逻辑", value: "境界 + 功法 + 环境" },
      { label: "越阶工具", value: "禁术 / 忘川书" },
    ],
    tabLabels: { relations: "体系关联", history: "境界变化" },
    relationsTitle: "体系关联",
    relations: [
      {
        type: "当前修行者",
        tone: "jade",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "练气七层，距离筑基还有 3 个关键事件。",
        knowledge: "沈砚知道自己的境界，不知道第 58 章会突破失败。",
      },
      {
        type: "越阶工具",
        tone: "alert",
        name: "忘川书",
        target: "物品",
        entityId: "wangchuan-book",
        note: "可以借前人经验越阶，但每次都会损失记忆。",
        knowledge: "沈砚知道代价，不知道缺页人格。",
      },
      {
        type: "正道传承",
        tone: "jade",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "以练气、筑基、金丹为主流传承。",
        knowledge: "宗门知道主流境界，不知道忘川书的完整机制。",
      },
      {
        type: "魔道体系",
        tone: "alert",
        name: "血河宗",
        target: "势力",
        entityId: "xuehe",
        note: "以血河为根基，突破方式与正道不同。",
        knowledge: "血河宗的魔道体系尚未完整定义。",
      },
      {
        type: "终局瓶颈",
        tone: "gold",
        name: "天门",
        target: "地点",
        note: "渡劫之后才能接触天门，但天门只认完整记忆。",
        knowledge: "只有掌门和守门长老知道天门与境界的关系。",
      },
    ],
    historyTitle: "境界变化",
    historyHint: "记录主角境界和体系规则的推进",
    history: [
      { chapter: "第 1 章", title: "练气三层", note: "外门杂役，隐藏忘川书", tone: "done" },
      { chapter: "第 31 章", title: "练气七层", note: "第一次借前人经验破阵", tone: "done" },
      {
        chapter: "第 58 章",
        title: "预计筑基失败",
        note: "大纲预留：第一次突破失败",
        tone: "future",
      },
      {
        chapter: "第 86 章",
        title: "忘川书再少一页",
        note: "突破代价与书页减少同步",
        tone: "future",
      },
      {
        chapter: "第 120 章",
        title: "渡劫与天门",
        note: "境界终点与天门规则交汇",
        tone: "future",
      },
    ],
    references: [
      {
        page: "settings",
        tab: "power",
        icon: "zap",
        title: "设定中心 · 力量体系",
        meta: "力量体系引用 · 九境十三层",
      },
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 练气七层",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 金手指卡",
        meta: "故事圣经引用",
      },
      {
        page: "settings",
        tab: "confirmed",
        icon: "badge-check",
        title: "已确认设定 · 记忆代价",
        meta: "世界事实 · 第 31 章起",
      },
    ],
    health: {
      score: 74,
      summary: "五境框架完整，但金丹到元婴存在缺口",
      items: [
        { tone: "jade", title: "五境框架完整", note: "练气到渡劫的主线境界清晰" },
        { tone: "alert", title: "金丹到元婴瓶颈缺失", note: "需要补充突破条件和失败后果" },
        { tone: "gold", title: "战斗数值未量化", note: "建议明确境界差距的战斗表现" },
        { tone: "gold", title: "魔道体系未定义", note: "血河宗的突破方式仍是空白" },
      ],
    },
  },
  "timeline-main": {
    id: "timeline-main",
    name: "从忘川村到天门",
    avatar: "时",
    markClass: "faction-mark blue",
    kicker: "时间线",
    role: "故事时间线",
    roleTone: "gold",
    arc: "十六年前 → 现在 → 三个月后",
    status: "已锁定",
    source: "作者创建",
    aliases: "故事时间线、主时间轴",
    type: "时间线",
    scope: "全书",
    summary:
      "故事的主时间轴，从十六年前的忘川村灭门案，到三年前沈砚进入太玄门，再到当前第 47 章的断臂之后，最终指向三个月后的天门开启。",
    tags: ["时间轴", "忘川村", "天门", "第 120 章"],
    quickFacts: [
      { label: "起点", value: "十六年前", meta: "忘川村灭门" },
      { label: "当前", value: "第 47 章", meta: "断臂之后" },
      { label: "关键节点", value: "4 个", meta: "过去 / 现在 / 未来" },
      { label: "终点", value: "第 120 章", meta: "天门开启", tone: "gold" },
    ],
    driveTitle: "时间轴",
    driveHint: "过去、现在与未来",
    drives: [
      { label: "过去", value: "忘川村灭门案被伪装成自杀" },
      { label: "现在", value: "沈砚断臂，血河宗追兵逼近" },
      { label: "未来", value: "三个月后天门开启，记忆与天门冲突" },
    ],
    knowledgeTitle: "时间认知",
    knowledgeHint: "谁知道时间线的哪一段真相",
    knowledge: [
      {
        state: "公开",
        tone: "jade",
        text: "三年前进入太玄门",
        reveal: "第 1 章",
        detail: "沈砚成为外门杂役，第一次接触忘川书。",
      },
      {
        state: "机密",
        tone: "gold",
        text: "十六年前的灭门案",
        reveal: "第 120 章",
        detail: "对外伪装成自杀，只有玄微真人知道全部真相。",
      },
      {
        state: "未知",
        tone: "alert",
        text: "三个月后的天门开启",
        reveal: "第 120 章",
        detail: "沈砚只知道天门重要，不知道开启需要完整记忆。",
      },
    ],
    customFields: [
      { label: "时间跨度", value: "十六年" },
      { label: "当前章节", value: "第 47 章" },
      { label: "关键事件", value: "4 个" },
      { label: "旅行时间", value: "东境到忘川渡 7 天" },
      { label: "时间一致性", value: "正常" },
    ],
    tabLabels: { relations: "时间关联", history: "关键节点" },
    relationsTitle: "时间关联",
    relations: [
      {
        type: "起点事件",
        tone: "alert",
        name: "忘川村灭门",
        target: "事件",
        note: "十六年前，沈砚父母被杀，真相被伪装成自杀。",
        knowledge: "沈砚当前仍相信父母是自杀。",
      },
      {
        type: "人物",
        tone: "jade",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "从忘川村孤儿到太玄门杂役，再到天门守门人。",
        knowledge: "沈砚不知道自己的时间线被刻意安排。",
      },
      {
        type: "势力",
        tone: "jade",
        name: "太玄门",
        target: "势力",
        entityId: "taixuan",
        note: "三年前收沈砚入外门，安排顾青监视。",
        knowledge: "宗门知道时间线的一部分，不知道沈砚已离开。",
      },
      {
        type: "关键物品",
        tone: "alert",
        name: "忘川书",
        target: "物品",
        entityId: "wangchuan-book",
        note: "每次翻页都会让时间线出现记忆缺口。",
        knowledge: "沈砚知道代价，不知道缺失记忆去了哪里。",
      },
      {
        type: "终点",
        tone: "gold",
        name: "天门",
        target: "地点",
        note: "三个月后开启，时间线的最终交汇点。",
        knowledge: "玄微真人知道天门时间，沈砚不知道。",
      },
    ],
    historyTitle: "关键节点",
    historyHint: "按故事时间记录主线节点",
    history: [
      {
        chapter: "十六年前",
        title: "忘川村灭门",
        note: "沈砚父母被杀，真相被伪装成自杀",
        tone: "done",
      },
      {
        chapter: "三年前",
        title: "进入太玄门",
        note: "沈砚成为外门杂役，第一次接触忘川书",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "断臂之后",
        note: "血河夜行，沈砚左臂骨折",
        tone: "active",
      },
      {
        chapter: "三个月后",
        title: "天门将开",
        note: "三劫降临，记忆与天门必须二选一",
        tone: "future",
      },
    ],
    references: [
      {
        page: "settings",
        tab: "timeline",
        icon: "history",
        title: "设定中心 · 时间线",
        meta: "时间线引用 · 从忘川村到天门",
      },
      {
        page: "outline",
        icon: "list-tree",
        title: "大纲工作台 · 第 120 章",
        meta: "章纲引用 · 天门开启",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 主线",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 80,
      summary: "主时间轴完整，三个月跨度仍需锁定",
      items: [
        { tone: "jade", title: "主时间轴完整", note: "过去、现在、未来三个锚点清晰" },
        { tone: "gold", title: "第 58 章突破失败未量化", note: "需要明确失败对时间线的影响" },
        { tone: "alert", title: "三个月跨度未锁定", note: "第 47 章到第 120 章之间需要事件填充" },
        { tone: "jade", title: "旅行时间已定义", note: "东境到忘川渡 7 天" },
      ],
    },
  },
  "confirmed-facts": {
    id: "confirmed-facts",
    name: "已确认设定",
    avatar: "事",
    markClass: "faction-mark jade",
    kicker: "已确认设定",
    role: "生成约束",
    roleTone: "jade",
    arc: "事实 → 角色认知 → 叙事计划",
    status: "已锁定",
    source: "作者确认 + 正文抽取",
    aliases: "事实卡、确认事实",
    type: "已确认设定",
    scope: "全书",
    summary:
      "后续生成必须遵守的事实集合。它把世界事实、角色认知和叙事计划拆成可追踪的约束，并记录来源章节、确认时间和有效期。",
    tags: ["事实卡", "生成约束", "有效期", "一致性"],
    quickFacts: [
      { label: "已确认", value: "128 条", meta: "本周新增 8 条" },
      { label: "高风险", value: "2 条", meta: "即将过期或冲突", tone: "alert" },
      { label: "当前章节", value: "第 47 章", meta: "断臂之后" },
      { label: "有效期规则", value: "按章节到期", meta: "过期需续期或修改", tone: "gold" },
    ],
    driveTitle: "事实分类",
    driveHint: "世界事实、角色认知与叙事计划",
    drives: [
      { label: "世界事实", value: "身体状态、关系、地理、战力" },
      { label: "角色认知", value: "谁知道什么，带有效期" },
      { label: "叙事计划", value: "伏笔、揭示和信息差" },
    ],
    knowledgeTitle: "约束范围",
    knowledgeHint: "哪些事实必须进入生成上下文",
    knowledge: [
      {
        state: "必须遵守",
        tone: "alert",
        text: "沈砚左臂骨折，不能双手结印",
        reveal: "第 47–53 章",
        detail: "正文出现“双手结印”会触发连续性冲突。",
      },
      {
        state: "必须遵守",
        tone: "gold",
        text: "沈砚以为父母是自杀",
        reveal: "第 3–119 章",
        detail: "第 120 章前不能让主角主动怀疑仇杀。",
      },
      {
        state: "即将过期",
        tone: "alert",
        text: "左臂状态有效期",
        reveal: "第 53 章",
        detail: "到期前必须回收或续期，否则写作台会持续告警。",
      },
    ],
    customFields: [
      { label: "事实总数", value: "128" },
      { label: "本周新增", value: "8" },
      { label: "高风险", value: "2" },
      { label: "当前章节", value: "第 47 章" },
      { label: "导出格式", value: "设定附录 / JSON" },
    ],
    tabLabels: { relations: "事实关联", history: "确认记录" },
    relationsTitle: "事实关联",
    relations: [
      {
        type: "身体状态",
        tone: "alert",
        name: "沈砚",
        target: "人物",
        entityId: "shen-yan",
        note: "左臂骨折，不能双手结印。",
        knowledge: "第 47 章起生效，第 53 章前有效。",
      },
      {
        type: "角色认知",
        tone: "gold",
        name: "父母之死",
        target: "伏笔",
        note: "沈砚以为父母是自杀，真相是仇杀。",
        knowledge: "第 120 章前保持误解。",
      },
      {
        type: "物品事实",
        tone: "alert",
        name: "忘川书",
        target: "物品",
        entityId: "wangchuan-book",
        note: "首次翻页让沈砚忘记入门前的住处。",
        knowledge: "沈砚知道代价，不知道缺失记忆的去向。",
      },
      {
        type: "物品事实",
        tone: "gold",
        name: "半枚青玉",
        target: "物品",
        entityId: "qingyu",
        note: "在顾青手中，与沈砚身世有关。",
        knowledge: "沈砚见过但选择否认。",
      },
      {
        type: "关系事实",
        tone: "alert",
        name: "顾青",
        target: "人物",
        entityId: "gu-qing",
        note: "受太玄门命令监视沈砚。",
        knowledge: "沈砚不知道顾青受命监视。",
      },
    ],
    historyTitle: "确认记录",
    historyHint: "记录事实的确认、变更和到期",
    history: [
      {
        chapter: "第 3 章",
        title: "父母是自杀",
        note: "人物认知事实，第 120 章前有效",
        tone: "done",
      },
      {
        chapter: "第 18 章",
        title: "忘川书首次翻页",
        note: "沈砚忘记入门前的住处",
        tone: "done",
      },
      {
        chapter: "第 46 章",
        title: "半枚青玉在顾青手中",
        note: "物品事实，第 64 章前有效",
        tone: "done",
      },
      {
        chapter: "第 47 章",
        title: "左臂骨折",
        note: "身体状态，第 53 章前有效",
        tone: "active",
      },
      {
        chapter: "第 53 章",
        title: "左臂状态到期",
        note: "需要回收、续期或走修改请求",
        tone: "future",
      },
    ],
    references: [
      {
        page: "settings",
        tab: "confirmed",
        icon: "badge-check",
        title: "设定中心 · 已确认设定",
        meta: "事实卡引用 · 128 条",
      },
      {
        page: "writing",
        chapter: "47",
        icon: "file-text",
        title: "第 47 章 · 断臂之后",
        meta: "正文引用 · 左臂骨折",
      },
      {
        page: "foreshadows",
        icon: "git-commit-horizontal",
        title: "父母之死",
        meta: "伏笔引用 · 第 120 章揭示",
      },
      {
        page: "bible",
        icon: "book-marked",
        title: "故事圣经 · 世界铁律",
        meta: "故事圣经引用",
      },
    ],
    health: {
      score: 86,
      summary: "事实卡完整，仍有 2 条高风险约束",
      items: [
        { tone: "jade", title: "事实分类完整", note: "世界事实、角色认知和叙事计划均有记录" },
        { tone: "alert", title: "左臂状态即将到期", note: "第 53 章前必须处理" },
        { tone: "alert", title: "父母之死仍是误解", note: "第 120 章前不能提前揭示" },
        { tone: "gold", title: "导出格式未确认", note: "设定附录 / JSON 仍是草稿选项" },
      ],
    },
  },
};

const foreshadowStatusLabels = {
  planted: "已埋设",
  paid_off: "已回收",
  abandoned: "已放弃",
};

let foreshadowRecords = [
  {
    id: "fs-1",
    title: "父母之死",
    description: "沈砚以为父母是自杀，真相是仇杀，凶手与太玄门有关。",
    plantChapter: 16,
    plannedPayoffChapter: 120,
    importance: "must",
    status: "planted",
    characters: "沈砚, 玄微真人",
    factions: "太玄门",
    promise: "身世谜团",
  },
  {
    id: "fs-2",
    title: "忘川书缺页",
    description: "忘川书每使用一次就少一页，缺失的书页藏着前人完整的战斗人格。",
    plantChapter: 18,
    plannedPayoffChapter: 46,
    importance: "must",
    status: "planted",
    characters: "沈砚",
    factions: "",
    promise: "长线伏笔",
  },
  {
    id: "fs-3",
    title: "顾青的玉佩",
    description: "顾青随身带着半枚青玉，与沈砚身世有关，但他一直没有解释来历。",
    plantChapter: 46,
    plannedPayoffChapter: 64,
    importance: "optional",
    status: "planted",
    characters: "顾青, 沈砚",
    factions: "太玄门",
    promise: "人物关系",
    duplicateOf: "半枚青玉",
  },
  {
    id: "fs-4",
    title: "天门内的脚步声",
    description: "沈砚每次接近天门都会听见一个很年轻的脚步声，但从来没有人。",
    plantChapter: 47,
    plannedPayoffChapter: 150,
    importance: "optional",
    status: "planted",
    characters: "沈砚",
    factions: "天门守",
    promise: "世界真相",
    weakPayoff: true,
  },
  {
    id: "fs-5",
    title: "半枚青玉",
    description: "顾青在夜船上露出的旧玉，已经确认与沈砚身世有关。",
    plantChapter: 46,
    plannedPayoffChapter: 64,
    importance: "optional",
    status: "paid_off",
    characters: "顾青",
    factions: "太玄门",
    promise: "人物关系",
  },
  {
    id: "fs-6",
    title: "血河旧案",
    description: "血河宗十年前的一桩旧案，计划在后续章节回收。",
    plantChapter: null,
    plannedPayoffChapter: 44,
    importance: "optional",
    status: "abandoned",
    characters: "沈砚",
    factions: "血河宗",
    promise: "世界真相",
  },
];

const customFieldTypeLabels = {
  text: "文本",
  long_text: "长文本",
  number: "数字",
  date: "日期",
  single_select: "单选",
  multi_select: "多选",
  boolean: "布尔",
  relation: "关系引用",
};

let customFieldRecords = [
  {
    id: "cf-1",
    name: "血脉来源",
    type: "single_select",
    objects: ["人物"],
    required: true,
    status: "active",
    options: "人族, 妖族, 天门遗民",
    relationTarget: "",
    description: "人物血脉来源，会影响世界观和力量体系检查。",
    source: "题材默认",
    previewValue: "人族",
  },
  {
    id: "cf-2",
    name: "记忆完整度",
    type: "number",
    objects: ["人物"],
    required: false,
    status: "active",
    options: "",
    relationTarget: "",
    description: "0-100，用于追踪忘川书代价。",
    source: "题材默认",
    previewValue: "62",
  },
  {
    id: "cf-3",
    name: "本命法宝",
    type: "relation",
    objects: ["人物"],
    required: false,
    status: "active",
    options: "",
    relationTarget: "物品",
    description: "指向人物当前祭炼的本命物品。",
    source: "自定义",
    previewValue: "忘川书",
  },
  {
    id: "cf-4",
    name: "是否已飞升",
    type: "boolean",
    objects: ["人物"],
    required: false,
    status: "active",
    options: "",
    relationTarget: "",
    description: "标记人物是否已经离开人界。",
    source: "题材默认",
    previewValue: "否",
  },
  {
    id: "cf-5",
    name: "势力控制范围",
    type: "multi_select",
    objects: ["势力", "地图"],
    required: true,
    status: "active",
    options: "东境, 南境, 灵界",
    relationTarget: "",
    description: "势力当前控制的区域，和时间有效期一起使用。",
    source: "题材默认",
    previewValue: "东境、南境",
  },
  {
    id: "cf-6",
    name: "伏笔回收章",
    type: "number",
    objects: ["伏笔"],
    required: false,
    status: "active",
    options: "",
    relationTarget: "",
    description: "计划回收的章节号，参与过期检查。",
    source: "自定义",
    previewValue: "第 120 章",
  },
  {
    id: "cf-7",
    name: "道号",
    type: "text",
    objects: ["人物"],
    required: false,
    status: "disabled",
    options: "",
    relationTarget: "",
    description: "角色在宗门中的道号；当前作品暂时不用。",
    source: "自定义",
    previewValue: "未取",
  },
  {
    id: "cf-8",
    name: "人物小传",
    type: "long_text",
    objects: ["人物"],
    required: false,
    status: "active",
    options: "",
    relationTarget: "",
    description: "记录人物前史、性格形成和关键经历。",
    source: "自定义",
    previewValue: "边城长大，母亲失踪后独自入山。",
  },
  {
    id: "cf-9",
    name: "飞升日期",
    type: "date",
    objects: ["人物"],
    required: false,
    status: "active",
    options: "",
    relationTarget: "",
    description: "人物离开人界的具体故事日期。",
    source: "题材默认",
    previewValue: "未飞升",
  },
];

let toastTimer = null;
let editorDirty = false;
let confirmCallback = null;

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message || "操作已完成";
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

function updateCrumbs(page) {
  const crumbs = document.getElementById("crumbs");
  if (!crumbs) return;
  let html = '<span>我的作品</span><i data-lucide="chevron-right"></i>';
  if (page === "entity-detail") {
    const profile = entityProfiles[activeEntityId] || entityProfiles["shen-yan"];
    html += '<strong>仙途：忘川书</strong><i data-lucide="chevron-right"></i>';
    html += '<strong>设定中心</strong><i data-lucide="chevron-right"></i>';
    html += `<strong>${escapeHtml(profile.kicker)}</strong><i data-lucide="chevron-right"></i>`;
    html += `<strong>${escapeHtml(profile.name)}</strong>`;
  } else if (accountPages.has(page)) {
    html += `<strong>${pageLabels[page]}</strong>`;
  } else {
    html += '<strong>仙途：忘川书</strong><i data-lucide="chevron-right"></i>';
    html += `<strong>${pageLabels[page]}</strong>`;
  }
  crumbs.innerHTML = html;
  initIcons();
}

function navigate(page, options = {}) {
  const target = validPages.has(page) ? page : "dashboard";
  closeSearch();
  closeNotifications();
  closeUserMenu();
  document.body.classList.remove("sidebar-mobile-open");
  document.body.dataset.context = workPages.has(target) ? "work" : "account";
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.dataset.page === target);
  });
  document.querySelectorAll(".nav-item[data-page]").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.page === target ||
        (target === "entity-detail" && item.dataset.page === "settings")
    );
  });
  updateCrumbs(target);
  document.title =
    target === "entity-detail"
      ? `${entityProfiles[activeEntityId]?.name || "档案"} · 墨舟`
      : pageTitles[target] || "墨舟";
  if (!options.keepHash) {
    history.replaceState(null, "", `#${target}`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setAuthMode(mode) {
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
  document.querySelectorAll("[data-auth-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.authPanel === mode);
  });
}

function setAuthState(state) {
  const messages = {
    normal: "账号入口状态正常。",
    "code-error": "验证码错误或已过期，请重新获取。",
    "rate-limited": "登录尝试过于频繁，请 60 秒后再试。",
    "mail-sent": "重置邮件已发送，请检查收件箱和垃圾邮件。",
    "link-expired": "重置链接已失效，请重新发送邮件。",
    "password-weak": "密码强度不足：至少 12 位，并包含字母、数字和符号。",
    "recover-confirm": "恢复账号前请确认邮箱可收信，提交后会进入人工确认。",
  };
  document.querySelectorAll("[data-auth-state]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authState === state);
  });
  const message = document.getElementById("auth-state-message");
  if (message) message.textContent = messages[state] || messages.normal;
}

let wizardStep = 1;

const wizardStepMeta = {
  1: ["第 1 步", "你想写一个什么样的故事？", "可以先写一句"],
  2: ["第 2 步", "选择题材与规模", "题材包决定世界规则和字段"],
  3: ["第 3 步", "作品信息", "书名、笔名、平台必填"],
  4: ["第 4 步", "读者承诺与补充信息", "可以稍后补"],
  5: ["第 5 步", "确认故事蓝图", "右侧预览九卡摘要"],
  6: ["第 6 步", "创建作品", "确认后进入作品总览"],
};

function updateWizardSummary() {
  const node = document.getElementById("wizard-confirm-summary");
  if (!node) return;
  const rows = [
    ["书名", document.getElementById("work-title")?.value.trim() || "未填写"],
    ["笔名", document.getElementById("pen-name")?.value.trim() || "未填写"],
    ["题材", document.getElementById("genre")?.value || "未选择"],
    ["规模", document.getElementById("scale")?.value || "未选择"],
    ["目标平台", document.getElementById("platform")?.value || "未选择"],
    ["目标读者", document.getElementById("target-reader")?.value.trim() || "未填写"],
  ];
  node.innerHTML = rows
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function setWizardStep(step) {
  wizardStep = Math.max(1, Math.min(6, step));
  document.querySelectorAll("[data-wizard-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.wizardStepPanel) === wizardStep);
  });
  document.querySelectorAll(".stepper .step").forEach((stepNode, index) => {
    stepNode.classList.toggle("active", index + 1 === wizardStep);
  });
  const meta = wizardStepMeta[wizardStep];
  document.getElementById("wizard-step-kicker").textContent = meta[0];
  document.getElementById("wizard-step-title").textContent = meta[1];
  document.getElementById("wizard-step-hint").textContent = meta[2];
  const prev = document.getElementById("wizard-prev");
  const next = document.getElementById("wizard-next");
  const generate = document.getElementById("wizard-generate");
  const create = document.getElementById("wizard-create");
  if (prev) prev.disabled = wizardStep === 1;
  if (next) next.hidden = wizardStep >= 5;
  if (generate) generate.hidden = wizardStep !== 5;
  if (create) create.hidden = wizardStep !== 6;
  updateWizardSummary();
}

function validateWizardRequired() {
  const missing = ["work-title", "pen-name", "platform"].filter(
    (id) => !document.getElementById(id)?.value?.trim()
  );
  if (missing.length) {
    setWizardStep(3);
    showToast("请先填写书名、笔名和目标平台");
    return false;
  }
  return true;
}

function nextWizardStep() {
  if (wizardStep === 3 && !validateWizardRequired()) return;
  setWizardStep(wizardStep + 1);
}

function previousWizardStep() {
  setWizardStep(wizardStep - 1);
}

function setEntryMode(mode) {
  document.querySelectorAll("[data-entry-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.entryMode === mode);
  });
  const wizard = document.querySelector('[data-entry-view="wizard"]');
  const importView = document.querySelector('[data-entry-view="import"]');
  if (wizard) wizard.hidden = mode === "import";
  if (importView) importView.hidden = mode !== "import";
  if (mode === "blank") {
    const idea = document.getElementById("idea");
    const title = document.getElementById("work-title");
    if (idea) idea.value = "";
    if (title) title.value = "";
    setWizardStep(3);
    window.setTimeout(() => title?.focus(), 50);
  } else if (mode === "template") {
    setWizardStep(2);
  } else if (mode === "idea") {
    setWizardStep(1);
  }
  if (mode !== "import") {
    showToast(
      mode === "idea"
        ? "从一句话开始，先把灵感写下来"
        : mode === "blank"
          ? "空白作品：先建骨架，再补设定"
          : "题材模板：已套用仙侠主模板"
    );
  }
}

function applySettingsFilter() {
  const query = document.getElementById("settings-search")?.value.trim().toLowerCase() || "";
  const sort = document.getElementById("settings-sort")?.value || "default";
  const activePanel = document.querySelector(".tab-panel.active");
  if (!activePanel) return;
  activePanel.querySelectorAll(".entity-card, .faction-item").forEach((card) => {
    card.hidden = Boolean(query) && !card.textContent.toLowerCase().includes(query);
  });
  activePanel.querySelectorAll(".entity-grid").forEach((grid) => {
    const cards = [...grid.querySelectorAll(":scope > .entity-card")];
    cards.forEach((card, index) => {
      if (card.dataset.settingsIndex === undefined) card.dataset.settingsIndex = String(index);
    });
    cards.sort((left, right) => {
      if (sort === "default") {
        return Number(left.dataset.settingsIndex) - Number(right.dataset.settingsIndex);
      }
      return left.textContent.localeCompare(right.textContent, "zh-CN");
    });
    cards.forEach((card) => grid.appendChild(card));
  });
}

function initSettingsTools() {
  document.getElementById("settings-search")?.addEventListener("input", applySettingsFilter);
  document.getElementById("settings-sort")?.addEventListener("change", applySettingsFilter);
}

function generateSettingProposal() {
  const host = document.getElementById("settings-proposal");
  if (!host) return;
  if (host.querySelector(".settings-proposal-card")) {
    showToast("设定提案已经存在");
    return;
  }
  const card = document.createElement("article");
  card.className = "panel settings-proposal-card";
  card.innerHTML = `
    <div class="panel-head"><div><span class="panel-kicker">AI 设定提案</span><h3>新增「血河旧案证人」</h3></div><span class="badge gold-badge">待确认</span></div>
    <p>建议新增一名血河宗旧案证人，用于第 50 章的关键人物死亡与卷三冲突。</p>
    <div class="button-row"><button class="btn btn-ghost btn-small" data-action="dismiss-setting-proposal">放弃</button><button class="btn btn-primary btn-small" data-action="accept-setting-proposal">接受提案</button></div>`;
  host.appendChild(card);
  showToast("AI 已生成设定提案");
}

function acceptSettingProposal() {
  document.querySelector(".settings-proposal-card")?.remove();
  let grid = document.querySelector(".tab-panel.active .entity-grid");
  if (!grid) {
    setTab("characters");
    grid = document.querySelector('.tab-panel[data-tab-panel="characters"] .entity-grid');
  }
  if (grid) {
    const card = document.createElement("article");
    card.className = "entity-card panel";
    card.innerHTML = '<div class="entity-top"><span class="item-mark">证</span><span class="badge gold-badge">AI 提案</span></div><h3>血河旧案证人</h3><p>血河宗旧案的关键证人，掌握第 50 章人物死亡的直接证据。</p><div class="entity-meta"><span>类型：人物</span><span>来源：AI 提案</span></div>';
    grid.appendChild(card);
  }
  showToast("已接受设定提案，条目已加入当前分类");
}

function addEntityAlias() {
  const meta = document.getElementById("entity-page-meta");
  if (!meta || meta.querySelector(".alias-editor")) return;
  const editor = document.createElement("span");
  editor.className = "alias-editor";
  editor.innerHTML = '<input class="input" placeholder="输入新别名"><button class="text-btn small" data-action="save-entity-alias">保存</button>';
  meta.appendChild(editor);
  editor.querySelector("input")?.focus();
}

function saveEntityAlias(button) {
  const editor = button.closest(".alias-editor");
  const value = editor?.querySelector("input")?.value.trim();
  const profile = entityProfiles[activeEntityId];
  if (!editor || !value || !profile) return;
  profile.aliases = profile.aliases ? `${profile.aliases}、${value}` : value;
  const meta = document.getElementById("entity-page-meta");
  const alias = [...(meta?.querySelectorAll("span") || [])].find((node) => node.textContent.startsWith("别名"));
  if (alias) alias.textContent = `别名${value}`;
  editor.remove();
  showToast(`已添加别名「${value}」`);
}

function deleteEntityEntry() {
  const profile = entityProfiles[activeEntityId];
  if (!profile) return;
  openConfirm({
    title: `删除「${profile.name}」`,
    message: "删除后该条目会从当前设定分类移除，相关引用需要重新检查。",
    label: "删除条目",
    requireReason: true,
    onConfirm: ({ reason }) => {
      if (!reason) return;
      document.querySelector(`.entity-open-card[data-entity-id="${activeEntityId}"]`)?.remove();
      navigate("settings");
      setTab(entityReturnTab || "characters");
      showToast(`已删除「${profile.name}」，原因：${reason}`);
    },
  });
}

function showMapMarkers(button) {
  const list = document.getElementById("map-marker-list");
  if (!list) return;
  list.hidden = !list.hidden;
  button.textContent = list.hidden ? "查看图片标记" : "收起图片标记";
}

function setTab(tab) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tab);
  });
}

function setNoteTab(tab) {
  document.querySelectorAll("[data-note-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.noteTab === tab);
  });
  document.querySelectorAll("[data-note-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.notePanel === tab);
  });
}

function setOutlineView(view) {
  document.querySelectorAll("[data-outline-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.outlineView === view);
  });
  document.querySelectorAll("[data-outline-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.outlineViewPanel === view);
  });
}

function setLedgerView(view) {
  document.querySelectorAll("[data-ledger-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.ledgerView === view);
  });
  document.querySelectorAll("[data-ledger-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.ledgerPanel !== view;
  });
}

function moveOutlineNode(direction) {
  const node = document.querySelector(".outline-tree-item.active");
  if (!node) return;
  const sibling = direction === "up" ? node.previousElementSibling : node.nextElementSibling;
  if (!sibling?.classList.contains("outline-tree-item")) {
    showToast(direction === "up" ? "已经是第一个节点" : "已经是最后一个节点");
    return;
  }
  if (direction === "up") sibling.before(node);
  else sibling.after(node);
  showToast(`节点已${direction === "up" ? "上移" : "下移"}`);
}

function associateOutline() {
  const detail = document.querySelector(".chapter-detail");
  if (!detail) return;
  if (detail.querySelector(".outline-association")) {
    detail.querySelector(".outline-association").remove();
    showToast("已收起关联面板");
    return;
  }
  const panel = document.createElement("div");
  panel.className = "outline-association";
  panel.innerHTML = `
    <strong>关联对象</strong>
    <label class="check-row"><input type="checkbox" checked><span>伏笔：忘川书缺页</span></label>
    <label class="check-row"><input type="checkbox" checked><span>剧情线：主线 · 天门将开</span></label>
    <label class="check-row"><input type="checkbox"><span>人物弧光：顾青 · 从监视到选择立场</span></label>
    <button class="btn btn-primary btn-small" data-action="save-outline-association">保存关联</button>`;
  detail.querySelector(".outline-node-actions")?.before(panel);
  showToast("已打开关联面板");
}

function setBatchView(view) {
  document.querySelectorAll("[data-batch-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.batchView === view);
  });
  document.querySelectorAll("[data-batch-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.batchViewPanel === view);
  });
}

const genreDemoData = {
  xianxia: {
    title: "仙侠 · 修真文明",
    note: "分层地图、修炼体系、宗门势力、灵物与记忆代价。",
    details: ["地图：人界 → 东境 → 忘川渡", "势力：太玄门 / 血河宗 / 无相楼", "规则：境界、法宝、记忆代价"],
    coverTitle: "忘川书",
    coverMeta: "仙侠 · 长篇",
    creationNote: "仙侠：分层地图、修炼体系、宗门势力、灵物与记忆代价。",
    writingTitle: "仙侠 · 修真文明",
    writingRules: ["左臂骨折", "不能双手结印", "顾青不知道忘川书"],
    factions: [
      ["太玄门", "正道魁首 · 控制东境三十六城", "主角所属"],
      ["血河宗", "魔道大宗 · 与太玄门争夺忘川", "主要反派"],
      ["无相楼", "情报组织 · 买卖记忆与身份", "中立"],
      ["天门守", "仙界遗民 · 只在飞升时出现", "隐藏"],
    ],
    mapLabels: ["太玄门", "血河宗", "无相楼"],
  },
  history: {
    title: "历史 · 架空争霸",
    note: "州郡关隘、官制军制、世家门阀、粮草与道路。",
    details: ["地图：朔州 → 北境 → 京城", "势力：边军 / 世家 / 监军使", "规则：官制层级、军令、粮草和道路"],
    coverTitle: "北境争鼎",
    coverMeta: "历史 · 穿越争霸",
    creationNote: "历史：州郡关隘、官制军制、世家门阀、粮草与道路。",
    writingTitle: "历史 · 架空争霸",
    writingRules: ["不能出现现代器物", "官制称谓一致", "粮草与道路合理"],
    factions: [
      ["北境边军", "朔州边军 · 掌握关隘与骑兵", "主角阵营"],
      ["世家门阀", "控制朝堂与粮道 · 与边军博弈", "主要对手"],
      ["监军使", "皇权代表 · 监视边军", "中立偏敌"],
      ["北狄王庭", "草原强敌 · 冬季南侵", "外敌"],
    ],
    mapLabels: ["朔州", "北境关隘", "京城"],
  },
  urban: {
    title: "都市 · 资本与人脉",
    note: "城市、公司、家族、阶层、法律、金钱和人脉。",
    details: ["地图：南城 → 金融区 → 旧城商会", "势力：家族公司 / 旧城商会 / 投资方", "规则：资金流、授权、合同和法律程序"],
    coverTitle: "南城资本",
    coverMeta: "都市 · 资本",
    creationNote: "都市：城市、公司、家族、阶层、法律、金钱和人脉。",
    writingTitle: "都市 · 资本与人脉",
    writingRules: ["资金流合法", "合同与授权", "人脉不能凭空出现"],
    factions: [
      ["南城集团", "家族公司 · 控制旧城商业", "主角阵营"],
      ["旧城商会", "本地商户联盟 · 排外", "主要对手"],
      ["远方资本", "外来投资方 · 只看回报", "中立偏敌"],
      ["财经媒体", "舆论放大器 · 可被收买", "变量"],
    ],
    mapLabels: ["南城", "金融区", "旧城"],
  },
};

function setGenreDemo(genre) {
  const data = genreDemoData[genre];
  if (!data) return;
  document.querySelectorAll("[data-genre-demo]").forEach((button) => {
    button.classList.toggle("active", button.dataset.genreDemo === genre);
  });
  const title = document.getElementById("genre-demo-title");
  const note = document.getElementById("genre-demo-note");
  const detail = document.getElementById("genre-demo-detail");
  if (title) title.textContent = data.title;
  if (note) note.textContent = data.note;
  if (detail) detail.innerHTML = data.details.map((item) => `<span>${item}</span>`).join("");
  document.querySelectorAll("[data-genre-title]").forEach((el) => { el.textContent = data.title; });
  document.querySelectorAll("[data-genre-note]").forEach((el) => { el.textContent = data.note; });
  document.querySelectorAll("[data-genre-cover-title]").forEach((el) => { el.textContent = data.coverTitle; });
  document.querySelectorAll("[data-genre-cover-meta]").forEach((el) => { el.textContent = data.coverMeta; });
  document.querySelectorAll("[data-genre-creation-note]").forEach((el) => { el.textContent = data.creationNote; });
  document.querySelectorAll("[data-genre-writing-title]").forEach((el) => { el.textContent = data.writingTitle; });
  const writingRules = document.getElementById("writing-genre-rules");
  if (writingRules) {
    writingRules.innerHTML = data.writingRules.map((rule) => `<span class="state-chip">${rule}</span>`).join("");
  }
  document.querySelectorAll(".faction-list .faction-item").forEach((item, index) => {
    const faction = data.factions[index];
    if (!faction) return;
    const strong = item.querySelector("strong");
    const small = item.querySelector("small");
    const tag = item.querySelector(".tag");
    if (strong) strong.textContent = faction[0];
    if (small) small.textContent = faction[1];
    if (tag) tag.textContent = faction[2];
  });
  document.querySelectorAll("[data-genre-map-label]").forEach((el, index) => {
    if (data.mapLabels[index]) el.textContent = data.mapLabels[index];
  });
}

function toggleDemoMode() {
  const bar = document.getElementById("demo-state-bar");
  if (!bar) return;
  const open = bar.hidden;
  bar.hidden = !open;
  document.body.classList.toggle("demo-mode", open);
  if (!open) {
    document.body.dataset.demoState = "normal";
    document.querySelector(".main-shell")?.classList.remove("demo-state-blocked");
    const notice = document.getElementById("demo-state-notice");
    if (notice) notice.hidden = true;
    const overlay = document.getElementById("demo-page-state");
    if (overlay) overlay.hidden = true;
  }
  showToast(open ? "演示模式已开启，可切换七类全局状态" : "演示模式已关闭");
}

function setDemoState(state) {
  document.querySelectorAll("[data-demo-state]").forEach((button) => {
    button.classList.toggle("active", button.dataset.demoState === state);
  });
  document.body.dataset.demoState = state;
  const notice = document.getElementById("demo-state-notice");
  const labels = {
    normal: "正常",
    empty: "空状态",
    loading: "加载中",
    error: "错误",
    locked: "锁定",
    readonly: "只读",
    conflict: "冲突",
  };
  const messages = {
    normal: "",
    empty: "空状态：当前页面没有内容。先新建作品，或退出演示模式。",
    loading: "加载中：页面正在等待数据，暂时不能操作。",
    error: "错误状态：模型或数据加载失败，请重试或退出演示。",
    locked: "锁定状态：当前内容已锁定，修改需要填写原因。",
    readonly: "只读状态：作品已完本，默认只能阅读。",
    conflict: "冲突状态：正文与已确认设定不一致，需要处理。",
  };
  if (notice) {
    notice.textContent = messages[state] || "";
    notice.hidden = state === "normal";
    notice.dataset.state = state;
  }
  let overlay = document.getElementById("demo-page-state");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "demo-page-state";
    overlay.className = "demo-page-state";
    document.querySelector(".main-shell")?.appendChild(overlay);
  }
  overlay.hidden = state === "normal";
  overlay.dataset.state = state;
  const content = {
    empty: '<i data-lucide="inbox"></i><h2>这个页面还没有内容</h2><p>先新建作品，或返回正常状态继续浏览。</p><button class="btn btn-primary btn-small" data-action="set-demo-normal">返回正常</button>',
    loading: '<div class="state-skeleton"><span></span><span></span><span></span><span></span></div><p>正在加载页面数据…</p>',
    error: '<i data-lucide="cloud-off"></i><h2>加载失败</h2><p>模型或数据暂时不可用，请重试。</p><button class="btn btn-primary btn-small" data-action="set-demo-normal">返回正常</button>',
    locked: '<i data-lucide="lock"></i><h2>内容已锁定</h2><p>修改需要填写原因并创建修改请求。</p><button class="btn btn-primary btn-small" data-action="set-demo-normal">返回正常</button>',
    readonly: '<i data-lucide="book-open-check"></i><h2>只读模式</h2><p>作品已完本，默认只能阅读。</p><button class="btn btn-primary btn-small" data-action="set-demo-normal">返回正常</button>',
    conflict: '<i data-lucide="shield-alert"></i><h2>发现连续性冲突</h2><p>正文与已确认设定不一致，需要处理后才能继续。</p><button class="btn btn-primary btn-small" data-action="set-demo-normal">返回正常</button>',
  };
  overlay.innerHTML = content[state] || "";
  initIcons();
  document
    .querySelector(".main-shell")
    ?.classList.toggle("demo-state-blocked", ["loading", "error", "locked", "readonly"].includes(state));
  showToast(`演示状态：${labels[state] || state}`);
}

const writtenThroughChapter = 47;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function foreshadowChapter(value) {
  return value ? `第 ${value} 章` : "未定";
}

function getForeshadowChecks(record) {
  return {
    overdue:
      record.status === "planted" &&
      Number(record.plannedPayoffChapter) > 0 &&
      Number(record.plannedPayoffChapter) <= writtenThroughChapter,
    noSetup:
      !record.plantChapter &&
      Number(record.plannedPayoffChapter) > 0,
    duplicate: Boolean(record.duplicateOf),
    weakPayoff: Boolean(record.weakPayoff),
  };
}

function renderForeshadowStats() {
  const planted = foreshadowRecords.filter((record) => record.status === "planted");
  const overdue = foreshadowRecords.filter((record) => getForeshadowChecks(record).overdue);
  const paid = foreshadowRecords.filter((record) => record.status === "paid_off");
  const values = {
    "fs-stat-planted": planted.length,
    "fs-stat-must": planted.filter((record) => record.importance === "must").length,
    "fs-stat-overdue": overdue.length,
    "fs-stat-paid": paid.length,
  };
  for (const [id, value] of Object.entries(values)) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }
}

function renderForeshadowChecks() {
  const node = document.getElementById("foreshadow-checks");
  const countNode = document.getElementById("foreshadow-check-count");
  if (!node || !countNode) return;

  const checks = foreshadowRecords.map((record) => ({ record, checks: getForeshadowChecks(record) }));
  const groups = [
    {
      key: "overdue",
      title: "过期未回收",
      hint: "计划回收章已经过去，但仍是已埋设状态。",
      items: checks.filter(({ checks: value }) => value.overdue),
    },
    {
      key: "noSetup",
      title: "没有埋设就回收",
      hint: "有回收计划，但没有记录埋设章。",
      items: checks.filter(({ checks: value }) => value.noSetup),
    },
    {
      key: "duplicate",
      title: "重复线索",
      hint: "和另一条伏笔指向同一个物件或事件。",
      items: checks.filter(({ checks: value }) => value.duplicate),
    },
    {
      key: "weakPayoff",
      title: "回收力度不够",
      hint: "线索存在，但没有明确改变人物、关系或世界认知。",
      items: checks.filter(({ checks: value }) => value.weakPayoff),
    },
  ];
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  countNode.textContent = String(total);
  node.innerHTML = groups
    .map(
      (group) => `
        <div class="foreshadow-check-item ${group.items.length ? "has-warning" : ""}">
          <div>
            <strong>${group.title}</strong>
            <small>${group.items.length ? group.items.map(({ record }) => escapeHtml(record.title)).join("、") : group.hint}</small>
          </div>
          <span class="badge ${group.items.length ? "alert-badge" : "jade-badge"}">${group.items.length}</span>
        </div>
      `,
    )
    .join("");
}

function renderForeshadowList() {
  const node = document.getElementById("foreshadow-list");
  const countNode = document.getElementById("foreshadow-count");
  if (!node || !countNode) return;

  const search = document.getElementById("foreshadow-search")?.value.trim().toLowerCase() ?? "";
  const status = document.getElementById("foreshadow-status-filter")?.value ?? "";
  const importance = document.getElementById("foreshadow-importance-filter")?.value ?? "";
  const filtered = foreshadowRecords.filter((record) => {
    const haystack = [
      record.title,
      record.description,
      record.characters,
      record.factions,
      record.promise,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!search || haystack.includes(search)) &&
      (!status || record.status === status) &&
      (!importance || record.importance === importance)
    );
  });

  countNode.textContent = String(filtered.length);
  if (filtered.length === 0) {
    node.innerHTML = `
      <div class="foreshadow-empty">
        <i data-lucide="search-x"></i>
        <strong>没有符合条件的伏笔</strong>
        <p>换一个关键词或放宽筛选条件。</p>
      </div>
    `;
    initIcons();
    return;
  }

  node.innerHTML = filtered
    .map((record) => {
      const checks = getForeshadowChecks(record);
      const checkTags = [
        checks.overdue ? '<span class="badge alert-badge">过期未回收</span>' : "",
        checks.noSetup ? '<span class="badge alert-badge">没有埋设就回收</span>' : "",
        checks.duplicate
          ? `<span class="badge gold-badge">重复：${escapeHtml(record.duplicateOf)}</span>`
          : "",
        checks.weakPayoff ? '<span class="badge gold-badge">回收力度不够</span>' : "",
      ]
        .filter(Boolean)
        .join("");
      const statusClass =
        record.status === "paid_off"
          ? "jade-badge"
          : record.status === "abandoned"
            ? ""
            : "gold-badge";
      const importanceClass = record.importance === "must" ? "alert-badge" : "";
      const actions =
        record.status === "planted"
          ? `<button class="text-btn small" data-action="pay-foreshadow" data-id="${record.id}">标记已回收</button>
             <button class="text-btn small" data-action="abandon-foreshadow" data-id="${record.id}">放弃</button>`
          : "";

      return `
        <article class="foreshadow-row ${record.status === "paid_off" ? "is-paid" : ""} ${record.status === "abandoned" ? "is-abandoned" : ""}">
          <div class="foreshadow-row-head">
            <div>
              <span class="badge ${importanceClass}">${record.importance === "must" ? "必须回收" : "可选回收"}</span>
              <h3>${escapeHtml(record.title)}</h3>
            </div>
            <span class="badge ${statusClass}">${foreshadowStatusLabels[record.status]}</span>
          </div>
          <p>${escapeHtml(record.description)}</p>
          <div class="foreshadow-meta">
            <span>埋设：${escapeHtml(foreshadowChapter(record.plantChapter))}</span>
            <span>计划回收：${escapeHtml(foreshadowChapter(record.plannedPayoffChapter))}</span>
            <span>人物：${escapeHtml(record.characters || "未关联")}</span>
            <span>势力：${escapeHtml(record.factions || "未关联")}</span>
            <span>读者承诺：${escapeHtml(record.promise)}</span>
          </div>
          <div class="foreshadow-check-tags">${checkTags || '<span class="badge jade-badge">没有检查问题</span>'}</div>
          <div class="foreshadow-actions">
            ${actions}
            <button class="text-btn small" data-action="edit-foreshadow" data-id="${record.id}">编辑</button>
          </div>
        </article>
      `;
    })
    .join("");
  initIcons();
}

function renderForeshadowLedger() {
  renderForeshadowStats();
  renderForeshadowList();
  renderForeshadowChecks();
}

function openForeshadowModal(id) {
  const modal = document.getElementById("foreshadow-modal");
  const form = document.getElementById("foreshadow-form");
  const title = document.getElementById("foreshadow-modal-title");
  const error = document.getElementById("foreshadow-form-error");
  if (!modal || !form || !title) return;
  const record = id ? foreshadowRecords.find((item) => item.id === id) : null;
  title.textContent = record ? "编辑伏笔" : "新增伏笔";
  form.querySelector("#foreshadow-id").value = record?.id ?? "";
  form.querySelector("#foreshadow-title").value = record?.title ?? "";
  form.querySelector("#foreshadow-description").value = record?.description ?? "";
  form.querySelector("#foreshadow-plant").value = record?.plantChapter ?? "";
  form.querySelector("#foreshadow-payoff").value = record?.plannedPayoffChapter ?? "";
  form.querySelector("#foreshadow-importance").value = record?.importance ?? "must";
  form.querySelector("#foreshadow-status").value = record?.status ?? "planted";
  form.querySelector("#foreshadow-promise").value = record?.promise ?? "长线伏笔";
  form.querySelector("#foreshadow-characters").value = record?.characters ?? "";
  form.querySelector("#foreshadow-factions").value = record?.factions ?? "";
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => form.querySelector("#foreshadow-title")?.focus(), 50);
}

function closeForeshadowModal() {
  const modal = document.getElementById("foreshadow-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function updateForeshadowStatus(id, status) {
  const record = foreshadowRecords.find((item) => item.id === id);
  if (!record) return;
  record.status = status;
  renderForeshadowLedger();
  showToast(status === "paid_off" ? `已回收「${record.title}」` : `已放弃「${record.title}」`);
}

function initForeshadowLedger() {
  const form = document.getElementById("foreshadow-form");
  if (!form) return;

  ["foreshadow-search", "foreshadow-status-filter", "foreshadow-importance-filter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderForeshadowList);
    document.getElementById(id)?.addEventListener("change", renderForeshadowList);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = form.querySelector("#foreshadow-id").value;
    const title = form.querySelector("#foreshadow-title").value.trim();
    const description = form.querySelector("#foreshadow-description").value.trim();
    const error = document.getElementById("foreshadow-form-error");
    if (!title || !description) {
      if (error) {
        error.hidden = false;
        error.textContent = "伏笔名称和内容不能为空。";
      }
      return;
    }
    const input = {
      title,
      description,
      plantChapter: Number(form.querySelector("#foreshadow-plant").value) || null,
      plannedPayoffChapter: Number(form.querySelector("#foreshadow-payoff").value) || null,
      importance: form.querySelector("#foreshadow-importance").value,
      status: form.querySelector("#foreshadow-status").value,
      promise: form.querySelector("#foreshadow-promise").value,
      characters: form.querySelector("#foreshadow-characters").value.trim(),
      factions: form.querySelector("#foreshadow-factions").value.trim(),
    };
    if (id) {
      const record = foreshadowRecords.find((item) => item.id === id);
      if (record) Object.assign(record, input);
      showToast(`已更新「${title}」`);
    } else {
      foreshadowRecords.unshift({ id: `fs-${Date.now()}`, ...input });
      showToast(`已新增「${title}」`);
    }
    closeForeshadowModal();
    renderForeshadowLedger();
  });

  renderForeshadowLedger();
}

function jumpToBibleCard(target) {
  document.querySelectorAll("[data-bible-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.bibleTarget === target);
  });
  const card = document.getElementById(`bible-${target}`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderChapter(number) {
  const chapter = chapters[number];
  if (!chapter) return;
  const paper = document.querySelector(".editor-paper");
  const headingNumber = document.querySelector(".chapter-heading span");
  const headingTitle = document.querySelector(".chapter-heading h1");
  if (!paper || !headingNumber || !headingTitle) return;

  headingNumber.textContent = `第 ${number} 章`;
  headingTitle.textContent = chapter.title;
  paper.innerHTML =
    `<div class="chapter-heading"><span>第 ${number} 章</span><h1>${chapter.title}</h1></div>` +
    chapter.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");

  document.querySelectorAll(".chapter-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.chapter === String(number));
  });
  document.querySelectorAll(".chapter-card").forEach((item) => {
    item.classList.toggle("active", item.dataset.chapter === String(number));
  });

  bindCommentMarks();
  initIcons();
  showToast(`已切换到第 ${number} 章「${chapter.title}」`);
}

function bindCommentMarks() {
  document.querySelectorAll(".comment-mark").forEach((mark) => {
    mark.addEventListener("click", () => {
      showToast(mark.dataset.comment || "编辑批注");
    });
  });
}

function openExport() {
  const modal = document.getElementById("export-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeExport() {
  const modal = document.getElementById("export-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

const settingTypeLabels = {
  world: "世界规则",
  characters: "人物档案",
  factions: "势力",
  map: "地图 / 地点",
  power: "力量体系",
  items: "物品功法",
  goldenfinger: "金手指",
  timeline: "时间线",
  confirmed: "已确认设定",
};

function openCreateSetting() {
  const modal = document.getElementById("setting-create-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  const error = document.getElementById("setting-create-error");
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  const name = document.getElementById("setting-name");
  if (name) window.setTimeout(() => name.focus(), 50);
}

function closeCreateSetting() {
  const modal = document.getElementById("setting-create-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function addRecentSetting(input) {
  const recent = document.getElementById("settings-recent");
  const list = document.getElementById("settings-recent-list");
  if (!recent || !list) return;

  const card = document.createElement("article");
  card.className = "settings-recent-card";

  const type = document.createElement("span");
  type.className = "badge jade-badge";
  type.textContent = settingTypeLabels[input.type] || "设定";

  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = input.name;
  const summary = document.createElement("small");
  summary.textContent = input.summary;
  copy.append(name, summary);

  const state = document.createElement("span");
  state.className = input.status === "confirmed" ? "badge" : "badge gold-badge";
  state.textContent = input.status === "confirmed" ? "已确认" : "草稿";

  const openButton = document.createElement("button");
  openButton.className = "text-btn small";
  openButton.dataset.tab = input.type;
  openButton.textContent = "打开分类";

  card.append(type, copy, state, openButton);
  list.prepend(card);
  recent.hidden = false;
  initIcons();
  setTab(input.type);
}

function initSettingCreate() {
  const form = document.getElementById("setting-create-form");
  const type = document.getElementById("setting-type");
  const hint = document.getElementById("setting-type-hint");
  if (!form || !type || !hint) return;

  const hints = {
    world: "世界规则会参与后续生成和连续性检查；草稿不会立即进入生成上下文。",
    characters: "人物档案会关联当前状态、知识边界和关系；草稿可稍后补全。",
    factions: "势力可以关联控制区、人物和时间线；建议补充目标与资源。",
    map: "地点会参与地图层级、旅行时间和人物位置检查。",
    power: "力量体系需要写清层级、突破条件、代价和瓶颈。",
    items: "物品功法需要记录品阶、效果、代价、归属和限制。",
    goldenfinger: "金手指必须定义规则、代价、限制和成长曲线。",
    timeline: "时间节点会参与时间线一致性检查。",
    confirmed: "已确认设定会进入后续生成上下文；请确认事实准确。",
  };

  type.addEventListener("change", () => {
    hint.querySelector("span").textContent = hints[type.value] || hints.world;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = form.querySelector('#setting-name').value.trim();
    const summary = form.querySelector('#setting-summary').value.trim();
    const details = form.querySelector('#setting-details').value.trim();
    const tags = form.querySelector('#setting-tags').value.trim();
    const status = form.querySelector('#setting-status').value;
    const error = document.getElementById("setting-create-error");

    if (!name || !summary) {
      if (error) {
        error.hidden = false;
        error.textContent = "名称和一句话摘要不能为空。";
      }
      return;
    }
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }

    addRecentSetting({ type: type.value, name, summary, details, tags, status });
    form.reset();
    hint.querySelector("span").textContent = hints.world;
    closeCreateSetting();
    showToast(`已创建「${name}」设定草稿`);
    window.setTimeout(() => {
      document.getElementById("settings-recent")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  });
}

function renderCustomFieldPreview() {
  const node = document.getElementById("custom-field-preview");
  if (!node) return;
  const fields = customFieldRecords.filter(
    (field) => field.status === "active" && field.objects.includes("人物"),
  );
  node.innerHTML = fields
    .map(
      (field) => `
        <div class="field-preview-row">
          <span>${escapeHtml(field.name)}</span>
          <strong>${escapeHtml(field.previewValue || "未填写")}</strong>
          <small>${customFieldTypeLabels[field.type]}${field.required ? " · 必填" : ""}</small>
        </div>
      `,
    )
    .join("");
}

function renderCustomFieldList() {
  const node = document.getElementById("custom-field-list");
  if (!node) return;
  const search = document.getElementById("custom-field-search")?.value.trim().toLowerCase() ?? "";
  const object = document.getElementById("custom-field-object-filter")?.value ?? "";
  const status = document.getElementById("custom-field-status-filter")?.value ?? "";
  const fields = customFieldRecords.filter((field) => {
    const haystack = [field.name, field.description, field.options, field.relationTarget]
      .join(" ")
      .toLowerCase();
    return (
      (!search || haystack.includes(search)) &&
      (!object || field.objects.includes(object)) &&
      (!status || field.status === status)
    );
  });

  if (fields.length === 0) {
    node.innerHTML = `
      <div class="foreshadow-empty">
        <i data-lucide="search-x"></i>
        <strong>没有符合条件的字段</strong>
        <p>换一个关键词或放宽筛选条件。</p>
      </div>
    `;
    initIcons();
    return;
  }

  node.innerHTML = fields
    .map((field) => {
      const detail =
        field.type === "relation"
          ? `指向：${escapeHtml(field.relationTarget)}`
          : field.options || field.description;
      return `
        <div class="custom-field-row ${field.status === "disabled" ? "is-disabled" : ""}">
          <div class="custom-field-name">
            <strong>${escapeHtml(field.name)}</strong>
            <small>${escapeHtml(field.source)}</small>
          </div>
          <span data-label="类型">${customFieldTypeLabels[field.type]}</span>
          <span data-label="适用对象">${escapeHtml(field.objects.join(" / "))}</span>
          <span class="badge ${field.required ? "jade-badge" : ""}" data-label="必填">${field.required ? "是" : "否"}</span>
          <span data-label="选项 / 说明">${escapeHtml(detail)}</span>
          <span class="badge ${field.status === "active" ? "jade-badge" : ""}" data-label="状态">${field.status === "active" ? "启用" : "停用"}</span>
          <div class="custom-field-row-actions">
            <button class="icon-btn small" data-action="edit-custom-field" data-id="${field.id}" title="编辑字段"><i data-lucide="pencil"></i></button>
            <button class="text-btn small" data-action="toggle-custom-field" data-id="${field.id}">${field.status === "active" ? "停用" : "启用"}</button>
          </div>
        </div>
      `;
    })
    .join("");
  initIcons();
}

function renderCustomFields() {
  renderCustomFieldList();
  renderCustomFieldPreview();
}

function syncCustomFieldTypeFields() {
  const type = document.getElementById("custom-field-type")?.value;
  document.querySelectorAll("[data-custom-type-field]").forEach((node) => {
    node.hidden = true;
    if (node.dataset.customTypeField === "options") {
      node.hidden = !["single_select", "multi_select"].includes(type);
    }
    if (node.dataset.customTypeField === "relation") {
      node.hidden = type !== "relation";
    }
  });
}

function openCustomFieldModal(id) {
  const modal = document.getElementById("custom-field-modal");
  const form = document.getElementById("custom-field-form");
  const title = document.getElementById("custom-field-modal-title");
  const error = document.getElementById("custom-field-form-error");
  if (!modal || !form || !title) return;
  const field = id ? customFieldRecords.find((item) => item.id === id) : null;
  title.textContent = field ? "编辑字段" : "新增字段";
  form.querySelector("#custom-field-id").value = field?.id ?? "";
  form.querySelector("#custom-field-name").value = field?.name ?? "";
  form.querySelector("#custom-field-type").value = field?.type ?? "text";
  form.querySelector("#custom-field-required").value = String(field?.required ?? false);
  form.querySelector("#custom-field-status").value = field?.status ?? "active";
  form.querySelector("#custom-field-options").value = field?.options ?? "";
  form.querySelector("#custom-field-relation-target").value =
    field?.relationTarget || "物品";
  form.querySelector("#custom-field-description").value = field?.description ?? "";
  form.querySelectorAll(".custom-object-options input").forEach((checkbox) => {
    checkbox.checked = field ? field.objects.includes(checkbox.value) : checkbox.value === "人物";
    checkbox.disabled = Boolean(field);
  });
  form.querySelector("#custom-field-type").disabled = Boolean(field);
  const editNote = document.getElementById("custom-field-edit-note");
  if (editNote) editNote.hidden = !field;
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  syncCustomFieldTypeFields();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => form.querySelector("#custom-field-name")?.focus(), 50);
}

function closeCustomFieldModal() {
  const modal = document.getElementById("custom-field-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function openConfirm(options = {}) {
  const modal = document.getElementById("confirm-modal");
  const title = document.getElementById("confirm-title");
  const message = document.getElementById("confirm-message");
  const submit = document.getElementById("confirm-submit");
  const nameGroup = document.querySelector("[data-confirm-name-group]");
  const reasonGroup = document.querySelector("[data-confirm-reason-group]");
  const error = document.getElementById("confirm-error");
  if (!modal || !title || !message || !submit) return;

  title.textContent = options.title || "确认操作";
  message.textContent = options.message || "这个操作需要二次确认。";
  submit.textContent = options.label || "确认";
  if (nameGroup) nameGroup.hidden = !options.requireName;
  if (reasonGroup) reasonGroup.hidden = !options.requireReason;
  const nameInput = document.getElementById("confirm-name");
  const reasonInput = document.getElementById("confirm-reason");
  if (nameInput) nameInput.value = "";
  if (reasonInput) reasonInput.value = "";
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  confirmCallback = (values) => {
    if (options.onConfirm) options.onConfirm(values);
    else showToast(options.success || "操作已确认");
  };
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeConfirm() {
  const modal = document.getElementById("confirm-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  confirmCallback = null;
}

function openCopyWork() {
  const modal = document.getElementById("copy-work-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeCopyWork() {
  const modal = document.getElementById("copy-work-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function initCopyWork() {
  const form = document.getElementById("copy-work-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const parts = [...form.querySelectorAll("[data-copy-part]:checked")].map(
      (input) => input.dataset.copyPart
    );
    closeCopyWork();
    showToast(parts.length ? `已复制作品，包含 ${parts.length} 个部分` : "已创建空白副本");
  });
}

function initConfirm() {
  const form = document.getElementById("confirm-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nameGroup = document.querySelector("[data-confirm-name-group]");
    const reasonGroup = document.querySelector("[data-confirm-reason-group]");
    const name = document.getElementById("confirm-name")?.value.trim() || "";
    const reason = document.getElementById("confirm-reason")?.value.trim() || "";
    const error = document.getElementById("confirm-error");
    if (nameGroup && !nameGroup.hidden && !name) {
      if (error) {
        error.hidden = false;
        error.textContent = "请填写分支名称。";
      }
      return;
    }
    if (reasonGroup && !reasonGroup.hidden && !reason) {
      if (error) {
        error.hidden = false;
        error.textContent = "请填写操作原因。";
      }
      return;
    }
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    const callback = confirmCallback;
    closeConfirm();
    callback?.({ name, reason });
  });
}

function openModelConfig() {
  const modal = document.getElementById("model-config-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => document.getElementById("model-config-name")?.focus(), 50);
}

function closeModelConfig() {
  const modal = document.getElementById("model-config-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function initModelConfig() {
  const form = document.getElementById("model-config-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("model-config-name").value.trim();
    const baseUrl = document.getElementById("model-config-base-url").value.trim();
    const model = document.getElementById("model-config-model").value.trim();
    const error = document.getElementById("model-config-error");
    if (!name || !baseUrl || !model) {
      if (error) {
        error.hidden = false;
        error.textContent = "配置名称、Base URL 和模型名不能为空。";
      }
      return;
    }
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    closeModelConfig();
    const rows = document.querySelectorAll(".model-config-row");
    const lastRow = rows[rows.length - 1];
    if (lastRow) {
      const row = document.createElement("div");
      row.className = "model-config-row";
      row.dataset.modelId = `model-${Date.now()}`;
      row.innerHTML = `
        <div class="model-logo">${escapeHtml(name.slice(0, 2).toUpperCase())}</div>
        <div class="model-config-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(model)} · ${escapeHtml(baseUrl)} · Key ••••••••</small></div>
        <span class="badge">新配置</span>
        <button class="text-btn small" data-action="run-connection-test">测试连接</button>
        <button class="icon-btn small" data-action="open-model-config" title="编辑模型配置"><i data-lucide="pencil"></i></button>
        <button class="icon-btn small" data-action="delete-model-config" title="删除配置"><i data-lucide="trash-2"></i></button>`;
      lastRow.after(row);
      initIcons();
    }
    showToast(`模型配置「${name}」已保存`);
  });
}

function deleteModelConfig(button) {
  const row = button.closest(".model-config-row");
  if (!row) return;
  const name = row.querySelector(".model-config-copy strong")?.textContent || "模型配置";
  row.remove();
  showToast(`模型配置「${name}」已删除`);
}

function openOutlineNode() {
  const modal = document.getElementById("outline-node-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => document.getElementById("outline-node-title-input")?.focus(), 50);
}

function closeOutlineNode() {
  const modal = document.getElementById("outline-node-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function initOutlineNode() {
  const form = document.getElementById("outline-node-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = document.getElementById("outline-node-title-input").value.trim();
    const goal = document.getElementById("outline-node-goal").value.trim();
    const error = document.getElementById("outline-node-error");
    if (!title || !goal) {
      if (error) {
        error.hidden = false;
        error.textContent = "节点标题和目标不能为空。";
      }
      return;
    }
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    closeOutlineNode();
    showToast(`节点「${title}」已保存，准备度已更新`);
  });
}

function openWritingActions() {
  const modal = document.getElementById("writing-actions-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeWritingActions() {
  const modal = document.getElementById("writing-actions-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function openChangeRequest() {
  const modal = document.getElementById("change-request-modal");
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => document.getElementById("change-request-name")?.focus(), 50);
}

function closeChangeRequest() {
  const modal = document.getElementById("change-request-modal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function initChangeRequest() {
  const form = document.getElementById("change-request-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("change-request-name").value.trim();
    const reason = document.getElementById("change-request-reason").value.trim();
    const error = document.getElementById("change-request-error");
    if (!name || !reason) {
      if (error) {
        error.hidden = false;
        error.textContent = "修改标题和原因不能为空。";
      }
      return;
    }
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    closeChangeRequest();
    showToast(`修改请求「${name}」已创建，正在分析影响`);
  });
}

let manualVersionNumber = 12;

function updateEditorWordCount() {
  const paper = document.querySelector(".editor-paper");
  if (!paper) return;
  paper.dispatchEvent(new Event("input", { bubbles: true }));
}

function appendEditorParagraph(text) {
  const paper = document.querySelector(".editor-paper");
  if (!paper) return;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paper.appendChild(paragraph);
  editorDirty = true;
  updateEditorWordCount();
}

function createChapterDraft() {
  const nav = document.querySelector(".chapter-nav");
  if (!nav) return;
  const nextNumber = Math.max(...Object.keys(chapters).map(Number), 49) + 1;
  chapters[nextNumber] = {
    title: "未命名章节",
    paragraphs: ["新的章节从这里开始。", "沈砚还没有想好下一步要去哪里。"],
  };
  const button = document.createElement("button");
  button.className = "chapter-nav-item";
  button.dataset.chapter = String(nextNumber);
  button.innerHTML = `<span>${nextNumber}</span><div><strong>未命名章节</strong><small>草稿</small></div><span class="status-pill">草稿</span>`;
  nav.appendChild(button);
  renderChapter(nextNumber);
  const badge = document.querySelector(".chapter-sidebar .panel-head .badge");
  if (badge) {
    const [done, total] = badge.textContent.split("/").map((part) => Number(part.trim()));
    if (!Number.isNaN(done) && !Number.isNaN(total)) {
      badge.textContent = `${done + 1} / ${total}`;
    }
  }
  showToast(`第 ${nextNumber} 章草稿已创建`);
}

function generateChapterDraft(button) {
  if (!button || button.dataset.busy === "true") return;
  const label = button.querySelector("span");
  const original = label?.textContent || "整章生成";
  button.dataset.busy = "true";
  button.disabled = true;
  if (label) label.textContent = "生成中…";
  showToast("正在生成整章草稿");
  window.setTimeout(() => {
    showEditorInsertProposal(
      "【生成草稿】顾青的手按在剑柄上没有动。沈砚听见自己的呼吸，也听见识海里那本书翻过一页的轻响。",
      "整章生成"
    );
    button.dataset.busy = "false";
    button.disabled = false;
    if (label) label.textContent = original;
    const saveState = document.querySelector(".save-state");
    if (saveState) {
      saveState.innerHTML = '<i data-lucide="cloud-check"></i>已生成草稿提案，等待审阅';
      initIcons();
    }
    showToast("整章草稿提案已生成，等待你确认");
  }, 900);
}

function continueWriting() {
  showEditorInsertProposal(
    "顾青没有追上来，只把剑鞘往地上一顿。那一声很轻，却让沈砚想起很多年前，母亲在门口叫他回家吃饭。",
    "续写"
  );
  showToast("已生成续写提案，等待你确认");
}

function showEditorInsertProposal(text, label) {
  const panel = document.querySelector('[data-note-panel="advice"]');
  if (!panel) return;
  const existing = panel.querySelector(".editor-insert-proposal");
  if (existing) existing.remove();
  const card = document.createElement("article");
  card.className = "note-card rewrite-proposal editor-insert-proposal";
  card.dataset.insertText = text;
  card.innerHTML = `
    <div class="note-head"><span class="badge gold-badge">${escapeHtml(label)}提案</span><small>第 47 章</small></div>
    <p>${escapeHtml(text)}</p>
    <div class="note-actions">
      <button class="text-btn small" data-action="dismiss-editor-insert">放弃</button>
      <button class="text-btn small" data-action="accept-editor-insert">插入正文</button>
    </div>`;
  panel.prepend(card);
  setNoteTab("advice");
}

function checkConsistency() {
  setNoteTab("continuity");
  const card = document.querySelector('[data-note-panel="continuity"] .alert-note');
  if (card) {
    card.classList.add("flash");
    window.setTimeout(() => card.classList.remove("flash"), 1200);
  }
  showToast("发现 1 处连续性冲突：左臂骨折与双手结印不一致");
}

function saveWritingVersion() {
  const list = document.querySelector('[data-note-panel="versions"] .version-list');
  if (!list) return;
  const paper = document.querySelector(".editor-paper");
  const wordCount = paper ? paper.innerText.replace(/\s+/g, "").length.toLocaleString() : "2,860";
  list.querySelectorAll(".version-item.current").forEach((item) => {
    item.classList.remove("current");
    item.querySelector(".badge")?.remove();
  });
  manualVersionNumber += 1;
  const item = document.createElement("div");
  item.className = "version-item current";
  item.innerHTML = `
    <div><strong>v${manualVersionNumber} · 手动保存</strong><small>刚刚 · ${wordCount} 字</small></div>
    <span class="badge live-badge">当前</span>`;
  list.prepend(item);
  editorDirty = false;
  const tab = document.querySelector('.note-tab[data-note-tab="versions"] span');
  if (tab) tab.textContent = String(list.querySelectorAll(".version-item").length);
  showToast(`已保存 v${manualVersionNumber}`);
}

function decideFact(button, decision) {
  const card = button.closest(".note-card");
  if (!card) return;
  const badge = card.querySelector(".note-head .badge");
  const labels = {
    confirmed: ["已确认", "jade-badge", "事实已确认，已写入已确认设定"],
    rejected: ["已驳回", "", "事实已驳回，不会进入后续上下文"],
    modified: ["已修改确认", "jade-badge", "已改成“顾青只察觉异常”，并写入已确认设定"],
  };
  const [label, tone, message] = labels[decision] || labels.confirmed;
  if (badge) {
    badge.textContent = label;
    badge.className = `badge ${tone}`.trim();
  }
  const actions = card.querySelector(".note-actions");
  if (actions) actions.innerHTML = `<span class="note-result">${label}</span>`;
  showToast(message);
}

function applyGenerationControls() {
  const saveState = document.querySelector(".save-state");
  if (saveState) {
    saveState.innerHTML = '<i data-lucide="check"></i>生成控制已应用';
    initIcons();
  }
  showToast("生成控制已应用，下一段会按新设置生成");
}

function setBatchTaskState(button, state) {
  const panel = button.closest(".task-panel");
  if (!panel) return;
  const badge = panel.querySelector(".panel-head .badge");
  panel.dataset.taskState = state;
  if (badge) {
    badge.textContent = state === "paused" ? "已暂停" : "运行中 · 62%";
    badge.className = `badge ${state === "paused" ? "gold-badge" : "live-badge"}`;
  }
  showToast(state === "paused" ? "任务已暂停，当前章节保留" : "任务已恢复，继续生成");
}

function updateReviewQueueCount() {
  const panel = document.querySelector(".review-panel");
  if (!panel) return;
  const pending = panel.querySelectorAll(".review-item:not(.review-done)").length;
  const heading = panel.querySelector(".panel-head h3");
  if (heading) heading.textContent = pending ? `${pending} 章等待作者确认` : "审核队列已清空";
}

function settleReviewItem(item, status) {
  if (!item || item.classList.contains("review-done")) return;
  item.classList.add("review-done");
  const badge = item.querySelector(".review-item > .badge");
  if (badge) {
    badge.textContent = status === "approved" ? "已批准" : "已驳回";
    badge.className = `badge ${status === "approved" ? "jade-badge" : "alert-badge"}`;
  }
  const actions = item.querySelector(".review-actions");
  if (actions) {
    actions.innerHTML =
      status === "approved"
        ? '<span class="note-result">已批准并锁定</span>'
        : '<span class="note-result">已驳回，等待重新生成</span>';
  }
}

function approveReview(button) {
  const item = button.closest(".review-item");
  if (!item) return;
  const title = item.querySelector(".review-copy strong")?.textContent || "章节";
  settleReviewItem(item, "approved");
  updateReviewQueueCount();
  showToast(`${title} 已批准并锁定`);
}

function rejectReview(button) {
  const item = button.closest(".review-item");
  if (!item) return;
  const title = item.querySelector(".review-copy strong")?.textContent || "章节";
  settleReviewItem(item, "rejected");
  updateReviewQueueCount();
  showToast(`${title} 已驳回，等待重新生成`);
}

function batchApproveLowRisk(button) {
  const items = [...document.querySelectorAll(".review-item:not(.review-done)")].filter((item) =>
    item.querySelector(".jade-badge")
  );
  items.forEach((item) => settleReviewItem(item, "approved"));
  updateReviewQueueCount();
  showToast(items.length ? `已批量批准 ${items.length} 个低风险章节` : "没有可批量批准的低风险章节");
}

function startExportTask(button) {
  const list = document.querySelector(".export-history-list");
  if (!list || button.dataset.busy === "true") return;
  button.dataset.busy = "true";
  button.disabled = true;
  const label = button.querySelector("span");
  const original = label?.textContent || "开始导出";
  if (label) label.textContent = "导出中…";
  const row = document.createElement("div");
  row.className = "export-history-row";
  row.innerHTML = `
    <i data-lucide="loader-circle"></i>
    <div><strong>仙途：忘川书_第二卷.txt</strong><small>刚刚 · 正在生成</small></div>
    <span class="badge gold-badge">生成中</span>`;
  list.prepend(row);
  initIcons();
  showToast("导出任务已创建，正在生成文件");
  window.setTimeout(() => {
    row.innerHTML = `
      <i data-lucide="file-text"></i>
      <div><strong>仙途：忘川书_第二卷.txt</strong><small>刚刚 · 9.9 MB · 7 天后过期</small></div>
      <button class="btn btn-ghost btn-small" data-action="download-export">下载</button>`;
    button.dataset.busy = "false";
    button.disabled = false;
    if (label) label.textContent = original;
    initIcons();
    showToast("导出完成，已写入导出历史");
  }, 1000);
}

function copyCurrentChapter() {
  const paper = document.querySelector(".editor-paper");
  const text = paper ? paper.innerText : "";
  if (navigator.clipboard && text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  showToast("当前章已复制到剪贴板");
}

function rerunPublishCheck(button) {
  const badge = document.querySelector(".publish-check-panel .panel-head .badge");
  if (badge) {
    badge.textContent = "检查中";
    badge.className = "badge gold-badge";
  }
  button.disabled = true;
  showToast("正在重新运行发布检查");
  window.setTimeout(() => {
    if (badge) {
      badge.textContent = "1 项待处理";
      badge.className = "badge gold-badge";
    }
    button.disabled = false;
    showToast("发布检查完成：敏感词 2 处，AI 内容标识待确认");
  }, 900);
}

function generatePublishCopy() {
  const panel = document.querySelector(".publish-check-panel");
  if (!panel || panel.querySelector(".publish-suggestion")) return;
  const suggestion = document.createElement("div");
  suggestion.className = "publish-suggestion";
  suggestion.innerHTML = `
    <strong>发布文案建议</strong>
    <p>书名备选：《忘川书》《天门之后》《我以记忆换长生》</p>
    <p>简介：他每变强一次，就会忘记一个最重要的人。直到有一天，他忘了自己为什么要变强。</p>
    <p>章节名建议：第 47 章《断臂之后》、第 48 章《一只手也能结印》、第 49 章《顾青的试探》</p>
    <span class="tag-row wrap"><span class="tag">仙侠</span><span class="tag">记忆代价</span><span class="tag">身世谜团</span><span class="tag">天门</span></span>`;
  panel.appendChild(suggestion);
  showToast("已生成书名、简介和标签建议");
}

function undoLastChange() {
  const request = document.querySelector(".change-request");
  if (!request) return;
  const badge = request.querySelector(".change-head .badge");
  if (badge) {
    badge.textContent = "已撤销";
    badge.className = "badge";
  }
  const actions = request.querySelector(".change-actions");
  if (actions) actions.innerHTML = '<span class="note-result">已撤销上一次修改，并生成反向修改</span>';
  const audit = document.querySelector(".audit-list");
  if (audit) {
    const row = document.createElement("div");
    row.className = "audit-row";
    row.innerHTML = '<span class="audit-dot gold"></span><div><strong>撤销修改请求 CR-024</strong><small>刚刚 · 你 · 原因：恢复主线设定</small></div><span class="badge jade-badge">已应用</span>';
    audit.prepend(row);
  }
  showToast("已撤销上一次修改，并生成反向修改");
}

function cancelChangeRequestAction() {
  const request = document.querySelector(".change-request");
  if (!request) return;
  const badge = request.querySelector(".change-head .badge");
  if (badge) {
    badge.textContent = "已放弃";
    badge.className = "badge";
  }
  const actions = request.querySelector(".change-actions");
  if (actions) actions.innerHTML = '<span class="note-result">修改请求已放弃，主线设定保持不变</span>';
  showToast("修改请求已取消，保留当前主线设定");
}

function showFixSuggestions() {
  const panel = document.querySelector(".decision-panel");
  if (!panel || panel.querySelector(".fix-suggestion-list")) return;
  const list = document.createElement("div");
  list.className = "fix-suggestion-list";
  list.innerHTML = `
    <div><strong>第 37 章</strong><span>追加剧中“记忆”试探，不改变表面台词</span></div>
    <div><strong>第 52 章</strong><span>保留信任，但加一层不安的伏笔</span></div>
    <div><strong>第 61 章</strong><span>把掌门的第一句台词改成问句</span></div>`;
  panel.appendChild(list);
  showToast("已生成 3 条可修复建议，结构性冲突仍需拉平行版本");
}

function saveWorkSettings(button) {
  const label = button.querySelector("span");
  if (label) label.textContent = "已保存";
  button.disabled = true;
  showToast("作品设置已保存");
}

function setWorkLifecycle(completed) {
  const form = document.querySelector(".work-settings-form");
  if (!form) return;
  let note = form.querySelector(".work-lifecycle-note");
  if (completed) {
    if (!note) {
      note = document.createElement("div");
      note.className = "work-lifecycle-note";
      form.prepend(note);
    }
    note.textContent = "作品已标记完本，默认只读；恢复连载后可继续编辑。";
  } else {
    note?.remove();
  }
  showToast(completed ? "作品已标记完本，默认只读" : "作品已恢复连载");
}

function generateNextVolume() {
  const items = [...document.querySelectorAll(".volume-panel .volume-item")];
  if (items.some((item) => item.textContent.includes("天门之后"))) {
    showToast("下一卷草案已经存在");
    return;
  }
  const last = items[items.length - 1];
  if (!last) return;
  const index = String(items.length + 1).padStart(2, "0");
  const volume = document.createElement("div");
  volume.className = "volume-item";
  volume.innerHTML = `<span class="volume-index">${index}</span><div><strong>天门之后</strong><small>草案 · 待确认</small></div><span class="status-pill">草案</span>`;
  last.after(volume);
  showToast("已生成下一卷大纲草案：天门之后");
}

function addVolumeDraft() {
  const items = [...document.querySelectorAll(".volume-panel .volume-item")];
  const last = items[items.length - 1];
  if (!last) return;
  const index = String(items.length + 1).padStart(2, "0");
  const volume = document.createElement("div");
  volume.className = "volume-item";
  volume.innerHTML = `<span class="volume-index">${index}</span><div><strong>新卷草案</strong><small>未命名 · 0 / 30</small></div><span class="status-pill">草稿</span>`;
  last.after(volume);
  showToast("已新增一卷，等待填写卷目标");
}

function focusComparePanel() {
  const panel = document.querySelector(".compare-panel");
  if (!panel) return;
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  panel.classList.add("flash");
  window.setTimeout(() => panel.classList.remove("flash"), 1200);
  showToast("已定位到并排比较");
}

function focusBatchForm() {
  const form = document.querySelector(".batch-form");
  if (!form) return;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.classList.add("flash");
  window.setTimeout(() => form.classList.remove("flash"), 1200);
  document.getElementById("batch-task-type")?.focus();
  showToast("已定位到新建生产任务");
}

function setBibleEditable(main, editing) {
  main.classList.toggle("is-editing", editing);
  main
    .querySelectorAll(
      ".bible-quote blockquote, .bible-card h4, .bible-card p, .bible-card li, .bible-card dd"
    )
    .forEach((el) => {
      el.contentEditable = String(editing);
    });
  let note = main.querySelector(".bible-edit-note");
  if (editing) {
    if (!note) {
      note = document.createElement("div");
      note.className = "bible-edit-note";
      main.prepend(note);
    }
    note.textContent = `修改请求 CR-025 · 原因：${main.dataset.editReason || "未填写"} · 影响：故事圣经九卡与后续大纲`;
  }
}

function toggleBibleEditing(button) {
  const main = document.querySelector(".bible-main");
  if (!main) return;
  const editing = !main.classList.contains("is-editing");
  const locked = Boolean(document.querySelector(".bible-head .locked-badge"));
  if (editing && locked && main.dataset.reasonConfirmed !== "true") {
    openConfirm({
      title: "修改已锁定故事圣经",
      message: "锁定后的修改会进入修改请求，并保留原因和回滚点。",
      label: "填写原因并继续",
      requireReason: true,
      onConfirm: ({ reason }) => {
        if (!reason) return;
        main.dataset.reasonConfirmed = "true";
        main.dataset.editReason = reason;
        setBibleEditable(main, true);
        const label = button.querySelector("span");
        if (label) label.textContent = "完成编辑";
        showToast("已进入故事圣经编辑模式");
      },
    });
    return;
  }
  setBibleEditable(main, editing);
  const label = button.querySelector("span");
  if (label) label.textContent = editing ? "完成编辑" : "编辑";
  showToast(
    editing
      ? "已进入故事圣经编辑模式"
      : `故事圣经已保存${main.dataset.editReason ? `，原因：${main.dataset.editReason}` : ""}`
  );
}

function editBibleQuote(button) {
  const quote = button.closest(".bible-quote")?.querySelector("blockquote");
  if (!quote) return;
  const main = document.querySelector(".bible-main");
  const locked = Boolean(document.querySelector(".bible-head .locked-badge"));
  if (locked && main?.dataset.reasonConfirmed !== "true") {
    openConfirm({
      title: "修改已锁定故事圣经",
      message: "修改这句话会保留原因，并产生修改记录。",
      label: "填写原因并继续",
      requireReason: true,
      onConfirm: ({ reason }) => {
        if (!reason) return;
        main.dataset.reasonConfirmed = "true";
        main.dataset.editReason = reason;
        quote.contentEditable = "true";
        quote.focus();
        showToast("可以编辑这句话");
      },
    });
    return;
  }
  quote.contentEditable = "true";
  quote.focus();
  showToast("可以编辑这句话");
}

function checkBible() {
  const main = document.querySelector(".bible-main");
  if (!main) return;
  if (!main.querySelector(".bible-check-result")) {
    const box = document.createElement("article");
    box.className = "bible-check-result panel";
    box.innerHTML = `
      <div class="panel-head"><div><span class="panel-kicker">一致性检查</span><h3>发现 2 处需要确认</h3></div><span class="badge gold-badge">检查完成</span></div>
      <div class="entity-note"><i data-lucide="alert-triangle"></i><span>主角卡没有写清“母亲是否还活着”，与身世线存在冲突。</span></div>
      <div class="entity-note"><i data-lucide="alert-triangle"></i><span>金手指卡写了 49 页，但正文还没有出现总页数。</span></div>`;
    main.prepend(box);
    initIcons();
  }
  showToast("故事圣经检查完成：2 处需要确认");
}

function completeBible() {
  const main = document.querySelector(".bible-main");
  if (!main) return;
  if (main.querySelector(".bible-proposal")) {
    showToast("补全提案已经存在");
    return;
  }
  const proposal = document.createElement("article");
  proposal.className = "bible-proposal panel";
  proposal.innerHTML = `
    <div class="panel-head"><div><span class="panel-kicker">AI 补全提案</span><h3>给主角卡补一条“母亲状态”</h3></div><span class="badge gold-badge">待确认</span></div>
    <p>母亲没有确认死亡，只是失踪。沈砚一直相信她还活着，这与“父母自杀”的认知形成更复杂的冲突。</p>
    <div class="button-row">
      <button class="btn btn-ghost btn-small" data-action="dismiss-bible-proposal">放弃</button>
      <button class="btn btn-primary btn-small" data-action="accept-bible-proposal">接受提案</button>
    </div>`;
  main.prepend(proposal);
  showToast("AI 已生成补全提案，等待你确认");
}

function focusShortcuts() {
  const cards = [...document.querySelectorAll(".help-card")];
  const card = cards.find((item) => item.textContent.includes("常用快捷键"));
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  window.setTimeout(() => card.classList.remove("flash"), 1200);
  showToast("已定位到快捷键说明");
}

function retryConnection(button) {
  const box = button.closest(".state-demo-error");
  if (!box) return;
  box.innerHTML = `
    <i data-lucide="cloud-check"></i><strong>连接已恢复</strong><p>deepseek-chat · 延迟 842 ms</p>
    <div><button class="btn btn-ghost btn-small" data-page="account-settings">打开模型设置</button></div>`;
  initIcons();
  showToast("模型连接已恢复");
}

function resumeSerialization(button) {
  const box = button.closest(".state-demo-readonly");
  if (!box) return;
  box.innerHTML = '<strong>连载已恢复</strong><p>作品已回到可编辑状态，可以继续写第 48 章。</p><button class="btn btn-ghost btn-small" data-page="writing">去写作台</button>';
  showToast("作品已恢复连载");
}

function startAuthCountdown(button) {
  if (button.dataset.busy === "true") return;
  button.dataset.busy = "true";
  button.disabled = true;
  let remaining = 60;
  button.textContent = `${remaining}s 后重发`;
  const timer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(timer);
      button.dataset.busy = "false";
      button.disabled = false;
      button.textContent = "发送验证码";
      return;
    }
    button.textContent = `${remaining}s 后重发`;
  }, 1000);
  showToast("验证码已发送，60 秒后可重发");
}

function showAuthMessage(button, message) {
  const panel = button.closest(".auth-mode-panel");
  if (!panel) return;
  let success = panel.querySelector(".auth-success");
  if (!success) {
    success = document.createElement("p");
    success.className = "auth-success";
    panel.appendChild(success);
  }
  success.innerHTML = `<i data-lucide="mail-check"></i>${message}`;
  initIcons();
  showToast(message);
}

function focusReaderPreview() {
  const panel = document.querySelector(".export-preview-panel");
  if (!panel) return;
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  panel.classList.add("flash");
  window.setTimeout(() => panel.classList.remove("flash"), 1200);
  showToast("已打开读者预览");
}

function toggleFullToc(button) {
  const toc = document.querySelector(".export-toc");
  if (!toc) return;
  const expanded = toc.dataset.expanded === "true";
  if (expanded) {
    toc.querySelectorAll(".toc-extra").forEach((row) => row.remove());
    toc.dataset.expanded = "false";
    button.querySelector("span").textContent = "查看完整目录";
    showToast("已收起目录");
    return;
  }
  ["第 49 章 · 顾青的试探", "第 50 章 · 血河旧案", "第 51 章 · 山门来信", "第 52 章 · 掌门夜谈"].forEach((title) => {
    const row = document.createElement("div");
    row.className = "toc-extra muted";
    row.innerHTML = `<span>${title.split(" · ")[0]}</span><strong>${title.split(" · ")[1]}</strong><small>章纲已确认</small>`;
    toc.appendChild(row);
  });
  toc.dataset.expanded = "true";
  button.querySelector("span").textContent = "收起目录";
  showToast("已展开完整目录");
}

function showPublishDetail(button) {
  const item = button.closest(".publish-check");
  if (!item) return;
  if (item.querySelector(".publish-detail")) {
    item.querySelector(".publish-detail").remove();
    showToast("已收起检查详情");
    return;
  }
  const detail = document.createElement("small");
  detail.className = "publish-detail";
  detail.textContent = item.textContent.includes("敏感词")
    ? "定位到 3 处：血河、尸体、抽干。建议替换为更克制的表达。"
    : "发布页需要保留 AI 生成内容说明，不能删除标识。";
  item.appendChild(detail);
  showToast("已展开检查详情");
}

function showRewriteProposal(source) {
  const panel = document.querySelector('[data-note-panel="advice"]');
  if (!panel) return;
  if (panel.querySelector(".rewrite-proposal")) {
    showToast("改写提案已经存在");
    setNoteTab("advice");
    return;
  }
  const card = document.createElement("article");
  card.className = "note-card rewrite-proposal";
  card.innerHTML = `
    <div class="note-head"><span class="badge gold-badge">改写提案</span><small>第 47 章</small></div>
    <h4>把“双手结印”改成单手结印</h4>
    <p>保留左臂骨折的连续性，让沈砚用右手掐残缺的印，顾青在旁看见袖口的血。</p>
    <div class="note-actions">
      <button class="text-btn small" data-action="dismiss-rewrite">放弃</button>
      <button class="text-btn small" data-action="accept-rewrite">应用改写</button>
    </div>`;
  panel.prepend(card);
  setNoteTab("advice");
  showToast(source === "selected" ? "已生成选中段落的改写提案" : "已生成改写提案，等待你确认");
}

function showVersionDiff(button) {
  const item = button.closest(".version-item");
  if (!item) return;
  if (item.querySelector(".version-diff")) {
    item.querySelector(".version-diff").remove();
    showToast("已收起版本差异");
    return;
  }
  const diff = document.createElement("div");
  diff.className = "version-diff";
  diff.innerHTML = '<span>差异</span><p>改动了 2 段：补入左臂状态，删除“双手结印”，章末钩子从“跑”改为“你刚才那招，我见过”。</p>';
  item.appendChild(diff);
  showToast("已展开版本差异");
}

function startBatchTask(button) {
  const container = document.querySelector(".batch-tasks");
  const history = container?.querySelector(".task-history");
  if (!container) return;
  const approval = [...document.querySelectorAll('input[name="approval"]')].find(
    (input) => input.checked
  );
  const autoApproval = approval?.closest(".check-row")?.textContent.includes("自动通过");
  if (autoApproval) {
    const reasons = [];
    if (document.querySelector(".batch-readiness .readiness-item.warning")) {
      reasons.push("存在高风险章节");
    }
    if (!document.querySelector(".batch-readiness")?.textContent.includes("卷纲已锁定")) {
      reasons.push("大纲未锁定");
    }
    const quality = document.getElementById("quality")?.selectedOptions[0]?.textContent || "";
    if (quality.includes("快速")) reasons.push("质量档位低于标准");
    const scope = document.querySelector(".scope-segments .seg.active")?.textContent.trim() || "";
    if (scope === "按卷" || scope === "全本") reasons.push("卷末或全书必须人工确认");
    if (reasons.length) {
      showToast(`不能自动通过：${reasons.join("；")}。请改为逐章或逐卷审批`);
      return;
    }
  }
  const task = document.createElement("article");
  task.className = "panel task-panel";
  task.innerHTML = `
    <div class="panel-head"><div><span class="panel-kicker">排队中</span><h3>第二卷 · 第 48-60 章</h3></div><span class="badge">等待中</span></div>
    <div class="progress"><span style="width:0%"></span></div>
    <div class="task-meta"><span>已完成 0 / 13 章</span><span>预计 26 分钟</span><span>预估 $0.36</span></div>`;
  if (history) container.insertBefore(task, history);
  else container.appendChild(task);
  button.disabled = true;
  button.querySelector("span").textContent = "已加入队列";
  showToast("批量任务已加入队列");
}

function toggleBatchDetails(button) {
  const panel = button.closest(".task-panel");
  if (!panel) return;
  const existing = panel.querySelector(".task-detail");
  if (existing) {
    existing.remove();
    showToast("已收起任务详情");
    return;
  }
  const detail = document.createElement("div");
  detail.className = "task-detail";
  detail.innerHTML = '<strong>任务详情</strong><p>当前章节：第 48 章 · 一只手也能结印。已完成草拟与连续性检查，正在等待审阅。</p>';
  panel.appendChild(detail);
  showToast("已展开任务详情");
}

function focusVersionGraph() {
  const panel = document.querySelector(".version-graph-panel");
  if (!panel) return;
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  panel.classList.add("flash");
  window.setTimeout(() => panel.classList.remove("flash"), 1200);
  showToast("已定位到版本图");
}

function copyEntityProfile() {
  const name = document.getElementById("entity-detail-name")?.textContent || "档案";
  const text = document.getElementById("entity-page-meta")?.innerText || "";
  if (navigator.clipboard) navigator.clipboard.writeText(`${name}\n${text}`).catch(() => {});
  showToast(`${name}档案已复制`);
}

function showRelationshipGraph(button) {
  const profile = entityProfiles[button.dataset.profileId];
  const host = document.getElementById("entity-relations-content");
  if (!profile || !host) return;
  const existing = host.querySelector(".relation-graph-panel");
  if (existing) {
    existing.remove();
    showToast("已收起关系图");
    return;
  }
  const panel = document.createElement("div");
  panel.className = "relation-graph-panel";
  panel.innerHTML = `
    <div class="relation-graph-center">${escapeHtml(profile.name)}</div>
    <div class="relation-graph-nodes">
      ${profile.relations
        .map(
          (relation) =>
            `<div class="relation-graph-node"><span>${escapeHtml(relation.type)}</span><strong>${escapeHtml(relation.name)}</strong></div>`
        )
        .join("")}
    </div>`;
  host.appendChild(panel);
  showToast("关系图已展开");
}

function showHealthFixes(button) {
  const profile = entityProfiles[button.dataset.profileId];
  const host = document.getElementById("entity-health-content");
  if (!profile || !host) return;
  const existing = host.querySelector(".health-fix-list");
  if (existing) {
    existing.remove();
    showToast("已收起修复建议");
    return;
  }
  const list = document.createElement("div");
  list.className = "fix-suggestion-list health-fix-list";
  list.innerHTML = profile.health.items
    .map(
      (item) =>
        `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.note)}</span></div>`
    )
    .join("");
  host.appendChild(list);
  showToast("已生成修复建议");
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function saveProjectDraft(button) {
  const label = button.querySelector("span");
  if (label) label.textContent = "草稿已保存";
  else button.textContent = "草稿已保存";
  button.disabled = true;
  showToast("新作品草稿已保存");
}

function showChapterSplitSettings(button) {
  if (button.parentElement.querySelector(".split-settings")) {
    button.parentElement.querySelector(".split-settings").remove();
    showToast("已收起章节切分设置");
    return;
  }
  const panel = document.createElement("div");
  panel.className = "split-settings";
  panel.innerHTML = '<span class="field-label">切分方式</span><select class="select"><option>按标题切分</option><option>按空行切分</option><option>按字数切分</option></select>';
  button.parentElement.appendChild(panel);
  showToast("已打开章节切分设置");
}

function showOutlineProposal() {
  const detail = document.querySelector(".chapter-detail");
  if (!detail) return;
  if (detail.querySelector(".outline-proposal")) {
    showToast("重生成提案已经存在");
    return;
  }
  const proposal = document.createElement("article");
  proposal.className = "outline-proposal";
  proposal.innerHTML = `
    <div class="note-head"><span class="badge gold-badge">局部重生成提案</span><small>第 48 章</small></div>
    <h4>把“暴露手段”改成“主动藏拙”</h4>
    <p>章末不直接让顾青看见书页，而是让他只看见沈砚袖口的血。悬念更克制，也不提前消耗忘川书暴露的节点。</p>
    <div class="note-actions">
      <button class="text-btn small" data-action="dismiss-outline-proposal">放弃</button>
      <button class="text-btn small" data-action="accept-outline-proposal">接受提案</button>
    </div>`;
  const header = detail.querySelector(".panel-head");
  if (header) header.after(proposal);
  showToast("已生成第 48 章局部重生成提案");
}

function toggleGoldenEditing(button) {
  const grid = document.querySelector(".golden-three-grid");
  if (!grid) return;
  const editing = !grid.classList.contains("is-editing");
  grid.classList.toggle("is-editing", editing);
  grid.querySelectorAll("h4, p, small").forEach((el) => {
    el.contentEditable = String(editing);
  });
  const label = button.querySelector("span");
  if (label) label.textContent = editing ? "保存开篇策略" : "编辑开篇策略";
  showToast(editing ? "已进入黄金三章编辑模式" : "黄金三章策略已保存");
}

function focusLedger(button) {
  const card = button.closest(".ledger-card");
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  window.setTimeout(() => card.classList.remove("flash"), 1200);
  showToast("已定位到当前账本");
}

function refreshBatch(button) {
  const icon = button.querySelector(".lucide");
  icon?.classList.add("spin");
  window.setTimeout(() => icon?.classList.remove("spin"), 700);
  showToast("任务中心已刷新");
}

function retryFailedBatch(button) {
  button.disabled = true;
  button.textContent = "已重试";
  showToast("失败章节已重新加入队列");
}

function exportTaskHistory() {
  downloadTextFile(
    "任务历史.txt",
    "今天 10:42 第二卷 第48-60章 运行中 8/13\n昨天 21:08 第一卷 完本审计 已完成 2个待确认项\n昨天 18:06 第47章 连续性审计 已完成"
  );
  showToast("任务历史已导出");
}

function exportTaskReport() {
  downloadTextFile(
    "第二卷任务报告.txt",
    "第二卷 第48-60章\n完成 13/13 章\n总字数 38,420\n连续性错误 1 处（已处理）\n下一步：第50章关键人物死亡需要逐章确认"
  );
  showToast("任务报告已导出");
}

function exportAuditLog() {
  downloadTextFile(
    "修改审计.txt",
    "锁定故事圣经 10分钟前 九卡确认完成\n修改左臂伤势有效期 今天09:41 第53章痊愈\n从第18章拉平行版本 今天14:08 卷三需要更强反派动机"
  );
  showToast("审计记录已导出");
}

function refreshExportHistory(button) {
  button.textContent = "已刷新";
  showToast("导出历史已刷新");
}

function downloadExport(button) {
  downloadTextFile(
    "仙途：忘川书_第二卷.txt",
    "仙途：忘川书\n第二卷 血河夜行\n\n第45章 血河渡口\n第46章 夜船\n第47章 断臂之后"
  );
  button.textContent = "已下载";
  showToast("开始下载导出文件");
}

function reexportHistory(button) {
  const row = button.closest(".export-history-row");
  if (!row) return;
  button.disabled = true;
  button.textContent = "生成中";
  row.querySelector("small").textContent = "刚刚 · 正在重新生成";
  window.setTimeout(() => {
    button.disabled = false;
    button.textContent = "下载";
    row.querySelector("small").textContent = "刚刚 · 12.4 MB · 7 天后过期";
    showToast("已重新创建导出任务");
  }, 900);
}

function addWorkTag() {
  const row = document.querySelector(".work-settings-form .tag-row");
  if (!row) return;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = "新标签";
  row.insertBefore(tag, row.lastElementChild);
  showToast("已新增标签");
}

function runConnectionTest(button) {
  button.textContent = "测试中…";
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = "连接正常 · 842 ms";
    button.disabled = false;
    showToast("连接测试通过，延迟 842 ms");
  }, 700);
}

function exportAccountData() {
  downloadTextFile(
    "账号数据.json",
    JSON.stringify({ user: "林见鹿", email: "linjianlu@example.com", works: ["仙途：忘川书"], exportedAt: new Date().toISOString() }, null, 2)
  );
  showToast("账号数据导出任务已创建");
}

function markAllNotificationsRead() {
  document.querySelectorAll(".notification-item .badge").forEach((badge) => {
    badge.textContent = "已读";
    badge.className = "badge";
  });
  const title = document.getElementById("notification-title");
  if (title) title.textContent = "没有未读通知";
  showToast("已全部标记为已读");
}

function quickExport() {
  closeExport();
  downloadTextFile("仙途：忘川书_当前卷.txt", "仙途：忘川书\n第二卷 血河夜行\n\n当前卷导出");
  showToast("导出任务已创建");
}

function generateWritingAction(label) {
  closeWritingActions();
  const panel = document.querySelector('[data-note-panel="advice"]');
  if (!panel) return;
  const content = {
    扩写: "把沈砚断臂后的动作拆成三个节拍：藏袖、试探、失败，让痛感更具体。",
    缩写: "删去两句解释，只保留“他抬起左手，又放下”的动作。",
    改视角: "切到顾青视角，用他的判断来写沈砚的异常，不直接进入沈砚内心。",
    三个钩子: "钩子一：青玉裂纹；钩子二：顾青说“我见过”；钩子三：远处山门钟响。",
    生成标题: "候选标题：《一只手也能结印》《袖口的血》《顾青看见了什么》",
    生成摘要: "沈砚断臂后被迫单手结印，顾青第一次确认他身怀秘密，但没有点破。",
  };
  const proposal = document.createElement("article");
  proposal.className = "note-card rewrite-proposal";
  proposal.innerHTML = `
    <div class="note-head"><span class="badge gold-badge">${label}提案</span><small>第 47 章</small></div>
    <p>${content[label] || "已生成新的写作提案。"}</p>
    <div class="note-actions"><button class="text-btn small" data-action="dismiss-rewrite">放弃</button><button class="text-btn small" data-action="accept-rewrite">应用</button></div>`;
  panel.prepend(proposal);
  setNoteTab("advice");
  showToast(`已生成${label}提案`);
}

function setEntityEditing(page, button, editing, reason = "") {
  page.classList.toggle("is-editing", editing);
  page.querySelectorAll(".entity-summary-card p, .entity-detail-block p").forEach((node) => {
    node.contentEditable = String(editing);
  });
  let note = page.querySelector(".entity-edit-note");
  if (editing) {
    if (!note) {
      note = document.createElement("div");
      note.className = "bible-edit-note";
      page.querySelector(".entity-page-main")?.prepend(note);
    }
    note.textContent = `修改请求 CR-026 · 原因：${reason || "未填写"} · 影响：关联章节 3 处、设定 2 条`;
  }
  const label = button.querySelector("span");
  if (label) label.textContent = editing ? "保存档案" : "编辑档案";
  showToast(editing ? "已进入档案编辑模式" : `档案已保存${reason ? `，原因：${reason}` : ""}`);
}

function editEntityProfile(button) {
  const page = document.querySelector('[data-page="entity-detail"]');
  if (!page) return;
  const editing = !page.classList.contains("is-editing");
  const locked = document.getElementById("entity-detail-status")?.textContent.includes("锁定");
  if (editing && locked && page.dataset.reasonConfirmed !== "true") {
    openConfirm({
      title: "修改已锁定档案",
      message: "锁定档案的修改会保留原因，并进入修改记录。",
      label: "填写原因并继续",
      requireReason: true,
      onConfirm: ({ reason }) => {
        if (!reason) return;
        page.dataset.reasonConfirmed = "true";
        page.dataset.editReason = reason;
        setEntityEditing(page, button, true, reason);
      },
    });
    return;
  }
  setEntityEditing(page, button, editing, page.dataset.editReason || "");
}

function changeCover(button) {
  const cover = document.querySelector(".work-settings-cover");
  if (!cover) return;
  const badge = button.closest(".panel")?.querySelector(".panel-head .badge");
  cover.classList.toggle("cover-alt");
  if (badge) badge.textContent = cover.classList.contains("cover-alt") ? "待保存" : "已上传";
  showToast(cover.classList.contains("cover-alt") ? "已选择新的封面样式" : "已恢复原封面");
}

function applyEditorFormat(button) {
  const command = button.dataset.command;
  if (!command) return;
  document.execCommand(command, false, button.dataset.value || null);
  showToast(command === "undo" ? "已撤销" : command === "redo" ? "已重做" : "格式已应用");
}

function toggleTag(button) {
  button.classList.toggle("selected");
  showToast(button.classList.contains("selected") ? `已选择「${button.textContent.trim()}」` : `已取消「${button.textContent.trim()}」`);
}

let activeEntityId = "shen-yan";
let entityReturnTab = "characters";

function entityToneClass(tone) {
  if (tone === "alert") return "alert-badge";
  if (tone === "jade") return "jade-badge";
  if (tone === "gold") return "gold-badge";
  return "";
}

function renderEntityOverview(profile) {
  const quickFacts = profile.quickFacts
    .map(
      (fact) => `
        <div class="entity-quick-fact${fact.tone ? ` tone-${fact.tone}` : ""}">
          <span>${escapeHtml(fact.label)}</span>
          <strong>${escapeHtml(fact.value)}</strong>
          <small>${escapeHtml(fact.meta)}</small>
        </div>`
    )
    .join("");

  const drives = profile.drives
    .map(
      (drive) => `
        <div class="entity-drive">
          <span>${escapeHtml(drive.label)}</span>
          <strong>${escapeHtml(drive.value)}</strong>
        </div>`
    )
    .join("");

  const knowledge = profile.knowledge
    .map(
      (item) => `
        <div class="entity-knowledge-row tone-${item.tone || "neutral"}">
          <span class="badge ${entityToneClass(item.tone)}">${escapeHtml(item.state)}</span>
          <div>
            <div class="entity-knowledge-title">
              <strong>${escapeHtml(item.text)}</strong>
              <small>${escapeHtml(item.reveal)}</small>
            </div>
            <p>${escapeHtml(item.detail)}</p>
          </div>
        </div>`
    )
    .join("");

  const fields = [
    { label: "名称", value: profile.name },
    { label: "别名", value: profile.aliases },
    { label: "类型", value: profile.type },
    { label: "作用域", value: profile.scope },
    { label: "状态", value: profile.status },
    { label: "来源", value: profile.source },
  ]
    .map(
      (field) => `
        <div>
          <span>${escapeHtml(field.label)}</span>
          <strong>${escapeHtml(field.value)}</strong>
        </div>`
    )
    .join("");

  const customFields = profile.customFields
    .map(
      (field) => `
        <div>
          <small>${escapeHtml(field.label)}</small>
          <strong>${escapeHtml(field.value)}</strong>
        </div>`
    )
    .join("");

  return `
    <div class="entity-summary-card">
      <p>${escapeHtml(profile.summary)}</p>
      <div class="tag-row wrap">
        ${profile.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </div>
    <div class="entity-quick-facts">${quickFacts}</div>
    <div class="entity-section-head">
      <span>${escapeHtml(profile.driveTitle || "核心驱动")}</span>
      <small>${escapeHtml(profile.driveHint || "仅作者可见")}</small>
    </div>
    <div class="entity-drive-grid">${drives}</div>
    <div class="entity-section-head">
      <span>${escapeHtml(profile.knowledgeTitle || "角色认知")}</span>
      <small>${escapeHtml(profile.knowledgeHint || "写作时必须遵守的知识边界")}</small>
    </div>
    <div class="entity-knowledge-list">${knowledge}</div>
    <div class="entity-section-head">
      <span>${escapeHtml(profile.fieldsTitle || "档案字段")}</span>
      <small>${escapeHtml(profile.fieldsHint || "基础信息与自定义字段")}</small>
    </div>
    <div class="entity-detail-grid">${fields}</div>
    <div class="entity-custom-values">${customFields}</div>`;
}

function renderEntityRelations(profile) {
  const rows = profile.relations
    .map((relation) => {
      const name = relation.entityId
        ? `<button class="entity-relation-link" data-action="open-entity-detail" data-entity-id="${escapeHtml(relation.entityId)}" data-entity-tab-target="relations">${escapeHtml(relation.name)}<i data-lucide="arrow-up-right"></i></button>`
        : `<strong>${escapeHtml(relation.name)}</strong>`;
      return `
        <article class="entity-relation-row">
          <div class="entity-relation-head">
            <span class="badge ${entityToneClass(relation.tone)}">${escapeHtml(relation.type)}</span>
            ${name}
            <small>${escapeHtml(relation.target)}</small>
          </div>
          <p>${escapeHtml(relation.note)}</p>
          <div class="entity-knowledge-line">
            <i data-lucide="eye"></i>
            <span>${escapeHtml(relation.knowledge)}</span>
          </div>
        </article>`;
    })
    .join("");

  return `
    <div class="entity-relation-list">${rows}</div>
    <button class="btn btn-ghost btn-block entity-edit-btn" data-action="show-relationship-graph" data-profile-id="${escapeHtml(profile.id)}">
      <i data-lucide="network"></i><span>打开关系图</span>
    </button>`;
}

function renderEntityHistory(profile) {
  const rows = profile.history
    .map(
      (item) => `
        <div class="${escapeHtml(item.tone || "done")}">
          <span>${escapeHtml(item.chapter)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.note)}</small>
        </div>`
    )
    .join("");

  return `
    <div class="entity-history">${rows}</div>
    <div class="entity-note">
      <i data-lucide="info"></i>
      <span>已写章节中的状态不能直接覆盖；需要修改时走修改请求，未写章节可直接调整。</span>
    </div>`;
}

function renderEntityReferences(profile) {
  const rows = profile.references
    .map(
      (reference) => `
        <button data-action="open-entity-reference"
          data-page="${escapeHtml(reference.page)}"
          ${reference.chapter ? `data-chapter="${escapeHtml(reference.chapter)}"` : ""}
          ${reference.tab ? `data-tab="${escapeHtml(reference.tab)}"` : ""}>
          <i data-lucide="${escapeHtml(reference.icon)}"></i>
          <div>
            <strong>${escapeHtml(reference.title)}</strong>
            <small>${escapeHtml(reference.meta)}</small>
          </div>
          <i data-lucide="chevron-right"></i>
        </button>`
    )
    .join("");

  return `<div class="entity-reference-list">${rows}</div>`;
}

function renderEntityHealth(profile) {
  const rows = profile.health.items
    .map(
      (item) => `
        <li>
          <span class="health-dot ${item.tone === "alert" ? "cinnabar" : item.tone}"></span>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.note)}</small>
          </div>
        </li>`
    )
    .join("");

  return `
    <div class="entity-health-score">
      <strong>${profile.health.score}</strong>
      <div>
        <span>设定健康度</span>
        <small>${escapeHtml(profile.health.summary)}</small>
      </div>
    </div>
    <div class="entity-health-meter"><span style="width:${profile.health.score}%"></span></div>
    <ul class="entity-health-list">${rows}</ul>
    <button class="btn btn-ghost btn-block" data-action="show-health-fixes" data-profile-id="${escapeHtml(profile.id)}">
      <i data-lucide="wrench"></i><span>查看修复建议</span>
    </button>`;
}

function renderEntityDetail(profile) {
  activeEntityId = profile.id;
  const avatar = document.getElementById("entity-detail-avatar");
  if (avatar) {
    avatar.className =
      profile.markClass || `character-avatar ${profile.avatarClass || ""}`.trim();
    avatar.textContent = profile.avatar;
  }
  document.getElementById("entity-detail-kicker").textContent = profile.kicker;
  document.getElementById("entity-detail-name").textContent = profile.name;
  const role = document.getElementById("entity-detail-role");
  role.textContent = profile.role;
  role.className = `badge ${entityToneClass(profile.roleTone)}`.trim();
  document.getElementById("entity-detail-arc").textContent = profile.arc;
  document.getElementById("entity-detail-status").textContent = profile.status;
  document.getElementById("entity-detail-status").className = "badge jade-badge";

  const meta = document.getElementById("entity-page-meta");
  if (meta) {
    meta.innerHTML = [
      ["别名", profile.aliases],
      ["类型", profile.type],
      ["作用域", profile.scope],
      ["来源", profile.source],
    ]
      .map(
        ([label, value]) =>
          `<span><small>${escapeHtml(label)}</small>${escapeHtml(value)}</span>`
      )
      .join("");
  }

  const editButton = document.getElementById("entity-page-edit");
  if (editButton) {
    editButton.dataset.message = `${profile.name}档案编辑器已打开`;
    const editLabel = editButton.querySelector("span");
    if (editLabel) {
      editLabel.textContent =
        profile.editLabel || `编辑${profile.type.split(" / ")[0]}档案`;
    }
  }

  const tabLabels = {
    overview: "基本信息",
    relations: "关系",
    history: "状态历史",
    references: "引用",
    health: "体检",
    ...(profile.tabLabels || {}),
  };
  document.querySelectorAll("[data-entity-nav-label]").forEach((label) => {
    label.textContent = tabLabels[label.dataset.entityNavLabel] || label.textContent;
  });
  const relationsTitle = document.getElementById("entity-relations-title");
  if (relationsTitle) relationsTitle.textContent = tabLabels.relations;
  const historyTitle = document.getElementById("entity-history-title");
  if (historyTitle) historyTitle.textContent = tabLabels.history;
  document.getElementById("entity-relations-count").textContent = `${profile.relations.length} 条`;
  document.getElementById("entity-history-count").textContent = `${profile.history.length} 条`;
  document.getElementById("entity-references-count").textContent = `${profile.references.length} 处`;
  document.getElementById("entity-health-count").textContent = `${profile.health.items.length} 项`;
  document.getElementById("entity-overview-badge").textContent = profile.type;
  document.getElementById("entity-nav-score").textContent = profile.health.score;
  document.getElementById("entity-nav-meter").style.width = `${profile.health.score}%`;
  document.getElementById("entity-nav-health-note").textContent = profile.health.summary;

  document.getElementById("entity-overview-content").innerHTML = renderEntityOverview(profile);
  document.getElementById("entity-relations-content").innerHTML = renderEntityRelations(profile);
  document.getElementById("entity-history-content").innerHTML = renderEntityHistory(profile);
  document.getElementById("entity-references-content").innerHTML = renderEntityReferences(profile);
  document.getElementById("entity-health-content").innerHTML = renderEntityHealth(profile);
  initIcons();
}

function scrollEntitySection(section = "overview", behavior = "smooth") {
  document.querySelectorAll("[data-entity-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.entitySection === section);
  });
  if (section === "overview") {
    window.scrollTo({ top: 0, behavior });
    return;
  }
  const panel = document.querySelector(`[data-entity-section-panel="${section}"]`);
  if (panel) panel.scrollIntoView({ behavior, block: "start" });
}

function openEntityDetail(entityId = "shen-yan", section = "overview", sourceTab = null) {
  const profile = entityProfiles[entityId] || entityProfiles["shen-yan"];
  if (sourceTab && sourceTab !== "entity-detail") entityReturnTab = sourceTab;
  renderEntityDetail(profile);
  navigate("entity-detail");
  window.setTimeout(() => scrollEntitySection(section, "auto"), 40);
}

function closeEntityDetail() {
  const currentPage = document.querySelector(".page.active")?.dataset.page;
  if (currentPage !== "entity-detail") return;
  navigate("settings");
  setTab(entityReturnTab || "characters");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function setConfirmedFilter(type) {
  document.querySelectorAll("[data-fact-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.factFilter === type);
  });
  let visible = 0;
  document.querySelectorAll("[data-fact-type]").forEach((row) => {
    const show = type === "all" || row.dataset.factType === type;
    row.hidden = !show;
    if (show) visible += 1;
  });
  const summary = document.getElementById("confirmed-summary");
  if (summary) {
    summary.textContent =
      type === "all"
        ? "共 128 条已确认设定 · 8 条本周新增"
        : `显示 ${visible} 条 · 共 128 条已确认设定`;
  }
}

function toggleCustomFieldStatus(id) {
  const field = customFieldRecords.find((item) => item.id === id);
  if (!field) return;
  field.status = field.status === "active" ? "disabled" : "active";
  renderCustomFields();
  showToast(field.status === "active" ? `已启用「${field.name}」` : `已停用「${field.name}」，历史值保留`);
}

function initCustomFields() {
  const form = document.getElementById("custom-field-form");
  const type = document.getElementById("custom-field-type");
  if (!form || !type) return;
  type.addEventListener("change", syncCustomFieldTypeFields);
  ["custom-field-search", "custom-field-object-filter", "custom-field-status-filter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderCustomFieldList);
    document.getElementById(id)?.addEventListener("change", renderCustomFieldList);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = form.querySelector("#custom-field-id").value;
    const name = form.querySelector("#custom-field-name").value.trim();
    const fieldType = form.querySelector("#custom-field-type").value;
    const objects = [...form.querySelectorAll(".custom-object-options input:checked")].map(
      (checkbox) => checkbox.value,
    );
    const options = form.querySelector("#custom-field-options").value.trim();
    const relationTarget = form.querySelector("#custom-field-relation-target").value;
    const description = form.querySelector("#custom-field-description").value.trim();
    const error = document.getElementById("custom-field-form-error");
    const fail = (message) => {
      if (error) {
        error.hidden = false;
        error.textContent = message;
      }
    };
    if (!name) return fail("字段名不能为空。");
    if (objects.length === 0) return fail("至少选择一个适用对象。");
    if (["single_select", "multi_select"].includes(fieldType) && !options) {
      return fail("单选或多选字段必须填写选项。");
    }
    if (fieldType === "relation" && !relationTarget) {
      return fail("关系引用字段必须选择引用目标。");
    }
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    const existingField = id
      ? customFieldRecords.find((item) => item.id === id)
      : null;
    const input = {
      name,
      type: existingField ? existingField.type : fieldType,
      objects: existingField ? existingField.objects : objects,
      required: form.querySelector("#custom-field-required").value === "true",
      status: form.querySelector("#custom-field-status").value,
      options,
      relationTarget: fieldType === "relation" ? relationTarget : "",
      description,
    };
    if (id) {
      if (existingField) Object.assign(existingField, input);
      showToast(`已更新字段「${name}」`);
    } else {
      customFieldRecords.push({
        id: `cf-${Date.now()}`,
        ...input,
        source: "自定义",
        previewValue: "未填写",
      });
      showToast(`已新增字段「${name}」`);
    }
    closeCustomFieldModal();
    renderCustomFields();
  });

  renderCustomFields();
}

let shelfView = "active";

function renderShelf() {
  const grid = document.getElementById("project-grid");
  const empty = document.getElementById("shelf-empty");
  const count = document.getElementById("shelf-count");
  if (!grid || !empty || !count) return;

  const search = document.getElementById("shelf-search")?.value.trim().toLowerCase() ?? "";
  const status = document.getElementById("shelf-status-filter")?.value ?? "";
  const genre = document.getElementById("shelf-genre-filter")?.value ?? "";
  const words = document.getElementById("shelf-words-filter")?.value ?? "";
  const recent = document.getElementById("shelf-recent-filter")?.value ?? "";
  const sort = document.getElementById("shelf-sort")?.value ?? "updated";
  const cards = [...grid.querySelectorAll(".project-card")];
  const filtered = cards.filter((card) => {
    const haystack = `${card.dataset.title ?? ""} ${card.dataset.pen ?? ""}`.toLowerCase();
    const wordCount = Number(card.dataset.words || 0);
    const updatedMinutes = Number(card.dataset.updated || 0);
    const wordsMatch =
      !words ||
      (words === "lt1m" && wordCount < 1000000) ||
      (words === "1m-2m" && wordCount >= 1000000 && wordCount <= 2000000) ||
      (words === "gt2m" && wordCount > 2000000);
    const recentMatch =
      !recent ||
      (recent === "day" && updatedMinutes <= 1440) ||
      (recent === "week" && updatedMinutes <= 10080) ||
      (recent === "month" && updatedMinutes <= 43200);
    return (
      card.dataset.view === shelfView &&
      (!search || haystack.includes(search)) &&
      (!status || card.dataset.status === status) &&
      (!genre || card.dataset.genre === genre) &&
      wordsMatch &&
      recentMatch
    );
  });
  const field = {
    updated: "updated",
    words: "words",
    quality: "quality",
    foreshadows: "foreshadows",
  }[sort];
  filtered.sort((left, right) => {
    const a = Number(left.dataset[field] || 0);
    const b = Number(right.dataset[field] || 0);
    return sort === "updated" ? a - b : b - a;
  });

  cards.forEach((card) => {
    card.style.display = filtered.includes(card) ? "" : "none";
    const id = card.dataset.workId;
    const actions = card.querySelector(".project-actions");
    if (id && actions) {
      actions.innerHTML =
        card.dataset.view === "active"
          ? `<button data-action="archive-work" data-id="${id}">归档</button><button data-action="trash-work" data-id="${id}">移入回收站</button>`
          : `<button data-action="restore-work" data-id="${id}">恢复</button><button data-action="delete-work" data-id="${id}">永久删除</button>`;
    }
  });
  filtered.forEach((card) => grid.appendChild(card));
  count.textContent = `${filtered.length} 部`;
  empty.hidden = filtered.length !== 0;
  document.querySelectorAll("[data-shelf-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shelfView === shelfView);
  });
}

function initShelf() {
  if (!document.getElementById("project-grid")) return;
  document.querySelectorAll("[data-shelf-view]").forEach((button) => {
    button.addEventListener("click", () => {
      shelfView = button.dataset.shelfView;
      renderShelf();
    });
  });
  [
    "shelf-search",
    "shelf-status-filter",
    "shelf-genre-filter",
    "shelf-words-filter",
    "shelf-recent-filter",
    "shelf-sort",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderShelf);
    document.getElementById(id)?.addEventListener("change", renderShelf);
  });
  renderShelf();
}

function openSearch() {
  const overlay = document.getElementById("search-overlay");
  if (!overlay) return;
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  const input = document.getElementById("search-command-input");
  if (input) window.setTimeout(() => input.focus(), 50);
}

function closeSearch() {
  const overlay = document.getElementById("search-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
}

function openNotifications() {
  const drawer = document.getElementById("notification-drawer");
  if (!drawer) return;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeNotifications() {
  const drawer = document.getElementById("notification-drawer");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

function toggleUserMenu() {
  const menu = document.getElementById("user-menu");
  if (!menu) return;
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", String(!open));
}

function closeUserMenu() {
  const menu = document.getElementById("user-menu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

function handleAction(action, element) {
  switch (action) {
    case "toast":
      showToast(element.dataset.message);
      break;
    case "toggle-sidebar":
      if (window.matchMedia("(max-width: 760px)").matches) {
        document.body.classList.toggle("sidebar-mobile-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
      }
      break;
    case "open-export":
      openExport();
      break;
    case "close-export":
      closeExport();
      break;
    case "open-create-setting":
      openCreateSetting();
      break;
    case "close-create-setting":
      closeCreateSetting();
      break;
    case "open-foreshadow":
      openForeshadowModal();
      break;
    case "close-foreshadow":
      closeForeshadowModal();
      break;
    case "edit-foreshadow":
      openForeshadowModal(element.dataset.id);
      break;
    case "pay-foreshadow":
      updateForeshadowStatus(element.dataset.id, "paid_off");
      break;
    case "abandon-foreshadow":
      updateForeshadowStatus(element.dataset.id, "abandoned");
      break;
    case "run-foreshadow-check":
      renderForeshadowChecks();
      showToast("伏笔检查已更新");
      break;
    case "open-custom-field":
      openCustomFieldModal();
      break;
    case "close-custom-field":
      closeCustomFieldModal();
      break;
    case "edit-custom-field":
      openCustomFieldModal(element.dataset.id);
      break;
    case "toggle-custom-field":
      toggleCustomFieldStatus(element.dataset.id);
      break;
    case "confirm-action":
      openConfirm({
        title: element.dataset.confirmTitle,
        message: element.dataset.confirmMessage,
        label: element.dataset.confirmLabel,
        requireName: element.dataset.confirmName === "true",
        requireReason: element.dataset.confirmReason === "true",
        success: element.dataset.confirmSuccess,
      });
      break;
    case "close-confirm":
      closeConfirm();
      break;
    case "open-copy-work":
      openCopyWork();
      break;
    case "close-copy-work":
      closeCopyWork();
      break;
    case "open-model-config":
      openModelConfig();
      break;
    case "close-model-config":
      closeModelConfig();
      break;
    case "test-model-config":
      showToast("连接测试通过，延迟 842 ms");
      break;
    case "open-outline-node":
      openOutlineNode();
      break;
    case "close-outline-node":
      closeOutlineNode();
      break;
    case "open-writing-actions":
      openWritingActions();
      break;
    case "close-writing-actions":
      closeWritingActions();
      break;
    case "open-change-request":
      openChangeRequest();
      break;
    case "close-change-request":
      closeChangeRequest();
      break;
    case "open-entity-detail":
      openEntityDetail(
        element.closest("[data-entity-id]")?.dataset.entityId || "shen-yan",
        element.dataset.entityTabTarget || "overview",
        element.dataset.entitySourceTab ||
          document.querySelector(".settings-category-item.active")?.dataset.tab ||
          entityReturnTab
      );
      break;
    case "close-entity-detail":
      closeEntityDetail();
      break;
    case "open-entity-reference":
      navigate(element.dataset.page);
      if (element.dataset.tab) setTab(element.dataset.tab);
      if (element.dataset.chapter) renderChapter(element.dataset.chapter);
      break;
    case "archive-work": {
      const card = element.closest("[data-work-id]");
      if (card) {
        card.dataset.view = "archived";
        renderShelf();
        showToast("作品已归档，可在“已归档”中恢复");
      }
      break;
    }
    case "trash-work": {
      const card = element.closest("[data-work-id]");
      if (card) {
        card.dataset.view = "trash";
        renderShelf();
        showToast("作品已移入回收站，30 天内可以恢复");
      }
      break;
    }
    case "restore-work": {
      const card = element.closest("[data-work-id]");
      if (card) {
        card.dataset.view = "active";
        renderShelf();
        showToast("作品已恢复到书架");
      }
      break;
    }
    case "delete-work": {
      const card = element.closest("[data-work-id]");
      if (card) {
        openConfirm({
          title: "永久删除作品",
          message: "永久删除后不能恢复，所有章节、设定和版本都会被删除。",
          label: "永久删除",
          requireReason: true,
          onConfirm: () => {
            card.dataset.view = "deleted";
            renderShelf();
            showToast("作品已永久删除");
          },
        });
      }
      break;
    }
    case "dismiss-recent-settings": {
      const recent = document.getElementById("settings-recent");
      if (recent) recent.hidden = true;
      break;
    }
    case "open-search":
      openSearch();
      break;
    case "close-search":
      closeSearch();
      break;
    case "open-notifications":
      openNotifications();
      break;
    case "close-notifications":
      closeNotifications();
      break;
    case "toggle-user-menu":
      toggleUserMenu();
      break;
    case "fill-idea": {
      const idea = document.getElementById("idea");
      if (idea) {
        idea.value = element.dataset.idea || "";
        idea.focus();
        showToast("灵感已填入，可以继续调整");
      }
      break;
    }
    case "generate-blueprint": {
      if (!validateWizardRequired()) break;
      if (wizardStep < 5) {
        setWizardStep(5);
        showToast("故事蓝图预览已生成，请确认后创建");
        break;
      }
      const buttons = document.querySelectorAll('[data-action="generate-blueprint"]');
      buttons.forEach((button) => {
        button.disabled = true;
        const label = button.querySelector("span");
        if (label) label.textContent = "正在生成故事蓝图…";
      });
      showToast("正在整理世界规则、人物关系与前三卷主线");
      window.setTimeout(() => {
        buttons.forEach((button) => {
          button.disabled = false;
          const label = button.querySelector("span");
          if (label) label.textContent = "生成故事蓝图";
        });
        setWizardStep(6);
        showToast("故事蓝图已生成，请确认创建");
      }, 1100);
      break;
    }
    case "wizard-next":
      nextWizardStep();
      break;
    case "wizard-prev":
      previousWizardStep();
      break;
    case "create-work": {
      navigate("work-overview");
      showToast("作品已创建，正在打开作品总览");
      break;
    }
    case "toggle-comments":
      document.body.classList.toggle("hide-comments");
      showToast(
        document.body.classList.contains("hide-comments")
          ? "已隐藏编辑批注"
          : "已显示编辑批注"
      );
      break;
    case "toggle-focus":
      document.body.classList.toggle("focus-mode");
      showToast(
        document.body.classList.contains("focus-mode")
          ? "已进入专注模式，隐藏两侧面板"
          : "已退出专注模式"
      );
      break;
    case "new-chapter":
      createChapterDraft();
      break;
    case "generate-chapter":
      generateChapterDraft(element);
      break;
    case "continue-writing":
      continueWriting();
      break;
    case "check-consistency":
      checkConsistency();
      break;
    case "save-version":
      saveWritingVersion();
      break;
    case "apply-hook-suggestion":
      appendEditorParagraph("顾青把半枚青玉收进袖中，说：“你刚才那招，我见过。”");
      element.disabled = true;
      element.textContent = "已应用";
      showToast("已应用钩子建议，章末悬念已补上");
      break;
    case "decide-fact":
      decideFact(element, element.dataset.decision);
      break;
    case "apply-generation-controls":
      applyGenerationControls();
      break;
    case "pause-batch":
      setBatchTaskState(element, "paused");
      break;
    case "resume-batch":
      setBatchTaskState(element, "running");
      break;
    case "approve-review":
      approveReview(element);
      break;
    case "reject-review":
      rejectReview(element);
      break;
    case "batch-approve-low":
      batchApproveLowRisk(element);
      break;
    case "start-export":
      startExportTask(element);
      break;
    case "copy-chapter":
      copyCurrentChapter();
      break;
    case "rerun-publish-check":
      rerunPublishCheck(element);
      break;
    case "generate-publish-copy":
      generatePublishCopy();
      break;
    case "undo-change":
      undoLastChange();
      break;
    case "cancel-change":
      cancelChangeRequestAction();
      break;
    case "show-fix-suggestions":
      showFixSuggestions();
      break;
    case "save-work-settings":
      saveWorkSettings(element);
      break;
    case "mark-work-completed":
      setWorkLifecycle(true);
      break;
    case "resume-work":
      setWorkLifecycle(false);
      break;
    case "generate-next-volume":
      generateNextVolume();
      break;
    case "add-volume-draft":
      addVolumeDraft();
      break;
    case "focus-compare":
      focusComparePanel();
      break;
    case "focus-batch-form":
      focusBatchForm();
      break;
    case "edit-bible":
      toggleBibleEditing(element);
      break;
    case "check-bible":
      checkBible();
      break;
    case "complete-bible":
      completeBible();
      break;
    case "edit-bible-quote":
      editBibleQuote(element);
      break;
    case "accept-bible-proposal":
      element.closest(".bible-proposal")?.remove();
      {
        const card = document.getElementById("bible-protagonist");
        if (card && !card.querySelector(".bible-card-note")) {
          const note = document.createElement("div");
          note.className = "bible-card-note";
          note.textContent = "母亲状态：失踪，未确认死亡。沈砚一直相信她还活着。";
          card.appendChild(note);
        }
      }
      showToast("已接受补全提案，主角卡已更新");
      break;
    case "dismiss-bible-proposal":
      element.closest(".bible-proposal")?.remove();
      showToast("已放弃补全提案");
      break;
    case "show-shortcuts":
      focusShortcuts();
      break;
    case "retry-connection":
      retryConnection(element);
      break;
    case "resume-serialization":
      resumeSerialization(element);
      break;
    case "send-code":
      startAuthCountdown(element);
      break;
    case "send-reset-link":
      showAuthMessage(element, "重置邮件已发送，请检查收件箱和垃圾邮件");
      break;
    case "submit-recovery":
      showAuthMessage(element, "恢复申请已提交，请检查邮箱确认");
      break;
    case "reader-preview":
      focusReaderPreview();
      break;
    case "toggle-full-toc":
      toggleFullToc(element);
      break;
    case "publish-detail":
      showPublishDetail(element);
      break;
    case "rewrite-selection":
      showRewriteProposal("selected");
      break;
    case "generate-rewrite-proposal":
      showRewriteProposal("manual");
      break;
    case "dismiss-rewrite":
      element.closest(".rewrite-proposal")?.remove();
      showToast("已放弃改写提案");
      break;
    case "accept-rewrite":
      {
        const paper = document.querySelector(".editor-paper");
        const target = [...(paper?.querySelectorAll("p") || [])].find((p) =>
          p.textContent.includes("双手结印")
        );
        if (target) {
          target.innerHTML = "他用右手掐了一个残缺的印，灵力在掌心凝成一道细线，左袖立刻被血浸透。";
          updateEditorWordCount();
        }
        element.closest(".rewrite-proposal")?.remove();
      }
      setNoteTab("advice");
      showToast("已应用改写提案：改为单手结印");
      break;
    case "compare-version":
      showVersionDiff(element);
      break;
    case "start-batch":
      startBatchTask(element);
      break;
    case "batch-details":
      toggleBatchDetails(element);
      break;
    case "full-compare":
      focusComparePanel();
      break;
    case "full-version-graph":
      focusVersionGraph();
      break;
    case "copy-entity":
      copyEntityProfile();
      break;
    case "save-project-draft":
      saveProjectDraft(element);
      break;
    case "chapter-split-settings":
      showChapterSplitSettings(element);
      break;
    case "import-edit-title":
      importEditTitle(element);
      break;
    case "import-split":
      importSplitChapter(element);
      break;
    case "import-merge":
      importMergeChapter(element);
      break;
    case "outline-regenerate":
      showOutlineProposal();
      break;
    case "move-outline-up":
      moveOutlineNode("up");
      break;
    case "move-outline-down":
      moveOutlineNode("down");
      break;
    case "associate-outline":
      associateOutline();
      break;
    case "save-outline-association":
      element.closest(".outline-association")?.remove();
      showToast("已保存大纲关联");
      break;
    case "dismiss-outline-proposal":
      element.closest(".outline-proposal")?.remove();
      showToast("已放弃重生成提案");
      break;
    case "accept-outline-proposal":
      element.closest(".outline-proposal")?.remove();
      {
        const goal = document.querySelector(".chapter-detail .detail-block p");
        if (goal) {
          goal.textContent = "让沈砚在断臂状态下主动藏拙，只让顾青看见袖口的血，不提前暴露忘川书。";
        }
      }
      showToast("已接受重生成提案，章纲已更新");
      break;
    case "edit-golden-three":
      toggleGoldenEditing(element);
      break;
    case "focus-ledger":
      focusLedger(element);
      break;
    case "refresh-batch":
      refreshBatch(element);
      break;
    case "retry-batch":
      retryFailedBatch(element);
      break;
    case "export-task-history":
      exportTaskHistory();
      break;
    case "export-report":
      exportTaskReport();
      break;
    case "export-audit":
      exportAuditLog();
      break;
    case "refresh-export-history":
      refreshExportHistory(element);
      break;
    case "download-export":
      downloadExport(element);
      break;
    case "reexport-history":
      reexportHistory(element);
      break;
    case "add-work-tag":
      addWorkTag();
      break;
    case "change-cover":
      changeCover(element);
      break;
    case "run-connection-test":
      runConnectionTest(element);
      break;
    case "delete-model-config":
      deleteModelConfig(element);
      break;
    case "generate-setting-proposal":
      generateSettingProposal();
      break;
    case "accept-setting-proposal":
      acceptSettingProposal();
      break;
    case "dismiss-setting-proposal":
      element.closest(".settings-proposal-card")?.remove();
      showToast("已放弃设定提案");
      break;
    case "add-entity-alias":
      addEntityAlias();
      break;
    case "save-entity-alias":
      saveEntityAlias(element);
      break;
    case "delete-entity-entry":
      deleteEntityEntry();
      break;
    case "show-map-markers":
      showMapMarkers(element);
      break;
    case "export-account-data":
      exportAccountData();
      break;
    case "mark-notifications-read":
      markAllNotificationsRead();
      break;
    case "quick-export":
      quickExport();
      break;
    case "writing-action":
      generateWritingAction(element.dataset.label || "改写");
      break;
    case "edit-entity-profile":
      editEntityProfile(element);
      break;
    case "editor-format":
      applyEditorFormat(element);
      break;
    case "toggle-tag":
      toggleTag(element);
      break;
    case "toggle-demo-mode":
      toggleDemoMode();
      break;
    case "set-demo-normal":
      setDemoState("normal");
      break;
    case "accept-editor-insert":
      {
        const card = element.closest(".editor-insert-proposal");
        const text = card?.dataset.insertText;
        if (text) appendEditorParagraph(text);
        card?.remove();
      }
      showToast("已把提案插入正文");
      break;
    case "dismiss-editor-insert":
      element.closest(".editor-insert-proposal")?.remove();
      showToast("已放弃生成提案");
      break;
    case "show-relationship-graph":
      showRelationshipGraph(element);
      break;
    case "show-health-fixes":
      showHealthFixes(element);
      break;
    default:
      break;
  }
}

function initNavigation() {
  document.addEventListener("click", (event) => {
    const actionTrigger = event.target.closest("[data-action]");
    if (actionTrigger) {
      event.preventDefault();
      handleAction(actionTrigger.dataset.action, actionTrigger);
      return;
    }

    const pageTrigger = event.target.closest("[data-page]");
    if (pageTrigger && !pageTrigger.classList.contains("page")) {
      event.preventDefault();
      const targetPage = pageTrigger.dataset.page;
      const currentPage = document.querySelector(".page.active")?.dataset.page;
      if (currentPage === "writing" && editorDirty && targetPage !== "writing") {
        openConfirm({
          title: "离开写作台？",
          message: "当前章节有未保存的修改。离开会丢失这些修改，或先保存版本再离开。",
          label: "放弃修改并离开",
          onConfirm: () => {
            editorDirty = false;
            navigate(targetPage);
            if (pageTrigger.dataset.chapter) {
              renderChapter(pageTrigger.dataset.chapter);
            }
          },
        });
        return;
      }
      navigate(targetPage);
      if (pageTrigger.dataset.chapter) {
        renderChapter(pageTrigger.dataset.chapter);
      }
      return;
    }

    const tabTrigger = event.target.closest("[data-tab]");
    if (tabTrigger) {
      event.preventDefault();
      setTab(tabTrigger.dataset.tab);
      return;
    }

    const noteTrigger = event.target.closest("[data-note-tab]");
    if (noteTrigger) {
      event.preventDefault();
      setNoteTab(noteTrigger.dataset.noteTab);
      return;
    }

    const outlineViewTrigger = event.target.closest("[data-outline-view]");
    if (outlineViewTrigger) {
      event.preventDefault();
      setOutlineView(outlineViewTrigger.dataset.outlineView);
      return;
    }

    const ledgerViewTrigger = event.target.closest("[data-ledger-view]");
    if (ledgerViewTrigger) {
      event.preventDefault();
      setLedgerView(ledgerViewTrigger.dataset.ledgerView);
      return;
    }

    const outlineNodeTrigger = event.target.closest("[data-outline-node]");
    if (outlineNodeTrigger) {
      event.preventDefault();
      outlineNodeTrigger
        .closest(".outline-tree")
        ?.querySelectorAll(".outline-tree-item")
        .forEach((item) => item.classList.toggle("active", item === outlineNodeTrigger));
      const title = outlineNodeTrigger.querySelector("strong")?.textContent || "大纲节点";
      showToast(`已选择大纲节点：${title}`);
      return;
    }

    const batchViewTrigger = event.target.closest("[data-batch-view]");
    if (batchViewTrigger) {
      event.preventDefault();
      setBatchView(batchViewTrigger.dataset.batchView);
      return;
    }

    const bibleNavTrigger = event.target.closest("[data-bible-target]");
    if (bibleNavTrigger) {
      event.preventDefault();
      jumpToBibleCard(bibleNavTrigger.dataset.bibleTarget);
      return;
    }

    const chapterTrigger = event.target.closest("[data-chapter]");
    if (chapterTrigger) {
      event.preventDefault();
      if (chapterTrigger.classList.contains("chapter-card")) {
        navigate("writing");
      }
      renderChapter(chapterTrigger.dataset.chapter);
      return;
    }

    const scopeTrigger = event.target.closest(".scope-segments .seg");
    if (scopeTrigger) {
      event.preventDefault();
      scopeTrigger
        .closest(".scope-segments")
        .querySelectorAll(".seg")
        .forEach((item) => item.classList.toggle("active", item === scopeTrigger));
      showToast(`生成范围已切换为：${scopeTrigger.textContent.trim()}`);
      return;
    }

    const exportScopeTrigger = event.target.closest(".export-scope-segments .seg");
    if (exportScopeTrigger) {
      event.preventDefault();
      exportScopeTrigger
        .closest(".export-scope-segments")
        .querySelectorAll(".seg")
        .forEach((item) => item.classList.toggle("active", item === exportScopeTrigger));
      showToast(`导出范围已切换为：${exportScopeTrigger.textContent.trim()}`);
      return;
    }

    const changeObjectTrigger = event.target.closest(".change-object-tabs .seg");
    if (changeObjectTrigger) {
      event.preventDefault();
      changeObjectTrigger
        .closest(".change-object-tabs")
        .querySelectorAll(".seg")
        .forEach((item) => item.classList.toggle("active", item === changeObjectTrigger));
      showToast(`影响对象已切换为：${changeObjectTrigger.textContent.trim()}`);
      return;
    }

    const genreDemoTrigger = event.target.closest("[data-genre-demo]");
    if (genreDemoTrigger) {
      event.preventDefault();
      setGenreDemo(genreDemoTrigger.dataset.genreDemo);
      showToast(`已切换题材演示：${genreDemoTrigger.textContent.trim()}`);
      return;
    }

    const demoStateTrigger = event.target.closest("[data-demo-state]");
    if (demoStateTrigger) {
      event.preventDefault();
      setDemoState(demoStateTrigger.dataset.demoState);
      return;
    }

    const plainSegTrigger = event.target.closest(".segmented .seg");
    if (plainSegTrigger && Object.keys(plainSegTrigger.dataset).length === 0) {
      event.preventDefault();
      plainSegTrigger
        .closest(".segmented")
        ?.querySelectorAll(".seg")
        .forEach((button) => button.classList.toggle("active", button === plainSegTrigger));
      showToast(`已选择：${plainSegTrigger.textContent.trim()}`);
      return;
    }

    const entitySectionTrigger = event.target.closest("[data-entity-section]");
    if (entitySectionTrigger) {
      event.preventDefault();
      scrollEntitySection(entitySectionTrigger.dataset.entitySection);
      return;
    }

    const factFilterTrigger = event.target.closest("[data-fact-filter]");
    if (factFilterTrigger) {
      event.preventDefault();
      setConfirmedFilter(factFilterTrigger.dataset.factFilter);
      return;
    }

    const entryTrigger = event.target.closest("[data-entry-mode]");
    if (entryTrigger) {
      event.preventDefault();
      setEntryMode(entryTrigger.dataset.entryMode);
      return;
    }

    const authModeTrigger = event.target.closest("[data-auth-mode]");
    if (authModeTrigger) {
      event.preventDefault();
      setAuthMode(authModeTrigger.dataset.authMode);
      return;
    }

    const authStateTrigger = event.target.closest("[data-auth-state]");
    if (authStateTrigger) {
      event.preventDefault();
      setAuthState(authStateTrigger.dataset.authState);
      return;
    }

    if (
      !event.target.closest("#user-menu") &&
      !event.target.closest('[data-action="toggle-user-menu"]')
    ) {
      closeUserMenu();
    }

    const formatTrigger = event.target.closest(".format-card");
    if (formatTrigger) {
      event.preventDefault();
      formatTrigger
        .closest(".format-grid")
        .querySelectorAll(".format-card")
        .forEach((item) => item.classList.toggle("active", item === formatTrigger));
      showToast(`导出格式已选择：${formatTrigger.querySelector("strong").textContent}`);
      return;
    }

    if (event.target.classList.contains("modal-backdrop")) {
      if (event.target.id === "setting-create-modal") {
        closeCreateSetting();
      } else if (event.target.id === "foreshadow-modal") {
        closeForeshadowModal();
      } else if (event.target.id === "custom-field-modal") {
        closeCustomFieldModal();
      } else if (event.target.id === "confirm-modal") {
        closeConfirm();
      } else if (event.target.id === "copy-work-modal") {
        closeCopyWork();
      } else if (event.target.id === "model-config-modal") {
        closeModelConfig();
      } else if (event.target.id === "outline-node-modal") {
        closeOutlineNode();
      } else if (event.target.id === "writing-actions-modal") {
        closeWritingActions();
      } else if (event.target.id === "change-request-modal") {
        closeChangeRequest();
      } else {
        closeExport();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches("[data-entity-id][role='button']")
    ) {
      event.preventDefault();
      openEntityDetail(
        event.target.dataset.entityId,
        event.target.dataset.entityTabTarget || "overview",
        document.querySelector(".settings-category-item.active")?.dataset.tab || entityReturnTab
      );
      return;
    }
    if (event.key === "Escape") {
      closeExport();
      closeCreateSetting();
      closeForeshadowModal();
      closeCustomFieldModal();
      closeConfirm();
      closeCopyWork();
      closeModelConfig();
      closeOutlineNode();
      closeWritingActions();
      closeChangeRequest();
      closeEntityDetail();
      closeSearch();
      closeNotifications();
      closeUserMenu();
    }
  });
}

function initChapterFilter() {
  const input = document.querySelector(".chapter-filter input");
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    document.querySelectorAll(".chapter-nav-item").forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(query) ? "" : "none";
    });
  });
}

function initImportPreview() {
  const input = document.getElementById("manuscript");
  const preview = document.getElementById("import-preview");
  if (!input || !preview) return;
  const label = preview.querySelector(".import-preview-head span");
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (label) label.textContent = `${file.name} · 已识别 3 章`;
    showToast("旧稿已载入，可以调整章节切分");
  });
}

function renumberImportRows() {
  document.querySelectorAll(".import-chapter-row").forEach((row, index) => {
    const number = row.querySelector("span");
    if (number) number.textContent = `第 ${index + 1} 章`;
  });
}

function importEditTitle(button) {
  const row = button.closest(".import-chapter-row");
  const title = row?.querySelector("strong");
  if (!title) return;
  const editing = title.contentEditable !== "true";
  title.contentEditable = String(editing);
  if (editing) {
    title.focus();
    button.textContent = "保存标题";
    showToast("可以直接修改章节标题");
  } else {
    button.textContent = "改标题";
    showToast(`章节标题已改为「${title.textContent.trim()}」`);
  }
}

function importSplitChapter(button) {
  const row = button.closest(".import-chapter-row");
  if (!row) return;
  const next = row.cloneNode(true);
  next.querySelector("strong").textContent = "拆分章节";
  next.querySelector("small").textContent = "0 字";
  const badge = next.querySelector(".badge");
  if (badge) {
    badge.textContent = "待确认";
    badge.className = "badge gold-badge";
  }
  row.after(next);
  renumberImportRows();
  showToast("已拆分出一个新章节");
}

function importMergeChapter(button) {
  const row = button.closest(".import-chapter-row");
  const next = row?.nextElementSibling;
  if (!row || !next?.classList.contains("import-chapter-row")) {
    showToast("没有可合并的下一章");
    return;
  }
  next.remove();
  renumberImportRows();
  showToast("已合并下一章");
}

function initSearchFilter() {
  const input = document.getElementById("search-command-input");
  if (!input) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    const highlight = (el) => {
      if (!el.dataset.originalText) el.dataset.originalText = el.textContent;
      const original = el.dataset.originalText;
      if (!query) {
        el.textContent = original;
        return false;
      }
      const index = original.toLowerCase().indexOf(query);
      if (index < 0) {
        el.textContent = original;
        return false;
      }
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      el.innerHTML = original.replace(new RegExp(`(${escaped})`, "ig"), "<mark>$1</mark>");
      return true;
    };
    document.querySelectorAll(".search-result-group button").forEach((button) => {
      let matched = !query;
      button.querySelectorAll("strong, small").forEach((el) => {
        if (highlight(el)) matched = true;
      });
      button.style.display = matched ? "" : "none";
    });
  });
}

function initEditorInput() {
  const paper = document.querySelector(".editor-paper");
  const counter = document.querySelector(".editor-statusbar span:first-child");
  if (!paper || !counter) return;
  let timer = null;
  paper.addEventListener("input", () => {
    editorDirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const length = paper.innerText.replace(/\s+/g, "").length;
      counter.innerHTML = `<i data-lucide="type"></i>${length.toLocaleString()} 字`;
      initIcons();
    }, 250);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initChapterFilter();
  initImportPreview();
  initSearchFilter();
  initSettingCreate();
  initSettingsTools();
  initForeshadowLedger();
  initCustomFields();
  initConfirm();
  initCopyWork();
  initShelf();
  initModelConfig();
  initOutlineNode();
  initChangeRequest();
  initEditorInput();
  bindCommentMarks();
  initIcons();
  setWizardStep(1);

  const hash = window.location.hash.replace("#", "");
  const initialPage = validPages.has(hash) ? hash : "dashboard";
  if (initialPage === "entity-detail") {
    renderEntityDetail(entityProfiles[activeEntityId] || entityProfiles["shen-yan"]);
  }
  navigate(initialPage, { keepHash: true });

  window.addEventListener("hashchange", () => {
    const nextHash = window.location.hash.replace("#", "");
    const nextPage = validPages.has(nextHash) ? nextHash : "dashboard";
    if (nextPage === "entity-detail") {
      renderEntityDetail(entityProfiles[activeEntityId] || entityProfiles["shen-yan"]);
    }
    navigate(nextPage, { keepHash: true });
  });

  window.addEventListener("beforeunload", (event) => {
    if (editorDirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
});
