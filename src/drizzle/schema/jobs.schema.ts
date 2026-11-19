import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core"

import { sharedTimestampColumns } from "../utils"

/**
 * One generation request. The worker takes it from the Redis queue, runs it on its engine and records how it
 * ended here.
 */
export const jobs = pgTable.withRLS(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: varchar("kind", { length: 20 }).notNull().$type<Media.JobKind>(),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("queued")
      .$type<Media.JobStatus>(),
    prompt: text("prompt").notNull().default(""),
    params: jsonb("params").notNull().$type<Media.JobParams>(),
    error: text("error"),
    // What a job wrote when that is text rather than files: a caption job's description and prompts
    result: jsonb("result").$type<Media.Caption>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...sharedTimestampColumns
  },
  (self) => [
    index("jobs_created_at_index").on(self.createdAt.desc()),
    index("jobs_kind_created_at_index").on(self.kind, self.createdAt.desc()),
    index("jobs_status_index").on(self.status)
  ]
)

/**
 * A media file on disk: a reference image the user uploaded (`job_id` is null) or something a job made.
 * `path` is relative to the ComfyUI directory named by `root`, with forward slashes.
 */
export const assets = pgTable.withRLS(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull().$type<Media.AssetKind>(),
    role: varchar("role", { length: 20 }).notNull().$type<Media.AssetRole>(),
    root: varchar("root", { length: 10 }).notNull().$type<Media.AssetRoot>(),
    path: text("path").notNull(),
    mime: varchar("mime_type", { length: 50 }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    size: bigint("size_bytes", { mode: "number" }).notNull(),
    // Order within the job and role: image 1, 2, … or the frame number
    position: integer("position").notNull().default(0),
    isFavorite: boolean("is_favorite").notNull().default(false),
    ...sharedTimestampColumns
  },
  (self) => [
    uniqueIndex("assets_root_path_index").on(self.root, self.path),
    index("assets_job_role_position_index").on(self.jobId, self.role, self.position),
    index("assets_role_created_at_index").on(self.role, self.createdAt.desc())
  ]
)

/**
 * The reference images of a job, in the order the model sees them. An asset can feed many jobs: an upload
 * reused, or an earlier output sent back in.
 */
export const jobInputs = pgTable.withRLS(
  "job_inputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    ...sharedTimestampColumns
  },
  (self) => [
    uniqueIndex("job_inputs_job_position_index").on(self.jobId, self.position),
    index("job_inputs_asset_index").on(self.assetId)
  ]
)
