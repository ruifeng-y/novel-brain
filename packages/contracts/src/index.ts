import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION_INVALID",
  "AUTH_CODE_INVALID",
  "AUTH_RATE_LIMITED",
  "AUTH_EMAIL_TAKEN",
  "AUTH_PASSWORD_WEAK",
  "AUTH_LOGIN_FAILED",
  "AUTH_SESSION_INVALID",
  "AUTH_CSRF_INVALID",
  "AUTH_ORIGIN_INVALID",
  "MODEL_KEY_INVALID",
  "MODEL_CONNECTION_FAILED",
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_POLICY_BLOCKED",
  "MODEL_RESPONSE_INVALID",
  "MODEL_PROVIDER_ERROR",
  "BIBLE_NOT_READY",
  "BIBLE_LOCKED",
  "BIBLE_NOT_LOCKED",
  "SETTING_LOCKED",
  "SETTING_NAME_CONFLICT",
  "SETTING_ALIAS_CONFLICT",
  "SETTING_CONFLICT_UNRESOLVED",
  "SETTING_PROPOSAL_STATE",
  "SETTING_NOT_LOCKED",
  "CUSTOM_FIELD_REQUIRED",
  "CUSTOM_FIELD_INVALID",
  "CUSTOM_FIELD_IMMUTABLE",
  "CUSTOM_FIELD_DUPLICATE",
  "CHARACTER_STATE_OVERLAP",
  "MAP_NODE_PARENT_MISMATCH",
  "MAP_LAYER_MISMATCH",
  "MAP_ROUTE_ENDPOINT_MISMATCH",
  "MAP_ROUTE_DISCONNECTED",
  "MAP_ROUTE_TRAVEL_TIME_CONFLICT",
  "CONTROL_AREA_OVERLAP",
  "TIMELINE_EVENT_OVERLAP",
  "TIMELINE_ERA_NOT_FOUND",
  "ITINERARY_TIME_ORDER",
  "ITINERARY_OVERLAP",
  "POWER_PATH_MISMATCH",
  "POWER_REALM_LADDER_INVALID",
  "POWER_LIFESPAN_POLICY_INVALID",
  "ITEM_RIGHT_CONFLICT",
  "ITEM_NOT_CONSUMABLE",
  "ITEM_QUANTITY_INSUFFICIENT",
  "EQUIPMENT_SLOT_CONFLICT",
  "ITEM_NOT_EQUIPMENT",
  "JOB_BUDGET_EXCEEDED",
  "JOB_CONTEXT_BRANCH_STALE",
  "JOB_CONTEXT_WINDOW_TOO_SMALL",
  "JOB_CANCELLED",
  "JOB_NOT_RECOVERABLE",
  "JOB_RECOVERY_CONFLICT",
  "JOB_ATTEMPTS_EXHAUSTED",
  "WRITING_ACTION_NOT_EDITABLE",
  "WRITING_ACTION_SELECTION_INVALID",
  "WRITING_ACTION_SOURCE_VERSION_INVALID",
  "FACT_DECISION_REQUIRED",
  "FACT_SUBMISSION_BLOCKED",
  "CANON_CHAPTER_NOT_APPROVED",
  "IMPORT_CONFLICT_UNRESOLVED",
  "OUTLINE_STRUCTURE_INVALID",
  "OUTLINE_NODE_LOCKED",
  "OUTLINE_PARENT_INVALID",
  "OUTLINE_CHAPTER_INVALID",
  "OUTLINE_REFERENCE_INVALID",
  "GOLDEN_THREE_CANDIDATES_EXIST",
  "GOLDEN_THREE_INVALID_CANDIDATES",
  "GOLDEN_THREE_CANDIDATE_LOCKED",
  "GOLDEN_THREE_REVIEW_FAILED",
  "GOLDEN_THREE_SELECTION_REQUIRED",
  "GOLDEN_THREE_ALREADY_LOCKED",
  "GOLDEN_THREE_OVERRIDE_INVALID",
  "LEDGER_TRANSITION_INVALID",
  "LEDGER_SOURCE_REQUIRED",
  "LEDGER_EVIDENCE_REQUIRED",
  "LEDGER_REFERENCE_INVALID",
  "VERSION_CONFLICT",
  "AGENT_CONTRACT_INVALID",
  "AGENT_GRANT_INVALID",
  "AGENT_GRANT_EXPIRED",
  "AGENT_GRANT_REVOKED",
  "AGENT_TOOL_NOT_REGISTERED",
  "AGENT_TOOL_DENIED",
  "AGENT_BUDGET_EXCEEDED",
  "AGENT_APPROVAL_REQUIRED",
  "FORBIDDEN_TENANT_ACCESS",
  "INTERNAL_ERROR",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const uuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Expected a UUID v7",
  );

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).default({}),
    requestId: z.string().startsWith("req_"),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiEnvelopeSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    requestId: z.string().startsWith("req_"),
    meta: z.record(z.string(), z.unknown()).default({}),
  });

export type ApiEnvelope<T> = {
  data: T;
  requestId: string;
  meta: Record<string, unknown>;
};

export const authEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const authPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");
export const authDisplayNameSchema = z.string().trim().min(1).max(50);
export const authorAvatarUrlSchema = z
  .url()
  .max(500)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Avatar URL must use http or https");

export const sendRegistrationCodeRequestSchema = z.object({
  email: authEmailSchema,
});
export type SendRegistrationCodeRequest = z.infer<typeof sendRegistrationCodeRequestSchema>;

export const registerRequestSchema = z.object({
  email: authEmailSchema,
  code: z.string().regex(/^\d{6}$/),
  password: authPasswordSchema,
  displayName: authDisplayNameSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: authEmailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sendPasswordResetRequestSchema = z.object({
  email: authEmailSchema,
});
export type SendPasswordResetRequest = z.infer<typeof sendPasswordResetRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(32).max(256),
  password: authPasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const authUserSchema = z.object({
  id: uuidV7Schema,
  emailMasked: z.string().min(3),
  displayName: z.string().min(1),
  bio: z.string().max(500).default(""),
  avatarUrl: authorAvatarUrlSchema.nullable().default(null),
  version: z.number().int().positive().default(1),
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const profileUpdateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    displayName: authDisplayNameSchema.optional(),
    bio: z.string().trim().max(500).optional(),
    avatarUrl: authorAvatarUrlSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.displayName !== undefined || input.bio !== undefined || input.avatarUrl !== undefined,
    { message: "At least one profile field is required" },
  );
export type ProfileUpdateRequest = z.infer<typeof profileUpdateRequestSchema>;

export const authSessionSchema = z.object({
  id: uuidV7Schema,
  expiresAt: z.string().datetime(),
  current: z.literal(true),
  userAgent: z.string(),
  createdAt: z.string().datetime(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const authDeviceSessionSchema = z.object({
  id: uuidV7Schema,
  expiresAt: z.string().datetime(),
  current: z.boolean(),
  userAgent: z.string(),
  ip: z.string(),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type AuthDeviceSession = z.infer<typeof authDeviceSessionSchema>;

export const authSessionDataSchema = z.object({
  user: authUserSchema,
  session: authSessionSchema,
});
export type AuthSessionData = z.infer<typeof authSessionDataSchema>;

export const csrfDataSchema = z.object({
  token: z.string().min(20),
});
export const sendRegistrationCodeDataSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.string().datetime(),
});
export const sendPasswordResetDataSchema = z.object({
  sent: z.literal(true),
  expiresAt: z.string().datetime(),
});
export const resetPasswordDataSchema = z.object({
  reset: z.literal(true),
});
export const revokeSessionDataSchema = z.object({
  revoked: z.literal(true),
});
export const logoutDataSchema = z.object({
  loggedOut: z.literal(true),
});

export const csrfResponseSchema = apiEnvelopeSchema(csrfDataSchema);
export const sendRegistrationCodeResponseSchema = apiEnvelopeSchema(sendRegistrationCodeDataSchema);
export const sendPasswordResetResponseSchema = apiEnvelopeSchema(sendPasswordResetDataSchema);
export const resetPasswordResponseSchema = apiEnvelopeSchema(resetPasswordDataSchema);
export const authSessionResponseSchema = apiEnvelopeSchema(authSessionDataSchema);
export const authDeviceSessionsResponseSchema = apiEnvelopeSchema(z.array(authDeviceSessionSchema));
export const revokeSessionResponseSchema = apiEnvelopeSchema(revokeSessionDataSchema);
export const profileResponseSchema = apiEnvelopeSchema(authUserSchema);
export const logoutResponseSchema = apiEnvelopeSchema(logoutDataSchema);

export const authorPenNameSchema = z.object({
  id: uuidV7Schema,
  name: z.string().min(1).max(50),
  bio: z.string().max(500),
  avatarUrl: authorAvatarUrlSchema.nullable(),
  isDefault: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AuthorPenName = z.infer<typeof authorPenNameSchema>;

export const authorPenNameCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(50),
  bio: z.string().trim().max(500).default(""),
  avatarUrl: authorAvatarUrlSchema.nullable().optional(),
  isDefault: z.boolean().default(false),
});
export type AuthorPenNameCreateRequest = z.infer<typeof authorPenNameCreateRequestSchema>;

export const authorPenNameUpdateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(50).optional(),
    bio: z.string().trim().max(500).optional(),
    avatarUrl: authorAvatarUrlSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.bio !== undefined ||
      input.avatarUrl !== undefined ||
      input.isDefault !== undefined,
    { message: "At least one pen name field is required" },
  );
export type AuthorPenNameUpdateRequest = z.infer<typeof authorPenNameUpdateRequestSchema>;

export const authorPenNameResponseSchema = apiEnvelopeSchema(authorPenNameSchema);
export const authorPenNameListResponseSchema = apiEnvelopeSchema(z.array(authorPenNameSchema));
export const authorPenNameDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

export const modelProviderSchema = z.enum(["deepseek", "openai-compatible"]);
export const modelPurposeSchema = z.enum(["planning", "writing", "review"]);
export type ModelPurpose = z.infer<typeof modelPurposeSchema>;

export const modelConfigInputSchema = z.object({
  provider: modelProviderSchema,
  label: z.string().trim().min(1).max(80),
  baseUrl: z.url().max(500),
  model: z.string().trim().min(1).max(120),
  apiKey: z.string().min(1).max(500),
  purposes: z.array(modelPurposeSchema).min(1).max(3).default(["writing"]),
  isDefault: z.boolean().default(false),
});
export type ModelConfigInput = z.infer<typeof modelConfigInputSchema>;

export const modelConfigUpdateSchema = z.object({
  version: z.number().int().positive(),
  label: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.url().max(500).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  purposes: z.array(modelPurposeSchema).min(1).max(3).optional(),
  isDefault: z.boolean().optional(),
});
export type ModelConfigUpdate = z.infer<typeof modelConfigUpdateSchema>;

export const modelConnectionTestStatusSchema = z.enum([
  "success",
  "key_invalid",
  "rate_limited",
  "timeout",
  "provider_error",
  "error",
]);
export type ModelConnectionTestStatus = z.infer<typeof modelConnectionTestStatusSchema>;

export const modelConfigSchema = z.object({
  id: uuidV7Schema,
  provider: modelProviderSchema,
  label: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  purposes: z.array(modelPurposeSchema).min(1),
  keyMasked: z.string(),
  isDefault: z.boolean(),
  version: z.number().int().positive(),
  lastTestStatus: modelConnectionTestStatusSchema.nullable(),
  lastTestedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

export const modelProviderInfoSchema = z.object({
  key: modelProviderSchema,
  label: z.string(),
  defaultBaseUrl: z.string(),
  baseUrls: z.array(z.string()),
  models: z.array(z.string()),
});
export type ModelProviderInfo = z.infer<typeof modelProviderInfoSchema>;

export const modelConfigsResponseSchema = apiEnvelopeSchema(z.array(modelConfigSchema));
export const modelProvidersResponseSchema = apiEnvelopeSchema(z.array(modelProviderInfoSchema));
export const modelConfigResponseSchema = apiEnvelopeSchema(modelConfigSchema);
export const modelConnectionTestResponseSchema = apiEnvelopeSchema(
  z.object({
    status: z.literal("success"),
    latencyMs: z.number().nonnegative(),
    message: z.string(),
  }),
);
export const modelConfigDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

export const workStatusSchema = z.enum([
  "draft",
  "preparing",
  "serializing",
  "paused",
  "completed",
  "archived",
]);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const workGenreSchema = z.enum(["xianxia", "history", "urban"]);
export type WorkGenre = z.infer<typeof workGenreSchema>;

export const workScaleTargetSchema = z.enum(["short", "medium", "long", "epic"]);
export type WorkScaleTarget = z.infer<typeof workScaleTargetSchema>;

export const workSourceModeSchema = z.enum([
  "idea",
  "blank",
  "template",
  "settings_import",
  "manuscript_import",
]);
export type WorkSourceMode = z.infer<typeof workSourceModeSchema>;

const workBaseInputShape = {
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(50).optional(),
  genre: workGenreSchema.default("xianxia"),
  scaleTarget: workScaleTargetSchema.default("long"),
  chapterLengthTarget: z.number().int().min(1000).max(10000).default(3000),
};

export const workCreateRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("idea"),
    idea: z.string().trim().min(10).max(5000),
    ...workBaseInputShape,
  }),
  z.object({
    mode: z.literal("blank"),
    ...workBaseInputShape,
  }),
  z.object({
    mode: z.literal("template"),
    templateKey: z.literal("xianxia"),
    ...workBaseInputShape,
  }),
]);
export type WorkCreateRequest = z.infer<typeof workCreateRequestSchema>;

export const workTemplatePackSchema = z.object({
  id: uuidV7Schema,
  key: workGenreSchema,
  version: z.number().int().positive(),
  label: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
export type WorkTemplatePack = z.infer<typeof workTemplatePackSchema>;

export const workSchema = z.object({
  id: uuidV7Schema,
  title: z.string(),
  penName: z.string(),
  genre: workGenreSchema,
  status: workStatusSchema,
  scaleTarget: workScaleTargetSchema,
  chapterLengthTarget: z.number().int().positive(),
  sourceMode: workSourceModeSchema,
  idea: z.string().nullable(),
  templatePack: workTemplatePackSchema.nullable(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Work = z.infer<typeof workSchema>;

export const workBranchSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  name: z.string(),
  headNodeId: uuidV7Schema,
  status: z.enum(["active", "archived"]),
});
export type WorkBranch = z.infer<typeof workBranchSchema>;

export const workReadinessItemSchema = z.object({
  key: z.enum(["main_branch", "model_config", "story_bible", "outline"]),
  label: z.string(),
  ready: z.boolean(),
});

export const workReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  items: z.array(workReadinessItemSchema),
});
export type WorkReadiness = z.infer<typeof workReadinessSchema>;

export const workOverviewSchema = workSchema.extend({
  mainBranch: workBranchSchema,
  branches: z.array(workBranchSchema),
  readiness: workReadinessSchema,
});
export type WorkOverview = z.infer<typeof workOverviewSchema>;

export const workListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: workStatusSchema.optional(),
  genre: workGenreSchema.optional(),
  cursor: uuidV7Schema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type WorkListQuery = z.infer<typeof workListQuerySchema>;

export const workResponseSchema = apiEnvelopeSchema(workOverviewSchema);
export const workListResponseSchema = z.object({
  data: z.array(workSchema),
  requestId: z.string().startsWith("req_"),
  meta: z.object({ nextCursor: uuidV7Schema.nullable() }),
});
export const workBranchesResponseSchema = apiEnvelopeSchema(z.array(workBranchSchema));

export const importCandidateTypeSchema = z.enum([
  "character",
  "faction",
  "map",
  "power_system",
  "golden_finger",
]);
export type ImportCandidateType = z.infer<typeof importCandidateTypeSchema>;

export const importCandidateStatusSchema = z.enum(["accepted", "pending", "conflict"]);
export type ImportCandidateStatus = z.infer<typeof importCandidateStatusSchema>;

export const importCandidateSchema = z.object({
  id: uuidV7Schema,
  type: importCandidateTypeSchema,
  name: z.string().min(1),
  summary: z.string(),
  sourceExcerpt: z.string().min(1),
  confidence: z.number().min(0).max(1),
  status: importCandidateStatusSchema,
});
export type ImportCandidate = z.infer<typeof importCandidateSchema>;

export const importUnparsedSchema = z.object({
  sourceExcerpt: z.string().min(1),
  reason: z.string().min(1),
});
export type ImportUnparsed = z.infer<typeof importUnparsedSchema>;

export const importConflictSchema = z.object({
  id: uuidV7Schema,
  type: z.literal("contradictory_setting"),
  summary: z.string().min(1),
  candidates: z.array(importCandidateSchema).length(2),
  decision: z.enum(["pending", "use_primary", "use_secondary"]),
  decidedAt: z.string().datetime().nullable(),
});
export type ImportConflict = z.infer<typeof importConflictSchema>;

export const importReportSchema = z.object({
  accepted: z.array(importCandidateSchema),
  pending: z.array(importCandidateSchema),
  conflicts: z.array(importConflictSchema),
  unparsed: z.array(importUnparsedSchema),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const settingsImportStatusSchema = z.enum(["awaiting_confirmation", "completed"]);
export type SettingsImportStatus = z.infer<typeof settingsImportStatusSchema>;

export const settingsImportSourceKindSchema = z.enum(["paste", "file"]);
export type SettingsImportSourceKind = z.infer<typeof settingsImportSourceKindSchema>;

export const settingsImportSchema = z.object({
  id: uuidV7Schema,
  status: settingsImportStatusSchema,
  sourceKind: settingsImportSourceKindSchema,
  sourceName: z.string().nullable(),
  report: importReportSchema,
  canConfirm: z.boolean(),
  confirmedWorkId: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
});
export type SettingsImport = z.infer<typeof settingsImportSchema>;

export const settingsImportCreateRequestSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  sourceName: z.string().trim().min(1).max(200).optional(),
});
export type SettingsImportCreateRequest = z.infer<typeof settingsImportCreateRequestSchema>;

export const settingsImportConfirmRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(50).optional(),
  genre: workGenreSchema.default("xianxia"),
  scaleTarget: workScaleTargetSchema.default("long"),
  chapterLengthTarget: z.number().int().min(1000).max(10000).default(3000),
});
export type SettingsImportConfirmRequest = z.infer<typeof settingsImportConfirmRequestSchema>;

export const settingsImportConflictDecisionRequestSchema = z.object({
  decision: z.enum(["use_primary", "use_secondary"]),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type SettingsImportConflictDecisionRequest = z.infer<
  typeof settingsImportConflictDecisionRequestSchema
>;

export const settingsImportResponseSchema = apiEnvelopeSchema(settingsImportSchema);
export const importReportResponseSchema = apiEnvelopeSchema(importReportSchema);

export const manuscriptImportFormatSchema = z.enum(["txt", "markdown"]);
export type ManuscriptImportFormat = z.infer<typeof manuscriptImportFormatSchema>;

export const manuscriptImportStatusSchema = z.enum(["ready", "partial", "empty"]);
export type ManuscriptImportStatus = z.infer<typeof manuscriptImportStatusSchema>;

export const manuscriptImportWarningSchema = z.object({
  sourceExcerpt: z.string().min(1),
  reason: z.string().min(1),
});
export type ManuscriptImportWarning = z.infer<typeof manuscriptImportWarningSchema>;

export const manuscriptImportChapterSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  content: z.string(),
  wordCount: z.number().int().nonnegative(),
});
export type ManuscriptImportChapter = z.infer<typeof manuscriptImportChapterSchema>;

export const manuscriptImportSchema = z.object({
  id: uuidV7Schema,
  status: manuscriptImportStatusSchema,
  sourceName: z.string().min(1),
  format: manuscriptImportFormatSchema,
  chapters: z.array(manuscriptImportChapterSchema),
  warnings: z.array(manuscriptImportWarningSchema),
  canConfirm: z.boolean(),
  confirmedWorkId: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
});
export type ManuscriptImport = z.infer<typeof manuscriptImportSchema>;

export const manuscriptImportResponseSchema = apiEnvelopeSchema(manuscriptImportSchema);

export const STORY_BIBLE_CARD_KEYS = [
  "oneSentence",
  "sellingPoints",
  "protagonist",
  "goldenFinger",
  "worldLaws",
  "mainPlot",
  "subplots",
  "ending",
  "readerPromise",
] as const;

export const storyBibleCardKeySchema = z.enum(STORY_BIBLE_CARD_KEYS);
export type StoryBibleCardKey = z.infer<typeof storyBibleCardKeySchema>;

export const STORY_BIBLE_CARD_TITLES: Record<StoryBibleCardKey, string> = {
  oneSentence: "一句话故事",
  sellingPoints: "核心卖点",
  protagonist: "主角",
  goldenFinger: "金手指",
  worldLaws: "世界铁律",
  mainPlot: "主线",
  subplots: "支线",
  ending: "结局方向",
  readerPromise: "读者承诺",
};

export const storyBibleStatusSchema = z.enum(["draft", "proposed", "locked"]);
export type StoryBibleStatus = z.infer<typeof storyBibleStatusSchema>;

export const storyBibleWorldRuleSchema = z
  .object({
    id: uuidV7Schema,
    name: z.string().trim().min(1).max(120),
    constraint: z.string().trim().min(1).max(2_000),
    scope: z.string().trim().min(1).max(500),
    exceptions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  })
  .strict();
export type StoryBibleWorldRule = z.infer<typeof storyBibleWorldRuleSchema>;

export const storyBibleWorldRuleInputSchema = storyBibleWorldRuleSchema.extend({
  id: uuidV7Schema.optional(),
});
export type StoryBibleWorldRuleInput = z.infer<typeof storyBibleWorldRuleInputSchema>;

export const storyBibleCardSchema = z
  .object({
    key: storyBibleCardKeySchema,
    title: z.string().min(1),
    content: z.string().max(20_000),
    complete: z.boolean(),
    worldRules: z.array(storyBibleWorldRuleSchema).max(20).default([]),
  })
  .strict()
  .superRefine((card, context) => {
    if (card.key !== "worldLaws" && card.worldRules.length > 0) {
      context.addIssue({
        code: "custom",
        message: "worldRules are only allowed on worldLaws",
        path: ["worldRules"],
      });
    }
  });
export type StoryBibleCard = z.infer<typeof storyBibleCardSchema>;

export const storyBibleMissingCardSchema = z.object({
  key: storyBibleCardKeySchema,
  title: z.string().min(1),
});
export type StoryBibleMissingCard = z.infer<typeof storyBibleMissingCardSchema>;

export const storyBibleIssueSchema = z.object({
  code: z.enum(["missing_card", "missing_world_rule", "contradictory_world_rule"]),
  key: storyBibleCardKeySchema,
  title: z.string().min(1),
  message: z.string().min(1),
});
export type StoryBibleIssue = z.infer<typeof storyBibleIssueSchema>;

export const storyBibleReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().min(0).max(9),
  total: z.literal(9),
  canLock: z.boolean(),
  missingCards: z.array(storyBibleMissingCardSchema).max(9),
  issues: z.array(storyBibleIssueSchema).max(20),
});
export type StoryBibleReadiness = z.infer<typeof storyBibleReadinessSchema>;

export const storyBibleProposalSchema = z.object({
  generatedAt: z.string().datetime(),
  source: z.literal("work_premise"),
});
export type StoryBibleProposal = z.infer<typeof storyBibleProposalSchema>;

const storyBibleCardsSchema = z
  .array(storyBibleCardSchema)
  .length(9)
  .superRefine((cards, context) => {
    const keys = cards.map((card) => card.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Story bible card keys must be unique" });
    }
    for (const key of STORY_BIBLE_CARD_KEYS) {
      if (!keys.includes(key)) {
        context.addIssue({ code: "custom", message: `Story bible card ${key} is required` });
      }
    }
  });

