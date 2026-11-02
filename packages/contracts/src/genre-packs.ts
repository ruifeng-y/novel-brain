import type { CustomFieldType, EntityType } from './entity-center';
import {
  HISTORY_CUSTOM_FIELDS,
  HISTORY_MAIN_TEMPLATE,
  HISTORY_SUBTYPE_LABELS,
  HISTORY_SUBTYPE_SUMMARIES,
  HISTORY_VARIANT_LABELS,
  type HistorySubtype,
} from './history-pack';
import type { WorkGenrePack } from './works';

export type UrbanCheckCategory = 'real_world' | 'relationship' | 'money' | 'law';
export type HistoryCheckCategory =
  | 'anachronism'
  | 'official_hierarchy'
  | 'army_movement'
  | 'provisions'
  | 'geographic_distance';
export type GenreCheckCategory = UrbanCheckCategory | HistoryCheckCategory;

export type GenrePackFieldDefinition = {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
};

export type GenrePackSubtypeDefinition = {
  key: string;
  label: string;
  description: string;
  entityType: EntityType;
  fields: GenrePackFieldDefinition[];
};

export type GenrePackTemplateDefinition = {
  key: string;
  name: string;
  summary: string;
  writingGuide: string[];
  checkCategories: GenreCheckCategory[];
};

export type GenrePackDefinition = {
  key: WorkGenrePack;
  label: string;
  template: GenrePackTemplateDefinition;
  subtypes: GenrePackSubtypeDefinition[];
};

export const URBAN_FIELD_KEYS = {
  city: {
    region: 'urban_city_region',
    population: 'urban_city_population',
    tier: 'urban_city_tier',
    commute: 'urban_city_commute',
  },
  company: {
    industry: 'urban_company_industry',
    legalRepresentative: 'urban_company_legal_representative',
    registeredCapital: 'urban_company_registered_capital',
    cashBalance: 'urban_company_cash_balance',
    ownership: 'urban_company_ownership',
    employees: 'urban_company_employees',
  },
  family: {
    head: 'urban_family_head',
    members: 'urban_family_members',
    assets: 'urban_family_assets',
    influence: 'urban_family_influence',
    succession: 'urban_family_succession',
  },
  class: {
    tier: 'urban_class_tier',
    income: 'urban_class_income',
    assets: 'urban_class_assets',
    access: 'urban_class_access',
    mobility: 'urban_class_mobility',
  },
  law: {
    jurisdiction: 'urban_law_jurisdiction',
    prohibitedActions: 'urban_law_prohibited_actions',
    requirements: 'urban_law_requirements',
    penalty: 'urban_law_penalty',
  },
  money: {
    holder: 'urban_money_holder',
    currency: 'urban_money_currency',
    balance: 'urban_money_balance',
    monthlyIncome: 'urban_money_monthly_income',
    source: 'urban_money_source',
  },
  connections: {
    target: 'urban_connections_target',
    relation: 'urban_connections_relation',
    trust: 'urban_connections_trust',
    obligation: 'urban_connections_obligation',
    influence: 'urban_connections_influence',
  },
} as const;

