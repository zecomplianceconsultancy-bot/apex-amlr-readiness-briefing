import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["admin", "member"]);
export const projectRole = pgEnum("project_role", ["owner", "editor", "viewer"]);
/** Ordered from least to most sensitive; see security/data-policy.ts. */
export const dataClassification = pgEnum("data_classification", [
  "public",
  "internal",
  "confidential",
  "restricted",
]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", ["complete", "streaming", "error", "cancelled"]);
export const invocationStatus = pgEnum("invocation_status", [
  "running",
  "success",
  "error",
  "blocked",
  "cancelled",
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // stored lower-cased
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("member"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/** Server-side sessions. Only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Projects (the unit of data segregation)
// ---------------------------------------------------------------------------

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  classification: dataClassification("classification").notNull().default("internal"),
  /** Mask personal data (e-mail, IBAN, BSN, phone, card numbers) before it leaves the platform. */
  piiRedaction: boolean("pii_redaction").notNull().default(true),
  defaultModelId: text("default_model_id"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_members_user_idx").on(t.userId)],
);

/**
 * Reusable project context ("standing instructions"). Append-only: every edit creates a
 * new version, and each model invocation records which version it used.
 */
export const projectContextVersions = pgTable(
  "project_context_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("project_context_version_uq").on(t.projectId, t.version)],
);

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("conversations_project_idx").on(t.projectId, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    status: messageStatus("status").notNull().default("complete"),
    /** Set for user messages. */
    authorId: uuid("author_id").references(() => users.id),
    /** Set for assistant messages: the invocation that produced this output. */
    invocationId: uuid("invocation_id").references(() => modelInvocations.id),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** SHA-256 of the original plaintext bytes; used for provenance and integrity checks. */
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    extractedText: text("extracted_text"),
    extractionError: text("extraction_error"),
    /** When true the extracted text is added to the prompt context of every chat in the project. */
    includeInContext: boolean("include_in_context").notNull().default(false),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("files_project_idx").on(t.projectId)],
);

// ---------------------------------------------------------------------------
// AI provenance: one row per call to a model provider
// ---------------------------------------------------------------------------

export const modelInvocations = pgTable(
  "model_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Why this call happened, e.g. "chat". Later: "research", "qa", "consolidate", workflow step ids. */
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    /** Registry id chosen by the user or router, e.g. "anthropic:claude-opus-5". */
    modelId: text("model_id").notNull(),
    /** Provider-side model name sent in the request. */
    modelRequested: text("model_requested").notNull(),
    /** Model/version string the provider reports it actually used. */
    modelReported: text("model_reported"),
    routing: jsonb("routing").notNull(),
    params: jsonb("params").notNull(),
    /** Exact normalized payload sent to the provider (after redaction). */
    requestPayload: jsonb("request_payload").notNull(),
    requestHash: text("request_hash").notNull(),
    /** Which context was included: project context version, files (+sha256), history size. */
    contextRefs: jsonb("context_refs").notNull(),
    /** Data policy decision and redaction summary. */
    policy: jsonb("policy").notNull(),
    status: invocationStatus("status").notNull(),
    responseText: text("response_text"),
    /** Sources the engine cited (web research tools); part of the provenance record. */
    citations: jsonb("citations").notNull().default([]),
    finishReason: text("finish_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    providerRequestId: text("provider_request_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("model_invocations_project_idx").on(t.projectId, t.startedAt),
    index("model_invocations_conversation_idx").on(t.conversationId),
  ],
);

// ---------------------------------------------------------------------------
// Audit trail: append-only and hash-chained (see drizzle/0001_audit_immutability.sql)
// ---------------------------------------------------------------------------

export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, precision: 3 }).notNull(),
    actorUserId: uuid("actor_user_id"),
    actorType: text("actor_type").notNull(), // "user" | "system"
    action: text("action").notNull(),
    projectId: uuid("project_id"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    details: jsonb("details").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    index("audit_events_project_idx").on(t.projectId, t.seq),
    index("audit_events_actor_idx").on(t.actorUserId, t.seq),
  ],
);