export const storyBibleSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  version: z.number().int().positive(),
  status: storyBibleStatusSchema,
  cards: storyBibleCardsSchema,
  readiness: storyBibleReadinessSchema,
  proposal: storyBibleProposalSchema.nullable(),
  lockedAt: z.string().datetime().nullable(),
  lockedBy: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoryBible = z.infer<typeof storyBibleSchema>;

export const storyBiblePatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    cards: z
      .array(
        z.object({
          key: storyBibleCardKeySchema,
          content: z.string().max(20_000),
          worldRules: z.array(storyBibleWorldRuleInputSchema).max(20).optional(),
        }),
      )
      .min(1)
      .max(9),
  })
  .superRefine((input, context) => {
    const keys = input.cards.map((card) => card.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Story bible card updates must have unique keys",
        path: ["cards"],
      });
    }
    for (const card of input.cards) {
      if (card.key === "worldLaws" && card.worldRules === undefined) {
        context.addIssue({
          code: "custom",
          message: "worldLaws card requires structured world rules",
          path: ["cards"],
        });
      }
      if (card.key !== "worldLaws" && card.worldRules !== undefined) {
        context.addIssue({
          code: "custom",
          message: "worldRules are only allowed on worldLaws",
          path: ["cards"],
        });
      }
    }
  });
export type StoryBiblePatchRequest = z.infer<typeof storyBiblePatchRequestSchema>;

export const storyBibleGenerateRequestSchema = z.object({}).strict();
export type StoryBibleGenerateRequest = z.infer<typeof storyBibleGenerateRequestSchema>;

export const storyBibleLockRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type StoryBibleLockRequest = z.infer<typeof storyBibleLockRequestSchema>;

export const storyBibleUnlockRequestSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
});
export type StoryBibleUnlockRequest = z.infer<typeof storyBibleUnlockRequestSchema>;

export const storyBibleVersionActionSchema = z.enum(["proposed", "edited", "locked", "unlocked"]);
export type StoryBibleVersionAction = z.infer<typeof storyBibleVersionActionSchema>;

export const storyBibleVersionSchema = z.object({
  id: uuidV7Schema,
  storyBibleId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  version: z.number().int().positive(),
  action: storyBibleVersionActionSchema,
  actorId: uuidV7Schema,
  reason: z.string().min(1),
  cards: storyBibleCardsSchema,
  createdAt: z.string().datetime(),
});
export type StoryBibleVersion = z.infer<typeof storyBibleVersionSchema>;

export const storyBibleChangeRequestCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    cardKey: storyBibleCardKeySchema,
    title: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    after: storyBibleCardSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.cardKey !== input.after.key) {
      context.addIssue({
        code: "custom",
        message: "Change request card key must match the after card",
        path: ["cardKey"],
      });
    }
    if (input.cardKey === "worldLaws" && input.after.worldRules.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Locked worldLaws change requests require structured world rules",
        path: ["after", "worldRules"],
      });
    }
  });
export type StoryBibleChangeRequestCreateRequest = z.infer<
  typeof storyBibleChangeRequestCreateRequestSchema
>;

export const storyBibleChangeRequestSchema = z.object({
  id: uuidV7Schema,
  storyBibleId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  cardKey: storyBibleCardKeySchema,
  title: z.string().min(1),
  reason: z.string().min(1),
  before: storyBibleCardSchema,
  after: storyBibleCardSchema,
  status: z.enum(["pending", "analyzing", "approved", "rejected", "applied"]),
  risk: z.enum(["low", "medium", "high"]),
  source: z.enum(["author", "ai", "import", "batch"]),
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type StoryBibleChangeRequest = z.infer<typeof storyBibleChangeRequestSchema>;

export const storyBibleResponseSchema = apiEnvelopeSchema(storyBibleSchema);
export const storyBibleReadinessResponseSchema = apiEnvelopeSchema(storyBibleReadinessSchema);
export const storyBibleVersionListQuerySchema = z.object({
  cursor: uuidV7Schema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type StoryBibleVersionListQuery = z.infer<typeof storyBibleVersionListQuerySchema>;

export const storyBibleWorldRuleListQuerySchema = z.object({
  cursor: uuidV7Schema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export type StoryBibleWorldRuleListQuery = z.infer<typeof storyBibleWorldRuleListQuerySchema>;

export const storyBibleVersionListResponseSchema = z.object({
  data: z.array(storyBibleVersionSchema),
  requestId: z.string().startsWith("req_"),
  meta: z.object({ nextCursor: uuidV7Schema.nullable() }),
});
export const storyBibleWorldRuleListResponseSchema = z.object({
  data: z.array(storyBibleWorldRuleSchema),
  requestId: z.string().startsWith("req_"),
  meta: z.object({ nextCursor: uuidV7Schema.nullable() }),
});
export const storyBibleChangeRequestResponseSchema = apiEnvelopeSchema(
  storyBibleChangeRequestSchema,
);
export const storyBibleDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

export const settingEntityTypeSchema = z.enum([
  "world_rule",
  "character",
  "faction",
  "map",
  "power_system",
  "golden_finger",
  "item",
  "timeline_event",
]);
export type SettingEntityType = z.infer<typeof settingEntityTypeSchema>;

export const settingStatusSchema = z.enum(["draft", "proposed", "locked", "discarded"]);
export type SettingStatus = z.infer<typeof settingStatusSchema>;

export const settingSourceSchema = z.enum(["author", "import", "ai", "canon"]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

export const customFieldTypeSchema = z.enum([
  "text",
  "long_text",
  "number",
  "date",
  "single_select",
  "multi_select",
  "boolean",
  "relation_ref",
]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

export const customFieldAppliesToSchema = z.enum([
  "all",
  "world_rule",
  "character",
  "faction",
  "map",
  "power_system",
  "golden_finger",
  "item",
  "timeline_event",
]);
export type CustomFieldAppliesTo = z.infer<typeof customFieldAppliesToSchema>;

const customFieldOptionsSchema = z.array(z.string().trim().min(1).max(80)).max(100).default([]);

const customFieldDefinitionBaseShape = {
  label: z.string().trim().min(1).max(80),
  fieldType: customFieldTypeSchema,
  appliesTo: customFieldAppliesToSchema,
  required: z.boolean().default(false),
  options: customFieldOptionsSchema,
  relationTarget: settingEntityTypeSchema.nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
};

export const customFieldDefinitionCreateRequestSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, "Expected a lowercase field key"),
    ...customFieldDefinitionBaseShape,
  })
  .strict()
  .superRefine(validateCustomFieldDefinitionShape);
export type CustomFieldDefinitionCreateRequest = z.infer<
  typeof customFieldDefinitionCreateRequestSchema
>;

export const customFieldDefinitionPatchRequestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    key: z.string().trim().optional(),
    label: z.string().trim().min(1).max(80).optional(),
    fieldType: customFieldTypeSchema.optional(),
    appliesTo: customFieldAppliesToSchema.optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    relationTarget: settingEntityTypeSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).some((key) => key !== "schemaVersion"), {
    message: "At least one custom field change is required",
  });
export type CustomFieldDefinitionPatchRequest = z.infer<
  typeof customFieldDefinitionPatchRequestSchema
>;

export const customFieldDefinitionSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  key: z.string(),
  label: z.string(),
  fieldType: customFieldTypeSchema,
  appliesTo: customFieldAppliesToSchema,
  required: z.boolean(),
  options: z.array(z.string()),
  relationTarget: settingEntityTypeSchema.nullable(),
  enabled: z.boolean(),
  schemaVersion: z.number().int().positive(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;

export const customFieldValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
]);
export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

export const customFieldValuesSchema = z.record(z.string().trim().min(1).max(80), z.unknown());
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

export const customFieldDefinitionResponseSchema = apiEnvelopeSchema(customFieldDefinitionSchema);
export const customFieldDefinitionListResponseSchema = apiEnvelopeSchema(
  z.array(customFieldDefinitionSchema),
);

export const settingConflictTypeSchema = z.enum([
  "none",
  "duplicate_name",
  "alias_collision",
  "contradictory_fact",
  "import_candidate",
  "ai_disagreement",
]);
export type SettingConflictType = z.infer<typeof settingConflictTypeSchema>;

export const settingEvidenceKindSchema = z.enum([
  "chapter",
  "entity",
  "import",
  "author_note",
  "ai_suggestion",
]);
export type SettingEvidenceKind = z.infer<typeof settingEvidenceKindSchema>;

export const settingEvidenceSchema = z
  .object({
    kind: settingEvidenceKindSchema,
    sourceId: uuidV7Schema.nullable().default(null),
    label: z.string().trim().min(1).max(200),
    quote: z.string().max(5_000).default(""),
    locator: z.string().max(500).default(""),
    confidence: z.number().min(0).max(1).nullable().default(null),
  })
  .strict();
export type SettingEvidence = z.infer<typeof settingEvidenceSchema>;

export const settingProposalCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
    conflictType: settingConflictTypeSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SettingProposalCreateRequest = z.infer<typeof settingProposalCreateRequestSchema>;

export const settingProposalDecisionRequestSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    reason: z.string().trim().min(1).max(1_000),
    conflictType: settingConflictTypeSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SettingProposalDecisionRequest = z.infer<typeof settingProposalDecisionRequestSchema>;

export const settingProposalStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type SettingProposalStatus = z.infer<typeof settingProposalStatusSchema>;

export const settingProposalSchema = z.object({
  id: uuidV7Schema,
  entityId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  entityVersion: z.number().int().positive(),
  status: settingProposalStatusSchema,
  conflictType: settingConflictTypeSchema,
  evidence: z.array(settingEvidenceSchema),
  reason: z.string(),
  proposedBy: uuidV7Schema,
  createdAt: z.string().datetime(),
  decidedBy: uuidV7Schema.nullable(),
  decidedAt: z.string().datetime().nullable(),
  decisionReason: z.string().nullable(),
  decisionEvidence: z.array(settingEvidenceSchema),
  decisionConflictType: settingConflictTypeSchema.nullable(),
});
export type SettingProposal = z.infer<typeof settingProposalSchema>;

export const settingProposalResponseSchema = apiEnvelopeSchema(settingProposalSchema);
export const settingProposalListResponseSchema = apiEnvelopeSchema(z.array(settingProposalSchema));

export const worldRuleDataSchema = z
  .object({
    rule: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type WorldRuleData = z.infer<typeof worldRuleDataSchema>;

export const characterDataSchema = z
  .object({
    bodyState: z.string().trim().min(1).max(20_000),
    knowledgeBoundary: z.string().trim().min(1).max(20_000),
    relationshipSummary: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type CharacterData = z.infer<typeof characterDataSchema>;

export const goldenFingerDataSchema = z
  .object({
    rules: z.string().trim().min(1).max(20_000),
    cost: z.string().trim().min(1).max(20_000),
    limits: z.string().trim().min(1).max(20_000),
    growth: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type GoldenFingerData = z.infer<typeof goldenFingerDataSchema>;

export const factionDataSchema = z
  .object({
    details: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type FactionData = z.infer<typeof factionDataSchema>;

export const mapDataSchema = z
  .object({
    details: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type MapData = z.infer<typeof mapDataSchema>;

export const powerSystemDataSchema = z
  .object({
    details: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type PowerSystemData = z.infer<typeof powerSystemDataSchema>;

export const itemDataSchema = z
  .object({
    category: z.string().trim().min(1).max(200),
    grade: z.string().trim().max(200).default(""),
    effect: z.string().trim().min(1).max(20_000),
    cost: z.string().trim().max(20_000).default(""),
    ownership: z.string().trim().max(500).default(""),
    limits: z.string().trim().max(20_000).default(""),
  })
  .strict();
export type ItemData = z.infer<typeof itemDataSchema>;

export const timelineEventDataSchema = z
  .object({
    era: z.string().trim().max(200).default(""),
    storyTime: z.string().trim().min(1).max(500),
    storySortKey: z.number().int().optional(),
    duration: z.string().trim().max(500).default(""),
    event: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type TimelineEventData = z.infer<typeof timelineEventDataSchema>;

const settingEntityBaseShape = {
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  summary: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
};

const settingEntityPatchShape = {
  name: z.string().trim().min(1).max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(20_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
};

export const settingEntityCreateRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("world_rule"),
    ...settingEntityBaseShape,
    data: worldRuleDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("character"),
    ...settingEntityBaseShape,
    data: characterDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("faction"),
    ...settingEntityBaseShape,
    data: factionDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("map"),
    ...settingEntityBaseShape,
    data: mapDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("power_system"),
    ...settingEntityBaseShape,
    data: powerSystemDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("golden_finger"),
    ...settingEntityBaseShape,
    data: goldenFingerDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("item"),
    ...settingEntityBaseShape,
    data: itemDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
  z.object({
    type: z.literal("timeline_event"),
    ...settingEntityBaseShape,
    data: timelineEventDataSchema,
    customFields: customFieldValuesSchema.default({}),
  }),
]);
export type SettingEntityCreateRequest = z.infer<typeof settingEntityCreateRequestSchema>;

export const settingEntityPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    ...settingEntityPatchShape,
    customFields: customFieldValuesSchema.optional(),
    data: z
      .union([
        worldRuleDataSchema.partial(),
        characterDataSchema.partial(),
        factionDataSchema.partial(),
        mapDataSchema.partial(),
        powerSystemDataSchema.partial(),
        goldenFingerDataSchema.partial(),
        itemDataSchema.partial(),
        timelineEventDataSchema.partial(),
      ])
      .optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.aliases !== undefined ||
      input.summary !== undefined ||
      input.description !== undefined ||
      input.tags !== undefined ||
      input.customFields !== undefined ||
      input.data !== undefined,
    { message: "At least one setting field is required" },
  );
export type SettingEntityPatchRequest = z.infer<typeof settingEntityPatchRequestSchema>;

export const settingChangeRequestCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(1_000),
    after: z
      .object({
        ...settingEntityPatchShape,
        customFields: customFieldValuesSchema.optional(),
        data: z
          .union([
            worldRuleDataSchema.partial(),
            characterDataSchema.partial(),
            factionDataSchema.partial(),
            mapDataSchema.partial(),
            powerSystemDataSchema.partial(),
            goldenFingerDataSchema.partial(),
            itemDataSchema.partial(),
            timelineEventDataSchema.partial(),
          ])
          .optional(),
        powerSystem: z.lazy(() => powerSystemChangePatchSchema).optional(),
        mechanism: z.lazy(() => mechanismChangePatchSchema).optional(),
        item: z.lazy(() => itemChangePatchSchema).optional(),
      })
      .refine(
        (input) =>
          input.name !== undefined ||
          input.aliases !== undefined ||
          input.summary !== undefined ||
          input.description !== undefined ||
          input.tags !== undefined ||
          input.customFields !== undefined ||
          input.data !== undefined ||
          input.powerSystem !== undefined ||
          input.mechanism !== undefined ||
          input.item !== undefined,
        { message: "At least one setting field is required" },
      ),
    conflictType: settingConflictTypeSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SettingChangeRequestCreateRequest = z.infer<
  typeof settingChangeRequestCreateRequestSchema
>;

export const settingChangeRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "applied",
]);
export type SettingChangeRequestStatus = z.infer<typeof settingChangeRequestStatusSchema>;

export const settingChangeRequestSchema = z.object({
  id: uuidV7Schema,
  entityId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  entityVersion: z.number().int().positive(),
  title: z.string(),
  reason: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  status: settingChangeRequestStatusSchema,
  conflictType: settingConflictTypeSchema,
  evidence: z.array(settingEvidenceSchema),
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type SettingChangeRequest = z.infer<typeof settingChangeRequestSchema>;

export const settingChangeRequestResponseSchema = apiEnvelopeSchema(settingChangeRequestSchema);
export const settingChangeRequestListResponseSchema = apiEnvelopeSchema(
  z.array(settingChangeRequestSchema),
);

export const settingEntityLockRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type SettingEntityLockRequest = z.infer<typeof settingEntityLockRequestSchema>;

const settingEntityCommonShape = {
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  name: z.string(),
  aliases: z.array(z.string()),
  summary: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  customFields: z.record(z.string(), customFieldValueSchema),
  status: settingStatusSchema,
  source: settingSourceSchema,
  version: z.number().int().positive(),
  lockedAt: z.string().datetime().nullable(),
  lockedBy: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const settingEntitySchema = z.discriminatedUnion("type", [
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("world_rule"),
    data: worldRuleDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("character"),
    data: characterDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("faction"),
    data: factionDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("map"),
    data: mapDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("power_system"),
    data: powerSystemDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("golden_finger"),
    data: goldenFingerDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("item"),
    data: itemDataSchema,
  }),
  z.object({
    ...settingEntityCommonShape,
    type: z.literal("timeline_event"),
    data: timelineEventDataSchema,
  }),
]);
export type SettingEntity = z.infer<typeof settingEntitySchema>;

export const settingEntityListQuerySchema = z.object({
  type: settingEntityTypeSchema.optional(),
  status: settingStatusSchema.optional(),
});
export type SettingEntityListQuery = z.infer<typeof settingEntityListQuerySchema>;

export const settingEntityResponseSchema = apiEnvelopeSchema(settingEntitySchema);
export const settingEntityListResponseSchema = apiEnvelopeSchema(z.array(settingEntitySchema));
export const settingEntityDeleteResponseSchema = apiEnvelopeSchema(
  z.object({ deleted: z.literal(true) }),
);

export const domainRefTypeSchema = z.enum([
  "character",
  "faction",
  "map",
  "world_rule",
  "map_layer",
  "map_node",
  "map_edge",
  "map_marker",
  "territory",
  "power_system",
  "golden_finger",
  "item",
  "timeline_event",
  "timeline_era",
  "itinerary",
  "fact",
  "chapter",
  "character_relationship",
  "character_state",
  "character_knowledge",
]);
export type DomainRefType = z.infer<typeof domainRefTypeSchema>;

export const storyTimePointSchema = z
  .object({
    era: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(200),
    sortKey: z.number().int(),
  })
  .strict();
export type StoryTimePoint = z.infer<typeof storyTimePointSchema>;

export const versionRefSchema = z
  .object({
    branchId: uuidV7Schema,
    versionNodeId: uuidV7Schema.nullable().default(null),
    objectVersion: z.number().int().positive().nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.versionNodeId === null) !== (input.objectVersion === null)) {
      context.addIssue({
        code: "custom",
        path: ["versionNodeId"],
        message: "Version node and object version must be provided together",
      });
    }
  });
export type VersionRef = z.infer<typeof versionRefSchema>;

export const domainRefSchema = z
  .object({
    type: domainRefTypeSchema,
    id: uuidV7Schema,
    branchId: uuidV7Schema,
    label: z.string().trim().min(1).max(200).nullable().default(null),
    version: versionRefSchema.nullable().default(null),
  })
  .strict();
export type DomainRef = z.infer<typeof domainRefSchema>;

export const validityIntervalSchema = z
  .object({
    fromChapter: z.number().int().positive(),
    toChapter: z.number().int().positive().nullable().default(null),
    fromStoryTime: storyTimePointSchema.nullable().default(null),
    toStoryTime: storyTimePointSchema.nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.toChapter !== null && input.toChapter < input.fromChapter) {
      context.addIssue({
        code: "custom",
        path: ["toChapter"],
        message: "Validity end chapter cannot precede its start",
      });
    }
    if (
      input.fromStoryTime !== null &&
      input.toStoryTime !== null &&
      input.fromStoryTime.era === input.toStoryTime.era &&
      input.toStoryTime.sortKey < input.fromStoryTime.sortKey
    ) {
      context.addIssue({
        code: "custom",
        path: ["toStoryTime"],
        message: "Validity end story time cannot precede its start",
      });
    }
    if (input.fromStoryTime === null && input.toStoryTime !== null) {
      context.addIssue({
        code: "custom",
        path: ["fromStoryTime"],
        message: "Validity start story time is required when an end is provided",
      });
    }
  });
export type ValidityInterval = z.infer<typeof validityIntervalSchema>;

export const retrievalSourceKindSchema = z.enum(["entity", "fact", "timeline_event", "map_node"]);
export type RetrievalSourceKind = z.infer<typeof retrievalSourceKindSchema>;

export const retrievalMatchKindSchema = z.enum([
  "canonical_name",
  "alias",
  "title",
  "synonym",
  "fuzzy",
  "content",
  "relationship",
]);
export type RetrievalMatchKind = z.infer<typeof retrievalMatchKindSchema>;

export const retrievalMatchFieldSchema = z.enum([
  "name",
  "aliases",
  "title",
  "content",
  "relationship",
]);
export type RetrievalMatchField = z.infer<typeof retrievalMatchFieldSchema>;

export const retrievalQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    synonyms: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    sourceKinds: z
      .array(retrievalSourceKindSchema)
      .min(1)
      .max(4)
      .default(["entity", "fact", "timeline_event", "map_node"]),
    entityTypes: z.array(settingEntityTypeSchema).max(8).default([]),
    chapterNumber: z.number().int().positive(),
    versionNodeId: uuidV7Schema.nullable().default(null),
    storyTime: storyTimePointSchema.nullable().default(null),
    povCharacterId: uuidV7Schema.nullable().default(null),
    expandRelationships: z.boolean().default(true),
    relationshipDepth: z.number().int().min(0).max(2).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.expandRelationships && (input.relationshipDepth ?? 0) > 0) {
      context.addIssue({
        code: "custom",
        path: ["relationshipDepth"],
        message: "Relationship depth requires relationship expansion",
      });
    }
  })
  .transform((input) => ({
    ...input,
    relationshipDepth: input.expandRelationships ? (input.relationshipDepth ?? 1) : 0,
  }));
export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;

export const retrievalRelationshipHopSchema = z
  .object({
    relationId: uuidV7Schema,
    relationType: z.string().trim().min(1).max(80),
    direction: z.enum(["outgoing", "incoming"]),
    from: domainRefSchema,
    to: domainRefSchema,
  })
  .strict();
export type RetrievalRelationshipHop = z.infer<typeof retrievalRelationshipHopSchema>;

export const retrievalSourceChapterSchema = z
  .object({
    chapterId: uuidV7Schema,
    number: z.number().int().positive(),
    title: z.string(),
  })
  .strict();
export type RetrievalSourceChapter = z.infer<typeof retrievalSourceChapterSchema>;

export const retrievalDisambiguationSchema = z
  .object({
    sameNameCount: z.number().int().min(1),
    key: z.string().trim().min(1),
  })
  .strict();
export type RetrievalDisambiguation = z.infer<typeof retrievalDisambiguationSchema>;

export const retrievalResultSchema = z
  .object({
    id: uuidV7Schema,
    sourceKind: retrievalSourceKindSchema,
    matchKind: retrievalMatchKindSchema,
    score: z.number().min(0).max(1),
    label: z.string().trim().min(1).max(200),
    canonicalName: z.string().trim().min(1).max(200),
    entityType: settingEntityTypeSchema.nullable(),
    summary: z.string(),
    source: domainRefSchema,
    validity: validityIntervalSchema,
    sourceChapter: retrievalSourceChapterSchema.nullable(),
    matchedTerm: z.string().trim().min(1).max(200),
    matchedField: retrievalMatchFieldSchema,
    relationshipPath: z.array(retrievalRelationshipHopSchema),
    disambiguation: retrievalDisambiguationSchema,
  })
  .strict();
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;

export const retrievalResultListResponseSchema = apiEnvelopeSchema(z.array(retrievalResultSchema));

export const searchDocumentSourceTypeSchema = z.enum([
  "entity",
  "fact",
  "timeline_event",
  "map_node",
  "chapter",
  "setting",
]);
export type SearchDocumentSourceType = z.infer<typeof searchDocumentSourceTypeSchema>;

export const searchDocumentSchema = z
  .object({
    id: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    sourceType: searchDocumentSourceTypeSchema,
    sourceId: uuidV7Schema,
    entityType: settingEntityTypeSchema.nullable(),
    title: z.string(),
    content: z.string(),
    aliases: z.array(z.string()),
    version: versionRefSchema,
    sourceChapterId: uuidV7Schema.nullable(),
    validity: validityIntervalSchema,
    metadata: z.record(z.string(), z.unknown()),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SearchDocument = z.infer<typeof searchDocumentSchema>;

const characterProfileFields = {
  desire: z.string().trim().max(20_000).default(""),
  fear: z.string().trim().max(20_000).default(""),
  goal: z.string().trim().max(20_000).default(""),
  voiceSample: z.string().trim().max(20_000).default(""),
  voiceGuide: z.string().trim().max(20_000).default(""),
  disguise: z.string().trim().max(20_000).default(""),
};

export const characterProfileSchema = z.object(characterProfileFields).strict();
export type CharacterProfile = z.infer<typeof characterProfileSchema>;

export const characterProfilePatchSchema = z
  .object({
    desire: characterProfileFields.desire.optional(),
    fear: characterProfileFields.fear.optional(),
    goal: characterProfileFields.goal.optional(),
    voiceSample: characterProfileFields.voiceSample.optional(),
    voiceGuide: characterProfileFields.voiceGuide.optional(),
    disguise: characterProfileFields.disguise.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one character profile field is required",
  });
export type CharacterProfilePatch = z.infer<typeof characterProfilePatchSchema>;

export const characterProfileUpdateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    profile: characterProfilePatchSchema,
  })
  .strict();
export type CharacterProfileUpdateRequest = z.infer<typeof characterProfileUpdateRequestSchema>;

export const characterRelationshipTypeSchema = z.enum([
  "kinship",
  "ally",
  "enemy",
  "mentor",
  "student",
  "subordinate",
  "superior",
  "member_of",
  "located_at",
  "controls",
  "owns",
]);
export type CharacterRelationshipType = z.infer<typeof characterRelationshipTypeSchema>;

export const characterRelationshipCreateRequestSchema = z
  .object({
    target: domainRefSchema,
    relationType: characterRelationshipTypeSchema,
    validity: validityIntervalSchema,
    sourceChapterId: uuidV7Schema.nullable().default(null),
  })
  .strict();
export type CharacterRelationshipCreateRequest = z.infer<
  typeof characterRelationshipCreateRequestSchema
>;

export const characterStateKindSchema = z.enum(["body", "limb", "location", "ability", "disguise"]);
export type CharacterStateKind = z.infer<typeof characterStateKindSchema>;

export const characterStateKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "Expected a lowercase state key");

export const characterStateTransitionCreateRequestSchema = z
  .object({
    stateKind: characterStateKindSchema,
    stateKey: characterStateKeySchema,
    value: z.string().trim().min(1).max(20_000),
    target: domainRefSchema.nullable().default(null),
    validity: validityIntervalSchema,
    sourceChapterId: uuidV7Schema.nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.stateKind === "location") {
      if (input.target === null) {
        context.addIssue({
          code: "custom",
          path: ["target"],
          message: "Location transitions require a map or map node reference",
        });
      } else if (input.target.type !== "map" && input.target.type !== "map_node") {
        context.addIssue({
          code: "custom",
          path: ["target", "type"],
          message: "Location transitions must reference a map or map node",
        });
      }
      return;
    }
    if (input.target !== null) {
      context.addIssue({
        code: "custom",
        path: ["target"],
        message: "Only location transitions can carry a domain reference",
      });
    }
  });
export type CharacterStateTransitionCreateRequest = z.infer<
  typeof characterStateTransitionCreateRequestSchema
>;

export const characterKnowledgeStateKindSchema = z.enum([
  "knowledge",
  "belief",
  "suspicion",
  "misbelief",
  "unknown",
]);
export type CharacterKnowledgeStateKind = z.infer<typeof characterKnowledgeStateKindSchema>;

export const characterKnowledgeSourceKindSchema = z.enum([
  "observed",
  "told",
  "inferred",
  "read",
  "assumed",
]);
export type CharacterKnowledgeSourceKind = z.infer<typeof characterKnowledgeSourceKindSchema>;

export const characterKnowledgeStateCreateRequestSchema = z
  .object({
    objectiveFactId: uuidV7Schema,
    state: characterKnowledgeStateKindSchema,
    claimedContent: z.string().trim().max(20_000).nullable().default(null),
    sourceKind: characterKnowledgeSourceKindSchema,
    validity: validityIntervalSchema,
    sourceChapterId: uuidV7Schema.nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    const hasClaim = Boolean(input.claimedContent?.trim());
    if (input.state === "unknown" && hasClaim) {
      context.addIssue({
        code: "custom",
        path: ["claimedContent"],
        message: "Unknown knowledge states cannot carry claimed content",
      });
    }
    if (input.state !== "unknown" && !hasClaim) {
      context.addIssue({
        code: "custom",
        path: ["claimedContent"],
        message: "Known, believed, suspected and misbelieved states require content",
      });
    }
  });
export type CharacterKnowledgeStateCreateRequest = z.infer<
  typeof characterKnowledgeStateCreateRequestSchema
>;

export const characterCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    summary: z.string().trim().min(1).max(500),
    description: z.string().max(20_000).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    profile: characterProfileSchema.default({
      desire: "",
      fear: "",
      goal: "",
      voiceSample: "",
      voiceGuide: "",
      disguise: "",
    }),
  })
  .strict();
export type CharacterCreateRequest = z.infer<typeof characterCreateRequestSchema>;

export const characterRelationshipSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  sourceCharacterId: uuidV7Schema,
  target: domainRefSchema,
  relationType: characterRelationshipTypeSchema,
  validity: validityIntervalSchema,
  sourceChapterId: uuidV7Schema.nullable(),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type CharacterRelationship = z.infer<typeof characterRelationshipSchema>;
export const characterRelationshipResponseSchema = apiEnvelopeSchema(characterRelationshipSchema);

export const characterStateTransitionSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  characterId: uuidV7Schema,
  stateKind: characterStateKindSchema,
  stateKey: characterStateKeySchema,
  value: z.string(),
  target: domainRefSchema.nullable(),
  validity: validityIntervalSchema,
  sourceChapterId: uuidV7Schema.nullable(),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type CharacterStateTransition = z.infer<typeof characterStateTransitionSchema>;
export const characterStateTransitionResponseSchema = apiEnvelopeSchema(
  characterStateTransitionSchema,
);

export const characterKnowledgeStateSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  characterId: uuidV7Schema,
  objectiveFactId: uuidV7Schema,
  state: characterKnowledgeStateKindSchema,
  claimedContent: z.string().nullable(),
  sourceKind: characterKnowledgeSourceKindSchema,
  validity: validityIntervalSchema,
  sourceChapterId: uuidV7Schema.nullable(),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type CharacterKnowledgeState = z.infer<typeof characterKnowledgeStateSchema>;
export const characterKnowledgeStateResponseSchema = apiEnvelopeSchema(
  characterKnowledgeStateSchema,
);

export const characterHealthFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "blocker"]),
  message: z.string().min(1),
});
export type CharacterHealthFinding = z.infer<typeof characterHealthFindingSchema>;

