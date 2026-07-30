import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const workspaceStates = pgTable("workspace_states", {
  id: integer("id").primaryKey(),
  version: integer("version").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  passwordChangedAt: timestamptz("password_changed_at"),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamptz("locked_until"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_username_unique").on(table.username),
]);

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  inviteCode: text("invite_code").notNull(),
  searchable: boolean("searchable").notNull().default(false),
  workStart: text("work_start").notNull().default("10:00"),
  workEnd: text("work_end").notNull().default("19:00"),
  reportDeadlineWeekday: integer("report_deadline_weekday").notNull().default(5),
  reportDeadlineTime: text("report_deadline_time").notNull().default("19:00"),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("groups_invite_code_unique").on(table.inviteCode),
]);

export const groupMemberships = pgTable("group_memberships", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["leader", "intern"] }).notNull(),
  status: text("status", { enum: ["active", "pending", "left", "rejected"] }).notNull().default("pending"),
  note: text("note"),
  joinedAt: text("joined_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("memberships_group_user_unique").on(table.groupId, table.userId),
  index("memberships_user_status_idx").on(table.userId, table.status),
  index("memberships_group_status_idx").on(table.groupId, table.status),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  activeGroupId: text("active_group_id"),
  expiresAt: timestamptz("expires_at").notNull(),
  lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_idx").on(table.userId),
]);

export const groupWorkspaceStates = pgTable("group_workspace_states", {
  groupId: text("group_id").primaryKey(),
  version: integer("version").notNull().default(1),
  payload: text("payload").notNull(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const fileObjects = pgTable("file_objects", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("file_objects_key_unique").on(table.objectKey),
  index("file_objects_group_idx").on(table.groupId),
]);

export const importDataBatches = pgTable("import_data_batches", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  uploaderUserId: text("uploader_user_id").notNull(),
  fileObjectId: text("file_object_id").notNull(),
  period: text("period").notNull(),
  basis: text("basis").notNull(),
  metricType: text("metric_type").notNull(),
  rowCount: integer("row_count").notNull(),
  warningCount: integer("warning_count").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "revoked"] }).notNull().default("pending"),
  normalizedPayload: text("normalized_payload").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamptz("reviewed_at"),
  rejectReason: text("reject_reason"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (table) => [
  index("import_batches_group_status_idx").on(table.groupId, table.status),
]);

export const notificationJobs = pgTable("notification_jobs", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  scheduledFor: timestamptz("scheduled_for").notNull(),
  status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("sent"),
  dedupKey: text("dedup_key").notNull(),
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error"),
  sentAt: timestamptz("sent_at"),
  readAt: timestamptz("read_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("notification_jobs_dedup_unique").on(table.dedupKey),
  index("notification_jobs_due_idx").on(table.status, table.scheduledFor),
]);

export const activityEvents = pgTable("activity_events", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull(),
  userId: text("user_id").notNull(),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  metadata: text("metadata"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}, (table) => [
  index("activity_events_group_idx").on(table.groupId, table.createdAt),
]);

export const currentTimestamp = sql`CURRENT_TIMESTAMP`;