const URBAN_SUBTYPES: GenrePackSubtypeDefinition[] = [
  {
    key: 'city',
    label: '城市',
    description: '城市层级、人口、生活成本和通勤条件。',
    entityType: 'map',
    fields: [
      { key: URBAN_FIELD_KEYS.city.region, label: '所属区域', type: 'text' },
      { key: URBAN_FIELD_KEYS.city.population, label: '常住人口（万人）', type: 'number' },
      {
        key: URBAN_FIELD_KEYS.city.tier,
        label: '城市层级',
        type: 'single_select',
        options: ['一线城市', '新一线城市', '二线城市', '三线城市', '县城'],
      },
      { key: URBAN_FIELD_KEYS.city.commute, label: '通勤特点', type: 'text' },
    ],
  },
  {
    key: 'company',
    label: '公司',
    description: '公司行业、控制权、注册资本和可动用现金。',
    entityType: 'faction',
    fields: [
      { key: URBAN_FIELD_KEYS.company.industry, label: '所属行业', type: 'text' },
      {
        key: URBAN_FIELD_KEYS.company.legalRepresentative,
        label: '法定代表人',
        type: 'text',
      },
      {
        key: URBAN_FIELD_KEYS.company.registeredCapital,
        label: '注册资本（万元）',
        type: 'number',
      },
      { key: URBAN_FIELD_KEYS.company.cashBalance, label: '可动用现金（万元）', type: 'number' },
      {
        key: URBAN_FIELD_KEYS.company.ownership,
        label: '股权结构',
        type: 'single_select',
        options: ['个人独资', '合伙企业', '有限责任公司', '上市公司', '家族控股'],
      },
      { key: URBAN_FIELD_KEYS.company.employees, label: '员工人数', type: 'number' },
    ],
  },
  {
    key: 'family',
    label: '家族',
    description: '家族成员、共同资产、影响力和继承关系。',
    entityType: 'faction',
    fields: [
      { key: URBAN_FIELD_KEYS.family.head, label: '当家人', type: 'text' },
      { key: URBAN_FIELD_KEYS.family.members, label: '主要成员', type: 'text' },
      { key: URBAN_FIELD_KEYS.family.assets, label: '家族资产（万元）', type: 'number' },
      { key: URBAN_FIELD_KEYS.family.influence, label: '影响力来源', type: 'text' },
      { key: URBAN_FIELD_KEYS.family.succession, label: '继承安排', type: 'text' },
    ],
  },
  {
    key: 'class',
    label: '阶层',
    description: '收入、资产、社会资源和上升通道。',
    entityType: 'world',
    fields: [
      {
        key: URBAN_FIELD_KEYS.class.tier,
        label: '阶层位置',
        type: 'single_select',
        options: ['富裕阶层', '中产阶层', '工薪阶层', '困难群体'],
      },
      { key: URBAN_FIELD_KEYS.class.income, label: '收入范围', type: 'text' },
      { key: URBAN_FIELD_KEYS.class.assets, label: '资产范围', type: 'text' },
      { key: URBAN_FIELD_KEYS.class.access, label: '可接触的社会资源', type: 'text' },
      { key: URBAN_FIELD_KEYS.class.mobility, label: '上升或下降通道', type: 'text' },
    ],
  },
  {
    key: 'law',
    label: '法律',
    description: '适用辖区、禁止行为、必要程序和法律后果。',
    entityType: 'world',
    fields: [
      { key: URBAN_FIELD_KEYS.law.jurisdiction, label: '适用辖区', type: 'text' },
      {
        key: URBAN_FIELD_KEYS.law.prohibitedActions,
        label: '禁止行为',
        type: 'multi_select',
        options: [
          '挪用公司资金',
          '泄露客户资料',
          '无证驾驶',
          '暴力催收',
          '非法拘禁',
          '商业贿赂',
          '伪造合同',
        ],
      },
      { key: URBAN_FIELD_KEYS.law.requirements, label: '必须履行的程序', type: 'text' },
      { key: URBAN_FIELD_KEYS.law.penalty, label: '违反后的后果', type: 'text' },
    ],
  },
  {
    key: 'money',
    label: '金钱',
    description: '资金持有人、余额、收入来源和币种。',
    entityType: 'world',
    fields: [
      { key: URBAN_FIELD_KEYS.money.holder, label: '持有人', type: 'text' },
      {
        key: URBAN_FIELD_KEYS.money.currency,
        label: '币种',
        type: 'single_select',
        options: ['人民币', '美元', '港币'],
      },
      { key: URBAN_FIELD_KEYS.money.balance, label: '当前余额（万元）', type: 'number' },
      { key: URBAN_FIELD_KEYS.money.monthlyIncome, label: '月收入（万元）', type: 'number' },
      { key: URBAN_FIELD_KEYS.money.source, label: '资金来源', type: 'text' },
    ],
  },
  {
    key: 'connections',
    label: '人脉',
    description: '关键人脉、关系性质、信任程度和人情义务。',
    entityType: 'faction',
    fields: [
      { key: URBAN_FIELD_KEYS.connections.target, label: '关系对象', type: 'text' },
      {
        key: URBAN_FIELD_KEYS.connections.relation,
        label: '关系性质',
        type: 'single_select',
        options: ['盟友', '对手', '上下级', '亲属', '利益伙伴'],
      },
      { key: URBAN_FIELD_KEYS.connections.trust, label: '信任程度', type: 'number' },
      { key: URBAN_FIELD_KEYS.connections.obligation, label: '人情义务', type: 'text' },
      { key: URBAN_FIELD_KEYS.connections.influence, label: '可调动资源', type: 'text' },
    ],
  },
];