export const characterDetailSchema = z.object({
  character: domainRefSchema,
  profile: characterProfileSchema,
  relationships: z.array(characterRelationshipSchema),
  stateTransitions: z.array(characterStateTransitionSchema),
  knowledgeStates: z.array(characterKnowledgeStateSchema),
  health: z.array(characterHealthFindingSchema),
  version: z.number().int().positive(),
  latestVersionNodeId: uuidV7Schema,
  status: settingStatusSchema,
  lockedAt: z.string().datetime().nullable(),
});
export type CharacterDetail = z.infer<typeof characterDetailSchema>;

export const characterDetailResponseSchema = apiEnvelopeSchema(characterDetailSchema);
export const characterListResponseSchema = apiEnvelopeSchema(z.array(characterDetailSchema));

export const characterHistoryQuerySchema = z
  .object({
    chapterNumber: z.coerce.number().int().positive().optional(),
    versionNodeId: uuidV7Schema.optional(),
  })
  .strict()
  .refine((input) => input.chapterNumber !== undefined || input.versionNodeId !== undefined, {
    message: "A chapter number or version node is required",
  });
export type CharacterHistoryQuery = z.infer<typeof characterHistoryQuerySchema>;

export const characterHistorySchema = z.object({
  character: domainRefSchema,
  at: z.object({
    chapterNumber: z.number().int().positive().nullable(),
    versionNodeId: uuidV7Schema.nullable(),
  }),
  profile: characterProfileSchema,
  relationships: z.array(characterRelationshipSchema),
  stateTransitions: z.array(characterStateTransitionSchema),
  knowledgeStates: z.array(characterKnowledgeStateSchema),
});
export type CharacterHistory = z.infer<typeof characterHistorySchema>;
export const characterHistoryResponseSchema = apiEnvelopeSchema(characterHistorySchema);

export const characterKnowledgeProjectionSchema = z.object({
  knownFacts: z.array(
    z.object({
      id: uuidV7Schema,
      subject: z.string(),
      predicate: z.string(),
      object: z.string(),
      validFromChapter: z.number().int().positive(),
      validToChapter: z.number().int().positive().nullable(),
    }),
  ),
  beliefs: z.array(
    z.object({
      objectiveFactId: uuidV7Schema,
      state: z.enum(["belief", "suspicion", "misbelief", "unknown"]),
      claimedContent: z.string().nullable(),
    }),
  ),
  hiddenFactIds: z.array(uuidV7Schema),
});
export type CharacterKnowledgeProjection = z.infer<typeof characterKnowledgeProjectionSchema>;
export const characterKnowledgeProjectionResponseSchema = apiEnvelopeSchema(
  characterKnowledgeProjectionSchema,
);

export const characterChangeRequestKindSchema = z.enum([
  "profile",
  "relationship",
  "state_transition",
  "knowledge_state",
]);
export type CharacterChangeRequestKind = z.infer<typeof characterChangeRequestKindSchema>;

const characterChangeRequestBaseShape = {
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(1_000),
  evidence: z.array(settingEvidenceSchema).min(1).max(20),
};

export const characterChangeRequestCreateRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...characterChangeRequestBaseShape,
      kind: z.literal("profile"),
      after: characterProfilePatchSchema,
    })
    .strict(),
  z
    .object({
      ...characterChangeRequestBaseShape,
      kind: z.literal("relationship"),
      after: characterRelationshipCreateRequestSchema,
    })
    .strict(),
  z
    .object({
      ...characterChangeRequestBaseShape,
      kind: z.literal("state_transition"),
      after: characterStateTransitionCreateRequestSchema,
    })
    .strict(),
  z
    .object({
      ...characterChangeRequestBaseShape,
      kind: z.literal("knowledge_state"),
      after: characterKnowledgeStateCreateRequestSchema,
    })
    .strict(),
]);
export type CharacterChangeRequestCreateRequest = z.infer<
  typeof characterChangeRequestCreateRequestSchema
>;

export const characterChangeRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "applied",
]);
export type CharacterChangeRequestStatus = z.infer<typeof characterChangeRequestStatusSchema>;

export const characterChangeRequestSchema = z.object({
  id: uuidV7Schema,
  characterId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  version: z.number().int().positive(),
  kind: characterChangeRequestKindSchema,
  title: z.string(),
  reason: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  status: characterChangeRequestStatusSchema,
  evidence: z.array(settingEvidenceSchema),
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type CharacterChangeRequest = z.infer<typeof characterChangeRequestSchema>;

export const characterChangeRequestResponseSchema = apiEnvelopeSchema(characterChangeRequestSchema);
export const characterChangeRequestListResponseSchema = apiEnvelopeSchema(
  z.array(characterChangeRequestSchema),
);

export const domainHealthFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "blocker"]),
  message: z.string().min(1),
  relatedIds: z.array(uuidV7Schema).max(20).default([]),
});
export type DomainHealthFinding = z.infer<typeof domainHealthFindingSchema>;

const worldEntityBaseShape = {
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  summary: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
};

export const factionProfileSchema = z
  .object({
    overview: z.string().trim().max(20_000).default(""),
    goals: z.string().trim().max(20_000).default(""),
    resources: z.string().trim().max(20_000).default(""),
    doctrine: z.string().trim().max(20_000).default(""),
  })
  .strict();
export type FactionProfile = z.infer<typeof factionProfileSchema>;

export const factionProfilePatchSchema = z
  .object({
    overview: z.string().trim().max(20_000).optional(),
    goals: z.string().trim().max(20_000).optional(),
    resources: z.string().trim().max(20_000).optional(),
    doctrine: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one faction profile field is required",
  });
export type FactionProfilePatch = z.infer<typeof factionProfilePatchSchema>;

export const factionProfileUpdateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    profile: factionProfilePatchSchema,
  })
  .strict();
export type FactionProfileUpdateRequest = z.infer<typeof factionProfileUpdateRequestSchema>;

export const factionCreateRequestSchema = z
  .object({
    ...worldEntityBaseShape,
    profile: factionProfileSchema.default({
      overview: "",
      goals: "",
      resources: "",
      doctrine: "",
    }),
  })
  .strict();
export type FactionCreateRequest = z.infer<typeof factionCreateRequestSchema>;

export const mapCreateRequestSchema = z
  .object({
    ...worldEntityBaseShape,
    details: z.string().trim().max(20_000).default(""),
  })
  .strict();
export type MapCreateRequest = z.infer<typeof mapCreateRequestSchema>;

export const factionRelationTypeSchema = z.enum([
  "ally",
  "enemy",
  "vassal",
  "overlord",
  "trade",
  "neutral",
]);
export type FactionRelationType = z.infer<typeof factionRelationTypeSchema>;

export const factionRelationshipCreateRequestSchema = z
  .object({
    target: domainRefSchema,
    relationType: factionRelationTypeSchema,
    validity: validityIntervalSchema,
    sourceChapterId: uuidV7Schema.nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.target.type !== "faction") {
      context.addIssue({
        code: "custom",
        path: ["target", "type"],
        message: "Faction relationships must target another faction",
      });
    }
  });
export type FactionRelationshipCreateRequest = z.infer<
  typeof factionRelationshipCreateRequestSchema
>;

export const factionRelationshipSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  sourceFactionId: uuidV7Schema,
  target: domainRefSchema,
  relationType: factionRelationTypeSchema,
  validity: validityIntervalSchema,
  sourceChapterId: uuidV7Schema.nullable(),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type FactionRelationship = z.infer<typeof factionRelationshipSchema>;
export const factionRelationshipResponseSchema = apiEnvelopeSchema(factionRelationshipSchema);

export const territoryControlLevelSchema = z.enum(["direct", "military", "influence", "contested"]);
export type TerritoryControlLevel = z.infer<typeof territoryControlLevelSchema>;

export const territoryCreateRequestSchema = z
  .object({
    node: domainRefSchema,
    controlLevel: territoryControlLevelSchema,
    validity: validityIntervalSchema,
    evidence: z.array(settingEvidenceSchema).max(20).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.node.type !== "map_node" && input.node.type !== "map") {
      context.addIssue({
        code: "custom",
        path: ["node", "type"],
        message: "Territory control must reference a map or map node",
      });
    }
  });
export type TerritoryCreateRequest = z.infer<typeof territoryCreateRequestSchema>;

export const territorySchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  factionId: uuidV7Schema,
  node: domainRefSchema,
  controlLevel: territoryControlLevelSchema,
  validity: validityIntervalSchema,
  evidence: z.array(settingEvidenceSchema),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type Territory = z.infer<typeof territorySchema>;
export const territoryResponseSchema = apiEnvelopeSchema(territorySchema);

export const mapLayerCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    parentLayerId: uuidV7Schema.nullable().default(null),
    sortOrder: z.number().int().nonnegative().default(0),
    minScale: z.number().finite().nonnegative().default(0),
    maxScale: z.number().finite().nonnegative().default(100),
    validity: validityIntervalSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.maxScale < input.minScale) {
      context.addIssue({
        code: "custom",
        path: ["maxScale"],
        message: "Map layer maximum scale cannot be below its minimum",
      });
    }
  });
export type MapLayerCreateRequest = z.infer<typeof mapLayerCreateRequestSchema>;

export const mapLayerSchema = z.object({
  id: uuidV7Schema,
  mapId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  name: z.string(),
  parentLayerId: uuidV7Schema.nullable(),
  sortOrder: z.number().int().nonnegative(),
  minScale: z.number(),
  maxScale: z.number(),
  validity: validityIntervalSchema,
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type MapLayer = z.infer<typeof mapLayerSchema>;
export const mapLayerResponseSchema = apiEnvelopeSchema(mapLayerSchema);

export const mapNodeTypeSchema = z.enum([
  "region",
  "settlement",
  "landmark",
  "passage",
  "battlefield",
  "sect",
  "dungeon",
  "other",
]);
export type MapNodeType = z.infer<typeof mapNodeTypeSchema>;

const mapCoordinateSchema = z.number().finite().min(0).max(1);

export const mapNodeCreateRequestSchema = z
  .object({
    layerId: uuidV7Schema.nullable().default(null),
    parentNodeId: uuidV7Schema.nullable().default(null),
    name: z.string().trim().min(1).max(120),
    nodeType: mapNodeTypeSchema,
    summary: z.string().trim().max(5_000).default(""),
    x: mapCoordinateSchema.nullable().default(null),
    y: mapCoordinateSchema.nullable().default(null),
    validity: validityIntervalSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.x === null) !== (input.y === null)) {
      context.addIssue({
        code: "custom",
        path: ["x"],
        message: "Map node coordinates require both x and y",
      });
    }
  });
export type MapNodeCreateRequest = z.infer<typeof mapNodeCreateRequestSchema>;

export const mapNodeSchema = z.object({
  id: uuidV7Schema,
  mapId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  layerId: uuidV7Schema.nullable(),
  parentNodeId: uuidV7Schema.nullable(),
  name: z.string(),
  nodeType: mapNodeTypeSchema,
  summary: z.string(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  validity: validityIntervalSchema,
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type MapNode = z.infer<typeof mapNodeSchema>;
export const mapNodeResponseSchema = apiEnvelopeSchema(mapNodeSchema);

export const mapRouteTypeSchema = z.enum(["road", "trail", "water", "air", "teleport", "secret"]);
export type MapRouteType = z.infer<typeof mapRouteTypeSchema>;

export const mapEdgeCreateRequestSchema = z
  .object({
    layerId: uuidV7Schema.nullable().default(null),
    fromNodeId: uuidV7Schema,
    toNodeId: uuidV7Schema,
    routeType: mapRouteTypeSchema,
    bidirectional: z.boolean().default(true),
    travelMinutes: z.number().int().positive(),
    validity: validityIntervalSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.fromNodeId === input.toNodeId) {
      context.addIssue({
        code: "custom",
        path: ["toNodeId"],
        message: "Route endpoints must differ",
      });
    }
    if (input.travelMinutes <= 0) {
      context.addIssue({
        code: "custom",
        path: ["travelMinutes"],
        message: "Travel time must be positive",
      });
    }
  });
export type MapEdgeCreateRequest = z.infer<typeof mapEdgeCreateRequestSchema>;

export const mapEdgeSchema = z.object({
  id: uuidV7Schema,
  mapId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  layerId: uuidV7Schema.nullable(),
  fromNodeId: uuidV7Schema,
  toNodeId: uuidV7Schema,
  routeType: mapRouteTypeSchema,
  bidirectional: z.boolean(),
  travelMinutes: z.number().int().positive(),
  validity: validityIntervalSchema,
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type MapEdge = z.infer<typeof mapEdgeSchema>;
export const mapEdgeResponseSchema = apiEnvelopeSchema(mapEdgeSchema);

export const mapMarkerTypeSchema = z.enum(["danger", "event", "resource", "note", "character"]);
export type MapMarkerType = z.infer<typeof mapMarkerTypeSchema>;

export const mapMarkerCreateRequestSchema = z
  .object({
    layerId: uuidV7Schema.nullable().default(null),
    nodeId: uuidV7Schema.nullable().default(null),
    label: z.string().trim().min(1).max(120),
    markerType: mapMarkerTypeSchema,
    x: mapCoordinateSchema,
    y: mapCoordinateSchema,
    validity: validityIntervalSchema,
  })
  .strict();
export type MapMarkerCreateRequest = z.infer<typeof mapMarkerCreateRequestSchema>;

export const mapMarkerSchema = z.object({
  id: uuidV7Schema,
  mapId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  layerId: uuidV7Schema.nullable(),
  nodeId: uuidV7Schema.nullable(),
  label: z.string(),
  markerType: mapMarkerTypeSchema,
  x: z.number(),
  y: z.number(),
  validity: validityIntervalSchema,
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type MapMarker = z.infer<typeof mapMarkerSchema>;
export const mapMarkerResponseSchema = apiEnvelopeSchema(mapMarkerSchema);

export const mapRouteQuerySchema = z
  .object({
    fromNodeId: uuidV7Schema,
    toNodeId: uuidV7Schema,
    chapterNumber: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type MapRouteQuery = z.infer<typeof mapRouteQuerySchema>;

export const mapRouteSchema = z.object({
  mapId: uuidV7Schema,
  fromNodeId: uuidV7Schema,
  toNodeId: uuidV7Schema,
  pathNodeIds: z.array(uuidV7Schema),
  edgeIds: z.array(uuidV7Schema),
  travelMinutes: z.number().int().nonnegative(),
});
export type MapRoute = z.infer<typeof mapRouteSchema>;
export const mapRouteResponseSchema = apiEnvelopeSchema(mapRouteSchema);

export const timelineEraCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    orderIndex: z.number().int().nonnegative(),
    startSortKey: z.number().int(),
    endSortKey: z.number().int().nullable().default(null),
    description: z.string().trim().max(20_000).default(""),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.endSortKey !== null && input.endSortKey < input.startSortKey) {
      context.addIssue({
        code: "custom",
        path: ["endSortKey"],
        message: "Timeline era end cannot precede its start",
      });
    }
  });
export type TimelineEraCreateRequest = z.infer<typeof timelineEraCreateRequestSchema>;

export const timelineEraSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  name: z.string(),
  orderIndex: z.number().int().nonnegative(),
  startSortKey: z.number().int(),
  endSortKey: z.number().int().nullable(),
  description: z.string(),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type TimelineEra = z.infer<typeof timelineEraSchema>;
export const timelineEraResponseSchema = apiEnvelopeSchema(timelineEraSchema);

export const timelineEventCreateRequestSchema = z
  .object({
    ...worldEntityBaseShape,
    era: z.string().trim().min(1).max(120),
    storyTime: storyTimePointSchema,
    durationMinutes: z.number().int().nonnegative().default(0),
    durationLabel: z.string().trim().max(200).default(""),
    event: z.string().trim().min(1).max(20_000),
    validity: validityIntervalSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.storyTime.era !== input.era) {
      context.addIssue({
        code: "custom",
        path: ["storyTime", "era"],
        message: "Timeline event era must match its story time era",
      });
    }
  });
export type TimelineEventCreateRequest = z.infer<typeof timelineEventCreateRequestSchema>;

export const timelineEventDetailSchema = z.object({
  event: domainRefSchema,
  era: z.string(),
  storyTime: storyTimePointSchema,
  durationMinutes: z.number().int().nonnegative(),
  durationLabel: z.string(),
  eventText: z.string(),
  validity: validityIntervalSchema,
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type TimelineEventDetail = z.infer<typeof timelineEventDetailSchema>;
export const timelineEventResponseSchema = apiEnvelopeSchema(timelineEventDetailSchema);

export const characterItineraryCreateRequestSchema = z
  .object({
    character: domainRefSchema,
    fromNode: domainRefSchema,
    toNode: domainRefSchema,
    departure: storyTimePointSchema,
    arrival: storyTimePointSchema,
    travelMinutes: z.number().int().positive(),
    validity: validityIntervalSchema,
    sourceChapterId: uuidV7Schema.nullable().default(null),
    evidence: z.array(settingEvidenceSchema).max(20).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.character.type !== "character") {
      context.addIssue({
        code: "custom",
        path: ["character", "type"],
        message: "Itineraries must reference a character",
      });
    }
    if (input.fromNode.type !== "map_node" || input.toNode.type !== "map_node") {
      context.addIssue({
        code: "custom",
        path: ["fromNode", "type"],
        message: "Itineraries must reference map nodes",
      });
    }
    if (
      input.departure.era === input.arrival.era &&
      input.arrival.sortKey <= input.departure.sortKey
    ) {
      context.addIssue({
        code: "custom",
        path: ["arrival"],
        message: "Itinerary arrival must follow departure",
      });
    }
  });
export type CharacterItineraryCreateRequest = z.infer<typeof characterItineraryCreateRequestSchema>;

export const characterItinerarySchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  character: domainRefSchema,
  fromNode: domainRefSchema,
  toNode: domainRefSchema,
  departure: storyTimePointSchema,
  arrival: storyTimePointSchema,
  routeTravelMinutes: z.number().int().positive(),
  travelMinutes: z.number().int().positive(),
  validity: validityIntervalSchema,
  sourceChapterId: uuidV7Schema.nullable(),
  evidence: z.array(settingEvidenceSchema),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type CharacterItinerary = z.infer<typeof characterItinerarySchema>;
export const characterItineraryResponseSchema = apiEnvelopeSchema(characterItinerarySchema);

export const factionDetailSchema = z.object({
  faction: domainRefSchema,
  profile: factionProfileSchema,
  relationships: z.array(factionRelationshipSchema),
  territories: z.array(territorySchema),
  health: z.array(domainHealthFindingSchema),
  version: z.number().int().positive(),
  latestVersionNodeId: uuidV7Schema,
  status: settingStatusSchema,
  lockedAt: z.string().datetime().nullable(),
});
export type FactionDetail = z.infer<typeof factionDetailSchema>;
export const factionDetailResponseSchema = apiEnvelopeSchema(factionDetailSchema);
export const factionListResponseSchema = apiEnvelopeSchema(z.array(factionDetailSchema));

export const mapDetailSchema = z.object({
  map: domainRefSchema,
  layers: z.array(mapLayerSchema),
  nodes: z.array(mapNodeSchema),
  edges: z.array(mapEdgeSchema),
  markers: z.array(mapMarkerSchema),
  controlAreas: z.array(territorySchema),
  health: z.array(domainHealthFindingSchema),
  version: z.number().int().positive(),
  latestVersionNodeId: uuidV7Schema,
  status: settingStatusSchema,
  lockedAt: z.string().datetime().nullable(),
});
export type MapDetail = z.infer<typeof mapDetailSchema>;
export const mapDetailResponseSchema = apiEnvelopeSchema(mapDetailSchema);
export const mapListResponseSchema = apiEnvelopeSchema(z.array(mapDetailSchema));

export const worldTimelineSchema = z.object({
  eras: z.array(timelineEraSchema),
  events: z.array(timelineEventDetailSchema),
  itineraries: z.array(characterItinerarySchema),
  health: z.array(domainHealthFindingSchema),
  latestVersionNodeId: uuidV7Schema,
});
export type WorldTimeline = z.infer<typeof worldTimelineSchema>;
export const worldTimelineResponseSchema = apiEnvelopeSchema(worldTimelineSchema);

export const powerLifespanModeSchema = z.enum(["none", "realm", "fixed", "custom"]);
export type PowerLifespanMode = z.infer<typeof powerLifespanModeSchema>;

export const powerLifespanPolicySchema = z
  .object({
    mode: powerLifespanModeSchema.default("none"),
    unit: z.string().trim().min(1).max(40).default("年"),
    basis: z.string().trim().max(200).default(""),
    description: z.string().trim().max(2_000).default(""),
    pathId: uuidV7Schema.nullable().default(null),
    fixedAmount: z.number().int().positive().max(1_000_000).nullable().default(null),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "fixed" && policy.fixedAmount === null) {
      context.addIssue({
        code: "custom",
        path: ["fixedAmount"],
        message: "Fixed lifespan policies require an amount",
      });
    }
    if (policy.mode !== "fixed" && policy.fixedAmount !== null) {
      context.addIssue({
        code: "custom",
        path: ["fixedAmount"],
        message: "Only fixed lifespan policies carry a fixed amount",
      });
    }
    if (policy.mode === "custom" && policy.description.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Custom lifespan policies require a rule description",
      });
    }
  });
export type PowerLifespanPolicy = z.infer<typeof powerLifespanPolicySchema>;

export const powerRealmCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    rank: z.number().int().positive().max(1_000),
    description: z.string().trim().max(20_000).default(""),
    breakthroughConditions: z.string().trim().min(1).max(20_000),
    breakthroughCosts: z.string().trim().max(20_000).default(""),
    bottlenecks: z.string().trim().max(20_000).default(""),
    counters: z.string().trim().max(20_000).default(""),
    counteredBy: z.string().trim().max(20_000).default(""),
    lifespanAmount: z.number().int().positive().max(1_000_000).nullable().default(null),
    prerequisiteRealmId: uuidV7Schema.nullable().default(null),
  })
  .strict();