const HISTORY_SUBTYPE_ENTITY_TYPES: Record<HistorySubtype, EntityType> = {
  dynasty: 'world',
  bureaucracy: 'faction',
  military: 'faction',
  geography: 'map',
  clan: 'faction',
};

const HISTORY_SUBTYPES: GenrePackSubtypeDefinition[] = (
  Object.keys(HISTORY_SUBTYPE_LABELS) as HistorySubtype[]
).map((subtype) => ({
  key: subtype,
  label: HISTORY_SUBTYPE_LABELS[subtype],
  description: HISTORY_SUBTYPE_SUMMARIES[subtype],
  entityType: HISTORY_SUBTYPE_ENTITY_TYPES[subtype],
  fields: HISTORY_CUSTOM_FIELDS.filter((field) => field.subtypes.includes(subtype)).map(
    (field) => ({
      key: field.key,
      label: field.label,
      type: field.type as CustomFieldType,
      options: field.options,
    }),
  ),
}));

export const GENRE_PACK_DEFINITIONS: Record<WorkGenrePack, GenrePackDefinition> = {
  xianxia: {
    key: 'xianxia',
    label: '仙侠',
    template: {
      key: 'xianxia-classic',
      name: '仙侠主模板',
      summary: '以修行、宗门、灵物和天道规则推动成长与冲突。',
      writingGuide: [
        '修行、法宝和境界必须遵守既有规则、代价与瓶颈。',
        '人物行动要受宗门关系、地域距离和已确认事实约束。',
      ],
      checkCategories: [],
    },
    subtypes: [],
  },
  history: {
    key: 'history',
    label: '历史',
    template: {
      key: 'history-alternate-ancient',
      name: HISTORY_MAIN_TEMPLATE,
      summary: '在架空古代写朝代更替、官制军制、地理距离和世家争衡。',
      writingGuide: [
        '不绑定真实朝代与真实人物，但时代器物、制度和社会关系必须自洽。',
        '官职有品级和隶属关系，越级调令、军权和官署权限都要写清依据。',
        '军队移动必须经过地图道路，并核算行程、粮草与到达时间。',
        `作品方向可选${HISTORY_VARIANT_LABELS.alternate_ancient}或${HISTORY_VARIANT_LABELS.transmigration_hegemony}。`,
      ],
      checkCategories: [
        'anachronism',
        'official_hierarchy',
        'army_movement',
        'provisions',
        'geographic_distance',
      ],
    },
    subtypes: HISTORY_SUBTYPES,
  },
  urban: {
    key: 'urban',
    label: '都市',
    template: {
      key: 'urban-contemporary',
      name: '都市主模板',
      summary: '以现代城市中的事业、家庭、阶层和人脉关系推动故事。',
      writingGuide: [
        '人物行动要符合现代城市的通勤、场所流程和日常生活逻辑。',
        '资源、资金、合同权限和法律后果要能解释人物为什么能做或不能做一件事。',
        '家庭、公司、阶层和人脉关系的变化要留下可追踪的原因，不能只靠旁白宣布。',
      ],
      checkCategories: ['real_world', 'relationship', 'money', 'law'],
    },
    subtypes: URBAN_SUBTYPES,
  },
};

export function getGenrePackDefinition(
  key: string | null | undefined,
): GenrePackDefinition | undefined {
  if (key === 'xianxia' || key === 'history' || key === 'urban') {
    return GENRE_PACK_DEFINITIONS[key];
  }
  return undefined;
}

export function getGenreSubtypeDefinition(
  genrePack: string | null | undefined,
  subtype: string | null | undefined,
): GenrePackSubtypeDefinition | undefined {
  return getGenrePackDefinition(genrePack)?.subtypes.find(
    (definition) => definition.key === subtype,
  );
}

export function getGenreFieldDefinitions(
  genrePack: string | null | undefined,
  subtype: string | null | undefined,
): GenrePackFieldDefinition[] {
  return getGenreSubtypeDefinition(genrePack, subtype)?.fields ?? [];
}