export type PowerRealmCreateRequest = z.infer<typeof powerRealmCreateRequestSchema>;

export const powerRealmSchema = z.object({
  id: uuidV7Schema,
  pathId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  ...powerRealmCreateRequestSchema.shape,
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type PowerRealm = z.infer<typeof powerRealmSchema>;
export const powerRealmResponseSchema = apiEnvelopeSchema(powerRealmSchema);

export const powerPathCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    pathType: z.string().trim().min(1).max(80),
    description: z.string().trim().max(20_000).default(""),
    sortOrder: z.number().int().nonnegative().max(10_000).default(0),
    realms: z.array(powerRealmCreateRequestSchema).max(100).default([]),
  })
  .strict()
  .superRefine((path, context) => {
    const names = path.realms.map((realm) => realm.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["realms"],
        message: "Realm names must be unique within a path",
      });
    }
    const ranks = path.realms.map((realm) => realm.rank);
    if (new Set(ranks).size !== ranks.length) {
      context.addIssue({
        code: "custom",
        path: ["realms"],
        message: "Realm ranks must be unique within a path",
      });
    }
  });
export type PowerPathCreateRequest = z.infer<typeof powerPathCreateRequestSchema>;

export const powerPathSchema = z.object({
  id: uuidV7Schema,
  powerSystemId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  name: z.string(),
  pathType: z.string(),
  description: z.string(),
  sortOrder: z.number().int().nonnegative(),
  realms: z.array(powerRealmSchema),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type PowerPath = z.infer<typeof powerPathSchema>;
export const powerPathResponseSchema = apiEnvelopeSchema(powerPathSchema);

export const powerSystemCreateRequestSchema = z
  .object({
    ...worldEntityBaseShape,
    overview: z.string().trim().max(20_000).default(""),
    lifespanPolicy: powerLifespanPolicySchema.default({
      mode: "none",
      unit: "年",
      basis: "",
      description: "",
      pathId: null,
      fixedAmount: null,
    }),
    paths: z.array(powerPathCreateRequestSchema).max(50).default([]),
  })
  .strict()
  .superRefine((system, context) => {
    const names = system.paths.map((path) => path.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["paths"],
        message: "Power path names must be unique within a system",
      });
    }
  });
export type PowerSystemCreateRequest = z.infer<typeof powerSystemCreateRequestSchema>;

export const powerSystemPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(20_000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    overview: z.string().trim().max(20_000).optional(),
    lifespanPolicy: powerLifespanPolicySchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, {
    message: "At least one power system field is required",
  });
export type PowerSystemPatchRequest = z.infer<typeof powerSystemPatchRequestSchema>;

export const powerSystemSchema = z.object({
  powerSystem: domainRefSchema,
  overview: z.string(),
  lifespanPolicy: powerLifespanPolicySchema,
  paths: z.array(powerPathSchema),
  health: z.array(domainHealthFindingSchema),
  version: z.number().int().positive(),
  latestVersionNodeId: uuidV7Schema,
  status: settingStatusSchema,
  lockedAt: z.string().datetime().nullable(),
});
export type PowerSystem = z.infer<typeof powerSystemSchema>;
export const powerSystemResponseSchema = apiEnvelopeSchema(powerSystemSchema);
export const powerSystemListResponseSchema = apiEnvelopeSchema(z.array(powerSystemSchema));

export const mechanismOwnerRefSchema = domainRefSchema.refine(
  (owner) => owner.type === "character" || owner.type === "faction" || owner.type === "item",
  { message: "Mechanism owners must be a character, faction or item" },
);
export type MechanismOwnerRef = z.infer<typeof mechanismOwnerRefSchema>;

export const powerSystemRefSchema = domainRefSchema.refine(
  (reference) => reference.type === "power_system",
  { message: "Mechanism power systems must reference a power system" },
);
export type PowerSystemRef = z.infer<typeof powerSystemRefSchema>;

export const specialMechanismCreateRequestSchema = z
  .object({
    ...worldEntityBaseShape,
    mechanismType: z.string().trim().min(1).max(120),
    owner: mechanismOwnerRefSchema.nullable().default(null),
    powerSystem: powerSystemRefSchema.nullable().default(null),
    rules: z.string().trim().min(1).max(20_000),
    costs: z.string().trim().max(20_000).default(""),
    limits: z.string().trim().max(20_000).default(""),
    growth: z.string().trim().max(20_000).default(""),
  })
  .strict();
export type SpecialMechanismCreateRequest = z.infer<typeof specialMechanismCreateRequestSchema>;

export const specialMechanismPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(20_000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    mechanismType: z.string().trim().min(1).max(120).optional(),
    powerSystem: powerSystemRefSchema.nullable().optional(),
    rules: z.string().trim().min(1).max(20_000).optional(),
    costs: z.string().trim().max(20_000).optional(),
    limits: z.string().trim().max(20_000).optional(),
    growth: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, {
    message: "At least one mechanism field is required",
  });
export type SpecialMechanismPatchRequest = z.infer<typeof specialMechanismPatchRequestSchema>;

export const specialMechanismOwnershipTransferRequestSchema = z
  .object({
    version: z.number().int().positive(),
    owner: mechanismOwnerRefSchema,
    reason: z.string().trim().min(1).max(1_000),
    validity: validityIntervalSchema,
    evidence: z.array(settingEvidenceSchema).min(1).max(20),
  })
  .strict();
export type SpecialMechanismOwnershipTransferRequest = z.infer<
  typeof specialMechanismOwnershipTransferRequestSchema
>;

export const specialMechanismOwnershipRecordSchema = z.object({
  id: uuidV7Schema,
  mechanismId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  previousOwner: domainRefSchema.nullable(),
  owner: domainRefSchema,
  reason: z.string(),
  validity: validityIntervalSchema,
  evidence: z.array(settingEvidenceSchema),
  versionNodeId: uuidV7Schema,
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type SpecialMechanismOwnershipRecord = z.infer<typeof specialMechanismOwnershipRecordSchema>;

export const specialMechanismSchema = z.object({
  mechanism: domainRefSchema,
  mechanismType: z.string(),
  owner: domainRefSchema.nullable(),
  powerSystem: domainRefSchema.nullable(),
  rules: z.string(),
  costs: z.string(),
  limits: z.string(),
  growth: z.string(),
  ownershipHistory: z.array(specialMechanismOwnershipRecordSchema),
  health: z.array(domainHealthFindingSchema),
  version: z.number().int().positive(),
  latestVersionNodeId: uuidV7Schema,
  status: settingStatusSchema,
  lockedAt: z.string().datetime().nullable(),
});
export type SpecialMechanism = z.infer<typeof specialMechanismSchema>;
export const specialMechanismResponseSchema = apiEnvelopeSchema(specialMechanismSchema);
export const specialMechanismListResponseSchema = apiEnvelopeSchema(
  z.array(specialMechanismSchema),
);

export const itemKindSchema = z.enum(["item", "technique", "equipment", "resource"]);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemOwnershipModelSchema = z.enum(["shared", "unique"]);
export type ItemOwnershipModel = z.infer<typeof itemOwnershipModelSchema>;

export const itemCreateRequestSchema = z
  .object({
    ...worldEntityBaseShape,
    kind: itemKindSchema,
    category: z.string().trim().min(1).max(200),
    grade: z.string().trim().max(200).default(""),
    effect: z.string().trim().min(1).max(20_000),
    cost: z.string().trim().max(20_000).default(""),
    limits: z.string().trim().max(20_000).default(""),
    ownershipModel: itemOwnershipModelSchema,
    consumable: z.boolean().default(false),
    quantity: z.number().int().min(1).max(1_000_000).default(1),
    equipmentSlot: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.kind === "equipment" && item.equipmentSlot === null) {
      context.addIssue({
        code: "custom",
        path: ["equipmentSlot"],
        message: "Equipment requires an equipment slot",
      });
    }
    if (item.kind !== "equipment" && item.equipmentSlot !== null) {
      context.addIssue({
        code: "custom",
        path: ["equipmentSlot"],
        message: "Only equipment can define an equipment slot",
      });
    }
    if (item.ownershipModel === "unique" && item.quantity !== 1) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Unique items start with exactly one instance",
      });
    }
  });
export type ItemCreateRequest = z.infer<typeof itemCreateRequestSchema>;

export const itemPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    aliases: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(20_000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    kind: itemKindSchema.optional(),
    category: z.string().trim().min(1).max(200).optional(),
    grade: z.string().trim().max(200).optional(),
    effect: z.string().trim().min(1).max(20_000).optional(),
    cost: z.string().trim().max(20_000).optional(),
    limits: z.string().trim().max(20_000).optional(),
    ownershipModel: itemOwnershipModelSchema.optional(),
    consumable: z.boolean().optional(),
    equipmentSlot: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 1, {
    message: "At least one item field is required",
  });
export type ItemPatchRequest = z.infer<typeof itemPatchRequestSchema>;

export const itemRightTypeSchema = z.enum([
  "ownership",
  "custody",
  "location",
  "usage",
  "disposal",
]);
export type ItemRightType = z.infer<typeof itemRightTypeSchema>;

export const itemRightHolderSchema = domainRefSchema.refine(
  (holder) =>
    holder.type === "character" ||
    holder.type === "faction" ||
    holder.type === "item" ||
    holder.type === "map" ||
    holder.type === "map_node",
  { message: "Item rights must reference a character, faction, item or map location" },
);
export type ItemRightHolder = z.infer<typeof itemRightHolderSchema>;

export const itemRightGrantRequestSchema = z
  .object({
    rightType: itemRightTypeSchema,
    holder: itemRightHolderSchema,
    sharePercent: z.number().min(0.01).max(100).nullable().default(null),
    validity: validityIntervalSchema,
    sourceChapterId: uuidV7Schema.nullable().default(null),
    evidence: z.array(settingEvidenceSchema).max(20).default([]),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((right, context) => {
    if (right.rightType === "location") {
      if (right.holder.type !== "map" && right.holder.type !== "map_node") {
        context.addIssue({
          code: "custom",
          path: ["holder", "type"],
          message: "Location rights must reference a map or map node",
        });
      }
      if (right.sharePercent !== null) {
        context.addIssue({
          code: "custom",
          path: ["sharePercent"],
          message: "Location rights cannot carry an ownership share",
        });
      }
      return;
    }
    if (
      right.holder.type !== "character" &&
      right.holder.type !== "faction" &&
      right.holder.type !== "item"
    ) {
      context.addIssue({
        code: "custom",
        path: ["holder", "type"],
        message: "This right type must reference a character, faction or item",
      });
    }
    if (right.rightType === "ownership" && right.sharePercent === null) {
      context.addIssue({
        code: "custom",
        path: ["sharePercent"],
        message: "Ownership rights require a share percentage",
      });
    }
    if (right.rightType !== "ownership" && right.sharePercent !== null) {
      context.addIssue({
        code: "custom",
        path: ["sharePercent"],
        message: "Only ownership rights carry a share percentage",
      });
    }
  });
export type ItemRightGrantRequest = z.infer<typeof itemRightGrantRequestSchema>;

export const itemRightSchema = z.object({
  id: uuidV7Schema,
  itemId: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  rightType: itemRightTypeSchema,
  holder: domainRefSchema,
  sharePercent: z.number().nullable(),
  validity: validityIntervalSchema,
  sourceChapterId: uuidV7Schema.nullable(),
  evidence: z.array(settingEvidenceSchema),
  reason: z.string(),
  versionNodeId: uuidV7Schema,
  createdBy: uuidV7Schema,
  createdAt: z.string().datetime(),
});
export type ItemRight = z.infer<typeof itemRightSchema>;
export const itemRightResponseSchema = apiEnvelopeSchema(itemRightSchema);

export const itemConsumeRequestSchema = z
  .object({
    version: z.number().int().positive(),
    quantity: z.number().int().positive().max(1_000_000),
    reason: z.string().trim().min(1).max(1_000),
    evidence: z.array(settingEvidenceSchema).max(20).default([]),
  })
  .strict();
export type ItemConsumeRequest = z.infer<typeof itemConsumeRequestSchema>;

export const itemEquipRequestSchema = z
  .object({
    version: z.number().int().positive(),
    holder: domainRefSchema.refine(
      (holder) => holder.type === "character" || holder.type === "faction",
      { message: "Equipment can only be held by a character or faction" },
    ),
    reason: z.string().trim().min(1).max(1_000),
    evidence: z.array(settingEvidenceSchema).max(20).default([]),
  })
  .strict();
export type ItemEquipRequest = z.infer<typeof itemEquipRequestSchema>;

export const itemSchema = z.object({
  item: domainRefSchema,
  kind: itemKindSchema,
  category: z.string(),
  grade: z.string(),
  effect: z.string(),
  cost: z.string(),
  limits: z.string(),
  ownershipModel: itemOwnershipModelSchema,
  consumable: z.boolean(),
  quantity: z.number().int().nonnegative(),
  equipmentSlot: z.string().nullable(),
  equippedBy: domainRefSchema.nullable(),
  rights: z.array(itemRightSchema),
  health: z.array(domainHealthFindingSchema),
  version: z.number().int().positive(),
  latestVersionNodeId: uuidV7Schema,
  status: settingStatusSchema,
  lockedAt: z.string().datetime().nullable(),
});
export type ItemDomain = z.infer<typeof itemSchema>;
export const itemResponseSchema = apiEnvelopeSchema(itemSchema);
export const itemListResponseSchema = apiEnvelopeSchema(z.array(itemSchema));

export const powerSystemChangePatchSchema = z
  .object({
    overview: z.string().trim().max(20_000).optional(),
    lifespanPolicy: powerLifespanPolicySchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one power system change is required",
  });
export type PowerSystemChangePatch = z.infer<typeof powerSystemChangePatchSchema>;

export const mechanismChangePatchSchema = z
  .object({
    mechanismType: z.string().trim().min(1).max(120).optional(),
    powerSystem: powerSystemRefSchema.nullable().optional(),
    rules: z.string().trim().min(1).max(20_000).optional(),
    costs: z.string().trim().max(20_000).optional(),
    limits: z.string().trim().max(20_000).optional(),
    growth: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one mechanism change is required",
  });
export type MechanismChangePatch = z.infer<typeof mechanismChangePatchSchema>;

export const itemChangePatchSchema = z
  .object({
    kind: itemKindSchema.optional(),
    category: z.string().trim().min(1).max(200).optional(),
    grade: z.string().trim().max(200).optional(),
    effect: z.string().trim().min(1).max(20_000).optional(),
    cost: z.string().trim().max(20_000).optional(),
    limits: z.string().trim().max(20_000).optional(),
    ownershipModel: itemOwnershipModelSchema.optional(),
    consumable: z.boolean().optional(),
    equipmentSlot: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one item change is required",
  });
export type ItemChangePatch = z.infer<typeof itemChangePatchSchema>;

export const worldSnapshotQuerySchema = z
  .object({
    versionNodeId: uuidV7Schema.optional(),
    chapterNumber: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type WorldSnapshotQuery = z.infer<typeof worldSnapshotQuerySchema>;

export const worldSnapshotSchema = z.object({
  at: z.object({
    versionNodeId: uuidV7Schema.nullable(),
    chapterNumber: z.number().int().positive().nullable(),
  }),
  factions: z.array(factionDetailSchema),
  maps: z.array(mapDetailSchema),
  timeline: worldTimelineSchema,
  powerSystems: z.array(powerSystemSchema),
  mechanisms: z.array(specialMechanismSchema),
  items: z.array(itemSchema),
});
export type WorldSnapshot = z.infer<typeof worldSnapshotSchema>;
export const worldSnapshotResponseSchema = apiEnvelopeSchema(worldSnapshotSchema);

function validateCustomFieldDefinitionShape(
  input: Pick<CustomFieldDefinitionCreateRequest, "fieldType" | "options" | "relationTarget">,
  context: z.RefinementCtx,
): void {
  const selectField = input.fieldType === "single_select" || input.fieldType === "multi_select";
  if (selectField && input.options.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Select fields require at least one option",
    });
  }
  if (!selectField && input.options.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Only select fields can define options",
    });
  }
  if (new Set(input.options).size !== input.options.length) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "Select field options must be unique",
    });
  }
  if (input.fieldType === "relation_ref" && input.relationTarget === null) {
    context.addIssue({
      code: "custom",
      path: ["relationTarget"],
      message: "Relation fields require a target type",
    });
  }
  if (input.fieldType !== "relation_ref" && input.relationTarget !== null) {
    context.addIssue({
      code: "custom",
      path: ["relationTarget"],
      message: "Only relation fields can define a target type",
    });
  }
}

export const confirmedSettingSchema = z
  .object({
    kind: z.enum(["setting", "fact"]).optional(),
    id: uuidV7Schema,
    type: settingEntityTypeSchema,
    name: z.string(),
    summary: z.string(),
    source: settingSourceSchema,
    status: z.literal("locked"),
    version: z.number().int().positive(),
    lockedAt: z.string().datetime(),
    sourceChapterId: uuidV7Schema.optional(),
    sourceFactId: uuidV7Schema.optional(),
    validFromChapter: z.number().int().positive().optional(),
    validToChapter: z.number().int().positive().nullable().optional(),
    predicate: z.string().optional(),
    object: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.kind !== "fact") {
      return;
    }
    const requiredFactFields = [
      ["sourceChapterId", value.sourceChapterId],
      ["validFromChapter", value.validFromChapter],
      ["validToChapter", value.validToChapter],
      ["predicate", value.predicate],
      ["object", value.object],
    ] as const;
    for (const [field, fieldValue] of requiredFactFields) {
      if (fieldValue === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for confirmed facts`,
        });
      }
    }
  });
export type ConfirmedSetting = z.infer<typeof confirmedSettingSchema>;

export const confirmedSettingListResponseSchema = apiEnvelopeSchema(
  z.array(confirmedSettingSchema),
);

export const chapterStatusSchema = z.enum([
  "planned",
  "writing",
  "waiting_review",
  "changes_requested",
  "approved",
  "locked",
  "published",
  "rejected",
]);
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;

export const chapterSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  number: z.number().int().positive(),
  title: z.string(),
  status: chapterStatusSchema,
  version: z.number().int().positive(),
  wordCount: z.number().int().nonnegative(),
  currentVersionId: uuidV7Schema,
});
export type Chapter = z.infer<typeof chapterSchema>;

export const chapterBriefSchema = z
  .object({
    goal: z.string().trim().min(1).max(5_000),
    pov: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200),
    sceneBeats: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
    requiredFacts: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
  })
  .strict();
export type ChapterBrief = z.infer<typeof chapterBriefSchema>;

export const chapterReadinessItemSchema = z.object({
  key: z.enum(["story_bible", "settings", "brief"]),
  label: z.string().min(1),
  ready: z.boolean(),
  missing: z.array(z.string().min(1)),
});
export type ChapterReadinessItem = z.infer<typeof chapterReadinessItemSchema>;

export const chapterReadinessSchema = z.object({
  status: z.enum(["not_ready", "partial", "ready"]),
  completed: z.number().int().min(0).max(3),
  total: z.literal(3),
  canStartWriting: z.boolean(),
  items: z.array(chapterReadinessItemSchema).length(3),
});
export type ChapterReadiness = z.infer<typeof chapterReadinessSchema>;

export const chapterVersionSchema = z.object({
  id: uuidV7Schema,
  chapterId: uuidV7Schema,
  version: z.number().int().positive(),
  content: z.string(),
  contentHash: z.string().min(1),
  versionNodeId: uuidV7Schema,
  parentNodeId: uuidV7Schema.nullable(),
  createdAt: z.string().datetime(),
});
export type ChapterVersion = z.infer<typeof chapterVersionSchema>;

export const chapterWorkspaceSchema = chapterSchema.omit({ currentVersionId: true }).extend({
  currentVersionId: uuidV7Schema.nullable(),
  currentVersion: chapterVersionSchema.nullable(),
  brief: chapterBriefSchema.nullable(),
  readiness: chapterReadinessSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChapterWorkspace = z.infer<typeof chapterWorkspaceSchema>;

export const chapterCreateRequestSchema = z
  .object({
    number: z.number().int().positive().max(10_000),
    title: z.string().trim().min(1).max(200),
    brief: chapterBriefSchema,
  })
  .strict();
export type ChapterCreateRequest = z.infer<typeof chapterCreateRequestSchema>;

export const chapterPatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    brief: chapterBriefSchema.optional(),
  })
  .strict()
  .refine((input) => input.title !== undefined || input.brief !== undefined, {
    message: "At least one chapter field is required",
  });
export type ChapterPatchRequest = z.infer<typeof chapterPatchRequestSchema>;

export const chapterVersionCreateRequestSchema = z
  .object({
    version: z.number().int().positive(),
    content: z
      .string()
      .min(1)
      .max(200_000)
      .refine((content) => content.trim().length > 0, "Chapter content cannot be blank"),
  })
  .strict();
export type ChapterVersionCreateRequest = z.infer<typeof chapterVersionCreateRequestSchema>;

export const chapterWorkspaceListResponseSchema = apiEnvelopeSchema(
  z.array(chapterWorkspaceSchema),
);
export const chapterWorkspaceResponseSchema = apiEnvelopeSchema(chapterWorkspaceSchema);
export const chapterReadinessResponseSchema = apiEnvelopeSchema(chapterReadinessSchema);
export const chapterVersionListResponseSchema = apiEnvelopeSchema(z.array(chapterVersionSchema));
export const chapterVersionSaveDataSchema = z.object({
  chapter: chapterWorkspaceSchema,
  version: chapterVersionSchema,
});
export type ChapterVersionSaveData = z.infer<typeof chapterVersionSaveDataSchema>;
export const chapterVersionSaveResponseSchema = apiEnvelopeSchema(chapterVersionSaveDataSchema);

export const chapterReviewActionSchema = z.enum(["approve", "reject"]);
export type ChapterReviewAction = z.infer<typeof chapterReviewActionSchema>;

export const chapterReviewRequestSchema = z.object({
  action: chapterReviewActionSchema,
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1_000).optional(),
});
export type ChapterReviewRequest = z.infer<typeof chapterReviewRequestSchema>;

export const chapterReviewDecisionSchema = z.object({
  id: uuidV7Schema,
  chapterId: uuidV7Schema,
  action: chapterReviewActionSchema,
  actorId: uuidV7Schema,
  actorName: z.string().min(1),
  reason: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type ChapterReviewDecision = z.infer<typeof chapterReviewDecisionSchema>;

export const chapterReviewDataSchema = z.object({
  chapter: chapterWorkspaceSchema,
  decision: chapterReviewDecisionSchema,
});
export type ChapterReviewData = z.infer<typeof chapterReviewDataSchema>;
export const chapterReviewResponseSchema = apiEnvelopeSchema(chapterReviewDataSchema);

export const outlineLevelSchema = z.enum(["book", "volume", "act", "chapter", "scene"]);
export type OutlineLevel = z.infer<typeof outlineLevelSchema>;

export const outlineNodeStatusSchema = z.enum(["planned", "active", "done"]);
export type OutlineNodeStatus = z.infer<typeof outlineNodeStatusSchema>;

export const outlineChapterRefSchema = z
  .object({
    id: uuidV7Schema,
    number: z.number().int().positive(),
    title: z.string().min(1).max(200),
    status: chapterStatusSchema,
    version: z.number().int().positive(),
    wordCount: z.number().int().nonnegative(),
    brief: chapterBriefSchema.nullable().default(null),
  })
  .strict();
export type OutlineChapterRef = z.infer<typeof outlineChapterRefSchema>;

export const outlineNodeSchema = z
  .object({
    id: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    level: outlineLevelSchema,
    parentId: uuidV7Schema.nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(2_000),
    status: outlineNodeStatusSchema,
    locked: z.boolean(),
    version: z.number().int().positive(),
    chapter: outlineChapterRefSchema.nullable(),
    tension: z.number().int().min(0).max(100).nullable(),
    versionNodeId: uuidV7Schema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type OutlineNode = z.infer<typeof outlineNodeSchema>;

export const volumePlotLineSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    status: z.enum(["planned", "active", "resolved", "dropped"]),
    note: z.string().max(500),
  })
  .strict();
export type VolumePlotLine = z.infer<typeof volumePlotLineSchema>;

export const volumeContractSchema = z
  .object({
    id: uuidV7Schema,
    nodeId: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    objective: z.string().trim().min(1).max(2_000),
    conflict: z.string().trim().min(1).max(2_000),
    turningPoints: z.array(z.string().trim().min(1).max(500)).max(30),
    exitConditions: z.array(z.string().trim().min(1).max(500)).max(30),
    plotLines: z.array(volumePlotLineSchema).max(30),
    version: z.number().int().positive(),
    versionNodeId: uuidV7Schema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type VolumeContract = z.infer<typeof volumeContractSchema>;

export const sceneBeatSchema = z
  .object({
    id: uuidV7Schema,
    order: z.number().int().positive(),
    description: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type SceneBeat = z.infer<typeof sceneBeatSchema>;

export const sceneInformationReleaseSchema = z
  .object({
    id: uuidV7Schema,
    order: z.number().int().positive(),
    description: z.string().trim().min(1).max(500),
    constraint: z.string().max(1_000).nullable(),
  })
  .strict();
export type SceneInformationRelease = z.infer<typeof sceneInformationReleaseSchema>;

export const sceneCardSchema = z
  .object({
    id: uuidV7Schema,
    nodeId: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    title: z.string().trim().min(1).max(200),
    pov: domainRefSchema.nullable(),
    location: domainRefSchema.nullable(),
    storyTime: storyTimePointSchema.nullable(),
    beats: z.array(sceneBeatSchema).max(50),
    informationReleases: z.array(sceneInformationReleaseSchema).max(50),
    tension: z.number().int().min(0).max(100).nullable(),
    version: z.number().int().positive(),
    versionNodeId: uuidV7Schema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SceneCard = z.infer<typeof sceneCardSchema>;

export const outlineReadinessItemSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    severity: z.enum(["blocker", "warning"]),
    ready: z.boolean(),
    resourceType: z.enum(["outline_branch", "outline_node"]),
    resourceId: uuidV7Schema.nullable(),
    remediation: z.string().min(1),
  })
  .strict();
export type OutlineReadinessItem = z.infer<typeof outlineReadinessItemSchema>;

export const outlineReadinessSchema = z
  .object({
    ruleVersion: z.literal("outline-readiness-v1"),
    status: z.enum(["not_ready", "partial", "ready"]),
    canProceed: z.boolean(),
    completed: z.number().int().min(0),
    total: z.number().int().min(0),
    items: z.array(outlineReadinessItemSchema),
  })
  .strict();
export type OutlineReadiness = z.infer<typeof outlineReadinessSchema>;

export const outlineReplanIssueSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    nodeId: uuidV7Schema.nullable(),
  })
  .strict();
export type OutlineReplanIssue = z.infer<typeof outlineReplanIssueSchema>;

export const outlineReplanResultSchema = z
  .object({
    ruleVersion: z.literal("outline-replan-v1"),
    nodeId: uuidV7Schema,
    canApply: z.boolean(),
    impacted: z
      .object({
        nodeIds: z.array(uuidV7Schema),
        chapterIds: z.array(uuidV7Schema),
        sceneNodeIds: z.array(uuidV7Schema),
        lockedNodeIds: z.array(uuidV7Schema),
      })
      .strict(),
    blockers: z.array(outlineReplanIssueSchema),
    warnings: z.array(outlineReplanIssueSchema),
  })
  .strict();
export type OutlineReplanResult = z.infer<typeof outlineReplanResultSchema>;

export const outlineStatsSchema = z
  .object({
    totalNodes: z.number().int().min(0),
    chapterCount: z.number().int().min(0),
    plannedChapters: z.number().int().min(0),
    activeChapters: z.number().int().min(0),
    lockedChapters: z.number().int().min(0),
    wordCount: z.number().int().min(0),
    tensionPoints: z.number().int().min(0),
  })
  .strict();
export type OutlineStats = z.infer<typeof outlineStatsSchema>;

export const outlineWorkspaceSchema = z
  .object({
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    nodes: z.array(outlineNodeSchema),
    volumeContracts: z.array(volumeContractSchema),
    sceneCards: z.array(sceneCardSchema),
    readiness: outlineReadinessSchema,
    stats: outlineStatsSchema,
  })
  .strict();
export type OutlineWorkspace = z.infer<typeof outlineWorkspaceSchema>;

export const outlineSceneCardWriteRequestSchema = z
  .object({
    version: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(200),
    pov: domainRefSchema.nullable().default(null),
    location: domainRefSchema.nullable().default(null),
    storyTime: storyTimePointSchema.nullable().default(null),
    beats: z.array(z.object({ description: z.string().trim().min(1).max(1_000) }).strict()).max(50),
    informationReleases: z
      .array(
        z
          .object({
            description: z.string().trim().min(1).max(500),
            constraint: z.string().max(1_000).nullable().default(null),
          })
          .strict(),
      )
      .max(50),
    tension: z.number().int().min(0).max(100).nullable().default(null),
  })
  .strict();
export type OutlineSceneCardWriteRequest = z.infer<typeof outlineSceneCardWriteRequestSchema>;

export const outlineNodeCreateRequestSchema = z
  .object({
    level: outlineLevelSchema,
    parentId: uuidV7Schema.nullable(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(2_000).default(""),
    status: outlineNodeStatusSchema.default("planned"),
    tension: z.number().int().min(0).max(100).nullable().default(null),
    chapterId: uuidV7Schema.optional(),
    chapterCreate: chapterCreateRequestSchema.optional(),
    sceneCard: outlineSceneCardWriteRequestSchema.omit({ version: true }).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.level === "chapter") {
      if (Boolean(input.chapterId) === Boolean(input.chapterCreate)) {
        context.addIssue({
          code: "custom",
          path: ["chapterId"],
          message: "Chapter nodes require exactly one existing chapter or a new chapter",
        });
      }
    } else if (input.chapterId || input.chapterCreate) {
      context.addIssue({
        code: "custom",
        path: ["chapterId"],
        message: "Only chapter nodes can reference a chapter",
      });
    }
    if (input.sceneCard && input.level !== "scene") {
      context.addIssue({
        code: "custom",
        path: ["sceneCard"],
        message: "Only scene nodes can carry a scene card",
      });
    }
    if (!input.title && !input.sceneCard?.title && input.level !== "chapter") {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "Title is required for non-chapter nodes",
      });
    }
  });
export type OutlineNodeCreateRequest = z.infer<typeof outlineNodeCreateRequestSchema>;

export const outlineNodePatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(2_000).optional(),
    status: outlineNodeStatusSchema.optional(),
    tension: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.summary !== undefined ||
      input.status !== undefined ||
      input.tension !== undefined,
    { message: "At least one outline node field is required" },
  );
export type OutlineNodePatchRequest = z.infer<typeof outlineNodePatchRequestSchema>;

export const outlineNodeMoveRequestSchema = z
  .object({
    version: z.number().int().positive(),
    parentId: uuidV7Schema.nullable(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type OutlineNodeMoveRequest = z.infer<typeof outlineNodeMoveRequestSchema>;

export const outlineNodeVersionRequestSchema = z
  .object({
    version: z.number().int().positive(),
  })
  .strict();
export type OutlineNodeVersionRequest = z.infer<typeof outlineNodeVersionRequestSchema>;

export const outlineVolumeContractWriteRequestSchema = z
  .object({
    version: z.number().int().positive().optional(),
    objective: z.string().trim().min(1).max(2_000),
    conflict: z.string().trim().min(1).max(2_000),
    turningPoints: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    exitConditions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    plotLines: z.array(volumePlotLineSchema).max(30).default([]),
  })
  .strict();
export type OutlineVolumeContractWriteRequest = z.infer<
  typeof outlineVolumeContractWriteRequestSchema
>;

export const outlineReplanCheckRequestSchema = z
  .object({
    nodeId: uuidV7Schema,
    proposedParentId: uuidV7Schema.nullable().optional(),
    proposedSortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type OutlineReplanCheckRequest = z.infer<typeof outlineReplanCheckRequestSchema>;

export const outlineWorkspaceResponseSchema = apiEnvelopeSchema(outlineWorkspaceSchema);
export const outlineReadinessResponseSchema = apiEnvelopeSchema(outlineReadinessSchema);
export const outlineReplanResponseSchema = apiEnvelopeSchema(outlineReplanResultSchema);

export const outlineNodeMutationDataSchema = z
  .object({
    workspace: outlineWorkspaceSchema,
    node: outlineNodeSchema,
    versionNodeId: uuidV7Schema,
    auditId: uuidV7Schema,
    replan: outlineReplanResultSchema,
  })
  .strict();
export type OutlineNodeMutationData = z.infer<typeof outlineNodeMutationDataSchema>;
export const outlineNodeMutationResponseSchema = apiEnvelopeSchema(outlineNodeMutationDataSchema);

export const storyLedgerKindSchema = z.enum(["plot_thread", "foreshadow", "character_arc"]);
export type StoryLedgerKind = z.infer<typeof storyLedgerKindSchema>;

export const storyLedgerStatusSchema = z.enum([
  "planned",
  "planted",
  "progressed",
  "paid_off",
  "failed_payoff",
  "abandoned",
  "deferred",
]);
export type StoryLedgerStatus = z.infer<typeof storyLedgerStatusSchema>;

export const storyLedgerResponsibleRoleSchema = z.enum([
  "protagonist",
  "antagonist",
  "supporting",
  "ensemble",
  "author",
]);
export type StoryLedgerResponsibleRole = z.infer<typeof storyLedgerResponsibleRoleSchema>;

export const storyLedgerThreadTypeSchema = z.enum([
  "main",
  "subplot",
  "character",
  "faction",
  "world",
  "mystery",
  "romance",
]);
export type StoryLedgerThreadType = z.infer<typeof storyLedgerThreadTypeSchema>;

export const storyLedgerImportanceSchema = z.enum(["must", "optional"]);
export type StoryLedgerImportance = z.infer<typeof storyLedgerImportanceSchema>;

export const storyLedgerLifecycleActionSchema = z.enum([
  "setup",
  "progress",
  "payoff",
  "fail_payoff",
  "abandon",
  "defer",
]);
export type StoryLedgerLifecycleAction = z.infer<typeof storyLedgerLifecycleActionSchema>;

export const storyLedgerTargetWindowSchema = z
  .object({
    fromChapter: z.number().int().positive(),
    toChapter: z.number().int().positive(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.toChapter < input.fromChapter) {
      context.addIssue({
        code: "custom",
        path: ["toChapter"],
        message: "Target window end cannot precede its start",
      });
    }
  });
export type StoryLedgerTargetWindow = z.infer<typeof storyLedgerTargetWindowSchema>;

export const storyLedgerChapterRefSchema = z
  .object({
    id: uuidV7Schema,
    number: z.number().int().positive(),
    title: z.string().min(1).max(200),
  })
  .strict();
export type StoryLedgerChapterRef = z.infer<typeof storyLedgerChapterRefSchema>;

export const storyLedgerEvidenceSchema = z
  .object({
    kind: settingEvidenceKindSchema,
    sourceId: uuidV7Schema.nullable().default(null),
    label: z.string().trim().min(1).max(200),
    quote: z.string().max(5_000).default(""),
    locator: z.string().max(500).default(""),
    confidence: z.number().min(0).max(1).nullable().default(null),
    strength: z.enum(["weak", "strong"]).default("strong"),
  })
  .strict();
export type StoryLedgerEvidence = z.infer<typeof storyLedgerEvidenceSchema>;

export const storyLedgerEventRefSchema = z
  .object({
    eventId: uuidV7Schema,
    label: z.string().min(1).max(200),
    chapterNumber: z.number().int().positive().nullable(),
    validFromChapter: z.number().int().positive().nullable(),
    validToChapter: z.number().int().positive().nullable(),
  })
  .strict();
export type StoryLedgerEventRef = z.infer<typeof storyLedgerEventRefSchema>;

export const storyLedgerLifecycleEventSchema = z
  .object({
    id: uuidV7Schema,
    action: storyLedgerLifecycleActionSchema,
    fromStatus: storyLedgerStatusSchema,
    toStatus: storyLedgerStatusSchema,
    chapter: storyLedgerChapterRefSchema.nullable(),
    event: storyLedgerEventRefSchema.nullable(),
    reason: z.string().min(1).max(1_000),
    evidence: z.array(storyLedgerEvidenceSchema),
    actorId: uuidV7Schema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type StoryLedgerLifecycleEvent = z.infer<typeof storyLedgerLifecycleEventSchema>;

export const storyLedgerFindingSchema = z
  .object({
    code: z.enum([
      "LEDGER_OVERDUE",
      "LEDGER_DUPLICATE",
      "LEDGER_PREMATURE_PAYOFF",
      "LEDGER_WEAK_PAYOFF",
      "LEDGER_UNSUPPORTED_PAYOFF",
      "LEDGER_INVALIDATED_PAYOFF",
      "LEDGER_NO_CAUSAL_PAYOFF",
    ]),
    severity: z.enum(["warning", "blocker"]),
    entryId: uuidV7Schema,
    relatedEntryIds: z.array(uuidV7Schema),
    message: z.string().min(1),
    remediation: z.string().min(1),
  })
  .strict();
export type StoryLedgerFinding = z.infer<typeof storyLedgerFindingSchema>;

const storyLedgerEntryBaseShape = {
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(2_000),
  status: storyLedgerStatusSchema,
  responsibleRole: storyLedgerResponsibleRoleSchema,
  sourceChapter: storyLedgerChapterRefSchema.nullable(),
  sourceEvent: storyLedgerEventRefSchema.nullable(),
  targetWindow: storyLedgerTargetWindowSchema,
  prerequisiteEvents: z.array(storyLedgerEventRefSchema),
  evidence: z.array(storyLedgerEvidenceSchema),
  history: z.array(storyLedgerLifecycleEventSchema),
  version: z.number().int().positive(),
  versionNodeId: uuidV7Schema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const plotThreadSchema = z
  .object({
    ...storyLedgerEntryBaseShape,
    kind: z.literal("plot_thread"),
    threadType: storyLedgerThreadTypeSchema,
    stakes: z.string().trim().min(1).max(2_000),
    tension: z.number().int().min(0).max(100).nullable(),
  })
  .strict();
export type PlotThread = z.infer<typeof plotThreadSchema>;

export const foreshadowSchema = z
  .object({
    ...storyLedgerEntryBaseShape,
    kind: z.literal("foreshadow"),
    importance: storyLedgerImportanceSchema,
    readerPromise: z.string().trim().min(1).max(500),
    relatedCharacters: z.array(domainRefSchema).max(20),
    relatedFactions: z.array(domainRefSchema).max(20),
  })
  .strict();
export type Foreshadow = z.infer<typeof foreshadowSchema>;

export const characterArcSchema = z
  .object({
    ...storyLedgerEntryBaseShape,
    kind: z.literal("character_arc"),
    character: domainRefSchema,
    startState: z.string().trim().min(1).max(2_000),
    desire: z.string().trim().min(1).max(2_000),
    fear: z.string().trim().min(1).max(2_000),
    lie: z.string().trim().min(1).max(2_000),
    truth: z.string().trim().min(1).max(2_000),
    endState: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type CharacterArc = z.infer<typeof characterArcSchema>;

export const storyLedgerEntrySchema = z.discriminatedUnion("kind", [
  plotThreadSchema,
  foreshadowSchema,
  characterArcSchema,
]);
export type StoryLedgerEntry = z.infer<typeof storyLedgerEntrySchema>;

const storyLedgerCreateBaseShape = {
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(2_000).default(""),
  responsibleRole: storyLedgerResponsibleRoleSchema,
  status: z.enum(["planned", "planted"]).default("planned"),
  sourceChapterId: uuidV7Schema.nullable().default(null),
  sourceEventId: uuidV7Schema.nullable().default(null),
  targetWindow: storyLedgerTargetWindowSchema,
  prerequisiteEventIds: z.array(uuidV7Schema).max(20).default([]),
  evidence: z.array(storyLedgerEvidenceSchema).max(20).default([]),
  reason: z.string().trim().min(1).max(1_000).optional(),
};

type StoryLedgerCreateBase = {
  status: "planned" | "planted";
  sourceChapterId: string | null;
  sourceEventId: string | null;
  reason?: string | undefined;
};

const storyLedgerCreateRefinement = (input: StoryLedgerCreateBase, context: z.RefinementCtx) => {
  if (input.status === "planted" && !input.sourceChapterId && !input.sourceEventId) {
    context.addIssue({
      code: "custom",
      path: ["sourceChapterId"],
      message: "Planted ledger entries require a source chapter or event",
    });
  }
  if (input.status === "planted" && !input.reason) {
    context.addIssue({
      code: "custom",
      path: ["reason"],
      message: "Planted ledger entries require a reason",
    });
  }
};

export const plotThreadCreateRequestSchema = z
  .object({
    kind: z.literal("plot_thread"),
    ...storyLedgerCreateBaseShape,
    threadType: storyLedgerThreadTypeSchema,
    stakes: z.string().trim().min(1).max(2_000),
    tension: z.number().int().min(0).max(100).nullable().default(null),
  })
  .strict()
  .superRefine(storyLedgerCreateRefinement);
export type PlotThreadCreateRequest = z.infer<typeof plotThreadCreateRequestSchema>;

export const foreshadowCreateRequestSchema = z
  .object({
    kind: z.literal("foreshadow"),
    ...storyLedgerCreateBaseShape,
    importance: storyLedgerImportanceSchema.default("must"),
    readerPromise: z.string().trim().min(1).max(500),
    relatedCharacterIds: z.array(uuidV7Schema).max(20).default([]),
    relatedFactionIds: z.array(uuidV7Schema).max(20).default([]),
  })
  .strict()
  .superRefine(storyLedgerCreateRefinement);
export type ForeshadowCreateRequest = z.infer<typeof foreshadowCreateRequestSchema>;

export const characterArcCreateRequestSchema = z
  .object({
    kind: z.literal("character_arc"),
    ...storyLedgerCreateBaseShape,
    characterId: uuidV7Schema,
    startState: z.string().trim().min(1).max(2_000),
    desire: z.string().trim().min(1).max(2_000),
    fear: z.string().trim().min(1).max(2_000),
    lie: z.string().trim().min(1).max(2_000),
    truth: z.string().trim().min(1).max(2_000),
    endState: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine(storyLedgerCreateRefinement);
export type CharacterArcCreateRequest = z.infer<typeof characterArcCreateRequestSchema>;

export const storyLedgerEntryCreateRequestSchema = z.discriminatedUnion("kind", [
  plotThreadCreateRequestSchema,
  foreshadowCreateRequestSchema,
  characterArcCreateRequestSchema,
]);
export type StoryLedgerEntryCreateRequest = z.infer<typeof storyLedgerEntryCreateRequestSchema>;

const storyLedgerPatchBaseShape = {
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().max(2_000).optional(),
  responsibleRole: storyLedgerResponsibleRoleSchema.optional(),
  sourceChapterId: uuidV7Schema.nullable().optional(),
  sourceEventId: uuidV7Schema.nullable().optional(),
  targetWindow: storyLedgerTargetWindowSchema.optional(),
  prerequisiteEventIds: z.array(uuidV7Schema).max(20).optional(),
  evidence: z.array(storyLedgerEvidenceSchema).max(20).optional(),
};

export const plotThreadPatchRequestSchema = z
  .object({
    kind: z.literal("plot_thread"),
    ...storyLedgerPatchBaseShape,
    threadType: storyLedgerThreadTypeSchema.optional(),
    stakes: z.string().trim().min(1).max(2_000).optional(),
    tension: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict();
export type PlotThreadPatchRequest = z.infer<typeof plotThreadPatchRequestSchema>;

export const foreshadowPatchRequestSchema = z
  .object({
    kind: z.literal("foreshadow"),
    ...storyLedgerPatchBaseShape,
    importance: storyLedgerImportanceSchema.optional(),
    readerPromise: z.string().trim().min(1).max(500).optional(),
    relatedCharacterIds: z.array(uuidV7Schema).max(20).optional(),
    relatedFactionIds: z.array(uuidV7Schema).max(20).optional(),
  })
  .strict();
export type ForeshadowPatchRequest = z.infer<typeof foreshadowPatchRequestSchema>;

export const characterArcPatchRequestSchema = z
  .object({
    kind: z.literal("character_arc"),
    ...storyLedgerPatchBaseShape,
    characterId: uuidV7Schema.optional(),
    startState: z.string().trim().min(1).max(2_000).optional(),
    desire: z.string().trim().min(1).max(2_000).optional(),
    fear: z.string().trim().min(1).max(2_000).optional(),
    lie: z.string().trim().min(1).max(2_000).optional(),
    truth: z.string().trim().min(1).max(2_000).optional(),
    endState: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type CharacterArcPatchRequest = z.infer<typeof characterArcPatchRequestSchema>;

export const storyLedgerEntryPatchRequestSchema = z.discriminatedUnion("kind", [
  plotThreadPatchRequestSchema,
  foreshadowPatchRequestSchema,
  characterArcPatchRequestSchema,
]);
export type StoryLedgerEntryPatchRequest = z.infer<typeof storyLedgerEntryPatchRequestSchema>;

export const storyLedgerDeleteRequestSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type StoryLedgerDeleteRequest = z.infer<typeof storyLedgerDeleteRequestSchema>;

export const storyLedgerLifecycleRequestSchema = z
  .object({
    version: z.number().int().positive(),
    action: storyLedgerLifecycleActionSchema,
    chapterId: uuidV7Schema.nullable().default(null),
    eventId: uuidV7Schema.nullable().default(null),
    reason: z.string().trim().min(1).max(1_000),
    evidence: z.array(storyLedgerEvidenceSchema).max(20).default([]),
    targetWindow: storyLedgerTargetWindowSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const sourceRequired = ["setup", "progress", "payoff", "fail_payoff", "abandon"].includes(
      input.action,
    );
    if (sourceRequired && !input.chapterId && !input.eventId) {
      context.addIssue({
        code: "custom",
        path: ["chapterId"],
        message: "This lifecycle action requires a source chapter or event",
      });
    }
    if (["payoff", "fail_payoff"].includes(input.action) && input.evidence.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Payoff transitions require evidence",
      });
    }
    if (input.action === "defer" && !input.targetWindow) {
      context.addIssue({
        code: "custom",
        path: ["targetWindow"],
        message: "Defer transitions require a new target window",
      });
    }
  });
export type StoryLedgerLifecycleRequest = z.infer<typeof storyLedgerLifecycleRequestSchema>;

export const storyLedgerSummarySchema = z
  .object({
    total: z.number().int().min(0),
    open: z.number().int().min(0),
    overdue: z.number().int().min(0),
    mustPayoff: z.number().int().min(0),
    paidOff: z.number().int().min(0),
    abandoned: z.number().int().min(0),
    weakPayoff: z.number().int().min(0),
  })
  .strict();
export type StoryLedgerSummary = z.infer<typeof storyLedgerSummarySchema>;

export const storyLedgerWorkspaceSchema = z
  .object({
    ruleVersion: z.literal("story-ledger-checks-v1"),
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    writtenThroughChapter: z.number().int().min(0),
    entries: z.array(storyLedgerEntrySchema),
    findings: z.array(storyLedgerFindingSchema),
    summary: storyLedgerSummarySchema,
  })
  .strict();
export type StoryLedgerWorkspace = z.infer<typeof storyLedgerWorkspaceSchema>;

export const storyLedgerWorkspaceResponseSchema = apiEnvelopeSchema(storyLedgerWorkspaceSchema);
export const storyLedgerEntryResponseSchema = apiEnvelopeSchema(storyLedgerEntrySchema);
export const storyLedgerEntryListResponseSchema = apiEnvelopeSchema(
  z.array(storyLedgerEntrySchema),
);

export const storyLedgerMutationDataSchema = z
  .object({
    workspace: storyLedgerWorkspaceSchema,
    entry: storyLedgerEntrySchema,
    versionNodeId: uuidV7Schema,
    auditId: uuidV7Schema,
  })
  .strict();
export type StoryLedgerMutationData = z.infer<typeof storyLedgerMutationDataSchema>;
export const storyLedgerMutationResponseSchema = apiEnvelopeSchema(storyLedgerMutationDataSchema);

export const storyLedgerDeleteDataSchema = z
  .object({
    workspace: storyLedgerWorkspaceSchema,
    entryId: uuidV7Schema,
    versionNodeId: uuidV7Schema,
    auditId: uuidV7Schema,
  })
  .strict();
export type StoryLedgerDeleteData = z.infer<typeof storyLedgerDeleteDataSchema>;
export const storyLedgerDeleteResponseSchema = apiEnvelopeSchema(storyLedgerDeleteDataSchema);

export const canonCommitRequestSchema = z.object({
  chapterVersionId: uuidV7Schema,
});
export type CanonCommitRequest = z.infer<typeof canonCommitRequestSchema>;

export const factProposalStatusSchema = z.enum([
  "proposed",
  "confirmed",
  "modified_confirmed",
  "rejected",
  "superseded",
]);
export type FactProposalStatus = z.infer<typeof factProposalStatusSchema>;

export const factRiskSchema = z.enum(["low", "medium", "high"]);
export type FactRisk = z.infer<typeof factRiskSchema>;

export const factDecisionActionSchema = z.enum([
  "confirm",
  "modify_confirm",
  "reject",
  "supersede",
]);
export type FactDecisionAction = z.infer<typeof factDecisionActionSchema>;

export const factDecisionSchema = z.object({
  id: uuidV7Schema,
  action: factDecisionActionSchema,
  actorId: uuidV7Schema,
  actorName: z.string().min(1),
  reason: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type FactDecision = z.infer<typeof factDecisionSchema>;

export const factProposalSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  sourceVersionId: uuidV7Schema,
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  sourceSentence: z.string().min(1),
  status: factProposalStatusSchema,
  confidence: z.number().min(0).max(1),
  risk: factRiskSchema,
  required: z.boolean(),
  decision: factDecisionSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FactProposal = z.infer<typeof factProposalSchema>;

export const factProposalModificationSchema = z
  .object({
    subject: z.string().trim().min(1).max(500).optional(),
    predicate: z.string().trim().min(1).max(500).optional(),
    object: z.string().trim().min(1).max(5_000).optional(),
    risk: factRiskSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one edited field is required",
  });
export type FactProposalModification = z.infer<typeof factProposalModificationSchema>;

export const factProposalDecisionRequestSchema = z
  .object({
    action: factDecisionActionSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    modified: factProposalModificationSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.action === "modify_confirm" && !input.modified) {
      context.addIssue({
        code: "custom",
        path: ["modified"],
        message: "Modified confirmation requires at least one edited field",
      });
    }
    if (input.action !== "modify_confirm" && input.modified) {
      context.addIssue({
        code: "custom",
        path: ["modified"],
        message: "Edited fields are only allowed for modified confirmation",
      });
    }
  });
export type FactProposalDecisionRequest = z.infer<typeof factProposalDecisionRequestSchema>;

export const factProposalListResponseSchema = apiEnvelopeSchema(z.array(factProposalSchema));
export const factProposalResponseSchema = apiEnvelopeSchema(factProposalSchema);

export const canonCommitFactSchema = z.object({
  id: uuidV7Schema,
  proposalId: uuidV7Schema,
  decisionId: uuidV7Schema,
  sourceChapterId: uuidV7Schema,
  validFromChapter: z.number().int().positive(),
  validToChapter: z.number().int().positive().nullable(),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  risk: factRiskSchema,
  required: z.boolean(),
  status: z.enum(["confirmed", "modified_confirmed"]),
});
export type CanonCommitFact = z.infer<typeof canonCommitFactSchema>;

export const canonCommitDecisionSchema = z.object({
  proposalId: uuidV7Schema,
  decisionId: uuidV7Schema,
  action: factDecisionActionSchema,
  resultingStatus: factProposalStatusSchema,
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  risk: factRiskSchema,
  required: z.boolean(),
  sourceSentence: z.string().min(1),
  actorName: z.string().min(1),
  reason: z.string().min(1),
  decidedAt: z.string().datetime(),
});
export type CanonCommitDecision = z.infer<typeof canonCommitDecisionSchema>;

export const canonCommitSummarySchema = z.object({
  factCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  text: z.string().min(1),
});
export type CanonCommitSummary = z.infer<typeof canonCommitSummarySchema>;

export const canonCommitSchema = z.object({
  id: uuidV7Schema,
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  chapterVersionId: uuidV7Schema,
  versionNodeId: uuidV7Schema,
  sourceChapter: z.object({
    id: uuidV7Schema,
    number: z.number().int().positive(),
    title: z.string().min(1),
  }),
  decisions: z.array(canonCommitDecisionSchema),
  facts: z.array(canonCommitFactSchema),
  summary: canonCommitSummarySchema,
  createdAt: z.string().datetime(),
});
export type CanonCommit = z.infer<typeof canonCommitSchema>;

export const canonCommitResponseSchema = apiEnvelopeSchema(canonCommitSchema);
export const canonCommitListResponseSchema = apiEnvelopeSchema(z.array(canonCommitSchema));

export const manuscriptImportConfirmRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  penName: z.string().trim().min(1).max(50).optional(),
  genre: workGenreSchema.default("xianxia"),
  scaleTarget: workScaleTargetSchema.default("long"),
  chapterLengthTarget: z.number().int().min(1000).max(10000).default(3000),
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(1_000),
});
export type ManuscriptImportConfirmRequest = z.infer<typeof manuscriptImportConfirmRequestSchema>;

export const manuscriptImportConfirmDataSchema = z.object({
  work: workOverviewSchema,
  chapters: z.array(chapterSchema),
  chapterVersions: z.array(chapterVersionSchema),
});
export type ManuscriptImportConfirmData = z.infer<typeof manuscriptImportConfirmDataSchema>;

export const manuscriptImportConfirmResponseSchema = apiEnvelopeSchema(
  manuscriptImportConfirmDataSchema,
);

export const serviceNameSchema = z.enum(["api", "worker"]);
export type ServiceName = z.infer<typeof serviceNameSchema>;

export const dependencyCheckSchema = z.object({
  name: z.enum(["database", "queue"]),
  status: z.enum(["up", "down"]),
  latencyMs: z.number().nonnegative(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

export const livenessDataSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("api"),
  timestamp: z.string().datetime(),
});
export type LivenessData = z.infer<typeof livenessDataSchema>;

export const readinessDataSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("api"),
  timestamp: z.string().datetime(),
  checks: z.array(dependencyCheckSchema),
});
export type ReadinessData = z.infer<typeof readinessDataSchema>;

export const livenessResponseSchema = apiEnvelopeSchema(livenessDataSchema);
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const readinessResponseSchema = apiEnvelopeSchema(readinessDataSchema);
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const workerReadinessDataSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("worker"),
  workerCount: z.number().int().nonnegative(),
  checks: z.array(dependencyCheckSchema),
});
export type WorkerReadinessData = z.infer<typeof workerReadinessDataSchema>;

export const WORKER_QUEUE_NAME = "novel-brain-jobs";
export const GENERATE_CHAPTER_JOB = "generate_chapter";
export const WRITE_ACTION_JOB = "write_action";
export const WORKER_JOB_STEPS = [
  "prepare",
  "compile_context",
  "draft",
  "verify",
  "revise",
  "extract_facts",
  "await_review",
] as const;

export const workerJobStepSchema = z.enum(WORKER_JOB_STEPS);
export type WorkerJobStep = z.infer<typeof workerJobStepSchema>;

export const RECOVERY_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export const checkpointOutputRefSchema = z
  .object({
    type: z.enum(["chapter_version", "context_pack", "fact_proposal", "canon_commit", "artifact"]),
    id: z.string().min(1).max(200),
  })
  .strict();
export type CheckpointOutputRef = z.infer<typeof checkpointOutputRefSchema>;

export const generationCheckpointSchema = z
  .object({
    schemaVersion: z.literal(RECOVERY_CHECKPOINT_SCHEMA_VERSION).default(1),
    revision: z.number().int().nonnegative().default(0),
    step: workerJobStepSchema,
    inputHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    outputRefs: z.array(checkpointOutputRefSchema).max(100).default([]),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type GenerationCheckpoint = z.infer<typeof generationCheckpointSchema>;

export const generateChapterJobSchema = z.object({
  jobId: uuidV7Schema,
  jobType: z.literal(GENERATE_CHAPTER_JOB),
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  actorId: uuidV7Schema,
  modelConfigId: uuidV7Schema,
  idempotencyKey: z.string().min(1),
  budget: z.object({
    maxCostCny: z.number().nonnegative(),
    maxTokens: z.number().int().positive(),
    maxRevisionRounds: z.number().int().nonnegative(),
  }),
  checkpoint: generationCheckpointSchema,
});
export type GenerateChapterJob = z.infer<typeof generateChapterJobSchema>;

export const generationBudgetSchema = generateChapterJobSchema.shape.budget;
export type GenerationBudget = z.infer<typeof generationBudgetSchema>;

export const WRITING_ACTION_KINDS = [
  "continue",
  "rewrite",
  "expand",
  "condense",
  "change_pov",
  "add_hook",
  "generate_title",
  "generate_summary",
  "selection_rewrite",
] as const;
export const writingActionKindSchema = z.enum(WRITING_ACTION_KINDS);
export type WritingActionKind = z.infer<typeof writingActionKindSchema>;

export const WRITING_ACTION_STEPS = ["prepare", "generate", "await_review"] as const;
export const writingActionStepSchema = z.enum(WRITING_ACTION_STEPS);
export type WritingActionStep = z.infer<typeof writingActionStepSchema>;

export const writingActionSelectionSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((selection) => selection.end > selection.start, {
    message: "Selection end must be after start",
    path: ["end"],
  });
export type WritingActionSelection = z.infer<typeof writingActionSelectionSchema>;

const writingActionBaseShape = {
  sourceVersionId: uuidV7Schema,
  budget: generationBudgetSchema.default({
    maxCostCny: 2.5,
    maxTokens: 30_000,
    maxRevisionRounds: 0,
  }),
};

export const continueWritingActionSchema = z
  .object({
    action: z.literal("continue"),
    ...writingActionBaseShape,
    instruction: z.string().trim().min(1).max(2_000).optional(),
    targetLength: z.number().int().min(100).max(20_000).optional(),
  })
  .strict();

export const rewriteWritingActionSchema = z
  .object({
    action: z.literal("rewrite"),
    ...writingActionBaseShape,
    instruction: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const expandWritingActionSchema = z
  .object({
    action: z.literal("expand"),
    ...writingActionBaseShape,
    instruction: z.string().trim().min(1).max(2_000).optional(),
    targetLength: z.number().int().min(100).max(50_000),
  })
  .strict();

export const condenseWritingActionSchema = z
  .object({
    action: z.literal("condense"),
    ...writingActionBaseShape,
    instruction: z.string().trim().min(1).max(2_000).optional(),
    targetLength: z.number().int().min(100).max(50_000),
  })
  .strict();

export const changePovWritingActionSchema = z
  .object({
    action: z.literal("change_pov"),
    ...writingActionBaseShape,
    pov: z.string().trim().min(1).max(200),
  })
  .strict();

export const addHookWritingActionSchema = z
  .object({
    action: z.literal("add_hook"),
    ...writingActionBaseShape,
    hookStyle: z.enum(["suspense", "reversal", "question"]).optional(),
    count: z.number().int().min(1).max(3).default(3),
  })
  .strict();

export const generateTitleWritingActionSchema = z
  .object({
    action: z.literal("generate_title"),
    ...writingActionBaseShape,
    count: z.number().int().min(1).max(3).default(3),
  })
  .strict();

export const generateSummaryWritingActionSchema = z
  .object({
    action: z.literal("generate_summary"),
    ...writingActionBaseShape,
    maxLength: z.number().int().min(50).max(1_000).default(200),
  })
  .strict();

export const selectionRewriteWritingActionSchema = z
  .object({
    action: z.literal("selection_rewrite"),
    ...writingActionBaseShape,
    selection: writingActionSelectionSchema,
    instruction: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const writingActionRequestSchema = z.discriminatedUnion("action", [
  continueWritingActionSchema,
  rewriteWritingActionSchema,
  expandWritingActionSchema,
  condenseWritingActionSchema,
  changePovWritingActionSchema,
  addHookWritingActionSchema,
  generateTitleWritingActionSchema,
  generateSummaryWritingActionSchema,
  selectionRewriteWritingActionSchema,
]);
export type WritingActionRequest = z.infer<typeof writingActionRequestSchema>;
export type ContinueWritingAction = z.infer<typeof continueWritingActionSchema>;
export type RewriteWritingAction = z.infer<typeof rewriteWritingActionSchema>;
export type ExpandWritingAction = z.infer<typeof expandWritingActionSchema>;
export type CondenseWritingAction = z.infer<typeof condenseWritingActionSchema>;
export type ChangePovWritingAction = z.infer<typeof changePovWritingActionSchema>;
export type AddHookWritingAction = z.infer<typeof addHookWritingActionSchema>;
export type GenerateTitleWritingAction = z.infer<typeof generateTitleWritingActionSchema>;
export type GenerateSummaryWritingAction = z.infer<typeof generateSummaryWritingActionSchema>;
export type SelectionRewriteWritingAction = z.infer<typeof selectionRewriteWritingActionSchema>;

export const writingActionAffectedRangeSchema = z
  .object({
    originalStart: z.number().int().nonnegative(),
    originalEnd: z.number().int().positive(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.originalEnd > range.originalStart && range.end > range.start, {
    message: "Affected range end must be after start",
  });
export type WritingActionAffectedRange = z.infer<typeof writingActionAffectedRangeSchema>;

const writingActionOutputBaseShape = {
  id: uuidV7Schema,
  action: writingActionKindSchema,
  version: z.number().int().positive(),
  versionNodeId: uuidV7Schema,
  sourceVersionId: uuidV7Schema,
  chapterVersionId: uuidV7Schema.nullable(),
  affectedRange: writingActionAffectedRangeSchema.nullable(),
  provenance: z
    .object({
      promptKey: z.string().min(1).max(200),
      promptVersion: z.number().int().positive(),
      promptHash: z.string().regex(/^[a-f0-9]{64}$/),
      provider: z.string().min(1).max(100),
      model: z.string().min(1).max(200),
      parameters: z.record(z.string(), z.unknown()),
    })
    .strict(),
  createdAt: z.string().datetime(),
};

export const writingActionChapterTextOutputSchema = z
  .object({
    ...writingActionOutputBaseShape,
    kind: z.literal("chapter_text"),
    content: z.string().min(1).max(200_000),
  })
  .strict();
export const writingActionTitleOutputSchema = z
  .object({
    ...writingActionOutputBaseShape,
    kind: z.literal("title_options"),
    titles: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
  })
  .strict();
export const writingActionSummaryOutputSchema = z
  .object({
    ...writingActionOutputBaseShape,
    kind: z.literal("summary"),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();
export const writingActionHookOutputSchema = z
  .object({
    ...writingActionOutputBaseShape,
    kind: z.literal("hooks"),
    hooks: z.array(z.string().trim().min(1).max(1_000)).min(1).max(3),
  })
  .strict();
export const writingActionOutputSchema = z
  .discriminatedUnion("kind", [
    writingActionChapterTextOutputSchema,
    writingActionTitleOutputSchema,
    writingActionSummaryOutputSchema,
    writingActionHookOutputSchema,
  ])
  .superRefine((output, context) => {
    if (output.kind === "chapter_text" && output.chapterVersionId === null) {
      context.addIssue({
        code: "custom",
        path: ["chapterVersionId"],
        message: "Chapter text output requires a chapter version",
      });
    }
    if (output.kind !== "chapter_text" && output.chapterVersionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["chapterVersionId"],
        message: "Non-text output cannot replace a chapter version",
      });
    }
    if (output.action === "selection_rewrite" && output.affectedRange === null) {
      context.addIssue({
        code: "custom",
        path: ["affectedRange"],
        message: "Selection rewrite requires the affected range",
      });
    }
    if (output.action !== "selection_rewrite" && output.affectedRange !== null) {
      context.addIssue({
        code: "custom",
        path: ["affectedRange"],
        message: "Only selection rewrite reports an affected range",
      });
    }
  });
export type WritingActionOutput = z.infer<typeof writingActionOutputSchema>;

export const writingActionCheckpointSchema = z
  .object({
    schemaVersion: z.literal(RECOVERY_CHECKPOINT_SCHEMA_VERSION).default(1),
    revision: z.number().int().nonnegative().default(0),
    step: writingActionStepSchema,
    inputHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    outputRefs: z.array(checkpointOutputRefSchema).max(100).default([]),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type WritingActionCheckpoint = z.infer<typeof writingActionCheckpointSchema>;

export const writeActionJobSchema = z
  .object({
    jobId: uuidV7Schema,
    jobType: z.literal(WRITE_ACTION_JOB),
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    chapterId: uuidV7Schema,
    actorId: uuidV7Schema,
    modelConfigId: uuidV7Schema,
    idempotencyKey: z.string().min(1),
    action: writingActionKindSchema,
    sourceVersionId: uuidV7Schema,
    input: writingActionRequestSchema,
    budget: generationBudgetSchema,
    checkpoint: writingActionCheckpointSchema,
  })
  .superRefine((job, context) => {
    if (job.action !== job.input.action) {
      context.addIssue({
        code: "custom",
        path: ["input", "action"],
        message: "Writing action job and input must use the same action",
      });
    }
  });
export type WriteActionJob = z.infer<typeof writeActionJobSchema>;

export const workerJobSchema = z.discriminatedUnion("jobType", [
  generateChapterJobSchema,
  writeActionJobSchema,
]);
export type WorkerJob = z.infer<typeof workerJobSchema>;

export const generationJobStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "paused",
  "waiting_review",
  "completed",
  "failed",
  "cancelled",
]);
export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>;

export const generationCostSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costCny: z.number().nonnegative(),
});
export type GenerationCost = z.infer<typeof generationCostSchema>;

export const generationJobErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
});
export type GenerationJobError = z.infer<typeof generationJobErrorSchema>;

export const contextSourceTypeSchema = z.enum([
  "story_bible",
  "setting",
  "chapter_brief",
  "chapter_version",
  "style",
]);
export type ContextSourceType = z.infer<typeof contextSourceTypeSchema>;

export const contextSourceRefSchema = z.object({
  sourceType: contextSourceTypeSchema,
  sourceId: uuidV7Schema,
  label: z.string().min(1),
  citation: z.string().min(1),
});
export type ContextSourceRef = z.infer<typeof contextSourceRefSchema>;

export const contextSourcePrioritySchema = z.enum(["required", "high", "normal"]);
export type ContextSourcePriority = z.infer<typeof contextSourcePrioritySchema>;

export const contextLayerSchema = z.enum(["P0", "P1", "P2", "P3", "P4"]);
export type ContextLayer = z.infer<typeof contextLayerSchema>;

export const contextTaskSchema = z.enum([
  "chapter_draft",
  "chapter_revision",
  "continuity_check",
  "fact_extraction",
]);
export type ContextTask = z.infer<typeof contextTaskSchema>;

export const contextInclusionReasonSchema = z.enum([
  "p0_hard_constraint",
  "scene_relevant_canon",
  "recent_narrative",
  "style_and_promise",
  "optional_reference",
]);
export type ContextInclusionReason = z.infer<typeof contextInclusionReasonSchema>;

export const contextEvictionReasonSchema = z.enum([
  "token_budget",
  "stale_branch",
  "task_mismatch",
  "pov_mismatch",
  "future_fact",
  "expired_fact",
  "time_window",
  "knowledge_boundary",
  "empty_content",
  "missing_source",
]);
export type ContextEvictionReason = z.infer<typeof contextEvictionReasonSchema>;

export const contextPackSelectedSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  layer: contextLayerSchema.optional(),
  priority: z.union([contextSourcePrioritySchema, contextLayerSchema]),
  content: z.string().min(1),
  tokenCount: z.number().int().positive(),
  sourceRefs: z.array(contextSourceRefSchema).min(1),
  reason: contextInclusionReasonSchema.optional(),
});
export type ContextPackSelected = z.infer<typeof contextPackSelectedSchema>;

export const contextPackEvictionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  layer: contextLayerSchema.optional(),
  reason: contextEvictionReasonSchema,
  tokenCount: z.number().int().positive(),
  sourceRefs: z.array(contextSourceRefSchema).optional(),
  detail: z.string().optional(),
});
export type ContextPackEviction = z.infer<typeof contextPackEvictionSchema>;

export const contextLayerAccountingSchema = z.object({
  selectedCount: z.number().int().nonnegative(),
  selectedTokens: z.number().int().nonnegative(),
  evictedCount: z.number().int().nonnegative(),
  evictedTokens: z.number().int().nonnegative(),
});
export type ContextLayerAccounting = z.infer<typeof contextLayerAccountingSchema>;

export const contextBudgetAccountingSchema = z.object({
  requestedTokenBudget: z.number().int().positive(),
  effectiveTokenBudget: z.number().int().positive(),
  modelContextWindowTokens: z.number().int().positive().nullable(),
  reservedOutputTokens: z.number().int().nonnegative(),
  tokenUsed: z.number().int().nonnegative(),
  tokenRemaining: z.number().int().nonnegative(),
  tokenEstimator: z.string().min(1),
  layers: z.object({
    P0: contextLayerAccountingSchema,
    P1: contextLayerAccountingSchema,
    P2: contextLayerAccountingSchema,
    P3: contextLayerAccountingSchema,
    P4: contextLayerAccountingSchema,
  }),
});
export type ContextBudgetAccounting = z.infer<typeof contextBudgetAccountingSchema>;

export const contextPackManifestSchema = z.object({
  compilerVersion: z.string().min(1),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  task: contextTaskSchema,
  chapterId: uuidV7Schema,
  chapterNumber: z.number().int().positive(),
  povCharacterId: uuidV7Schema.nullable(),
  branchId: uuidV7Schema,
  tokenBudget: z.number().int().positive(),
  tokenUsed: z.number().int().nonnegative(),
  effectiveTokenBudget: z.number().int().positive(),
  selected: z.array(contextPackSelectedSchema),
  evicted: z.array(contextPackEvictionSchema),
  sourceRefs: z.array(contextSourceRefSchema),
  budget: contextBudgetAccountingSchema,
});
export type ContextPackManifest = z.infer<typeof contextPackManifestSchema>;

export const contextPackVersionSchema = z.object({
  id: uuidV7Schema,
  jobId: uuidV7Schema,
  version: z.number().int().positive(),
  compilerVersion: z.string().min(1),
  tokenBudget: z.number().int().positive(),
  tokenUsed: z.number().int().nonnegative(),
  selected: z.array(contextPackSelectedSchema),
  evicted: z.array(contextPackEvictionSchema),
  sourceRefs: z.array(contextSourceRefSchema),
  createdAt: z.string().datetime(),
  manifestHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  task: contextTaskSchema.optional(),
  chapterId: uuidV7Schema.optional(),
  chapterNumber: z.number().int().positive().optional(),
  povCharacterId: uuidV7Schema.nullable().optional(),
  branchId: uuidV7Schema.optional(),
  effectiveTokenBudget: z.number().int().positive().optional(),
  budget: contextBudgetAccountingSchema.optional(),
});
export type ContextPackVersion = z.infer<typeof contextPackVersionSchema>;

export const contextPackPreviewSchema = z.object({
  compilerVersion: z.string().min(1),
  tokenBudget: z.number().int().positive(),
  tokenUsed: z.number().int().nonnegative(),
  selected: z.array(contextPackSelectedSchema),
  evicted: z.array(contextPackEvictionSchema),
  sourceRefs: z.array(contextSourceRefSchema),
  manifestHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  task: contextTaskSchema.optional(),
  chapterId: uuidV7Schema.optional(),
  chapterNumber: z.number().int().positive().optional(),
  povCharacterId: uuidV7Schema.nullable().optional(),
  branchId: uuidV7Schema.optional(),
  effectiveTokenBudget: z.number().int().positive().optional(),
  budget: contextBudgetAccountingSchema.optional(),
});
export type ContextPackPreview = z.infer<typeof contextPackPreviewSchema>;

export const generationJobSchema = z.object({
  id: uuidV7Schema,
  type: z.literal(GENERATE_CHAPTER_JOB),
  workId: uuidV7Schema,
  branchId: uuidV7Schema,
  chapterId: uuidV7Schema,
  status: generationJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  currentStep: workerJobStepSchema,
  budget: generationBudgetSchema,
  cost: generationCostSchema,
  checkpoint: generationCheckpointSchema,
  error: generationJobErrorSchema.nullable(),
  contextPack: contextPackVersionSchema.nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type GenerationJob = z.infer<typeof generationJobSchema>;

export const writingActionJobSchema = z
  .object({
    id: uuidV7Schema,
    type: z.literal(WRITE_ACTION_JOB),
    action: writingActionKindSchema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    chapterId: uuidV7Schema,
    sourceVersionId: uuidV7Schema,
    status: generationJobStatusSchema,
    progress: z.number().int().min(0).max(100),
    currentStep: writingActionStepSchema,
    budget: generationBudgetSchema,
    cost: generationCostSchema,
    checkpoint: writingActionCheckpointSchema,
    output: writingActionOutputSchema.nullable(),
    contextPack: contextPackVersionSchema.nullable(),
    error: generationJobErrorSchema.nullable(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type WritingActionJob = z.infer<typeof writingActionJobSchema>;

export const jobRecoveryActionSchema = z.enum(["retry", "resume"]);
export type JobRecoveryAction = z.infer<typeof jobRecoveryActionSchema>;

export const jobRecoveryRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000),
    idempotencyKey: z.string().trim().min(1).max(200),
    expectedCheckpointVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export type JobRecoveryRequest = z.infer<typeof jobRecoveryRequestSchema>;

export const jobRecoveryRecordSchema = z
  .object({
    id: uuidV7Schema,
    jobId: uuidV7Schema,
    actorId: uuidV7Schema,
    action: jobRecoveryActionSchema,
    reason: z.string().min(1),
    idempotencyKey: z.string().min(1),
    fromStatus: generationJobStatusSchema,
    fromCheckpointVersion: z.number().int().nonnegative(),
    resumeStep: workerJobStepSchema,
    checkpointVersion: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type JobRecoveryRecord = z.infer<typeof jobRecoveryRecordSchema>;

export const jobRecoveryResponseSchema = apiEnvelopeSchema(
  z.object({
    job: generationJobSchema,
    recovery: jobRecoveryRecordSchema,
  }),
);

export const generateChapterRequestSchema = z
  .object({
    budget: generationBudgetSchema.default({
      maxCostCny: 2.5,
      maxTokens: 30_000,
      maxRevisionRounds: 2,
    }),
  })
  .strict();
export type GenerateChapterRequest = z.infer<typeof generateChapterRequestSchema>;

export const jobEventTypeSchema = z.enum([
  "job.created",
  "job.preparing",
  "job.step.started",
  "job.step.succeeded",
  "job.step.failed",
  "job.progress",
  "job.waiting_review",
  "job.paused",
  "job.resumed",
  "job.recovered",
  "job.canceled",
  "job.completed",
  "job.failed",
]);
export type JobEventType = z.infer<typeof jobEventTypeSchema>;

export const jobEventSchema = z.object({
  eventId: uuidV7Schema,
  type: jobEventTypeSchema,
  occurredAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()),
});
export type JobEvent = z.infer<typeof jobEventSchema>;

export const generationJobResponseSchema = apiEnvelopeSchema(generationJobSchema);
export const generationJobListResponseSchema = apiEnvelopeSchema(z.array(generationJobSchema));
export const writingActionJobResponseSchema = apiEnvelopeSchema(writingActionJobSchema);
export const writingActionJobListResponseSchema = apiEnvelopeSchema(
  z.array(writingActionJobSchema),
);
export const contextPackResponseSchema = apiEnvelopeSchema(contextPackVersionSchema.nullable());
export const contextPackPreviewResponseSchema = apiEnvelopeSchema(contextPackPreviewSchema);

export const agentRoleSchema = z.enum([
  "planner",
  "context_curator",
  "writer",
  "critic",
  "reviser",
  "fact_extractor",
  "canon_curator",
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const toolSideEffectLevelSchema = z.enum(["S0", "S1", "S2", "S3", "S4"]);
export type ToolSideEffectLevel = z.infer<typeof toolSideEffectLevelSchema>;

export const toolCategorySchema = z.enum([
  "read_story",
  "read_context",
  "write_draft",
  "write_review",
  "propose_fact",
  "commit_canon",
  "external_irreversible",
]);
export type ToolCategory = z.infer<typeof toolCategorySchema>;

export const toolNameSchema = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Expected a namespaced tool name");
export type ToolName = z.infer<typeof toolNameSchema>;

export const jsonSchemaDocumentSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => typeof schema.type === "string", "JSON Schema must declare a root type");
export type JsonSchemaDocument = z.infer<typeof jsonSchemaDocumentSchema>;

export const agentToolDeclarationSchema = z
  .object({
    name: toolNameSchema,
    required: z.boolean(),
  })
  .strict();
export type AgentToolDeclaration = z.infer<typeof agentToolDeclarationSchema>;

export const agentFailureSemanticsSchema = z
  .object({
    invalidOutput: z.literal("fail_run"),
    toolDenied: z.literal("fail_run"),
    budgetExceeded: z.literal("pause_task"),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(5),
        retryableCodes: z.array(z.string().min(1).max(100)).max(8),
        exhaustedAction: z.enum(["fail_run", "pause_task", "escalate_to_author"]),
        preserveCheckpoint: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type AgentFailureSemantics = z.infer<typeof agentFailureSemanticsSchema>;

export const agentContractSchema = z
  .object({
    key: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Expected a namespaced contract key"),
    version: z.number().int().positive(),
    role: agentRoleSchema,
    description: z.string().trim().min(1).max(2_000),
    inputSchema: jsonSchemaDocumentSchema,
    outputSchema: jsonSchemaDocumentSchema,
    tools: z.array(agentToolDeclarationSchema).max(32),
    failureSemantics: agentFailureSemanticsSchema,
  })
  .strict()
  .superRefine((contract, context) => {
    const names = contract.tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        path: ["tools"],
        message: "Tool declarations must be unique",
      });
    }
  });
export type AgentContract = z.infer<typeof agentContractSchema>;

export const toolRegistryEntrySchema = z
  .object({
    name: toolNameSchema,
    category: toolCategorySchema,
    sideEffect: toolSideEffectLevelSchema,
    description: z.string().trim().min(1).max(2_000),
    inputSchema: jsonSchemaDocumentSchema,
    agentCallable: z.boolean(),
    approval: z.enum(["none", "human"]),
  })
  .strict();
export type ToolRegistryEntry = z.infer<typeof toolRegistryEntrySchema>;

export const agentGrantStateSchema = z.enum(["active", "revoked", "expired"]);
export type AgentGrantState = z.infer<typeof agentGrantStateSchema>;

export const agentResourceScopeSchema = z
  .object({
    chapterIds: z.array(uuidV7Schema).max(500),
    settingIds: z.array(uuidV7Schema).max(500),
    includeCanon: z.boolean(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (new Set(scope.chapterIds).size !== scope.chapterIds.length) {
      context.addIssue({
        code: "custom",
        path: ["chapterIds"],
        message: "Chapter scope entries must be unique",
      });
    }
    if (new Set(scope.settingIds).size !== scope.settingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["settingIds"],
        message: "Setting scope entries must be unique",
      });
    }
  });
export type AgentResourceScope = z.infer<typeof agentResourceScopeSchema>;

export const agentGrantBudgetLimitsSchema = z
  .object({
    maxCostCny: z.number().positive().max(1_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    maxCalls: z.number().int().positive().max(10_000),
  })
  .strict();
export type AgentGrantBudgetLimits = z.infer<typeof agentGrantBudgetLimitsSchema>;

export const agentGrantBudgetSchema = agentGrantBudgetLimitsSchema
  .extend({
    spentCostCny: z.number().nonnegative(),
    spentTokens: z.number().int().nonnegative(),
    callCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.spentCostCny > budget.maxCostCny) {
      context.addIssue({ code: "custom", path: ["spentCostCny"], message: "Cost budget exceeded" });
    }
    if (budget.spentTokens > budget.maxTokens) {
      context.addIssue({
        code: "custom",
        path: ["spentTokens"],
        message: "Token budget exceeded",
      });
    }
    if (budget.callCount > budget.maxCalls) {
      context.addIssue({ code: "custom", path: ["callCount"], message: "Call budget exceeded" });
    }
  });
export type AgentGrantBudget = z.infer<typeof agentGrantBudgetSchema>;

export const agentGrantMaxImpactSchema = z
  .object({
    maxSideEffect: toolSideEffectLevelSchema,
    maxAffectedResources: z.number().int().positive().max(5_000),
  })
  .strict();
export type AgentGrantMaxImpact = z.infer<typeof agentGrantMaxImpactSchema>;

export const agentGrantCreateRequestSchema = z
  .object({
    taskId: uuidV7Schema,
    role: agentRoleSchema,
    tools: z.array(toolNameSchema).min(1).max(32),
    resourceScope: agentResourceScopeSchema,
    budget: agentGrantBudgetLimitsSchema,
    maxImpact: agentGrantMaxImpactSchema,
    expiresAt: z.string().datetime(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.tools).size !== request.tools.length) {
      context.addIssue({
        code: "custom",
        path: ["tools"],
        message: "Grant tools must be unique",
      });
    }
  });
export type AgentGrantCreateRequest = z.infer<typeof agentGrantCreateRequestSchema>;

export const agentGrantSchema = z
  .object({
    id: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    taskId: uuidV7Schema,
    userId: uuidV7Schema,
    role: agentRoleSchema,
    state: agentGrantStateSchema,
    tools: z.array(toolNameSchema).min(1).max(32),
    resourceScope: agentResourceScopeSchema,
    budget: agentGrantBudgetSchema,
    maxImpact: agentGrantMaxImpactSchema,
    expiresAt: z.string().datetime(),
    issuedBy: uuidV7Schema,
    revokedAt: z.string().datetime().nullable(),
    revokedBy: uuidV7Schema.nullable(),
    revocationReason: z.string().min(1).max(500).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.state === "revoked") {
      if (!grant.revokedAt || !grant.revokedBy || !grant.revocationReason) {
        context.addIssue({
          code: "custom",
          path: ["revokedAt"],
          message: "Revoked grants require revocation evidence",
        });
      }
    } else if (grant.revokedAt || grant.revokedBy || grant.revocationReason) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Only revoked grants may carry revocation evidence",
      });
    }
  });
export type AgentGrant = z.infer<typeof agentGrantSchema>;

export const agentGrantRevokeRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type AgentGrantRevokeRequest = z.infer<typeof agentGrantRevokeRequestSchema>;

export const agentToolApprovalSchema = z
  .object({
    approvalId: uuidV7Schema,
    approvedBy: uuidV7Schema,
    approvedSideEffect: toolSideEffectLevelSchema,
  })
  .strict();
export type AgentToolApproval = z.infer<typeof agentToolApprovalSchema>;

export const agentToolResourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), id: uuidV7Schema }).strict(),
  z.object({ type: z.literal("chapter"), id: uuidV7Schema }).strict(),
  z.object({ type: z.literal("setting"), id: uuidV7Schema }).strict(),
  z.object({ type: z.literal("canon"), id: uuidV7Schema.nullable() }).strict(),
]);
export type AgentToolResource = z.infer<typeof agentToolResourceSchema>;

export const agentToolCallRequestSchema = z
  .object({
    grantId: uuidV7Schema,
    taskId: uuidV7Schema,
    toolName: toolNameSchema,
    resource: agentToolResourceSchema,
    input: z.record(z.string(), z.unknown()),
    estimatedCostCny: z.number().nonnegative().max(1_000),
    estimatedTokens: z.number().int().nonnegative().max(10_000_000),
    affectedResources: z.number().int().positive().max(5_000),
    approval: agentToolApprovalSchema.nullable(),
  })
  .strict();
export type AgentToolCallRequest = z.infer<typeof agentToolCallRequestSchema>;

export const agentGrantResponseSchema = apiEnvelopeSchema(agentGrantSchema);
export const agentGrantListResponseSchema = apiEnvelopeSchema(z.array(agentGrantSchema));
export const agentGrantRevokeResponseSchema = agentGrantResponseSchema;

export const agentFailureClassSchema = z.enum([
  "provider",
  "timeout",
  "rate_limit",
  "schema",
  "policy",
  "budget",
  "cancelled",
  "unknown",
]);
export type AgentFailureClass = z.infer<typeof agentFailureClassSchema>;

export const agentRunStatusSchema = z.enum(["running", "succeeded", "failed"]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

const sha256HashSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hash");

export const promptVersionSchema = z
  .object({
    id: uuidV7Schema,
    jobId: uuidV7Schema,
    stepKey: z.string().min(1).max(100),
    key: z.string().min(1).max(100),
    version: z.number().int().positive(),
    role: agentRoleSchema,
    promptHash: sha256HashSchema,
    systemHash: sha256HashSchema,
    inputHash: sha256HashSchema,
    contextPackId: uuidV7Schema.nullable(),
    compilerVersion: z.string().min(1).max(100).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PromptVersion = z.infer<typeof promptVersionSchema>;

export const costReservationStatusSchema = z.enum(["reserved", "settled", "released"]);
export type CostReservationStatus = z.infer<typeof costReservationStatusSchema>;

export const costReservationSchema = z
  .object({
    id: uuidV7Schema,
    status: costReservationStatusSchema,
    reservedTokens: z.number().int().nonnegative(),
    reservedCostCny: z.number().nonnegative(),
    settledTokens: z.number().int().nonnegative(),
    settledCostCny: z.number().nonnegative(),
    failureClass: agentFailureClassSchema.nullable(),
    createdAt: z.string().datetime(),
    settledAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((reservation, context) => {
    if (
      reservation.status !== "settled" &&
      (reservation.settledTokens !== 0 || reservation.settledCostCny !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["settledTokens"],
        message: "Unsettled reservations cannot carry settled usage",
      });
    }
    if (reservation.status === "settled" && !reservation.settledAt) {
      context.addIssue({
        code: "custom",
        path: ["settledAt"],
        message: "Settled reservations require settlement time",
      });
    }
    if (reservation.status === "reserved" && reservation.settledAt) {
      context.addIssue({
        code: "custom",
        path: ["settledAt"],
        message: "Reserved reservations cannot be settled",
      });
    }
  });
export type CostReservation = z.infer<typeof costReservationSchema>;

export const modelCallStatusSchema = z.enum(["started", "succeeded", "failed"]);
export type ModelCallStatus = z.infer<typeof modelCallStatusSchema>;

export const modelCallSchema = z
  .object({
    id: uuidV7Schema,
    agentRunId: uuidV7Schema,
    promptVersionId: uuidV7Schema,
    costReservationId: uuidV7Schema,
    stepKey: z.string().min(1).max(100),
    attempt: z.number().int().positive(),
    status: modelCallStatusSchema,
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    parameters: z.record(z.string(), z.unknown()),
    configHash: sha256HashSchema,
    inputHash: sha256HashSchema,
    outputHash: sha256HashSchema.nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costCny: z.number().nonnegative(),
    failureClass: agentFailureClassSchema.nullable(),
    errorCode: errorCodeSchema.nullable(),
    escalationReason: z.string().min(1).max(500).nullable(),
    providerRequestId: z.string().min(1).max(200).nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((call, context) => {
    if (call.status === "failed" && !call.failureClass) {
      context.addIssue({
        code: "custom",
        path: ["failureClass"],
        message: "Failed model calls require a failure class",
      });
    }
    if (call.status !== "failed" && call.failureClass) {
      context.addIssue({
        code: "custom",
        path: ["failureClass"],
        message: "Only failed model calls may carry a failure class",
      });
    }
    if (call.status === "succeeded" && !call.outputHash) {
      context.addIssue({
        code: "custom",
        path: ["outputHash"],
        message: "Succeeded model calls require an output hash",
      });
    }
  });
export type ModelCall = z.infer<typeof modelCallSchema>;

export const agentToolCallTraceSchema = z
  .object({
    id: uuidV7Schema,
    toolName: z.string().min(3).max(100),
    sideEffect: toolSideEffectLevelSchema.nullable(),
    decision: z.enum(["allow", "deny"]),
    status: z.enum(["authorized", "denied", "succeeded", "failed"]),
    reason: z.string().min(1).max(200),
    inputHash: sha256HashSchema,
    inputSummary: z.record(z.string(), z.unknown()),
    outputSummary: z.record(z.string(), z.unknown()).nullable(),
    estimatedCostCny: z.number().nonnegative(),
    estimatedTokens: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type AgentToolCallTrace = z.infer<typeof agentToolCallTraceSchema>;

export const agentRunTraceRunSchema = z
  .object({
    id: uuidV7Schema,
    jobId: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    chapterId: uuidV7Schema.nullable(),
    stepKey: z.string().min(1).max(100),
    role: agentRoleSchema,
    status: agentRunStatusSchema,
    failureClass: agentFailureClassSchema.nullable(),
    escalationReason: z.string().min(1).max(500).nullable(),
    inputHash: sha256HashSchema,
    outputHash: sha256HashSchema.nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costCny: z.number().nonnegative(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type AgentRunTraceRun = z.infer<typeof agentRunTraceRunSchema>;

export const agentRunReplaySchema = z
  .object({
    modelConfigId: uuidV7Schema.nullable(),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    parameters: z.record(z.string(), z.unknown()),
    configHash: sha256HashSchema,
    promptVersion: z
      .object({
        id: uuidV7Schema,
        key: z.string().min(1).max(100),
        version: z.number().int().positive(),
        promptHash: sha256HashSchema,
        systemHash: sha256HashSchema,
        inputHash: sha256HashSchema,
      })
      .strict(),
  })
  .strict();
export type AgentRunReplay = z.infer<typeof agentRunReplaySchema>;

export const agentRunTraceSchema = z
  .object({
    run: agentRunTraceRunSchema,
    replay: agentRunReplaySchema.nullable(),
    promptVersions: z.array(promptVersionSchema),
    modelCalls: z.array(modelCallSchema),
    toolCalls: z.array(agentToolCallTraceSchema),
    costReservations: z.array(costReservationSchema),
  })
  .strict();
export type AgentRunTrace = z.infer<typeof agentRunTraceSchema>;

export const agentRunTraceListResponseSchema = apiEnvelopeSchema(z.array(agentRunTraceSchema));
export const agentRunTraceResponseSchema = apiEnvelopeSchema(agentRunTraceSchema);

export const ORCHESTRATOR_CONTRACT_VERSION = 1 as const;
export const ORCHESTRATOR_SCHEMA_VERSION = ORCHESTRATOR_CONTRACT_VERSION;
export const ORCHESTRATOR_AGENT_WORKFLOW_JOB = "agent_workflow" as const;

export const orchestratorRunStatusSchema = generationJobStatusSchema;
export type OrchestratorRunStatus = z.infer<typeof orchestratorRunStatusSchema>;

export const orchestratorTaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "waiting_review",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);
export type OrchestratorTaskStatus = z.infer<typeof orchestratorTaskStatusSchema>;

export const orchestratorStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);
export type OrchestratorStepStatus = z.infer<typeof orchestratorStepStatusSchema>;

export const orchestratorRiskSchema = z.enum(["low", "medium", "high"]);
export type OrchestratorRisk = z.infer<typeof orchestratorRiskSchema>;

export const orchestratorApprovalPolicySchema = z.enum(["none", "human"]);
export type OrchestratorApprovalPolicy = z.infer<typeof orchestratorApprovalPolicySchema>;

const orchestratorActorBaseShape = {
  id: uuidV7Schema,
};

export const orchestratorHumanActorSchema = z
  .object({
    type: z.literal("human"),
    ...orchestratorActorBaseShape,
  })
  .strict();
export type OrchestratorHumanActor = z.infer<typeof orchestratorHumanActorSchema>;

export const orchestratorAgentActorSchema = z
  .object({
    type: z.literal("agent"),
    ...orchestratorActorBaseShape,
  })
  .strict();
export type OrchestratorAgentActor = z.infer<typeof orchestratorAgentActorSchema>;

export const orchestratorActorSchema = z.discriminatedUnion("type", [
  orchestratorHumanActorSchema,
  orchestratorAgentActorSchema,
]);
export type OrchestratorActor = z.infer<typeof orchestratorActorSchema>;

export const orchestratorBudgetSchema = z
  .object({
    maxCostCny: z.number().positive().max(1_000),
    maxTokens: z.number().int().positive().max(10_000_000),
    maxCalls: z.number().int().positive().max(10_000),
  })
  .strict();
export type OrchestratorBudget = z.infer<typeof orchestratorBudgetSchema>;

export const orchestratorEnvelopeSchema = z
  .object({
    key: z
      .string()
      .min(3)
      .max(100)
      .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Expected a namespaced envelope key"),
    version: z.number().int().positive(),
    maxTasks: z.number().int().min(1).max(1_000),
    maxDepth: z.number().int().min(1).max(32),
    maxFanOut: z.number().int().min(0).max(64),
    maxConcurrency: z.number().int().min(1).max(8),
    dynamicSubtasks: z.boolean(),
    budget: orchestratorBudgetSchema,
  })
  .strict();
export type OrchestratorEnvelope = z.infer<typeof orchestratorEnvelopeSchema>;

export const orchestratorTaskKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]*$/, "Expected a stable task key");
export type OrchestratorTaskKey = z.infer<typeof orchestratorTaskKeySchema>;

export const orchestratorStepKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]*$/, "Expected a stable step key");
export type OrchestratorStepKey = z.infer<typeof orchestratorStepKeySchema>;

export const orchestratorTaskStepSchema = z
  .object({
    key: orchestratorStepKeySchema,
    toolName: toolNameSchema,
    input: z.record(z.string(), z.unknown()),
    estimatedCostCny: z.number().nonnegative().max(1_000),
    estimatedTokens: z.number().int().nonnegative().max(10_000_000),
  })
  .strict();
export type OrchestratorTaskStep = z.infer<typeof orchestratorTaskStepSchema>;

export const orchestratorTaskSchema = z
  .object({
    id: uuidV7Schema,
    key: orchestratorTaskKeySchema,
    title: z.string().trim().min(1).max(200),
    priority: z.number().int().min(0).max(100),
    dependsOn: z.array(orchestratorTaskKeySchema).max(64),
    role: agentRoleSchema,
    grantId: uuidV7Schema,
    resource: agentToolResourceSchema,
    affectedResources: z.number().int().positive().max(5_000),
    risk: orchestratorRiskSchema,
    approval: orchestratorApprovalPolicySchema,
    steps: z.array(orchestratorTaskStepSchema).min(1).max(32),
  })
  .strict()
  .superRefine((task, context) => {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      context.addIssue({
        code: "custom",
        path: ["dependsOn"],
        message: "Task dependencies must be unique",
      });
    }
    const stepKeys = task.steps.map((step) => step.key);
    if (new Set(stepKeys).size !== stepKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Task step keys must be unique",
      });
    }
    if (task.risk === "high" && task.approval !== "human") {
      context.addIssue({
        code: "custom",
        path: ["approval"],
        message: "High-risk tasks require a human approval gate",
      });
    }
  });
export type OrchestratorTask = z.infer<typeof orchestratorTaskSchema>;

const orchestratorCommandBaseShape = {
  schemaVersion: z.literal(ORCHESTRATOR_CONTRACT_VERSION),
  commandId: uuidV7Schema,
  runId: uuidV7Schema,
};

export const orchestratorScheduleCommandSchema = z
  .object({
    type: z.literal("schedule"),
    ...orchestratorCommandBaseShape,
    idempotencyKey: z.string().trim().min(1).max(200),
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    actor: orchestratorHumanActorSchema,
    envelope: orchestratorEnvelopeSchema,
    tasks: z.array(orchestratorTaskSchema).min(1).max(1_000),
  })
  .strict();
export type OrchestratorScheduleCommand = z.infer<typeof orchestratorScheduleCommandSchema>;

export const orchestratorPauseCommandSchema = z
  .object({
    type: z.literal("pause"),
    ...orchestratorCommandBaseShape,
    actor: orchestratorHumanActorSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type OrchestratorPauseCommand = z.infer<typeof orchestratorPauseCommandSchema>;

export const orchestratorResumeCommandSchema = z
  .object({
    type: z.literal("resume"),
    ...orchestratorCommandBaseShape,
    actor: orchestratorHumanActorSchema,
  })
  .strict();
export type OrchestratorResumeCommand = z.infer<typeof orchestratorResumeCommandSchema>;

export const orchestratorCancelCommandSchema = z
  .object({
    type: z.literal("cancel"),
    ...orchestratorCommandBaseShape,
    actor: orchestratorHumanActorSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type OrchestratorCancelCommand = z.infer<typeof orchestratorCancelCommandSchema>;

export const orchestratorApproveTaskCommandSchema = z
  .object({
    type: z.literal("approve_task"),
    ...orchestratorCommandBaseShape,
    actor: orchestratorHumanActorSchema,
    taskKey: orchestratorTaskKeySchema,
    approvalId: uuidV7Schema,
  })
  .strict();
export type OrchestratorApproveTaskCommand = z.infer<typeof orchestratorApproveTaskCommandSchema>;

export const orchestratorEscalateTaskCommandSchema = z
  .object({
    type: z.literal("escalate_task"),
    ...orchestratorCommandBaseShape,
    actor: orchestratorActorSchema,
    taskKey: orchestratorTaskKeySchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type OrchestratorEscalateTaskCommand = z.infer<typeof orchestratorEscalateTaskCommandSchema>;

export const orchestratorAddSubtasksCommandSchema = z
  .object({
    type: z.literal("add_subtasks"),
    ...orchestratorCommandBaseShape,
    actor: orchestratorActorSchema,
    parentTaskKey: orchestratorTaskKeySchema,
    tasks: z.array(orchestratorTaskSchema).min(1).max(100),
  })
  .strict();
export type OrchestratorAddSubtasksCommand = z.infer<typeof orchestratorAddSubtasksCommandSchema>;

export const orchestratorCommandSchema = z.discriminatedUnion("type", [
  orchestratorScheduleCommandSchema,
  orchestratorPauseCommandSchema,
  orchestratorResumeCommandSchema,
  orchestratorCancelCommandSchema,
  orchestratorApproveTaskCommandSchema,
  orchestratorEscalateTaskCommandSchema,
  orchestratorAddSubtasksCommandSchema,
]);
export type OrchestratorCommand = z.infer<typeof orchestratorCommandSchema>;

export const orchestratorEventTypeSchema = z.enum([
  "run.scheduled",
  "run.started",
  "run.pause_requested",
  "run.paused",
  "run.resumed",
  "run.waiting_review",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "tasks.added",
  "task.ready",
  "task.started",
  "task.waiting_review",
  "task.approved",
  "task.escalated",
  "task.succeeded",
  "task.failed",
  "task.skipped",
  "task.cancelled",
  "step.started",
  "step.succeeded",
  "step.failed",
  "step.skipped",
  "step.cancelled",
]);
export type OrchestratorEventType = z.infer<typeof orchestratorEventTypeSchema>;

export const orchestratorEventSchema = z
  .object({
    schemaVersion: z.literal(ORCHESTRATOR_CONTRACT_VERSION),
    eventId: z.string().min(1).max(120),
    runId: uuidV7Schema,
    sequence: z.number().int().positive(),
    type: orchestratorEventTypeSchema,
    occurredAt: z.string().datetime(),
    taskKey: orchestratorTaskKeySchema.nullable().default(null),
    stepKey: orchestratorStepKeySchema.nullable().default(null),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;

export const orchestratorTaskStepStateSchema = z
  .object({
    key: orchestratorStepKeySchema,
    toolName: toolNameSchema,
    input: z.record(z.string(), z.unknown()),
    estimatedCostCny: z.number().nonnegative(),
    estimatedTokens: z.number().int().nonnegative(),
    status: orchestratorStepStatusSchema,
    attempt: z.number().int().nonnegative(),
    output: z.record(z.string(), z.unknown()).default({}),
    errorCode: z.string().min(1).max(100).nullable(),
    errorMessage: z.string().min(1).max(2_000).nullable(),
  })
  .strict();
export type OrchestratorTaskStepState = z.infer<typeof orchestratorTaskStepStateSchema>;

export const orchestratorTaskStateSchema = z
  .object({
    id: uuidV7Schema,
    key: orchestratorTaskKeySchema,
    title: z.string().min(1),
    priority: z.number().int().min(0).max(100),
    dependsOn: z.array(orchestratorTaskKeySchema),
    role: agentRoleSchema,
    grantId: uuidV7Schema,
    resource: agentToolResourceSchema,
    affectedResources: z.number().int().positive(),
    risk: orchestratorRiskSchema,
    approval: orchestratorApprovalPolicySchema,
    status: orchestratorTaskStatusSchema,
    attempt: z.number().int().nonnegative(),
    approvedBy: uuidV7Schema.nullable(),
    approvalId: uuidV7Schema.nullable(),
    escalationReason: z.string().min(1).max(500).nullable(),
    steps: z.array(orchestratorTaskStepStateSchema).min(1),
  })
  .strict();
export type OrchestratorTaskState = z.infer<typeof orchestratorTaskStateSchema>;

export const orchestratorRunStateSchema = z
  .object({
    schemaVersion: z.literal(ORCHESTRATOR_CONTRACT_VERSION),
    runId: uuidV7Schema,
    ownerId: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    workflowKey: z.string().min(1),
    workflowVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(1),
    envelope: orchestratorEnvelopeSchema,
    status: orchestratorRunStatusSchema,
    pauseRequested: z.boolean(),
    cancelReason: z.string().min(1).max(500).nullable(),
    failureMessage: z.string().min(1).max(2_000).nullable(),
    lastSequence: z.number().int().nonnegative(),
    appliedCommandIds: z.array(uuidV7Schema).max(10_000),
    appliedEventIds: z.array(z.string().min(1).max(120)).max(20_000),
    tasks: z.array(orchestratorTaskStateSchema).min(1),
  })
  .strict()
  .superRefine((state, context) => {
    const keys = state.tasks.map((task) => task.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "Task keys must be unique",
      });
    }
  });
export type OrchestratorRunState = z.infer<typeof orchestratorRunStateSchema>;

export const orchestratorValidationIssueSchema = z
  .object({
    code: z.enum([
      "duplicate_task",
      "unknown_dependency",
      "cycle",
      "task_limit_exceeded",
      "depth_exceeded",
      "fanout_exceeded",
      "concurrency_exceeded",
      "budget_exceeded",
      "human_gate_required",
      "dynamic_subtasks_disabled",
      "invalid_child_task",
      "tool_not_registered",
      "role_tool_denied",
      "tool_not_agent_callable",
    ]),
    message: z.string().min(1),
    taskKey: orchestratorTaskKeySchema.nullable(),
  })
  .strict();
export type OrchestratorValidationIssue = z.infer<typeof orchestratorValidationIssueSchema>;

export const orchestratorRunResponseSchema = apiEnvelopeSchema(orchestratorRunStateSchema);

export const GOLDEN_THREE_REVIEW_DIMENSIONS = [
  "opening_hook",
  "protagonist_appeal",
  "world_rules",
  "core_conflict",
  "reader_promise",
  "chapter_end_hook",
] as const;
export const goldenThreeReviewDimensionSchema = z.enum(GOLDEN_THREE_REVIEW_DIMENSIONS);
export type GoldenThreeReviewDimension = z.infer<typeof goldenThreeReviewDimensionSchema>;

export const GOLDEN_THREE_REVIEW_DIMENSION_LABELS: Record<GoldenThreeReviewDimension, string> = {
  opening_hook: "开篇钩子",
  protagonist_appeal: "主角吸引力",
  world_rules: "世界规则展示",
  core_conflict: "核心冲突",
  reader_promise: "读者承诺",
  chapter_end_hook: "章末追读钩子",
};

export const GOLDEN_THREE_PASSING_SCORE = 4 as const;

export const goldenThreeStrategySchema = z.enum(["hook_focus", "character_focus", "world_focus"]);
export type GoldenThreeStrategy = z.infer<typeof goldenThreeStrategySchema>;

export const goldenThreeCandidateStatusSchema = z.enum(["draft", "reviewed", "selected", "locked"]);
export type GoldenThreeCandidateStatus = z.infer<typeof goldenThreeCandidateStatusSchema>;

export const goldenThreePromptProvenanceSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type GoldenThreePromptProvenance = z.infer<typeof goldenThreePromptProvenanceSchema>;

export const goldenThreeModelProvenanceSchema = z
  .object({
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict();
export type GoldenThreeModelProvenance = z.infer<typeof goldenThreeModelProvenanceSchema>;

export const goldenThreeContextProvenanceSchema = z
  .object({
    packVersionId: uuidV7Schema.nullable(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type GoldenThreeContextProvenance = z.infer<typeof goldenThreeContextProvenanceSchema>;

export const goldenThreeChapterPinInputSchema = z
  .object({
    chapterId: uuidV7Schema,
    chapterVersionId: uuidV7Schema,
    expectedContentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type GoldenThreeChapterPinInput = z.infer<typeof goldenThreeChapterPinInputSchema>;

export const goldenThreePinnedChapterSchema = z
  .object({
    chapterId: uuidV7Schema,
    chapterNumber: z.number().int().positive(),
    chapterTitle: z.string().min(1).max(200),
    chapterVersionId: uuidV7Schema,
    chapterVersion: z.number().int().positive(),
    versionNodeId: uuidV7Schema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    wordCount: z.number().int().nonnegative(),
    content: z.string(),
  })
  .strict();
export type GoldenThreePinnedChapter = z.infer<typeof goldenThreePinnedChapterSchema>;

export const goldenThreeCandidateInputSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    strategy: goldenThreeStrategySchema,
    prompt: goldenThreePromptProvenanceSchema,
    model: goldenThreeModelProvenanceSchema,
    context: goldenThreeContextProvenanceSchema,
    pins: z.array(goldenThreeChapterPinInputSchema).length(3),
  })
  .strict()
  .superRefine((candidate, context) => {
    const chapterIds = candidate.pins.map((pin) => pin.chapterId);
    if (new Set(chapterIds).size !== chapterIds.length) {
      context.addIssue({
        code: "custom",
        path: ["pins"],
        message: "A candidate must pin three distinct chapters",
      });
    }
    const versionIds = candidate.pins.map((pin) => pin.chapterVersionId);
    if (new Set(versionIds).size !== versionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["pins"],
        message: "A candidate must pin three distinct chapter versions",
      });
    }
  });
export type GoldenThreeCandidateInput = z.infer<typeof goldenThreeCandidateInputSchema>;

export const goldenThreeCandidateBatchRequestSchema = z
  .object({
    candidates: z.array(goldenThreeCandidateInputSchema).min(2).max(3),
  })
  .strict()
  .superRefine((input, context) => {
    const labels = input.candidates.map((candidate) => candidate.label.toLocaleLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate labels must be unique",
      });
    }
    const strategies = input.candidates.map((candidate) => candidate.strategy);
    if (new Set(strategies).size !== strategies.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Candidate strategies must be unique",
      });
    }
    const chapterSets = input.candidates.map((candidate) =>
      candidate.pins
        .map((pin) => pin.chapterId)
        .sort()
        .join(","),
    );
    if (new Set(chapterSets).size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Every candidate must compare the same three chapters",
      });
    }
  });
export type GoldenThreeCandidateBatchRequest = z.infer<
  typeof goldenThreeCandidateBatchRequestSchema
>;

export const goldenThreeReviewInputSchema = z
  .object({
    dimension: goldenThreeReviewDimensionSchema,
    score: z.number().int().min(1).max(5),
    evidence: z
      .object({
        chapterId: uuidV7Schema,
        chapterVersionId: uuidV7Schema,
        passage: z.string().trim().min(1).max(2_000),
        locator: z.string().trim().min(1).max(200),
      })
      .strict(),
    reviewerOrigin: z.enum(["model", "author", "critic"]),
  })
  .strict();
export type GoldenThreeReviewInput = z.infer<typeof goldenThreeReviewInputSchema>;

export const goldenThreeReviewBatchRequestSchema = z
  .object({
    version: z.number().int().positive(),
    reviews: z.array(goldenThreeReviewInputSchema).length(GOLDEN_THREE_REVIEW_DIMENSIONS.length),
  })
  .strict()
  .superRefine((input, context) => {
    const dimensions = input.reviews.map((review) => review.dimension);
    if (new Set(dimensions).size !== GOLDEN_THREE_REVIEW_DIMENSIONS.length) {
      context.addIssue({
        code: "custom",
        path: ["reviews"],
        message: "Each golden-three review dimension must appear exactly once",
      });
    }
  });
export type GoldenThreeReviewBatchRequest = z.infer<typeof goldenThreeReviewBatchRequestSchema>;

export const goldenThreeReviewSchema = goldenThreeReviewInputSchema
  .extend({
    id: uuidV7Schema,
    candidateId: uuidV7Schema,
    required: z.boolean(),
    passed: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type GoldenThreeReview = z.infer<typeof goldenThreeReviewSchema>;

export const goldenThreeReviewSummarySchema = z
  .object({
    completed: z.number().int().min(0).max(6),
    total: z.literal(6),
    requiredFailed: z.number().int().min(0).max(6),
    failedDimensions: z.array(goldenThreeReviewDimensionSchema).max(6),
  })
  .strict();
export type GoldenThreeReviewSummary = z.infer<typeof goldenThreeReviewSummarySchema>;

export const goldenThreeCandidateSchema = z
  .object({
    id: uuidV7Schema,
    batchId: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    label: z.string().min(1).max(100),
    strategy: goldenThreeStrategySchema,
    status: goldenThreeCandidateStatusSchema,
    version: z.number().int().positive(),
    prompt: goldenThreePromptProvenanceSchema,
    model: goldenThreeModelProvenanceSchema,
    context: goldenThreeContextProvenanceSchema,
    pins: z.array(goldenThreePinnedChapterSchema).length(3),
    reviews: z.array(goldenThreeReviewSchema).max(6),
    reviewSummary: goldenThreeReviewSummarySchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type GoldenThreeCandidate = z.infer<typeof goldenThreeCandidateSchema>;

export const goldenThreeGateBlockerCodeSchema = z.enum([
  "NO_CANDIDATES",
  "NO_SELECTION",
  "REVIEW_INCOMPLETE",
  "REQUIRED_DIMENSION_FAILED",
  "CANDIDATE_LOCKED",
]);
export type GoldenThreeGateBlockerCode = z.infer<typeof goldenThreeGateBlockerCodeSchema>;

export const goldenThreeGateSchema = z
  .object({
    candidateId: uuidV7Schema.nullable(),
    canLock: z.boolean(),
    blockers: z
      .array(
        z
          .object({
            code: goldenThreeGateBlockerCodeSchema,
            message: z.string().min(1),
            dimension: goldenThreeReviewDimensionSchema.nullable(),
          })
          .strict(),
      )
      .max(6),
    failedDimensions: z.array(goldenThreeReviewDimensionSchema).max(6),
  })
  .strict();
export type GoldenThreeGate = z.infer<typeof goldenThreeGateSchema>;

export const goldenThreeOverrideSchema = z
  .object({
    policy: z.literal("author_override_v1"),
    rationale: z.string().trim().min(10).max(2_000),
  })
  .strict();
export type GoldenThreeOverride = z.infer<typeof goldenThreeOverrideSchema>;

export const goldenThreeLockRequestSchema = z
  .object({
    version: z.number().int().positive(),
    override: goldenThreeOverrideSchema.optional(),
  })
  .strict();
export type GoldenThreeLockRequest = z.infer<typeof goldenThreeLockRequestSchema>;

export const goldenThreeSelectionRequestSchema = z
  .object({
    version: z.number().int().positive(),
  })
  .strict();
export type GoldenThreeSelectionRequest = z.infer<typeof goldenThreeSelectionRequestSchema>;

export const goldenThreeLockSchema = z
  .object({
    id: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    candidateId: uuidV7Schema,
    versionNodeId: uuidV7Schema,
    styleBaselineId: uuidV7Schema,
    chapterPins: z.array(goldenThreePinnedChapterSchema).length(3),
    override: goldenThreeOverrideSchema.nullable(),
    lockedBy: uuidV7Schema,
    lockedAt: z.string().datetime(),
  })
  .strict();
export type GoldenThreeLock = z.infer<typeof goldenThreeLockSchema>;

export const goldenThreeStyleBaselineSchema = z
  .object({
    id: uuidV7Schema,
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    sourceType: z.literal("golden_three"),
    sourceId: uuidV7Schema,
    version: z.number().int().positive(),
    versionNodeId: uuidV7Schema,
    profile: z
      .object({
        strategy: goldenThreeStrategySchema,
        candidateLabel: z.string().min(1).max(100),
        excerpts: z
          .array(
            z
              .object({
                chapterId: uuidV7Schema,
                chapterVersionId: uuidV7Schema,
                excerpt: z.string().min(1),
              })
              .strict(),
          )
          .length(3),
      })
      .strict(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type GoldenThreeStyleBaseline = z.infer<typeof goldenThreeStyleBaselineSchema>;

export const goldenThreeWorkspaceSchema = z
  .object({
    workId: uuidV7Schema,
    branchId: uuidV7Schema,
    candidates: z.array(goldenThreeCandidateSchema).max(3),
    selectedCandidateId: uuidV7Schema.nullable(),
    lock: goldenThreeLockSchema.nullable(),
    styleBaseline: goldenThreeStyleBaselineSchema.nullable(),
    gate: goldenThreeGateSchema,
  })
  .strict();
export type GoldenThreeWorkspace = z.infer<typeof goldenThreeWorkspaceSchema>;

export const goldenThreeWorkspaceResponseSchema = apiEnvelopeSchema(goldenThreeWorkspaceSchema);
