var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../lib/db/src/schema/appConfig.ts
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
var appConfig;
var init_appConfig = __esm({
  "../../lib/db/src/schema/appConfig.ts"() {
    "use strict";
    appConfig = pgTable("app_config", {
      key: text("key").primaryKey(),
      value: text("value"),
      isSecret: boolean("is_secret").notNull().default(false),
      description: text("description"),
      environment: text("environment").notNull().default("all"),
      updatedAt: timestamp("updated_at").notNull().defaultNow(),
      updatedBy: text("updated_by")
    });
  }
});

// ../../lib/db/src/schema/aiReview.ts
import {
  pgTable as pgTable2,
  pgEnum,
  serial,
  text as text2,
  integer,
  numeric,
  boolean as boolean2,
  timestamp as timestamp2,
  jsonb,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";
var aiReviewStatusEnum, aiReviewQueueEnum, aiReviewPriorityEnum, aiReviewDecisionEnum, aiLearningFeedbackStatusEnum, aiRulePackageStatusEnum, aiReviewAuditEventTypeEnum, aiReviewCasesTable, aiReviewSnapshotsTable, aiReviewerDecisionsTable, aiReviewAuditEventsTable, aiLearningFeedbackTable, aiRuleRecommendationPackagesTable;
var init_aiReview = __esm({
  "../../lib/db/src/schema/aiReview.ts"() {
    "use strict";
    aiReviewStatusEnum = pgEnum("ai_review_status", [
      "OPEN",
      "QUEUED",
      "ASSIGNED",
      "IN_REVIEW",
      "NEEDS_INFORMATION",
      "APPROVED_RECOMMENDATION",
      "CHANGED_COA",
      "REJECTED_RECOMMENDATION",
      "ESCALATED",
      "CANCELLED",
      "CLOSED"
    ]);
    aiReviewQueueEnum = pgEnum("ai_review_queue", [
      "AUTO_CLEAR_CANDIDATE",
      "STANDARD_FINANCE_REVIEW",
      "ACCOUNTING_REVIEW",
      "TREASURY_REVIEW",
      "TAX_REVIEW",
      "PAYROLL_REVIEW",
      "INTERCOMPANY_REVIEW",
      "ANOMALY_REVIEW",
      "HIGH_RISK_REVIEW",
      "DATA_QUALITY_REVIEW"
    ]);
    aiReviewPriorityEnum = pgEnum("ai_review_priority", [
      "LOW",
      "NORMAL",
      "HIGH",
      "URGENT",
      "CRITICAL"
    ]);
    aiReviewDecisionEnum = pgEnum("ai_review_decision_type", [
      "APPROVE_RECOMMENDATION",
      "CHANGE_COA",
      "REJECT_RECOMMENDATION",
      "REQUEST_INFORMATION",
      "ESCALATE"
    ]);
    aiLearningFeedbackStatusEnum = pgEnum("ai_learning_feedback_status", [
      "PENDING",
      "PROCESSED",
      "IGNORED"
    ]);
    aiRulePackageStatusEnum = pgEnum("ai_rule_package_status", [
      "DRAFT",
      "PENDING_REVIEW",
      "APPROVED",
      "REJECTED",
      "ARCHIVED"
    ]);
    aiReviewAuditEventTypeEnum = pgEnum("ai_review_audit_event_type", [
      "CASE_CREATED",
      "QUEUED",
      "ASSIGNED",
      "REVIEW_STARTED",
      "INFORMATION_REQUESTED",
      "RECOMMENDATION_APPROVED",
      "COA_CHANGED",
      "RECOMMENDATION_REJECTED",
      "ESCALATED",
      "REEVALUATED",
      "CANCELLED",
      "CLOSED"
    ]);
    aiReviewCasesTable = pgTable2(
      "ai_review_cases",
      {
        id: serial("id").primaryKey(),
        companyId: integer("company_id").notNull(),
        transactionId: text2("transaction_id"),
        source: text2("source").notNull().default("bank_mutation"),
        sourceRecordId: text2("source_record_id"),
        idempotencyKey: text2("idempotency_key").notNull(),
        queue: aiReviewQueueEnum("queue").notNull(),
        priority: aiReviewPriorityEnum("priority").notNull().default("NORMAL"),
        status: aiReviewStatusEnum("status").notNull().default("OPEN"),
        intent: text2("intent"),
        intentConfidence: numeric("intent_confidence", { precision: 6, scale: 4 }),
        recommendedCoaId: integer("recommended_coa_id"),
        recommendedCoaCode: text2("recommended_coa_code"),
        recommendedCoaName: text2("recommended_coa_name"),
        recommendedCoaConfidence: numeric("recommended_coa_confidence", { precision: 6, scale: 4 }),
        anomalyScore: numeric("anomaly_score", { precision: 6, scale: 4 }),
        anomalyRisk: text2("anomaly_risk"),
        requiresManualReview: boolean2("requires_manual_review").notNull().default(true),
        decisionPolicyVersion: text2("decision_policy_version"),
        orchestrationVersion: text2("orchestration_version"),
        snapshotVersion: text2("snapshot_version"),
        flagsJson: jsonb("flags_json"),
        anomalyTypesJson: jsonb("anomaly_types_json"),
        assignedReviewerId: text2("assigned_reviewer_id"),
        assignedReviewerRole: text2("assigned_reviewer_role"),
        assignedAt: timestamp2("assigned_at"),
        createdBy: text2("created_by"),
        createdAt: timestamp2("created_at").notNull().defaultNow(),
        updatedAt: timestamp2("updated_at").notNull().defaultNow(),
        dueAt: timestamp2("due_at"),
        closedAt: timestamp2("closed_at")
      },
      (t) => ({
        idempotencyUniq: uniqueIndex("ai_review_cases_idempotency_uniq").on(
          t.companyId,
          t.idempotencyKey
        ),
        companyStatusIdx: index("ai_review_cases_company_status_idx").on(
          t.companyId,
          t.status
        ),
        companyQueueIdx: index("ai_review_cases_company_queue_idx").on(
          t.companyId,
          t.queue
        ),
        transactionIdx: index("ai_review_cases_transaction_idx").on(t.transactionId),
        createdAtIdx: index("ai_review_cases_created_at_idx").on(t.createdAt),
        dueAtIdx: index("ai_review_cases_due_at_idx").on(t.dueAt)
      })
    );
    aiReviewSnapshotsTable = pgTable2(
      "ai_review_snapshots",
      {
        id: serial("id").primaryKey(),
        reviewCaseId: integer("review_case_id").notNull(),
        companyId: integer("company_id").notNull(),
        transactionSnapshotJson: jsonb("transaction_snapshot_json").notNull(),
        phase1SnapshotJson: jsonb("phase1_snapshot_json"),
        phase2SnapshotJson: jsonb("phase2_snapshot_json"),
        phase3SnapshotJson: jsonb("phase3_snapshot_json"),
        phase4SnapshotJson: jsonb("phase4_snapshot_json"),
        phase7SnapshotJson: jsonb("phase7_snapshot_json"),
        phase8SnapshotJson: jsonb("phase8_snapshot_json"),
        phase9SnapshotJson: jsonb("phase9_snapshot_json"),
        snapshotChecksum: text2("snapshot_checksum").notNull(),
        snapshotVersion: integer("snapshot_version").notNull().default(1),
        createdAt: timestamp2("created_at").notNull().defaultNow()
      },
      (t) => ({
        caseVersionUniq: uniqueIndex("ai_review_snapshots_case_version_uniq").on(
          t.reviewCaseId,
          t.snapshotVersion
        ),
        caseIdIdx: index("ai_review_snapshots_case_id_idx").on(t.reviewCaseId),
        companyIdx: index("ai_review_snapshots_company_idx").on(t.companyId)
      })
    );
    aiReviewerDecisionsTable = pgTable2(
      "ai_reviewer_decisions",
      {
        id: serial("id").primaryKey(),
        reviewCaseId: integer("review_case_id").notNull(),
        companyId: integer("company_id").notNull(),
        reviewerId: text2("reviewer_id").notNull(),
        decision: aiReviewDecisionEnum("decision").notNull(),
        previousStatus: aiReviewStatusEnum("previous_status").notNull(),
        newStatus: aiReviewStatusEnum("new_status").notNull(),
        selectedCoaId: integer("selected_coa_id"),
        selectedCoaCode: text2("selected_coa_code"),
        selectedCoaName: text2("selected_coa_name"),
        reasonCode: text2("reason_code"),
        comments: text2("comments"),
        reviewerConfidence: numeric("reviewer_confidence", { precision: 4, scale: 2 }),
        idempotencyKey: text2("idempotency_key").notNull(),
        decidedAt: timestamp2("decided_at").notNull(),
        createdAt: timestamp2("created_at").notNull().defaultNow()
      },
      (t) => ({
        idempotencyUniq: uniqueIndex("ai_reviewer_decisions_idempotency_uniq").on(
          t.companyId,
          t.idempotencyKey
        ),
        caseIdIdx: index("ai_reviewer_decisions_case_id_idx").on(t.reviewCaseId),
        reviewerIdx: index("ai_reviewer_decisions_reviewer_idx").on(t.reviewerId)
      })
    );
    aiReviewAuditEventsTable = pgTable2(
      "ai_review_audit_events",
      {
        id: serial("id").primaryKey(),
        reviewCaseId: integer("review_case_id").notNull(),
        companyId: integer("company_id").notNull(),
        eventType: aiReviewAuditEventTypeEnum("event_type").notNull(),
        actorType: text2("actor_type").notNull().default("SYSTEM"),
        actorId: text2("actor_id"),
        previousStatus: aiReviewStatusEnum("previous_status"),
        newStatus: aiReviewStatusEnum("new_status"),
        reason: text2("reason"),
        metadataJson: jsonb("metadata_json"),
        occurredAt: timestamp2("occurred_at").notNull(),
        createdAt: timestamp2("created_at").notNull().defaultNow()
      },
      (t) => ({
        caseIdIdx: index("ai_review_audit_events_case_id_idx").on(t.reviewCaseId),
        companyOccurredIdx: index("ai_review_audit_events_company_occurred_idx").on(
          t.companyId,
          t.occurredAt
        )
      })
    );
    aiLearningFeedbackTable = pgTable2(
      "ai_learning_feedback",
      {
        id: serial("id").primaryKey(),
        companyId: integer("company_id").notNull(),
        reviewCaseId: integer("review_case_id"),
        reviewerDecisionId: integer("reviewer_decision_id"),
        transactionId: text2("transaction_id"),
        intent: text2("intent"),
        aiRecommendedCoaCode: text2("ai_recommended_coa_code"),
        reviewerSelectedCoaCode: text2("reviewer_selected_coa_code"),
        agreement: boolean2("agreement"),
        reasonCode: text2("reason_code"),
        feedbackPayloadJson: jsonb("feedback_payload_json"),
        status: aiLearningFeedbackStatusEnum("status").notNull().default("PENDING"),
        createdAt: timestamp2("created_at").notNull().defaultNow(),
        processedAt: timestamp2("processed_at")
      },
      (t) => ({
        companyStatusIdx: index("ai_learning_feedback_company_status_idx").on(
          t.companyId,
          t.status
        ),
        reviewCaseIdx: index("ai_learning_feedback_review_case_idx").on(t.reviewCaseId)
      })
    );
    aiRuleRecommendationPackagesTable = pgTable2(
      "ai_rule_recommendation_packages",
      {
        id: serial("id").primaryKey(),
        companyId: integer("company_id").notNull(),
        packageType: text2("package_type").notNull(),
        status: aiRulePackageStatusEnum("status").notNull().default("DRAFT"),
        recommendationPayloadJson: jsonb("recommendation_payload_json"),
        simulationPayloadJson: jsonb("simulation_payload_json"),
        impactPayloadJson: jsonb("impact_payload_json"),
        riskLevel: text2("risk_level"),
        priority: integer("priority").notNull().default(0),
        requiresHumanApproval: boolean2("requires_human_approval").notNull().default(true),
        createdBy: text2("created_by"),
        reviewedBy: text2("reviewed_by"),
        createdAt: timestamp2("created_at").notNull().defaultNow(),
        reviewedAt: timestamp2("reviewed_at")
      },
      (t) => ({
        companyStatusIdx: index("ai_rule_packages_company_status_idx").on(
          t.companyId,
          t.status
        )
      })
    );
  }
});

// ../../lib/db/src/schema/companies.ts
import {
  pgTable as pgTable3,
  serial as serial2,
  text as text3,
  boolean as boolean3,
  integer as integer2,
  timestamp as timestamp3
} from "drizzle-orm/pg-core";
var companiesTable, companyLegalDocumentsTable;
var init_companies = __esm({
  "../../lib/db/src/schema/companies.ts"() {
    "use strict";
    companiesTable = pgTable3("companies", {
      id: serial2("id").primaryKey(),
      companyName: text3("company_name").notNull(),
      companyCode: text3("company_code").notNull().unique(),
      logoUrl: text3("logo_url"),
      address: text3("address"),
      city: text3("city"),
      province: text3("province"),
      postalCode: text3("postal_code"),
      kodeWilayah: text3("kode_wilayah"),
      phone: text3("phone"),
      fax: text3("fax"),
      email: text3("email"),
      website: text3("website"),
      // Perpajakan
      npwp: text3("npwp"),
      npwpStatus: text3("npwp_status"),
      kegiatanUtama: text3("kegiatan_utama"),
      jenisWajibPajak: text3("jenis_wajib_pajak"),
      bentukBadanHukum: text3("bentuk_badan_hukum"),
      tanggalTerdaftar: text3("tanggal_terdaftar"),
      tanggalAktivasi: text3("tanggal_aktivasi"),
      statusPkp: boolean3("status_pkp"),
      tanggalPkp: text3("tanggal_pkp"),
      kanwilDjp: text3("kanwil_djp"),
      kppTerdaftar: text3("kpp_terdaftar"),
      seksiPengawasan: text3("seksi_pengawasan"),
      tanggalPembaruanProfil: text3("tanggal_pembaruan_profil"),
      kodeKlu: text3("kode_klu"),
      deskripsiKlu: text3("deskripsi_klu"),
      // Legalitas
      nib: text3("nib"),
      isActive: boolean3("is_active").notNull().default(true),
      createdAt: timestamp3("created_at").defaultNow().notNull(),
      isHolding: boolean3("is_holding").notNull().default(false),
      parentCompanyId: integer2("parent_company_id")
    });
    companyLegalDocumentsTable = pgTable3("company_legal_documents", {
      id: serial2("id").primaryKey(),
      companyId: integer2("company_id").notNull(),
      docType: text3("doc_type").notNull(),
      docName: text3("doc_name").notNull(),
      fileUrl: text3("file_url").notNull(),
      fileSize: integer2("file_size"),
      mimeType: text3("mime_type"),
      notes: text3("notes"),
      uploadedBy: integer2("uploaded_by"),
      createdAt: timestamp3("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/orgStructure.ts
import { pgTable as pgTable4, serial as serial3, text as text4, integer as integer3, boolean as boolean4, timestamp as timestamp4, index as index2, uniqueIndex as uniqueIndex2 } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
var branchesTable, divisionsTable, departmentsTable, sectionsTable, insertBranchSchema, insertDivisionSchema, insertDepartmentSchema, insertSectionSchema;
var init_orgStructure = __esm({
  "../../lib/db/src/schema/orgStructure.ts"() {
    "use strict";
    init_companies();
    branchesTable = pgTable4("branches", {
      id: serial3("id").primaryKey(),
      companyId: integer3("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
      name: text4("name").notNull(),
      code: text4("code"),
      address: text4("address"),
      phone: text4("phone"),
      isActive: boolean4("is_active").notNull().default(true),
      createdAt: timestamp4("created_at").defaultNow().notNull()
    }, (t) => [
      index2("branches_company_idx").on(t.companyId),
      uniqueIndex2("branches_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`)
    ]);
    divisionsTable = pgTable4("divisions", {
      id: serial3("id").primaryKey(),
      companyId: integer3("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
      branchId: integer3("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
      name: text4("name").notNull(),
      code: text4("code"),
      description: text4("description"),
      managerId: text4("manager_id"),
      isActive: boolean4("is_active").notNull().default(true),
      createdAt: timestamp4("created_at").defaultNow().notNull()
    }, (t) => [
      index2("divisions_company_idx").on(t.companyId),
      uniqueIndex2("divisions_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`),
      index2("divisions_branch_idx").on(t.branchId)
    ]);
    departmentsTable = pgTable4("departments", {
      id: serial3("id").primaryKey(),
      companyId: integer3("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
      branchId: integer3("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
      divisionId: integer3("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
      name: text4("name").notNull(),
      code: text4("code"),
      description: text4("description"),
      managerId: text4("manager_id"),
      isActive: boolean4("is_active").notNull().default(true),
      createdAt: timestamp4("created_at").defaultNow().notNull()
    }, (t) => [
      index2("departments_company_idx").on(t.companyId),
      index2("departments_division_idx").on(t.divisionId),
      uniqueIndex2("departments_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`),
      index2("departments_branch_idx").on(t.branchId)
    ]);
    sectionsTable = pgTable4("sections", {
      id: serial3("id").primaryKey(),
      companyId: integer3("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
      departmentId: integer3("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
      name: text4("name").notNull(),
      code: text4("code"),
      description: text4("description"),
      isActive: boolean4("is_active").notNull().default(true),
      createdAt: timestamp4("created_at").defaultNow().notNull()
    }, (t) => [
      index2("sections_company_idx").on(t.companyId),
      index2("sections_department_idx").on(t.departmentId),
      uniqueIndex2("sections_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`)
    ]);
    insertBranchSchema = createInsertSchema(branchesTable).omit({ id: true, createdAt: true });
    insertDivisionSchema = createInsertSchema(divisionsTable).omit({ id: true, createdAt: true });
    insertDepartmentSchema = createInsertSchema(departmentsTable).omit({ id: true, createdAt: true });
    insertSectionSchema = createInsertSchema(sectionsTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/customRoles.ts
import { pgTable as pgTable5, serial as serial4, text as text5, timestamp as timestamp5, integer as integer4, jsonb as jsonb2, index as index3 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema2 } from "drizzle-zod";
var customRolesTable, insertCustomRoleSchema;
var init_customRoles = __esm({
  "../../lib/db/src/schema/customRoles.ts"() {
    "use strict";
    init_companies();
    init_orgStructure();
    customRolesTable = pgTable5("custom_roles", {
      id: serial4("id").primaryKey(),
      companyId: integer4("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      name: text5("name").notNull(),
      description: text5("description"),
      color: text5("color").notNull().default("#6366f1"),
      permissions: jsonb2("permissions").notNull().default([]),
      scopeType: text5("scope_type").default("company_only"),
      branchId: integer4("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
      divisionId: integer4("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
      departmentId: integer4("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
      createdAt: timestamp5("created_at").defaultNow().notNull(),
      updatedAt: timestamp5("updated_at").defaultNow().notNull()
    }, (t) => [
      index3("custom_roles_company_idx").on(t.companyId),
      index3("custom_roles_scope_idx").on(t.scopeType)
    ]);
    insertCustomRoleSchema = createInsertSchema2(customRolesTable).omit({ id: true, createdAt: true, updatedAt: true });
  }
});

// ../../lib/db/src/schema/users.ts
import { pgTable as pgTable6, text as text6, timestamp as timestamp6, pgEnum as pgEnum2, integer as integer5, serial as serial5 } from "drizzle-orm/pg-core";
import { uniqueIndex as uniqueIndex3 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema3 } from "drizzle-zod";
var userRoleEnum, usersTable, insertUserSchema, userAllowedCompaniesTable;
var init_users = __esm({
  "../../lib/db/src/schema/users.ts"() {
    "use strict";
    init_companies();
    init_orgStructure();
    init_customRoles();
    userRoleEnum = pgEnum2("user_role", ["admin", "ecommerce", "trading", "logistics"]);
    usersTable = pgTable6("users", {
      id: text6("id").primaryKey(),
      email: text6("email").notNull().unique(),
      name: text6("name").notNull().default(""),
      firstName: text6("first_name"),
      lastName: text6("last_name"),
      profileImageUrl: text6("profile_image_url"),
      role: userRoleEnum("role").default("ecommerce").notNull(),
      division: text6("division"),
      department: text6("department"),
      companyId: integer5("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      branchId: integer5("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
      divisionId: integer5("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
      departmentId: integer5("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
      sectionId: integer5("section_id").references(() => sectionsTable.id, { onDelete: "set null" }),
      customRoleId: integer5("custom_role_id").references(() => customRolesTable.id, { onDelete: "set null" }),
      defaultBranchId: integer5("default_branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
      systemRole: text6("system_role"),
      whatsapp: text6("whatsapp"),
      passwordHash: text6("password_hash"),
      createdAt: timestamp6("created_at").defaultNow().notNull(),
      updatedAt: timestamp6("updated_at").defaultNow().notNull()
    });
    insertUserSchema = createInsertSchema3(usersTable).omit({ createdAt: true, updatedAt: true });
    userAllowedCompaniesTable = pgTable6("user_allowed_companies", {
      id: serial5("id").primaryKey(),
      userId: text6("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
      companyId: integer5("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
      createdAt: timestamp6("created_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex3("uac_user_company_idx").on(t.userId, t.companyId)
    ]);
  }
});

// ../../lib/db/src/schema/auth.ts
import { index as index4, jsonb as jsonb3, pgTable as pgTable7, timestamp as timestamp7, varchar } from "drizzle-orm/pg-core";
var sessionsTable;
var init_auth = __esm({
  "../../lib/db/src/schema/auth.ts"() {
    "use strict";
    sessionsTable = pgTable7(
      "sessions",
      {
        sid: varchar("sid").primaryKey(),
        sess: jsonb3("sess").notNull(),
        expire: timestamp7("expire").notNull()
      },
      (table) => [index4("IDX_session_expire").on(table.expire)]
    );
  }
});

// ../../lib/db/src/schema/uom.ts
import { pgTable as pgTable8, serial as serial6, text as text7, numeric as numeric2, integer as integer6, boolean as boolean5, timestamp as timestamp8, unique } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema4 } from "drizzle-zod";
var uomTable, uomConversionsTable, insertUomSchema, insertUomConversionSchema;
var init_uom = __esm({
  "../../lib/db/src/schema/uom.ts"() {
    "use strict";
    uomTable = pgTable8("uom", {
      id: serial6("id").primaryKey(),
      name: text7("name").notNull().unique(),
      symbol: text7("symbol").notNull(),
      category: text7("category").notNull().default("count"),
      isActive: boolean5("is_active").notNull().default(true),
      createdAt: timestamp8("created_at").defaultNow().notNull()
    });
    uomConversionsTable = pgTable8("uom_conversions", {
      id: serial6("id").primaryKey(),
      fromUomId: integer6("from_uom_id").notNull().references(() => uomTable.id, { onDelete: "cascade" }),
      toUomId: integer6("to_uom_id").notNull().references(() => uomTable.id, { onDelete: "cascade" }),
      factor: numeric2("factor", { precision: 18, scale: 6 }).notNull(),
      createdAt: timestamp8("created_at").defaultNow().notNull()
    }, (t) => [
      unique("uom_conversions_pair_uidx").on(t.fromUomId, t.toUomId)
    ]);
    insertUomSchema = createInsertSchema4(uomTable).omit({ id: true, createdAt: true });
    insertUomConversionSchema = createInsertSchema4(uomConversionsTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/products.ts
import { pgTable as pgTable9, serial as serial7, text as text8, numeric as numeric3, integer as integer7, timestamp as timestamp9, boolean as boolean6, primaryKey, index as index5 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema5 } from "drizzle-zod";
var productCategoriesTable, insertProductCategorySchema, productsTable, insertProductSchema, productCategoryMapTable;
var init_products = __esm({
  "../../lib/db/src/schema/products.ts"() {
    "use strict";
    init_uom();
    init_companies();
    productCategoriesTable = pgTable9("product_categories", {
      id: serial7("id").primaryKey(),
      name: text8("name").notNull().unique(),
      createdAt: timestamp9("created_at").defaultNow().notNull()
    });
    insertProductCategorySchema = createInsertSchema5(productCategoriesTable).omit({ id: true, createdAt: true });
    productsTable = pgTable9("products", {
      id: serial7("id").primaryKey(),
      companyId: integer7("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      name: text8("name").notNull(),
      sku: text8("sku").notNull().unique(),
      price: numeric3("price", { precision: 12, scale: 2 }).notNull(),
      costPrice: numeric3("cost_price", { precision: 12, scale: 2 }).default("0"),
      stock: integer7("stock").notNull().default(0),
      description: text8("description"),
      imageUrl: text8("image_url"),
      mediaItems: text8("media_items").default("[]"),
      defaultSalesTaxId: integer7("default_sales_tax_id"),
      defaultPurchaseTaxId: integer7("default_purchase_tax_id"),
      itemType: text8("item_type").notNull().default("barang"),
      unit: text8("unit").notNull().default("pcs"),
      unitOptions: text8("unit_options").notNull().default("[]"),
      baseUomId: integer7("base_uom_id").references(() => uomTable.id, { onDelete: "set null" }),
      subcategory: text8("subcategory"),
      isActive: boolean6("is_active").notNull().default(true),
      weightKg: numeric3("weight_kg", { precision: 10, scale: 3 }),
      volumeCbm: numeric3("volume_cbm", { precision: 12, scale: 4 }),
      lengthCm: numeric3("length_cm", { precision: 10, scale: 2 }),
      widthCm: numeric3("width_cm", { precision: 10, scale: 2 }),
      heightCm: numeric3("height_cm", { precision: 10, scale: 2 }),
      goodsType: text8("goods_type"),
      currencyCode: text8("currency_code").notNull().default("IDR"),
      createdAt: timestamp9("created_at").defaultNow().notNull()
    }, (t) => [
      index5("products_company_idx").on(t.companyId)
    ]);
    insertProductSchema = createInsertSchema5(productsTable).omit({ id: true, createdAt: true });
    productCategoryMapTable = pgTable9("product_category_map", {
      productId: integer7("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      categoryId: integer7("category_id").notNull().references(() => productCategoriesTable.id, { onDelete: "cascade" })
    }, (table) => [
      primaryKey({ columns: [table.productId, table.categoryId] })
    ]);
  }
});

// ../../lib/db/src/schema/orders.ts
import { pgTable as pgTable10, serial as serial8, text as text9, numeric as numeric4, timestamp as timestamp10, pgEnum as pgEnum3, jsonb as jsonb4, index as index6, integer as integer8 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema6 } from "drizzle-zod";
var orderStatusEnum, ordersTable, insertOrderSchema;
var init_orders = __esm({
  "../../lib/db/src/schema/orders.ts"() {
    "use strict";
    init_companies();
    orderStatusEnum = pgEnum3("order_status", ["pending", "processing", "shipped", "delivered", "cancelled"]);
    ordersTable = pgTable10("orders", {
      id: serial8("id").primaryKey(),
      companyId: integer8("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      customerName: text9("customer_name").notNull(),
      customerEmail: text9("customer_email").notNull(),
      customerPhone: text9("customer_phone"),
      status: orderStatusEnum("status").default("pending").notNull(),
      totalAmount: numeric4("total_amount", { precision: 12, scale: 2 }).notNull(),
      taxAmount: numeric4("tax_amount", { precision: 12, scale: 2 }).default("0").notNull(),
      grandTotal: numeric4("grand_total", { precision: 12, scale: 2 }).notNull(),
      items: text9("items"),
      lineItems: jsonb4("line_items").$type(),
      createdAt: timestamp10("created_at").defaultNow().notNull()
    }, (t) => [
      // [H5-FIX] Performance indexes: full table scan tiap query tanpa ini
      index6("orders_customer_email_idx").on(t.customerEmail),
      index6("orders_status_idx").on(t.status),
      index6("orders_created_at_idx").on(t.createdAt),
      index6("orders_company_idx").on(t.companyId)
    ]);
    insertOrderSchema = createInsertSchema6(ordersTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/suppliers.ts
import { pgTable as pgTable11, serial as serial9, text as text10, integer as integer9, timestamp as timestamp11, boolean as boolean7, numeric as numeric5, index as index7, jsonb as jsonb5, date, uniqueIndex as uniqueIndex4 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema7 } from "drizzle-zod";
var suppliersTable, vendorCatalogItemsTable, supplierDocumentsTable, supplierStatusHistoryTable, supplierReviewsTable, vendorAuditLogsTable, insertSupplierSchema, insertVendorCatalogItemSchema;
var init_suppliers = __esm({
  "../../lib/db/src/schema/suppliers.ts"() {
    "use strict";
    init_companies();
    init_products();
    suppliersTable = pgTable11("suppliers", {
      id: serial9("id").primaryKey(),
      companyId: integer9("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      name: text10("name").notNull(),
      country: text10("country"),
      contactEmail: text10("contact_email"),
      contactPerson: text10("contact_person"),
      phone: text10("phone"),
      address: text10("address"),
      taxId: text10("tax_id"),
      npwp: text10("npwp"),
      nib: text10("nib"),
      defaultPurchaseTaxId: integer9("default_purchase_tax_id"),
      serviceType: text10("service_type"),
      isActive: boolean7("is_active").notNull().default(true),
      logo: text10("logo").notNull().default("\u{1F4E6}"),
      eta: text10("eta"),
      fee: numeric5("fee", { precision: 12, scale: 2 }).default("0"),
      markup: numeric5("markup", { precision: 5, scale: 2 }).default("0"),
      note: text10("note"),
      sortOrder: integer9("sort_order").notNull().default(0),
      yearVehicle: integer9("year_vehicle"),
      supportedModes: text10("supported_modes").array(),
      etaDaysMin: integer9("eta_days_min"),
      etaDaysMax: integer9("eta_days_max"),
      hasInternalTruck: boolean7("has_internal_truck").notNull().default(false),
      internalTruckPrice: numeric5("internal_truck_price", { precision: 14, scale: 2 }),
      createdAt: timestamp11("created_at").defaultNow().notNull(),
      updatedAt: timestamp11("updated_at").defaultNow().notNull(),
      // ── Fase 1: Status Granular ──────────────────────────────────────────────────
      status: text10("status").notNull().default("active"),
      vendorCode: text10("vendor_code"),
      isVerified: boolean7("is_verified").notNull().default(false),
      verifiedAt: timestamp11("verified_at"),
      verifiedBy: text10("verified_by"),
      statusReason: text10("status_reason"),
      statusChangedAt: timestamp11("status_changed_at"),
      statusChangedBy: text10("status_changed_by"),
      // ── Fase 2: Profil Marketplace ───────────────────────────────────────────────
      logoUrl: text10("logo_url"),
      coverUrl: text10("cover_url"),
      descriptionPublic: text10("description_public"),
      serviceAreas: jsonb5("service_areas").$type(),
      isPremium: boolean7("is_premium").notNull().default(false),
      isFeatured: boolean7("is_featured").notNull().default(false),
      marketplaceStatus: text10("marketplace_status").notNull().default("draft"),
      marketplacePublishedAt: timestamp11("marketplace_published_at"),
      marketplacePublishedBy: text10("marketplace_published_by"),
      publicSlug: text10("public_slug"),
      // ── Internal Vendor Flag ─────────────────────────────────────────────────────
      // Platform tidak mengambil markup dari vendor internal (perusahaan sendiri).
      // Set true untuk entitas dalam grup CST (misal PT Cahaya Sejati Teknologi, dll.)
      isInternalVendor: boolean7("is_internal_vendor").notNull().default(false),
      // ── Company Profile Extended ─────────────────────────────────────────────────
      companyBanner: text10("company_banner"),
      vision: text10("vision"),
      mission: text10("mission"),
      establishedYear: integer9("established_year"),
      mainMarket: text10("main_market"),
      factoryAddress: text10("factory_address"),
      officeAddress: text10("office_address"),
      warehouseAddress: text10("warehouse_address"),
      website: text10("website"),
      socialMedia: jsonb5("social_media"),
      latitude: numeric5("latitude", { precision: 10, scale: 7 }),
      longitude: numeric5("longitude", { precision: 10, scale: 7 })
    }, (t) => [
      index7("suppliers_company_idx").on(t.companyId),
      index7("suppliers_status_idx").on(t.status),
      index7("suppliers_is_verified_idx").on(t.isVerified),
      index7("suppliers_marketplace_status_idx").on(t.marketplaceStatus),
      uniqueIndex4("suppliers_public_slug_unique").on(t.publicSlug),
      uniqueIndex4("suppliers_vendor_code_unique").on(t.vendorCode)
    ]);
    vendorCatalogItemsTable = pgTable11("vendor_catalog_items", {
      // ── Core identity ──────────────────────────────────────────────────────────
      id: serial9("id").primaryKey(),
      vendorId: integer9("vendor_id").notNull().references(() => suppliersTable.id),
      vendorName: text10("vendor_name"),
      masterItemId: integer9("master_item_id").references(() => productsTable.id, { onDelete: "set null" }),
      // ── Legacy fields (backward compat) ───────────────────────────────────────
      type: text10("type").notNull().default("service"),
      name: text10("name").notNull(),
      description: text10("description"),
      unit: text10("unit"),
      kategori: text10("kategori"),
      subcategory: text10("subcategory"),
      isCommodityTag: boolean7("is_commodity_tag").notNull().default(false),
      sortOrder: integer9("sort_order").notNull().default(0),
      // ── Template engine ────────────────────────────────────────────────────────
      templateKind: text10("template_kind"),
      categoryKey: text10("category_key"),
      serviceType: text10("service_type"),
      templateId: text10("template_id"),
      templateVersion: text10("template_version"),
      templateSnapshot: jsonb5("template_snapshot"),
      specValues: jsonb5("spec_values"),
      // ── Pricing (priceBase = internal cost, NEVER expose to customer) ──────────
      priceBase: numeric5("price_base", { precision: 15, scale: 2 }).notNull().default("0"),
      markupPct: numeric5("markup_pct", { precision: 5, scale: 2 }).notNull().default("0"),
      priceSell: numeric5("price_sell", { precision: 15, scale: 2 }),
      currency: text10("currency").notNull().default("IDR"),
      // ── Availability ──────────────────────────────────────────────────────────
      stockStatus: text10("stock_status"),
      stockQty: numeric5("stock_qty", { precision: 15, scale: 3 }),
      moq: numeric5("moq", { precision: 15, scale: 3 }),
      leadTime: text10("lead_time"),
      validityDate: date("validity_date"),
      // ── Origin / location ─────────────────────────────────────────────────────
      location: text10("location"),
      origin: text10("origin"),
      // ── Attachments ───────────────────────────────────────────────────────────
      documents: jsonb5("documents"),
      // ── HS Code ───────────────────────────────────────────────────────────────
      hsCode: text10("hs_code"),
      // ── Media Foundation ──────────────────────────────────────────────────────
      mediaAssets: jsonb5("media_assets").$type().notNull().default([]),
      // ── Publication state ─────────────────────────────────────────────────────
      status: text10("status").notNull().default("draft"),
      isPublished: boolean7("is_published").notNull().default(false),
      isActive: boolean7("is_active").notNull().default(true),
      sourceSubmissionId: integer9("source_submission_id"),
      publishedAt: timestamp11("published_at"),
      // ── Timestamps ────────────────────────────────────────────────────────────
      createdAt: timestamp11("created_at").defaultNow().notNull(),
      updatedAt: timestamp11("updated_at").defaultNow(),
      // ── Analytics counters ─────────────────────────────────────────────────────
      viewCount: integer9("view_count").notNull().default(0),
      quoteCount: integer9("quote_count").notNull().default(0),
      orderCount: integer9("order_count").notNull().default(0),
      // ── Featured ──────────────────────────────────────────────────────────────
      isFeatured: boolean7("is_featured").notNull().default(false),
      featuredUntil: timestamp11("featured_until"),
      // Featured Product promotion (additive) — priority ordering + explicit window.
      featuredPriority: integer9("featured_priority").notNull().default(0),
      featuredStartAt: timestamp11("featured_start_at")
    }, (t) => [
      index7("vendor_catalog_vendor_idx").on(t.vendorId),
      index7("vendor_catalog_status_idx").on(t.status, t.isPublished),
      index7("vendor_catalog_category_idx").on(t.categoryKey),
      index7("vendor_catalog_service_type_idx").on(t.serviceType),
      index7("vendor_catalog_featured_idx").on(t.isFeatured, t.featuredPriority)
    ]);
    supplierDocumentsTable = pgTable11("supplier_documents", {
      id: serial9("id").primaryKey(),
      supplierId: integer9("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      documentType: text10("document_type").notNull(),
      documentNumber: text10("document_number"),
      documentName: text10("document_name"),
      fileUrl: text10("file_url"),
      issuedAt: date("issued_at"),
      expiresAt: date("expires_at"),
      verificationStatus: text10("verification_status").notNull().default("pending"),
      verifiedAt: timestamp11("verified_at"),
      verifiedBy: text10("verified_by"),
      rejectionReason: text10("rejection_reason"),
      uploadedAt: timestamp11("uploaded_at").defaultNow(),
      uploadedBy: text10("uploaded_by"),
      source: text10("source"),
      metadata: jsonb5("metadata"),
      createdAt: timestamp11("created_at").defaultNow().notNull(),
      updatedAt: timestamp11("updated_at").defaultNow().notNull(),
      // ── Soft Delete (Phase Final — C) ─────────────────────────────────────────
      // Dokumen tidak langsung dihapus permanen — set deleted_at + deleted_by.
      // Query aktif wajib filter isNull(deletedAt). Admin bisa melihat histori.
      deletedAt: timestamp11("deleted_at"),
      deletedBy: text10("deleted_by")
    }, (t) => [
      index7("supplier_docs_supplier_idx").on(t.supplierId),
      index7("supplier_docs_type_idx").on(t.documentType),
      index7("supplier_docs_expires_idx").on(t.expiresAt),
      index7("supplier_docs_deleted_idx").on(t.deletedAt)
    ]);
    supplierStatusHistoryTable = pgTable11("supplier_status_history", {
      id: serial9("id").primaryKey(),
      supplierId: integer9("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      previousStatus: text10("previous_status"),
      newStatus: text10("new_status").notNull(),
      reason: text10("reason"),
      actorUserId: text10("actor_user_id"),
      companyId: integer9("company_id"),
      requestId: text10("request_id"),
      createdAt: timestamp11("created_at").defaultNow().notNull()
    }, (t) => [
      index7("supplier_status_hist_supplier_idx").on(t.supplierId),
      index7("supplier_status_hist_created_idx").on(t.createdAt)
    ]);
    supplierReviewsTable = pgTable11("supplier_reviews", {
      id: serial9("id").primaryKey(),
      supplierId: integer9("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      customerId: integer9("customer_id"),
      sourceTransactionType: text10("source_transaction_type"),
      sourceTransactionId: integer9("source_transaction_id"),
      ratingOverall: numeric5("rating_overall", { precision: 3, scale: 1 }).notNull(),
      ratingDelivery: numeric5("rating_delivery", { precision: 3, scale: 1 }),
      ratingCommunication: numeric5("rating_communication", { precision: 3, scale: 1 }),
      ratingQuality: numeric5("rating_quality", { precision: 3, scale: 1 }),
      reviewText: text10("review_text"),
      isPublished: boolean7("is_published").notNull().default(false),
      moderationStatus: text10("moderation_status").notNull().default("pending"),
      createdAt: timestamp11("created_at").defaultNow().notNull(),
      updatedAt: timestamp11("updated_at").defaultNow().notNull()
    }, (t) => [
      index7("supplier_reviews_supplier_idx").on(t.supplierId),
      index7("supplier_reviews_source_idx").on(t.sourceTransactionType, t.sourceTransactionId),
      index7("supplier_reviews_customer_idx").on(t.customerId)
    ]);
    vendorAuditLogsTable = pgTable11("vendor_audit_logs", {
      id: serial9("id").primaryKey(),
      supplierId: integer9("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      action: text10("action").notNull(),
      actor: text10("actor").notNull(),
      before: jsonb5("before"),
      after: jsonb5("after"),
      ip: text10("ip"),
      userAgent: text10("user_agent"),
      createdAt: timestamp11("created_at").defaultNow().notNull()
    }, (t) => [
      index7("vendor_audit_logs_supplier_idx").on(t.supplierId),
      index7("vendor_audit_logs_action_idx").on(t.action),
      index7("vendor_audit_logs_created_idx").on(t.createdAt)
    ]);
    insertSupplierSchema = createInsertSchema7(suppliersTable).omit({ id: true, createdAt: true });
    insertVendorCatalogItemSchema = createInsertSchema7(vendorCatalogItemsTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/stocks.ts
import { pgTable as pgTable12, serial as serial10, text as text11, integer as integer10, numeric as numeric6, timestamp as timestamp12, index as index8 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema8 } from "drizzle-zod";
var stocksTable, insertStockSchema;
var init_stocks = __esm({
  "../../lib/db/src/schema/stocks.ts"() {
    "use strict";
    stocksTable = pgTable12("stocks", {
      id: serial10("id").primaryKey(),
      // Phase 1 isolation — nullable during backfill; enforce NOT NULL after data migration
      companyId: integer10("company_id"),
      productName: text11("product_name").notNull(),
      sku: text11("sku").notNull(),
      quantity: integer10("quantity").notNull().default(0),
      unit: text11("unit").notNull(),
      costPrice: numeric6("cost_price", { precision: 12, scale: 2 }).notNull(),
      supplierId: integer10("supplier_id"),
      hsCode: text11("hs_code"),
      createdAt: timestamp12("created_at").defaultNow().notNull()
    }, (t) => [
      index8("stocks_company_idx").on(t.companyId)
    ]);
    insertStockSchema = createInsertSchema8(stocksTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/shipments.ts
import { pgTable as pgTable13, serial as serial11, text as text12, integer as integer11, timestamp as timestamp13, pgEnum as pgEnum4 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema9 } from "drizzle-zod";
var shipmentStatusEnum, shipmentsTable, insertShipmentSchema;
var init_shipments = __esm({
  "../../lib/db/src/schema/shipments.ts"() {
    "use strict";
    shipmentStatusEnum = pgEnum4("shipment_status", [
      "pending",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
      "failed"
    ]);
    shipmentsTable = pgTable13("shipments", {
      id: serial11("id").primaryKey(),
      orderId: integer11("order_id"),
      trackingNumber: text12("tracking_number").notNull().unique(),
      carrier: text12("carrier").notNull(),
      status: shipmentStatusEnum("status").default("pending").notNull(),
      origin: text12("origin").notNull(),
      destination: text12("destination").notNull(),
      estimatedDelivery: text12("estimated_delivery"),
      createdAt: timestamp13("created_at").defaultNow().notNull()
    });
    insertShipmentSchema = createInsertSchema9(shipmentsTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/transactions.ts
import { pgTable as pgTable14, serial as serial12, text as text13, integer as integer12, numeric as numeric7, timestamp as timestamp14, pgEnum as pgEnum5, index as index9 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema10 } from "drizzle-zod";
var paymentMethodEnum, transactionsTable, insertTransactionSchema;
var init_transactions = __esm({
  "../../lib/db/src/schema/transactions.ts"() {
    "use strict";
    paymentMethodEnum = pgEnum5("payment_method", ["cash", "debit", "credit", "qris", "transfer"]);
    transactionsTable = pgTable14("transactions", {
      id: serial12("id").primaryKey(),
      // Phase 1 isolation — nullable during backfill; enforce NOT NULL after data migration
      companyId: integer12("company_id"),
      productName: text13("product_name").notNull(),
      quantity: integer12("quantity").notNull(),
      unitPrice: numeric7("unit_price", { precision: 12, scale: 2 }).notNull(),
      totalPrice: numeric7("total_price", { precision: 12, scale: 2 }).notNull(),
      paymentMethod: paymentMethodEnum("payment_method").notNull(),
      cashierId: text13("cashier_id"),
      documentUrl: text13("document_url"),
      createdAt: timestamp14("created_at").defaultNow().notNull()
    }, (t) => [
      index9("transactions_company_idx").on(t.companyId)
    ]);
    insertTransactionSchema = createInsertSchema10(transactionsTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/customers.ts
import { pgTable as pgTable15, serial as serial13, text as text14, integer as integer13, timestamp as timestamp15, index as index10 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema11 } from "drizzle-zod";
var customersTable, insertCustomerSchema;
var init_customers = __esm({
  "../../lib/db/src/schema/customers.ts"() {
    "use strict";
    init_companies();
    customersTable = pgTable15("customers", {
      id: serial13("id").primaryKey(),
      companyId: integer13("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      name: text14("name").notNull(),
      email: text14("email"),
      phone: text14("phone"),
      taxId: text14("tax_id"),
      nik: text14("nik"),
      address: text14("address"),
      notes: text14("notes"),
      defaultSalesTaxId: integer13("default_sales_tax_id"),
      createdAt: timestamp15("created_at").defaultNow().notNull()
    }, (t) => [
      index10("customers_company_idx").on(t.companyId)
    ]);
    insertCustomerSchema = createInsertSchema11(customersTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/logisticOrders.ts
import {
  pgTable as pgTable16,
  serial as serial14,
  text as text15,
  numeric as numeric8,
  integer as integer14,
  jsonb as jsonb6,
  timestamp as timestamp16,
  boolean as boolean8,
  index as index11,
  uniqueIndex as uniqueIndex5
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var logisticOrdersTable, logisticOrderItemsTable, logisticOrderRfqsTable, logisticOrderQuotesTable, vendorOffersTable, logisticOrdersRelations, logisticOrderItemsRelations, logisticOrderRfqsRelations, logisticOrderQuotesRelations, vendorResponsesTable;
var init_logisticOrders = __esm({
  "../../lib/db/src/schema/logisticOrders.ts"() {
    "use strict";
    init_suppliers();
    init_companies();
    logisticOrdersTable = pgTable16("logistic_orders", {
      id: serial14("id").primaryKey(),
      orderNumber: text15("order_number").notNull().unique(),
      companyId: integer14("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      companyName: text15("company_name").notNull(),
      customerName: text15("customer_name").notNull(),
      email: text15("email").notNull(),
      phone: text15("phone").notNull(),
      orderType: text15("order_type").notNull().default("shipment"),
      shipmentType: text15("shipment_type").notNull().default(""),
      origin: text15("origin").notNull().default(""),
      destination: text15("destination").notNull().default(""),
      commodity: text15("commodity"),
      cargoDescription: text15("cargo_description"),
      grossWeight: numeric8("gross_weight", { precision: 12, scale: 3 }),
      volumeCbm: numeric8("volume_cbm", { precision: 12, scale: 3 }),
      jumlahKoli: integer14("jumlah_koli"),
      requiredDate: text15("required_date"),
      notes: text15("notes"),
      paymentType: text15("payment_type"),
      paymentMethod: text15("payment_method"),
      senderName: text15("sender_name"),
      namaPenerima: text15("nama_penerima"),
      nomorPenerima: text15("nomor_penerima"),
      jamOrder: text15("jam_order"),
      source: text15("source").default("manual").notNull(),
      aiSessionToken: text15("ai_session_token"),
      subtotal: numeric8("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      tax: numeric8("tax", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric8("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      status: text15("status").notNull().default("New Order"),
      approvedQuoteId: integer14("approved_quote_id"),
      adminApprovalStatus: text15("admin_approval_status").default("pending"),
      approvedAt: timestamp16("approved_at"),
      approvedVendorId: integer14("approved_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      finalSellingPrice: numeric8("final_selling_price", { precision: 14, scale: 2 }),
      quotationSentAt: timestamp16("quotation_sent_at"),
      customerConfirmToken: text15("customer_confirm_token").unique(),
      customerConfirmStatus: text15("customer_confirm_status").default("pending"),
      customerConfirmedAt: timestamp16("customer_confirmed_at"),
      pickupDate: text15("pickup_date"),
      pickupTime: text15("pickup_time"),
      truckType: text15("truck_type"),
      markupPercent: numeric8("markup_percent", { precision: 5, scale: 2 }).default("20"),
      finalPrice: numeric8("final_price", { precision: 14, scale: 2 }),
      // [MULTI-MODE] Transport mode & mode-specific fields
      transportMode: text15("transport_mode"),
      originDistrict: text15("origin_district"),
      destDistrict: text15("dest_district"),
      etd: timestamp16("etd", { withTimezone: true }),
      eta: timestamp16("eta", { withTimezone: true }),
      originPort: text15("origin_port"),
      destPort: text15("dest_port"),
      weightKg: numeric8("weight_kg", { precision: 12, scale: 3 }),
      incoterm: text15("incoterm"),
      // [MULTI-MODE] Customer options flow
      optionsToken: text15("options_token").unique(),
      optionsSentAt: timestamp16("options_sent_at", { withTimezone: true }),
      publicRfqToken: text15("public_rfq_token").unique(),
      geofenceEnabled: boolean8("geofence_enabled").default(true).notNull(),
      geofenceRadiusKm: integer14("geofence_radius_km").default(75).notNull(),
      // Optimistic locking — incremented on every write; client must echo back current value to detect concurrent edits
      version: integer14("version").notNull().default(1),
      // ── Phase 1: AI classification fields ─────────────────────────────────────
      direction: text15("direction"),
      // import | export | domestic | transit
      isDangerousGood: boolean8("is_dangerous_good").default(false),
      serviceCategory: text15("service_category"),
      // freight | trucking | customs | handling | storage
      cargoSpecialTags: text15("cargo_special_tags").array(),
      requiredDocs: text15("required_docs").array(),
      // ── Step 2: Product Template Engine integration ─────────────────────────────
      categoryKey: text15("category_key"),
      templateId: integer14("template_id"),
      templateVersion: text15("template_version"),
      templateSnapshot: jsonb6("template_snapshot"),
      // ── Truck assignment fields ────────────────────────────────────────────────
      truckVendorId: integer14("truck_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      truckPrice: numeric8("truck_price", { precision: 14, scale: 2 }),
      truckSource: text15("truck_source"),
      // "internal" | "external" | null
      productPrice: numeric8("product_price", { precision: 14, scale: 2 }),
      // ── Phase 2A: Product-First Flow fields ────────────────────────────────────
      productRfqId: integer14("product_rfq_id"),
      productVendorId: integer14("product_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      productVendorConfirmedAt: timestamp16("product_vendor_confirmed_at"),
      productReadyDate: text15("product_ready_date"),
      productPickupLocation: text15("product_pickup_location"),
      productQtyConfirmed: numeric8("product_qty_confirmed", { precision: 12, scale: 3 }),
      shipmentRfqId: integer14("shipment_rfq_id"),
      shipmentMode: text15("shipment_mode"),
      shipmentModeSelectedAt: timestamp16("shipment_mode_selected_at"),
      customerProductApprovalToken: text15("customer_product_approval_token").unique(),
      customerProductApprovedAt: timestamp16("customer_product_approved_at"),
      createdAt: timestamp16("created_at").defaultNow().notNull(),
      updatedAt: timestamp16("updated_at").defaultNow().notNull()
    }, (t) => [
      index11("logistic_orders_company_idx").on(t.companyId),
      index11("logistic_orders_status_idx").on(t.status),
      index11("logistic_orders_vendor_idx").on(t.approvedVendorId)
    ]);
    logisticOrderItemsTable = pgTable16("logistic_order_items", {
      id: serial14("id").primaryKey(),
      orderId: serial14("order_id").references(() => logisticOrdersTable.id, { onDelete: "cascade" }).notNull(),
      category: text15("category").notNull(),
      serviceName: text15("service_name").notNull(),
      calculatorType: text15("calculator_type").notNull(),
      inputData: jsonb6("input_data").notNull().default({}),
      calculationResult: jsonb6("calculation_result").notNull().default({}),
      subtotal: numeric8("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      // vendor catalog reference fields
      itemSource: text15("item_source").default("manual"),
      vendorCatalogItemId: integer14("vendor_catalog_item_id"),
      vendorId: integer14("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      serviceType: text15("service_type"),
      priceSnapshot: jsonb6("price_snapshot"),
      calculationInput: jsonb6("calculation_input"),
      templateSnapshot: jsonb6("template_snapshot"),
      createdAt: timestamp16("created_at").defaultNow().notNull()
    }, (t) => [
      index11("logistic_order_items_order_idx").on(t.orderId)
    ]);
    logisticOrderRfqsTable = pgTable16("logistic_order_rfqs", {
      id: serial14("id").primaryKey(),
      orderId: integer14("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      rfqNumber: text15("rfq_number").notNull().unique(),
      vendorIds: integer14("vendor_ids").array().notNull().default([]),
      openedVendorIds: integer14("opened_vendor_ids").array().notNull().default([]),
      notes: text15("notes"),
      status: text15("status").notNull().default("admin_review"),
      responseDeadline: timestamp16("response_deadline", { withTimezone: true }),
      basicPrice: numeric8("basic_price", { precision: 14, scale: 2 }),
      quotedPrice: numeric8("quoted_price", { precision: 14, scale: 2 }),
      quotedAt: timestamp16("quoted_at", { withTimezone: true }),
      quoteNotes: text15("quote_notes"),
      customerResponseNotes: text15("customer_response_notes"),
      customerRespondedAt: timestamp16("customer_responded_at", { withTimezone: true }),
      createdByUserId: text15("created_by_user_id"),
      createdByUserName: text15("created_by_user_name"),
      // ── Step 2: Product Template Engine integration ─────────────────────────────
      templateId: integer14("template_id"),
      templateVersion: text15("template_version"),
      templateSnapshot: jsonb6("template_snapshot").$type(),
      // ── Phase 2A: Product-First Flow ──────────────────────────────────────────
      rfqType: text15("rfq_type").default("shipment"),
      phase: text15("phase").default("shipment_phase"),
      createdAt: timestamp16("created_at").defaultNow().notNull()
    });
    logisticOrderQuotesTable = pgTable16("logistic_order_quotes", {
      id: serial14("id").primaryKey(),
      rfqId: integer14("rfq_id").notNull().references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
      orderId: integer14("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      // Was ON DELETE CASCADE — deleting a vendor silently wiped historical
      // quotes tied to real orders. Changed to RESTRICT to match the pattern
      // used elsewhere (mktPurchaseOrders, mktVendorQuotes, logisticVendorFulfillments):
      // a vendor with quote history cannot be hard-deleted.
      vendorId: integer14("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
      vendorPrice: numeric8("vendor_price", { precision: 14, scale: 2 }).notNull().default("0"),
      currency: text15("currency").notNull().default("IDR"),
      estimatedPickup: text15("estimated_pickup"),
      estimatedDelivery: text15("estimated_delivery"),
      estimatedDays: integer14("estimated_days"),
      vendorNotes: text15("vendor_notes"),
      markupType: text15("markup_type").notNull().default("percentage"),
      markupPercentage: numeric8("markup_percentage", { precision: 5, scale: 2 }).notNull().default("0"),
      fixedSellingPrice: numeric8("fixed_selling_price", { precision: 14, scale: 2 }),
      sellingPrice: numeric8("selling_price", { precision: 14, scale: 2 }),
      quoteStatus: text15("quote_status").notNull().default("pending"),
      replySource: text15("reply_source").notNull().default("manual"),
      replyTimestamp: timestamp16("reply_timestamp"),
      vendorConfirmToken: text15("vendor_confirm_token").unique(),
      // Enterprise: ranking & scoring
      rankScore: numeric8("rank_score", { precision: 6, scale: 2 }),
      rankBadges: text15("rank_badges").array().default([]),
      createdAt: timestamp16("created_at").defaultNow().notNull()
    }, (t) => ({
      // Prevent duplicate vendor quote submission for same RFQ (race condition guard)
      rfqVendorUidx: uniqueIndex5("liq_rfq_vendor_uidx").on(t.rfqId, t.vendorId)
    }));
    vendorOffersTable = pgTable16("vendor_offers", {
      id: serial14("id").primaryKey(),
      orderId: integer14("order_id").references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      vendorId: integer14("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      transportMode: text15("transport_mode"),
      offerPrice: numeric8("offer_price", { precision: 15, scale: 2 }).notNull().default("0"),
      vehicleYear: integer14("vehicle_year"),
      carrierName: text15("carrier_name"),
      transitDays: integer14("transit_days"),
      notes: text15("notes"),
      isSelectedByAdmin: boolean8("is_selected_by_admin").notNull().default(false),
      finalCustomerPrice: numeric8("final_customer_price", { precision: 15, scale: 2 }),
      optionLabel: text15("option_label"),
      status: text15("status").notNull().default("PENDING"),
      chosenAt: timestamp16("chosen_at", { withTimezone: true }),
      createdAt: timestamp16("created_at", { withTimezone: true }).defaultNow().notNull()
    });
    logisticOrdersRelations = relations(logisticOrdersTable, ({ many }) => ({
      items: many(logisticOrderItemsTable),
      rfqs: many(logisticOrderRfqsTable)
    }));
    logisticOrderItemsRelations = relations(logisticOrderItemsTable, ({ one }) => ({
      order: one(logisticOrdersTable, {
        fields: [logisticOrderItemsTable.orderId],
        references: [logisticOrdersTable.id]
      })
    }));
    logisticOrderRfqsRelations = relations(logisticOrderRfqsTable, ({ one, many }) => ({
      order: one(logisticOrdersTable, {
        fields: [logisticOrderRfqsTable.orderId],
        references: [logisticOrdersTable.id]
      }),
      quotes: many(logisticOrderQuotesTable)
    }));
    logisticOrderQuotesRelations = relations(logisticOrderQuotesTable, ({ one }) => ({
      rfq: one(logisticOrderRfqsTable, {
        fields: [logisticOrderQuotesTable.rfqId],
        references: [logisticOrderRfqsTable.id]
      }),
      order: one(logisticOrdersTable, {
        fields: [logisticOrderQuotesTable.orderId],
        references: [logisticOrdersTable.id]
      }),
      vendor: one(suppliersTable, {
        fields: [logisticOrderQuotesTable.vendorId],
        references: [suppliersTable.id]
      })
    }));
    vendorResponsesTable = pgTable16("vendor_responses", {
      id: serial14("id").primaryKey(),
      // unique: one vendor response record per order (upsert target)
      orderNumber: text15("order_number").notNull().unique(),
      orderId: integer14("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
      vendorName: text15("vendor_name"),
      status: text15("status").notNull(),
      estimatedPickupTime: text15("estimated_pickup_time"),
      driverName: text15("driver_name"),
      driverPhone: text15("driver_phone"),
      plateNumber: text15("plate_number"),
      vehicleType: text15("vehicle_type"),
      notes: text15("notes"),
      unitPhotoUrl: text15("unit_photo_url"),
      quotedPrice: numeric8("quoted_price", { precision: 14, scale: 2 }),
      submittedAt: timestamp16("submitted_at").defaultNow().notNull(),
      createdAt: timestamp16("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/salesDocuments.ts
import { pgTable as pgTable17, serial as serial15, text as text16, integer as integer15, numeric as numeric9, timestamp as timestamp17, date as date2, pgEnum as pgEnum6, boolean as boolean9, index as index12, uniqueIndex as uniqueIndex6, jsonb as jsonb7 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema12 } from "drizzle-zod";
var salesDocKindEnum, salesDocStatusEnum, salesInvoiceStatusEnum, salesDeliveryStatusEnum, salesPaymentStatusEnum, salesDocumentsTable, salesDocumentLinesTable, insertSalesDocumentSchema, insertSalesDocumentLineSchema;
var init_salesDocuments = __esm({
  "../../lib/db/src/schema/salesDocuments.ts"() {
    "use strict";
    init_customers();
    init_products();
    init_logisticOrders();
    init_companies();
    init_uom();
    salesDocKindEnum = pgEnum6("sales_doc_kind", ["quote", "order"]);
    salesDocStatusEnum = pgEnum6("sales_doc_status", [
      "draft",
      "sent",
      "confirmed",
      "done",
      "cancelled"
    ]);
    salesInvoiceStatusEnum = pgEnum6("sales_invoice_status", [
      "none",
      "to_invoice",
      "invoiced"
    ]);
    salesDeliveryStatusEnum = pgEnum6("sales_delivery_status", [
      "none",
      "to_deliver",
      "delivered"
    ]);
    salesPaymentStatusEnum = pgEnum6("sales_payment_status", [
      "unpaid",
      "partial",
      "paid",
      "overdue"
    ]);
    salesDocumentsTable = pgTable17("sales_documents", {
      id: serial15("id").primaryKey(),
      docNumber: text16("doc_number").notNull().unique(),
      kind: salesDocKindEnum("kind").notNull().default("quote"),
      status: salesDocStatusEnum("status").notNull().default("draft"),
      invoiceStatus: salesInvoiceStatusEnum("invoice_status").notNull().default("none"),
      deliveryStatus: salesDeliveryStatusEnum("delivery_status").notNull().default("none"),
      paymentStatus: salesPaymentStatusEnum("payment_status").notNull().default("unpaid"),
      amountPaid: numeric9("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
      customerId: integer15("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
      customerName: text16("customer_name").notNull(),
      totalAmount: numeric9("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      taxRateId: integer15("tax_rate_id"),
      taxAmount: numeric9("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric9("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      origin: text16("origin"),
      destination: text16("destination"),
      transportMode: text16("transport_mode"),
      etd: date2("etd"),
      eta: date2("eta"),
      validUntil: timestamp17("valid_until"),
      expectedDate: timestamp17("expected_date"),
      notes: text16("notes"),
      paymentType: text16("payment_type"),
      confirmedAt: timestamp17("confirmed_at"),
      // Invoice automation fields
      invoiceNumber: text16("invoice_number"),
      invoiceDate: date2("invoice_date"),
      dueDate: date2("due_date"),
      paymentTermDays: integer15("payment_term_days").default(30),
      cancelledAt: timestamp17("cancelled_at"),
      cancelledBy: text16("cancelled_by"),
      cancelReason: text16("cancel_reason"),
      approvedBy: text16("approved_by"),
      approvedAt: timestamp17("approved_at"),
      editReason: text16("edit_reason"),
      reversalReason: text16("reversal_reason"),
      createdById: text16("created_by_id"),
      aiGenerated: boolean9("ai_generated").notNull().default(false),
      aiSourceCorrespondenceId: integer15("ai_source_correspondence_id"),
      aiSourceWaPhone: text16("ai_source_wa_phone"),
      logisticOrderId: integer15("logistic_order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
      companyId: integer15("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      warehouseId: integer15("warehouse_id"),
      categoryKey: text16("category_key"),
      templateId: text16("template_id"),
      templateVersion: text16("template_version"),
      templateSnapshot: jsonb7("template_snapshot").$type(),
      paymentProofToken: text16("payment_proof_token").unique(),
      proofUrl: text16("proof_url"),
      proofUploadedAt: timestamp17("proof_uploaded_at"),
      proofRemarks: text16("proof_remarks"),
      createdAt: timestamp17("created_at").defaultNow().notNull(),
      updatedAt: timestamp17("updated_at").defaultNow().notNull()
    }, (t) => [
      // [H6-FIX] Prevent duplicate SO from same logistic order (nullable-safe: NULL != NULL in PG unique index)
      uniqueIndex6("sales_documents_logistic_order_id_unique_idx").on(t.logisticOrderId),
      // [H10-FIX] Performance indexes for most-queried columns
      index12("sales_documents_customer_id_idx").on(t.customerId),
      index12("sales_documents_company_id_idx").on(t.companyId),
      index12("sales_documents_status_idx").on(t.status),
      index12("sales_documents_company_status_idx").on(t.companyId, t.status)
    ]);
    salesDocumentLinesTable = pgTable17("sales_document_lines", {
      id: serial15("id").primaryKey(),
      documentId: integer15("document_id").notNull().references(() => salesDocumentsTable.id, { onDelete: "cascade" }),
      productId: integer15("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text16("name").notNull(),
      description: text16("description"),
      quantity: numeric9("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
      salesUomId: integer15("sales_uom_id").references(() => uomTable.id, { onDelete: "set null" }),
      baseQty: numeric9("base_qty", { precision: 12, scale: 4 }),
      unitPrice: numeric9("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric9("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      meta: jsonb7("meta").$type()
    }, (t) => [
      index12("sales_doc_lines_doc_idx").on(t.documentId)
    ]);
    insertSalesDocumentSchema = createInsertSchema12(salesDocumentsTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      docNumber: true
    });
    insertSalesDocumentLineSchema = createInsertSchema12(salesDocumentLinesTable).omit({
      id: true
    });
  }
});

// ../../lib/db/src/schema/inventory.ts
import {
  pgTable as pgTable18,
  pgEnum as pgEnum7,
  serial as serial16,
  text as text17,
  integer as integer16,
  numeric as numeric10,
  boolean as boolean10,
  timestamp as timestamp18,
  unique as unique2,
  index as index13
} from "drizzle-orm/pg-core";
var warehouseTypeEnum, movementTypeEnum, referenceTypeEnum, warehousesTable, warehouseRacksTable, inventoryStockTable, stockMovementsTable;
var init_inventory = __esm({
  "../../lib/db/src/schema/inventory.ts"() {
    "use strict";
    init_products();
    init_companies();
    warehouseTypeEnum = pgEnum7("warehouse_type", ["CENTRAL", "BRANCH", "OUTLET"]);
    movementTypeEnum = pgEnum7("inv_movement_type", [
      "PURCHASE_RECEIPT",
      "SALES_DELIVERY",
      "POS_SALE",
      "RECIPE_CONSUMPTION",
      "TRANSFER_IN",
      "TRANSFER_OUT",
      "RETURN_IN",
      "RETURN_OUT",
      "OPNAME_ADJUST",
      "DAMAGE",
      "MANUAL_IN",
      "MANUAL_OUT"
    ]);
    referenceTypeEnum = pgEnum7("inv_reference_type", [
      "PURCHASE_ORDER",
      "SALES_ORDER",
      "POS_SESSION",
      "TRANSFER",
      "RETURN",
      "OPNAME",
      "MANUAL"
    ]);
    warehousesTable = pgTable18("warehouses", {
      id: serial16("id").primaryKey(),
      companyId: integer16("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      warehouseCode: text17("warehouse_code").notNull().unique(),
      warehouseName: text17("warehouse_name").notNull(),
      warehouseType: warehouseTypeEnum("warehouse_type").notNull().default("BRANCH"),
      branchId: integer16("branch_id"),
      address: text17("address"),
      isActive: boolean10("is_active").notNull().default(true),
      createdAt: timestamp18("created_at").defaultNow().notNull(),
      updatedAt: timestamp18("updated_at").defaultNow().notNull()
    }, (t) => [
      index13("warehouses_company_idx").on(t.companyId)
    ]);
    warehouseRacksTable = pgTable18("warehouse_racks", {
      id: serial16("id").primaryKey(),
      warehouseId: integer16("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
      rackCode: text17("rack_code").notNull(),
      rackName: text17("rack_name").notNull(),
      zone: text17("zone"),
      qrCode: text17("qr_code"),
      isActive: boolean10("is_active").notNull().default(true)
    }, (t) => [
      unique2("warehouse_racks_code_unique").on(t.warehouseId, t.rackCode)
    ]);
    inventoryStockTable = pgTable18("inventory_stock", {
      id: serial16("id").primaryKey(),
      productId: integer16("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      warehouseId: integer16("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
      rackId: integer16("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
      stockOnHand: numeric10("stock_on_hand", { precision: 14, scale: 3 }).notNull().default("0"),
      stockReserved: numeric10("stock_reserved", { precision: 14, scale: 3 }).notNull().default("0"),
      stockAvailable: numeric10("stock_available", { precision: 14, scale: 3 }).notNull().default("0"),
      minimumStock: numeric10("minimum_stock", { precision: 14, scale: 3 }).notNull().default("0"),
      unit: text17("unit").notNull().default("pcs"),
      averageCost: numeric10("average_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      lastUpdated: timestamp18("last_updated").defaultNow().notNull()
    }, (t) => [
      unique2("inventory_stock_product_warehouse_rack_unique").on(t.productId, t.warehouseId, t.rackId)
    ]);
    stockMovementsTable = pgTable18("stock_movements", {
      id: serial16("id").primaryKey(),
      movementNo: text17("movement_no").notNull().unique(),
      productId: integer16("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      warehouseId: integer16("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
      rackId: integer16("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
      movementType: movementTypeEnum("movement_type").notNull(),
      referenceType: referenceTypeEnum("reference_type"),
      referenceId: integer16("reference_id"),
      qtyIn: numeric10("qty_in", { precision: 14, scale: 3 }).notNull().default("0"),
      qtyOut: numeric10("qty_out", { precision: 14, scale: 3 }).notNull().default("0"),
      balanceAfter: numeric10("balance_after", { precision: 14, scale: 3 }).notNull().default("0"),
      unitCost: numeric10("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      totalCost: numeric10("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      notes: text17("notes"),
      createdBy: text17("created_by"),
      createdAt: timestamp18("created_at").defaultNow().notNull()
    }, (t) => [
      index13("stock_movements_product_idx").on(t.productId),
      index13("stock_movements_warehouse_idx").on(t.warehouseId),
      index13("stock_movements_type_idx").on(t.movementType),
      index13("stock_movements_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/portalCustomers.ts
import { pgTable as pgTable19, serial as serial17, text as text18, integer as integer17, timestamp as timestamp19, uniqueIndex as uniqueIndex7 } from "drizzle-orm/pg-core";
import { sql as sql2 } from "drizzle-orm";
import { createInsertSchema as createInsertSchema13 } from "drizzle-zod";
var portalCustomersTable, portalCustomerServicesTable, portalContentTable, insertPortalCustomerSchema;
var init_portalCustomers = __esm({
  "../../lib/db/src/schema/portalCustomers.ts"() {
    "use strict";
    portalCustomersTable = pgTable19("portal_customers", {
      id: serial17("id").primaryKey(),
      name: text18("name").notNull(),
      email: text18("email").notNull().unique(),
      passwordHash: text18("password_hash"),
      phone: text18("phone"),
      company: text18("company"),
      role: text18("role").notNull().default("customer"),
      accountStatus: text18("account_status").notNull().default("active"),
      sanctionReason: text18("sanction_reason"),
      sanctionUntil: timestamp19("sanction_until"),
      statusChangedAt: timestamp19("status_changed_at"),
      statusChangedBy: text18("status_changed_by"),
      avatarUrl: text18("avatar_url"),
      createdAt: timestamp19("created_at").defaultNow().notNull(),
      resetPasswordToken: text18("reset_password_token"),
      resetPasswordExpiry: timestamp19("reset_password_expiry"),
      oauthProvider: text18("oauth_provider"),
      oauthId: text18("oauth_id")
    }, (t) => ({
      phoneUniqueIdx: uniqueIndex7("portal_customers_phone_unique").on(t.phone).where(sql2`${t.phone} IS NOT NULL AND ${t.phone} <> ''`)
    }));
    portalCustomerServicesTable = pgTable19("portal_customer_services", {
      id: serial17("id").primaryKey(),
      customerId: integer17("customer_id").notNull(),
      serviceId: integer17("service_id").notNull(),
      createdAt: timestamp19("created_at").defaultNow().notNull()
    });
    portalContentTable = pgTable19("portal_content", {
      id: serial17("id").primaryKey(),
      key: text18("key").notNull(),
      value: text18("value").notNull().default(""),
      updatedAt: timestamp19("updated_at").defaultNow().notNull(),
      locale: text18("locale").notNull().default("id-ID")
    }, (t) => [
      uniqueIndex7("portal_content_key_locale_unique").on(t.key, t.locale)
    ]);
    insertPortalCustomerSchema = createInsertSchema13(portalCustomersTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/mktRfqs.ts
import { pgTable as pgTable20, serial as serial18, text as text19, integer as integer18, boolean as boolean11, date as date3, timestamp as timestamp20, pgEnum as pgEnum8, index as index14 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema14 } from "drizzle-zod";
var mktRfqStatusEnum, mktRfqPriorityEnum, mktRfqsTable, insertMktRfqSchema;
var init_mktRfqs = __esm({
  "../../lib/db/src/schema/mktRfqs.ts"() {
    "use strict";
    init_companies();
    init_suppliers();
    init_portalCustomers();
    mktRfqStatusEnum = pgEnum8("mkt_rfq_status", [
      "draft",
      "submitted",
      "quoting",
      "quoted",
      "awarded",
      "cancelled",
      "expired"
    ]);
    mktRfqPriorityEnum = pgEnum8("mkt_rfq_priority", [
      "low",
      "normal",
      "high",
      "urgent"
    ]);
    mktRfqsTable = pgTable20("mkt_rfqs", {
      id: serial18("id").primaryKey(),
      rfqNumber: text19("rfq_number").notNull().unique(),
      // format: MKT-RFQ-YYYYMM-XXXX
      companyId: integer18("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      // NULL = guest / no mapping yet
      catalogVendorId: integer18("catalog_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      // KEPUTUSAN #3
      // Phase 2B — Buyer Identity: link ke portal_customers.id jika logged-in, NULL jika guest
      portalCustomerId: integer18("portal_customer_id").references(() => portalCustomersTable.id, { onDelete: "set null" }),
      buyerName: text19("buyer_name").notNull(),
      buyerEmail: text19("buyer_email").notNull(),
      buyerPhone: text19("buyer_phone"),
      buyerCompany: text19("buyer_company"),
      // Phase 2B.1 — Buyer Organization: snapshot dari portal_company_members saat RFQ dibuat.
      // Immutable — mencerminkan context buyer pada waktu pembuatan RFQ, bukan state saat ini.
      // NULL jika guest atau logged-in tapi belum ada mapping ke company.
      buyerRole: text19("buyer_role"),
      // snapshot: requester | procurement | finance | admin | viewer
      buyerDepartment: text19("buyer_department"),
      // snapshot: mis. "Procurement", "Finance"
      buyerCostCenter: text19("buyer_cost_center"),
      // snapshot: mis. "CC-OPS-01"
      buyerApprovalLevel: integer18("buyer_approval_level"),
      // snapshot: 1=self, 2=needs L1, dst.
      guestToken: text19("guest_token").unique(),
      // KEPUTUSAN #9 — kept for backward compat
      // Phase 1B token security: hash stored for lookup; raw only sent to client
      guestTokenHash: text19("guest_token_hash"),
      guestTokenExpiresAt: timestamp20("guest_token_expires_at"),
      guestClaimedAt: timestamp20("guest_claimed_at"),
      guestClaimedBy: text19("guest_claimed_by"),
      status: mktRfqStatusEnum("status").notNull().default("draft"),
      priority: mktRfqPriorityEnum("priority").default("normal"),
      requiredDeliveryDate: date3("required_delivery_date"),
      deliveryAddress: text19("delivery_address"),
      notes: text19("notes"),
      emailVerified: boolean11("email_verified").notNull().default(false),
      // KEPUTUSAN #11
      emailVerifiedAt: timestamp20("email_verified_at"),
      // Counter denormalized [F08 resolved] — update via service layer
      lineCount: integer18("line_count").notNull().default(0),
      quoteCount: integer18("quote_count").notNull().default(0),
      // ── Phase 2E — Vendor Selection result (set atomically by selectVendorAndCreatePo) ──
      winnerSelectedAt: timestamp20("winner_selected_at"),
      winnerSelectedBy: text19("winner_selected_by"),
      // adminId string (no FK — internal)
      winningQuoteId: integer18("winning_quote_id"),
      // FK to mkt_vendor_quotes.id (enforced in DB only, not Drizzle to avoid circular import)
      // ── Phase 2F — Buyer Approval Flow ───────────────────────────────────────────
      // Kolom approval berjalan PARALEL dengan status utama (bukan bagian dari status lifecycle).
      // approval_status: none | pending | approved | rejected
      //   'none'     = tidak butuh approval (approval_level <= 1 atau NULL)
      //   'pending'  = menunggu approval dari approver yang eligible
      //   'approved' = disetujui → mkt_rfqs.status = 'submitted'
      //   'rejected' = ditolak → buyer revisi, status tetap 'draft'
      // Detail approval tersimpan di mkt_rfq_approvals table.
      approvalStatus: text19("approval_status").notNull().default("none"),
      approvalRequestedAt: timestamp20("approval_requested_at"),
      approvalResolvedAt: timestamp20("approval_resolved_at"),
      createdAt: timestamp20("created_at").defaultNow().notNull(),
      updatedAt: timestamp20("updated_at").defaultNow().notNull()
    }, (t) => [
      index14("mkt_rfqs_company_idx").on(t.companyId),
      index14("mkt_rfqs_catalog_vendor_idx").on(t.catalogVendorId),
      index14("mkt_rfqs_status_idx").on(t.status),
      index14("mkt_rfqs_guest_token_idx").on(t.guestToken),
      index14("mkt_rfqs_guest_token_hash_idx").on(t.guestTokenHash),
      index14("mkt_rfqs_portal_customer_idx").on(t.portalCustomerId),
      // Phase 2B.1 — company_id + status: untuk filter RFQ per perusahaan di admin dashboard
      index14("mkt_rfqs_company_status_idx").on(t.companyId, t.status)
    ]);
    insertMktRfqSchema = createInsertSchema14(mktRfqsTable).omit({
      id: true,
      rfqNumber: true,
      lineCount: true,
      quoteCount: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/accounting.ts
import {
  pgTable as pgTable21,
  serial as serial19,
  text as text20,
  integer as integer19,
  numeric as numeric12,
  boolean as boolean12,
  timestamp as timestamp21,
  pgEnum as pgEnum9,
  jsonb as jsonb8,
  date as date4,
  uniqueIndex as uniqueIndex8,
  index as index15
} from "drizzle-orm/pg-core";
import { sql as drizzleSql } from "drizzle-orm";
import { createInsertSchema as createInsertSchema15 } from "drizzle-zod";
var accountTypeEnum, coaNormalBalanceEnum, coaAccountCategoryEnum, coaStatusEnum, coaChangeActionEnum, coaChangeRequestStatusEnum, journalTypeEnum, taxKindEnum, cutTypeEnum, accountingEntryStatusEnum, accountingEntrySourceEnum, accountingPaymentTypeEnum, accountingPaymentStatusEnum, reconciliationStatusEnum, chartOfAccountsTable, coaChangeRequestsTable, coaVersionsTable, accountingJournalsTable, accountingTaxesTable, costCentersTable, accountingEntriesTable, accountingEntryLinesTable, accountingSettingsTable, accountingReconciliationsTable, accountingPaymentsTable, accountingPostingErrorsTable, coaModuleMappingTable, insertCompanySchema, insertAccountSchema, insertJournalSchema, insertTaxSchema, insertEntrySchema, insertEntryLineSchema, taxRulesTable, transactionTaxesTable, overrideRequestStatusEnum, financeOverrideRequestsTable;
var init_accounting = __esm({
  "../../lib/db/src/schema/accounting.ts"() {
    "use strict";
    init_companies();
    accountTypeEnum = pgEnum9("account_type", [
      "asset",
      "liability",
      "equity",
      "revenue",
      "expense"
    ]);
    coaNormalBalanceEnum = pgEnum9("coa_normal_balance", ["DEBIT", "CREDIT"]);
    coaAccountCategoryEnum = pgEnum9("coa_account_category", [
      "ASSET",
      "LIABILITY",
      "EQUITY",
      "REVENUE",
      "EXPENSE",
      "OTHER_INCOME",
      "OTHER_EXPENSE",
      "CONTRA_ASSET",
      "CONTRA_LIABILITY",
      "CONTRA_REVENUE",
      "CONTRA_EXPENSE",
      "CLEARING"
    ]);
    coaStatusEnum = pgEnum9("coa_status", [
      "DRAFT",
      "PENDING_APPROVAL",
      "ACTIVE",
      "REJECTED",
      "INACTIVE",
      "ARCHIVED"
    ]);
    coaChangeActionEnum = pgEnum9("coa_change_action", [
      "CREATE",
      "UPDATE",
      "UPDATE_NAME",
      "UPDATE_CODE",
      "UPDATE_PARENT",
      "UPDATE_CATEGORY",
      "UPDATE_NORMAL_BALANCE",
      "UPDATE_POSTABLE",
      "ACTIVATE",
      "DEACTIVATE",
      "ARCHIVE"
    ]);
    coaChangeRequestStatusEnum = pgEnum9("coa_change_request_status", [
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED",
      "CANCELLED"
    ]);
    journalTypeEnum = pgEnum9("journal_type", [
      "sales",
      "purchase",
      "bank",
      "cash",
      "general"
    ]);
    taxKindEnum = pgEnum9("tax_kind", ["sale", "purchase", "withholding"]);
    cutTypeEnum = pgEnum9("cut_type", ["self_borne", "withholding"]);
    accountingEntryStatusEnum = pgEnum9("accounting_entry_status", [
      "draft",
      "posted",
      "pending_approval",
      "approved",
      "rejected",
      "voided"
    ]);
    accountingEntrySourceEnum = pgEnum9("accounting_entry_source", [
      "manual",
      "sales_invoice",
      "purchase_bill",
      "sales_payment",
      "purchase_payment",
      "ecommerce_order",
      "stock_received",
      "manual_payment",
      "reversal",
      "cogs_delivery",
      "purchase_return",
      "sales_return",
      "opname_adjust",
      "damage_adjust",
      "grn_receipt",
      "wh_transfer",
      "sport_center_booking",
      "sport_center_booking_reversal",
      "sport_center_booking_refund",
      "sport_center_refund",
      "sport_center_membership",
      "sport_center_operational_expense",
      "closing_entry",
      "pos_sale",
      "logistic_vendor_cost",
      "tenant_rent_payment",
      "tenant_rent_reversal",
      "bank_mutation_import",
      "gsheet_import",
      "bank_reconciliation",
      // Reconciliation approval journal — canonical posting path
      "bank_reconciliation_void",
      // Reversal of a reconciliation journal
      "fleet_cash_payment",
      "marketplace_commission",
      // Added Phase 1C — 2026-07-02
      "kasbon",
      // Advance disbursement/repayment — already in DB enum
      "payroll",
      // Payroll disbursement — already in DB enum
      "hrd_salary_payment",
      // HRD salary payment — already in DB enum
      "sport_center_ppn_correction",
      // Koreksi PPN double-count sport center
      "sport_center_amount_correction",
      // Koreksi jumlah jurnal ≠ harga fasilitas
      "sport_center_qris_mdr",
      // Jurnal biaya MDR QRIS
      "sport_center_payment"
      // Canonical Sport Center payment event
    ]);
    accountingPaymentTypeEnum = pgEnum9("accounting_payment_type", [
      "inbound",
      "outbound"
    ]);
    accountingPaymentStatusEnum = pgEnum9("accounting_payment_status", [
      "posted",
      "voided",
      "draft",
      "pending_approval",
      "approved",
      "rejected"
    ]);
    reconciliationStatusEnum = pgEnum9("reconciliation_status", [
      "unreconciled",
      "suggested",
      "reconciled"
    ]);
    chartOfAccountsTable = pgTable21("chart_of_accounts", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      code: text20("code").notNull(),
      name: text20("name").notNull(),
      type: accountTypeEnum("type").notNull(),
      /**
       * subtype: opsional, untuk membedakan sub-jenis akun dalam tipe yang sama.
       * Nilai utama:
       *   'cash_bank'  — Kas, Bank, Giro, Kliring → boleh dipakai sbg tujuan fund_transfer
       *   'receivable' — Piutang (Usaha, Karyawan, Dana Talangan, dll.)
       *   'inventory'  — Persediaan Barang
       *   'fixed_asset'— Aset Tetap & Akumulasi Depresiasi
       *   'prepaid'    — Uang Muka / Biaya Dibayar di Muka
       *   'tax_asset'  — PPN Masukan / PPh Dibayar di Muka
       * NULL berarti belum dikategorikan.
       */
      subtype: text20("subtype"),
      parentId: integer19("parent_id"),
      isActive: boolean12("is_active").notNull().default(true),
      normalBalance: coaNormalBalanceEnum("normal_balance").notNull().default("DEBIT"),
      accountCategory: coaAccountCategoryEnum("account_category").notNull().default("ASSET"),
      isPostable: boolean12("is_postable").notNull().default(true),
      isHeader: boolean12("is_header").notNull().default(false),
      effectiveFrom: timestamp21("effective_from"),
      effectiveTo: timestamp21("effective_to"),
      status: coaStatusEnum("status").notNull().default("ACTIVE"),
      version: integer19("version").notNull().default(1),
      createdBy: text20("created_by"),
      updatedBy: text20("updated_by"),
      approvedBy: text20("approved_by"),
      approvedAt: timestamp21("approved_at"),
      rejectedBy: text20("rejected_by"),
      rejectedAt: timestamp21("rejected_at"),
      rejectionReason: text20("rejection_reason"),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyCodeUniq: uniqueIndex8("coa_company_code_uniq").on(t.companyId, t.code)
    }));
    coaChangeRequestsTable = pgTable21("coa_change_requests", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      coaId: integer19("coa_id"),
      action: coaChangeActionEnum("action").notNull(),
      status: coaChangeRequestStatusEnum("status").notNull().default("DRAFT"),
      beforeSnapshotJson: jsonb8("before_snapshot_json"),
      afterSnapshotJson: jsonb8("after_snapshot_json").notNull(),
      reason: text20("reason").notNull(),
      requestedBy: text20("requested_by").notNull(),
      requestedAt: timestamp21("requested_at").defaultNow().notNull(),
      reviewedBy: text20("reviewed_by"),
      reviewedAt: timestamp21("reviewed_at"),
      reviewComments: text20("review_comments"),
      idempotencyKey: text20("idempotency_key").notNull(),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyIdempotencyUniq: uniqueIndex8("coa_change_requests_company_idempotency_uniq").on(t.companyId, t.idempotencyKey),
      companyStatusIdx: index15("coa_change_requests_company_status_idx").on(t.companyId, t.status)
    }));
    coaVersionsTable = pgTable21("coa_versions", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      coaId: integer19("coa_id").notNull(),
      version: integer19("version").notNull(),
      snapshotJson: jsonb8("snapshot_json").notNull(),
      changeRequestId: integer19("change_request_id"),
      effectiveFrom: timestamp21("effective_from"),
      effectiveTo: timestamp21("effective_to"),
      createdBy: text20("created_by"),
      approvedBy: text20("approved_by"),
      createdAt: timestamp21("created_at").defaultNow().notNull()
    }, (t) => ({
      coaVersionUniq: uniqueIndex8("coa_versions_coa_version_uniq").on(t.coaId, t.version),
      companyCoaIdx: index15("coa_versions_company_coa_idx").on(t.companyId, t.coaId)
    }));
    accountingJournalsTable = pgTable21("accounting_journals", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      code: text20("code").notNull(),
      name: text20("name").notNull(),
      type: journalTypeEnum("type").notNull(),
      defaultDebitAccountId: integer19("default_debit_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      defaultCreditAccountId: integer19("default_credit_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      isActive: boolean12("is_active").notNull().default(true),
      createdAt: timestamp21("created_at").defaultNow().notNull()
    }, (t) => ({
      companyCodeUniq: uniqueIndex8("journals_company_code_uniq").on(t.companyId, t.code)
    }));
    accountingTaxesTable = pgTable21("accounting_taxes", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
      name: text20("name").notNull(),
      rate: numeric12("rate", { precision: 6, scale: 3 }).notNull(),
      kind: taxKindEnum("kind").notNull(),
      cutType: cutTypeEnum("cut_type").notNull().default("self_borne"),
      accountId: integer19("account_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
      isActive: boolean12("is_active").notNull().default(true),
      createdAt: timestamp21("created_at").defaultNow().notNull()
    });
    costCentersTable = pgTable21("cost_centers", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      code: text20("code").notNull(),
      name: text20("name").notNull(),
      description: text20("description"),
      isActive: boolean12("is_active").notNull().default(true),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyCodeUniq: uniqueIndex8("cost_centers_company_code_uniq").on(t.companyId, t.code)
    }));
    accountingEntriesTable = pgTable21("accounting_entries", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      entryNumber: text20("entry_number").notNull().unique(),
      journalId: integer19("journal_id").notNull().references(() => accountingJournalsTable.id, { onDelete: "restrict" }),
      date: date4("date").notNull(),
      ref: text20("ref"),
      description: text20("description"),
      /** Metode pembayaran sumber, mis. cash, transfer, qris. Metadata immutable jurnal. */
      paymentMethod: text20("payment_method"),
      /** Provider pembayaran sumber, mis. Paylabs, Mandiri Direct, GPN. */
      paymentProvider: text20("payment_provider"),
      status: accountingEntryStatusEnum("status").notNull().default("posted"),
      source: accountingEntrySourceEnum("source").notNull().default("manual"),
      sourceId: integer19("source_id"),
      /** Canonical upstream event identity for source-aware integrations. */
      sourceEventId: text20("source_event_id"),
      totalDebit: numeric12("total_debit", { precision: 14, scale: 2 }).notNull().default("0"),
      totalCredit: numeric12("total_credit", { precision: 14, scale: 2 }).notNull().default("0"),
      createdById: text20("created_by_id"),
      approvedBy: text20("approved_by"),
      approvedAt: timestamp21("approved_at"),
      cancelledBy: text20("cancelled_by"),
      cancelledAt: timestamp21("cancelled_at"),
      cancelReason: text20("cancel_reason"),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      costCenterId: integer19("cost_center_id").references(() => costCentersTable.id, { onDelete: "set null" }),
      facilityId: integer19("facility_id"),
      expenseCategory: text20("expense_category"),
      // ── Accounting Hub columns ────────────────────────────────────────────────
      branchId: integer19("branch_id"),
      divisionId: integer19("division_id"),
      sourceSchema: text20("source_schema"),
      sourceModule: text20("source_module"),
      sourceTable: text20("source_table"),
      postedAt: timestamp21("posted_at"),
      voidedAt: timestamp21("voided_at"),
      voidEntryId: integer19("void_entry_id")
    }, (t) => ({
      uniqAutoSource: uniqueIndex8("accounting_entries_source_uniq").on(t.source, t.sourceId).where(drizzleSql`${t.source} <> 'manual' AND ${t.sourceId} IS NOT NULL`),
      uniqCanonicalSourceEvent: uniqueIndex8("accounting_entries_canonical_event_uniq").on(t.companyId, t.source, t.sourceEventId).where(drizzleSql`${t.source} = 'sport_center_payment' AND ${t.sourceEventId} IS NOT NULL`),
      companyIdx: index15("accounting_entries_company_idx").on(t.companyId),
      journalIdx: index15("accounting_entries_journal_idx").on(t.journalId),
      dateIdx: index15("accounting_entries_date_idx").on(t.date),
      branchIdx: index15("accounting_entries_branch_idx").on(t.branchId),
      moduleIdx: index15("accounting_entries_module_idx").on(t.sourceModule)
    }));
    accountingEntryLinesTable = pgTable21("accounting_entry_lines", {
      id: serial19("id").primaryKey(),
      entryId: integer19("entry_id").notNull().references(() => accountingEntriesTable.id, { onDelete: "cascade" }),
      accountId: integer19("account_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
      description: text20("description"),
      debit: numeric12("debit", { precision: 14, scale: 2 }).notNull().default("0"),
      credit: numeric12("credit", { precision: 14, scale: 2 }).notNull().default("0")
    }, (t) => ({
      entryIdx: index15("entry_lines_entry_idx").on(t.entryId),
      accountIdx: index15("entry_lines_account_idx").on(t.accountId)
    }));
    accountingSettingsTable = pgTable21("accounting_settings", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      arAccountId: integer19("ar_account_id").references(() => chartOfAccountsTable.id, {
        onDelete: "set null"
      }),
      apAccountId: integer19("ap_account_id").references(() => chartOfAccountsTable.id, {
        onDelete: "set null"
      }),
      salesIncomeAccountId: integer19("sales_income_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      purchaseExpenseAccountId: integer19("purchase_expense_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      defaultBankAccountId: integer19("default_bank_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      ppnOutputAccountId: integer19("ppn_output_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      ppnInputAccountId: integer19("ppn_input_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      salesJournalId: integer19("sales_journal_id").references(
        () => accountingJournalsTable.id,
        { onDelete: "set null" }
      ),
      purchaseJournalId: integer19("purchase_journal_id").references(
        () => accountingJournalsTable.id,
        { onDelete: "set null" }
      ),
      bankJournalId: integer19("bank_journal_id").references(
        () => accountingJournalsTable.id,
        { onDelete: "set null" }
      ),
      /** Dedicated clearing/bank account and journal for QRIS receipts. */
      qrisAccountId: integer19("qris_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      qrisJournalId: integer19("qris_journal_id").references(
        () => accountingJournalsTable.id,
        { onDelete: "set null" }
      ),
      cashJournalId: integer19("cash_journal_id").references(
        () => accountingJournalsTable.id,
        { onDelete: "set null" }
      ),
      defaultSalesTaxId: integer19("default_sales_tax_id").references(
        () => accountingTaxesTable.id,
        { onDelete: "set null" }
      ),
      defaultPurchaseTaxId: integer19("default_purchase_tax_id").references(
        () => accountingTaxesTable.id,
        { onDelete: "set null" }
      ),
      defaultCashAccountId: integer19("default_cash_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      inventoryAccountId: integer19("inventory_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      gsheetSpreadsheetId: text20("gsheet_spreadsheet_id"),
      cogsAccountId: integer19("cogs_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      grirAccountId: integer19("grir_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      companyName: text20("company_name"),
      companyAddress: text20("company_address"),
      companyNpwp: text20("company_npwp"),
      companyLogoUrl: text20("company_logo_url"),
      meta: jsonb8("meta"),
      // ── Payroll account mapping (Cash Advance & Payroll Accounting Automation) ──
      salaryExpenseAccountId: integer19("salary_expense_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      allowanceExpenseAccountId: integer19("allowance_expense_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      salaryPayableAccountId: integer19("salary_payable_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      taxPayableAccountId: integer19("tax_payable_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      bpjsPayableAccountId: integer19("bpjs_payable_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      fleetCashAccountId: integer19("fleet_cash_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      fleetDriverReceivableAccountId: integer19("fleet_driver_receivable_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      tenantRentIncomeAccountId: integer19("tenant_rent_income_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    });
    accountingReconciliationsTable = pgTable21("accounting_reconciliations", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      lineId: integer19("line_id").notNull().references(() => accountingEntryLinesTable.id, { onDelete: "cascade" }),
      status: reconciliationStatusEnum("status").notNull().default("unreconciled"),
      matchSourceType: text20("match_source_type"),
      matchSourceId: integer19("match_source_id"),
      matchMethod: text20("match_method"),
      matchScore: numeric12("match_score", { precision: 5, scale: 2 }),
      matchDetails: jsonb8("match_details"),
      reconciledBy: text20("reconciled_by"),
      reconciledAt: timestamp21("reconciled_at"),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      lineUniq: uniqueIndex8("accounting_reconciliations_line_uniq").on(t.lineId),
      companyStatusIdx: index15("accounting_reconciliations_company_status_idx").on(t.companyId, t.status),
      sourceIdx: index15("accounting_reconciliations_source_idx").on(t.matchSourceType, t.matchSourceId),
      reconciledSourceUniq: uniqueIndex8("accounting_reconciliations_reconciled_source_uniq").on(t.companyId, t.matchSourceType, t.matchSourceId).where(drizzleSql`${t.status} = 'reconciled' AND ${t.matchSourceType} IS NOT NULL AND ${t.matchSourceId} IS NOT NULL`)
    }));
    accountingPaymentsTable = pgTable21("accounting_payments", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      paymentNumber: text20("payment_number"),
      paymentType: accountingPaymentTypeEnum("payment_type").notNull(),
      status: accountingPaymentStatusEnum("status").notNull().default("posted"),
      amount: numeric12("amount", { precision: 14, scale: 2 }).notNull(),
      journalId: integer19("journal_id").notNull().references(() => accountingJournalsTable.id, { onDelete: "restrict" }),
      partnerName: text20("partner_name"),
      date: date4("date").notNull(),
      ref: text20("ref"),
      memo: text20("memo"),
      /** Metode pembayaran sumber yang disalin dari modul transaksi. */
      paymentMethod: text20("payment_method"),
      /** Provider pembayaran sumber yang disalin dari modul transaksi. */
      paymentProvider: text20("payment_provider"),
      entryId: integer19("entry_id").references(() => accountingEntriesTable.id, {
        onDelete: "set null"
      }),
      voidEntryId: integer19("void_entry_id").references(() => accountingEntriesTable.id, {
        onDelete: "set null"
      }),
      sourceType: text20("source_type"),
      sourceDocId: integer19("source_doc_id"),
      voidReason: text20("void_reason"),
      createdById: text20("created_by_id"),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      // ── Accounting Hub columns ────────────────────────────────────────────────
      branchId: integer19("branch_id"),
      divisionId: integer19("division_id"),
      sourceSchema: text20("source_schema"),
      sourceModule: text20("source_module"),
      postedAt: timestamp21("posted_at"),
      voidedAt: timestamp21("voided_at")
    }, (t) => ({
      companyIdx: index15("accounting_payments_company_idx").on(t.companyId),
      journalIdx: index15("accounting_payments_journal_idx").on(t.journalId),
      dateIdx: index15("accounting_payments_date_idx").on(t.date)
    }));
    accountingPostingErrorsTable = pgTable21("accounting_posting_errors", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id"),
      branchId: integer19("branch_id"),
      divisionId: integer19("division_id"),
      sourceModule: text20("source_module").notNull(),
      sourceTable: text20("source_table"),
      sourceId: integer19("source_id"),
      sourceRef: text20("source_ref"),
      errorCode: text20("error_code").notNull(),
      errorMessage: text20("error_message").notNull(),
      payload: jsonb8("payload"),
      resolvedAt: timestamp21("resolved_at"),
      resolvedBy: text20("resolved_by"),
      resolveNote: text20("resolve_note"),
      createdAt: timestamp21("created_at").defaultNow().notNull()
    }, (t) => ({
      companyIdx: index15("posting_errors_company_idx").on(t.companyId),
      moduleIdx: index15("posting_errors_module_idx").on(t.sourceModule),
      resolvedIdx: index15("posting_errors_resolved_idx").on(t.resolvedAt)
    }));
    coaModuleMappingTable = pgTable21("coa_module_mapping", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      module: text20("module").notNull(),
      transactionType: text20("transaction_type").notNull(),
      debitAccountId: integer19("debit_account_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
      creditAccountId: integer19("credit_account_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
      description: text20("description"),
      isActive: boolean12("is_active").notNull().default(true),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyModuleTxUniq: uniqueIndex8("coa_module_mapping_uniq").on(t.companyId, t.module, t.transactionType),
      companyIdx: index15("coa_module_mapping_company_idx").on(t.companyId)
    }));
    insertCompanySchema = createInsertSchema15(companiesTable).omit({
      id: true,
      createdAt: true
    });
    insertAccountSchema = createInsertSchema15(chartOfAccountsTable).omit({
      id: true,
      createdAt: true
    });
    insertJournalSchema = createInsertSchema15(accountingJournalsTable).omit({
      id: true,
      createdAt: true
    });
    insertTaxSchema = createInsertSchema15(accountingTaxesTable).omit({
      id: true,
      createdAt: true
    });
    insertEntrySchema = createInsertSchema15(accountingEntriesTable).omit({
      id: true,
      createdAt: true,
      entryNumber: true,
      totalDebit: true,
      totalCredit: true
    });
    insertEntryLineSchema = createInsertSchema15(accountingEntryLinesTable).omit({
      id: true,
      entryId: true
    });
    taxRulesTable = pgTable21("tax_rules", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      name: text20("name").notNull(),
      transactionType: text20("transaction_type").notNull(),
      moduleSource: text20("module_source").notNull().default("all"),
      partnerType: text20("partner_type").notNull().default("all"),
      partnerPkpStatus: text20("partner_pkp_status").notNull().default("all"),
      partnerHasNpwp: text20("partner_has_npwp").notNull().default("all"),
      taxType: text20("tax_type").notNull(),
      taxRate: numeric12("tax_rate", { precision: 8, scale: 4 }).notNull().default("0"),
      taxBaseType: text20("tax_base_type").notNull().default("dpp"),
      direction: text20("direction").notNull().default("output"),
      isActive: boolean12("is_active").notNull().default(true),
      effectiveFrom: date4("effective_from"),
      effectiveTo: date4("effective_to"),
      notes: text20("notes"),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyActiveIdx: index15("tax_rules_company_idx").on(t.companyId, t.isActive),
      txTypeIdx: index15("tax_rules_tx_type_idx").on(t.transactionType)
    }));
    transactionTaxesTable = pgTable21("transaction_taxes", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      transactionType: text20("transaction_type").notNull(),
      transactionId: integer19("transaction_id").notNull(),
      transactionRef: text20("transaction_ref"),
      taxId: integer19("tax_id").notNull().references(() => accountingTaxesTable.id, { onDelete: "restrict" }),
      taxName: text20("tax_name").notNull(),
      taxRate: numeric12("tax_rate", { precision: 6, scale: 3 }).notNull(),
      cutType: text20("cut_type").notNull().default("self_borne"),
      baseAmount: numeric12("base_amount", { precision: 14, scale: 2 }).notNull(),
      taxAmount: numeric12("tax_amount", { precision: 14, scale: 2 }).notNull(),
      accountId: integer19("account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      period: text20("period").notNull(),
      status: text20("status").notNull().default("pending"),
      direction: text20("direction").notNull().default("output"),
      taxRuleId: integer19("tax_rule_id").references(() => taxRulesTable.id, { onDelete: "set null" }),
      partnerName: text20("partner_name"),
      npwp: text20("npwp"),
      fakturPajakNumber: text20("faktur_pajak_number"),
      buktiPotongNumber: text20("bukti_potong_number"),
      taxInvoiceNumber: text20("tax_invoice_number"),
      postedAt: timestamp21("posted_at"),
      paidAt: timestamp21("paid_at"),
      reportedAt: timestamp21("reported_at"),
      notes: text20("notes"),
      // ── Kolom ditambahkan via taxSptMigration (sudah ada di DB) ──────────────
      sptStatus: text20("spt_status").default("INCLUDED"),
      excludedReason: text20("excluded_reason"),
      excludedBy: text20("excluded_by"),
      excludedAt: timestamp21("excluded_at", { withTimezone: true }),
      // ── Kolom baru via taxAuditMigration ─────────────────────────────────────
      dppNilaiLain: numeric12("dpp_nilai_lain", { precision: 14, scale: 2 }).default("0"),
      nik: text20("nik"),
      validationErrors: jsonb8("validation_errors").default([]),
      metadata: jsonb8("metadata").default({}),
      includeInSpt: boolean12("include_in_spt").default(true),
      postingDate: timestamp21("posting_date", { withTimezone: true }),
      // ── Coretax C7 fields ─────────────────────────────────────────────────────
      invoiceDate: date4("invoice_date"),
      fakturDate: date4("faktur_date"),
      createdAt: timestamp21("created_at").defaultNow().notNull(),
      updatedAt: timestamp21("updated_at").defaultNow().notNull()
    }, (t) => ({
      txUniq: uniqueIndex8("tx_taxes_tx_uniq").on(t.transactionType, t.transactionId, t.taxId),
      companyPeriodIdx: index15("tx_taxes_company_period_idx").on(t.companyId, t.period),
      statusIdx: index15("tx_taxes_status_idx").on(t.status),
      directionIdx: index15("tx_taxes_direction_idx").on(t.direction),
      sptStatusIdx: index15("tx_taxes_spt_status_idx").on(t.companyId, t.period, t.sptStatus)
    }));
    overrideRequestStatusEnum = pgEnum9("override_request_status", [
      "PENDING_SECOND_APPROVAL",
      "APPROVED",
      "REJECTED",
      "EXECUTED"
    ]);
    financeOverrideRequestsTable = pgTable21("finance_override_requests", {
      id: serial19("id").primaryKey(),
      companyId: integer19("company_id").notNull(),
      requesterId: text20("requester_id").notNull(),
      requesterEmail: text20("requester_email").notNull(),
      approverId: text20("approver_id"),
      approverEmail: text20("approver_email"),
      status: overrideRequestStatusEnum("status").notNull().default("PENDING_SECOND_APPROVAL"),
      entityType: text20("entity_type").notNull(),
      entityId: text20("entity_id").notNull(),
      entitySnapshot: jsonb8("entity_snapshot"),
      targetAction: text20("target_action").notNull(),
      reason: text20("reason").notNull(),
      rejectionReason: text20("rejection_reason"),
      createdAt: timestamp21("created_at", { withTimezone: true }).notNull().defaultNow(),
      approvedAt: timestamp21("approved_at", { withTimezone: true }),
      rejectedAt: timestamp21("rejected_at", { withTimezone: true }),
      executedAt: timestamp21("executed_at", { withTimezone: true })
    }, (t) => ({
      companyIdx: index15("finance_override_req_company_idx").on(t.companyId),
      statusIdx: index15("finance_override_req_status_idx").on(t.status),
      requesterIdx: index15("finance_override_req_requester_idx").on(t.requesterId)
    }));
  }
});

// ../../lib/db/src/schema/mktVendorQuotes.ts
import { pgTable as pgTable22, serial as serial20, text as text21, integer as integer20, numeric as numeric13, jsonb as jsonb9, date as date5, timestamp as timestamp22, pgEnum as pgEnum10, index as index16, uniqueIndex as uniqueIndex9 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema16 } from "drizzle-zod";
var mktQuoteStatusEnum, mktVendorQuotesTable, insertMktVendorQuoteSchema;
var init_mktVendorQuotes = __esm({
  "../../lib/db/src/schema/mktVendorQuotes.ts"() {
    "use strict";
    init_mktRfqs();
    init_suppliers();
    init_accounting();
    mktQuoteStatusEnum = pgEnum10("mkt_quote_status", [
      "invited",
      "opened",
      "submitted",
      "selected",
      "rejected",
      "expired",
      "withdrawn",
      // Phase 2F — Requote Flow: admin meminta vendor merevisi quotation
      "requote_requested"
    ]);
    mktVendorQuotesTable = pgTable22("mkt_vendor_quotes", {
      id: serial20("id").primaryKey(),
      rfqId: integer20("rfq_id").notNull().references(() => mktRfqsTable.id, { onDelete: "cascade" }),
      vendorId: integer20("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
      token: text21("token").notNull().unique(),
      // token akses vendor (tanpa login)
      status: mktQuoteStatusEnum("status").notNull().default("invited"),
      validUntil: timestamp22("valid_until"),
      deliveryDateOffered: date5("delivery_date_offered"),
      notes: text21("notes"),
      attachmentUrl: text21("attachment_url"),
      attachmentFilename: text21("attachment_filename"),
      // Phase 2E — display name for the attachment (not the signed URL)
      // ── Phase 2D — Vendor Quote Submission header fields [KEPUTUSAN #3-#6] ────
      quotationNumber: text21("quotation_number"),
      // KEPUTUSAN #3 — bebas, TIDAK unique
      quotationDate: date5("quotation_date"),
      // KEPUTUSAN #4 — default CURRENT_DATE di service layer
      paymentTerms: text21("payment_terms"),
      // KEPUTUSAN #5 — free text, bukan enum
      incoterm: text21("incoterm"),
      // KEPUTUSAN #5 — free text, bukan enum
      deliveryLocation: text21("delivery_location"),
      // ── INTERNAL FIELDS — WAJIB disembunyikan dari vendor API [KEPUTUSAN #10] ──
      commissionRate: numeric13("commission_rate", { precision: 5, scale: 3 }),
      // % komisi platform
      commissionTaxId: integer20("commission_tax_id").references(() => accountingTaxesTable.id, { onDelete: "set null" }),
      // KEPUTUSAN #12
      commissionAmount: numeric13("commission_amount", { precision: 14, scale: 2 }),
      netVendorAmount: numeric13("net_vendor_amount", { precision: 14, scale: 2 }),
      rankScore: numeric13("rank_score", { precision: 8, scale: 4 }),
      rankBadges: jsonb9("rank_badges").$type(),
      submittedAt: timestamp22("submitted_at"),
      openedAt: timestamp22("opened_at"),
      // ── Phase 2F — Requote Flow ────────────────────────────────────────────────
      // Diisi saat admin meminta vendor merevisi quotation (status → 'requote_requested').
      requoteNotes: text21("requote_notes"),
      // alasan requote dari admin
      requoteDeadline: timestamp22("requote_deadline"),
      // deadline respons (opsional)
      requoteRound: integer20("requote_round").notNull().default(1),
      // round 1 = initial quote, 2 = first requote, dst.
      // Di-increment saat vendor submit ulang dari 'requote_requested'
      createdAt: timestamp22("created_at").defaultNow().notNull(),
      updatedAt: timestamp22("updated_at").defaultNow().notNull()
    }, (t) => [
      index16("mkt_vendor_quotes_rfq_idx").on(t.rfqId),
      index16("mkt_vendor_quotes_vendor_idx").on(t.vendorId),
      index16("mkt_vendor_quotes_status_idx").on(t.status),
      // Phase 2C: satu vendor max 1 invite per RFQ — race guard di DB level
      uniqueIndex9("mkt_vendor_quotes_rfq_vendor_unique").on(t.rfqId, t.vendorId)
    ]);
    insertMktVendorQuoteSchema = createInsertSchema16(mktVendorQuotesTable).omit({
      id: true,
      token: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktPurchaseOrders.ts
import { pgTable as pgTable23, serial as serial21, text as text22, integer as integer21, date as date6, numeric as numeric14, timestamp as timestamp23, pgEnum as pgEnum11, index as index17, uniqueIndex as uniqueIndex10 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema17 } from "drizzle-zod";
var mktPoStatusEnum, mktPurchaseOrdersTable, insertMktPurchaseOrderSchema;
var init_mktPurchaseOrders = __esm({
  "../../lib/db/src/schema/mktPurchaseOrders.ts"() {
    "use strict";
    init_mktRfqs();
    init_mktVendorQuotes();
    init_companies();
    init_suppliers();
    init_salesDocuments();
    mktPoStatusEnum = pgEnum11("mkt_po_status", [
      "pending",
      "confirmed",
      "in_progress",
      "delivered",
      "completed",
      "cancelled",
      "issued",
      "vendor_accepted",
      "revision_requested",
      "vendor_rejected",
      "production",
      "ready_to_ship",
      "in_transit",
      "partially_delivered",
      "closed",
      "rejected_goods"
    ]);
    mktPurchaseOrdersTable = pgTable23("mkt_purchase_orders", {
      id: serial21("id").primaryKey(),
      poNumber: text22("po_number").notNull().unique(),
      // format: MKT-PO-YYYYMM-XXXX
      rfqId: integer21("rfq_id").notNull().references(() => mktRfqsTable.id, { onDelete: "restrict" }),
      quoteId: integer21("quote_id").notNull().references(() => mktVendorQuotesTable.id, { onDelete: "restrict" }),
      companyId: integer21("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      vendorId: integer21("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
      status: mktPoStatusEnum("status").notNull().default("pending"),
      totalAmount: numeric14("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      taxAmount: numeric14("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric14("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      // Link ke ERP documents (dibuat setelah PO confirmed)
      salesDocumentId: integer21("sales_document_id").references(() => salesDocumentsTable.id, { onDelete: "set null" }),
      // ── Phase 2E — Snapshot immutable (di-isi saat INSERT, TIDAK boleh diubah) ──
      // Melindungi PO dari perubahan data supplier/quote di kemudian hari.
      vendorNameSnapshot: text22("vendor_name_snapshot"),
      vendorAddressSnapshot: text22("vendor_address_snapshot"),
      paymentTermsSnapshot: text22("payment_terms_snapshot"),
      incotermSnapshot: text22("incoterm_snapshot"),
      quotationNumberSnapshot: text22("quotation_number_snapshot"),
      quotationDateSnapshot: date6("quotation_date_snapshot"),
      currencySnapshot: text22("currency_snapshot"),
      leadTimeDaysSnapshot: integer21("lead_time_days_snapshot"),
      confirmedAt: timestamp23("confirmed_at"),
      cancelledAt: timestamp23("cancelled_at"),
      cancelReason: text22("cancel_reason"),
      journalPostedAt: timestamp23("journal_posted_at"),
      // ── Phase 2G — Vendor confirmation token + KPI dates (migration 0022) ──────
      // vendor_token: opaque 64-hex, nullable (NULL for pre-Phase-2G PO rows).
      // vendor_token_version increments on regenerate — old token strings become
      // unmatchable (lookup is always by exact token string), no separate
      // token-history table needed for Phase 2G.
      vendorToken: text22("vendor_token").unique(),
      vendorTokenVersion: integer21("vendor_token_version").notNull().default(1),
      vendorTokenExpiresAt: timestamp23("vendor_token_expires_at"),
      vendorTokenUsedAt: timestamp23("vendor_token_used_at"),
      lastTokenGeneratedAt: timestamp23("last_token_generated_at"),
      revisionNotes: text22("revision_notes"),
      closedAt: timestamp23("closed_at"),
      expectedCompletionDate: date6("expected_completion_date"),
      actualCompletionDate: date6("actual_completion_date"),
      createdBy: text22("created_by"),
      createdAt: timestamp23("created_at").defaultNow().notNull(),
      updatedAt: timestamp23("updated_at").defaultNow().notNull()
    }, (t) => [
      // Phase 2E — unique constraints (also in migration 0018)
      uniqueIndex10("mkt_po_rfq_unique").on(t.rfqId),
      uniqueIndex10("mkt_po_quote_unique").on(t.quoteId),
      // Lookup indexes
      index17("mkt_purchase_orders_company_idx").on(t.companyId),
      index17("mkt_purchase_orders_vendor_idx").on(t.vendorId),
      index17("mkt_purchase_orders_status_idx").on(t.status)
    ]);
    insertMktPurchaseOrderSchema = createInsertSchema17(mktPurchaseOrdersTable).omit({
      id: true,
      poNumber: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/purchaseDocuments.ts
import { pgTable as pgTable24, serial as serial22, text as text23, integer as integer22, numeric as numeric15, timestamp as timestamp24, pgEnum as pgEnum12, index as index18, jsonb as jsonb10 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema18 } from "drizzle-zod";
var purchaseDocKindEnum, purchaseDocStatusEnum, purchaseReceiveStatusEnum, purchaseBillStatusEnum, purchasePaymentStatusEnum, purchaseDocumentsTable, purchaseDocumentLinesTable, insertPurchaseDocumentSchema, insertPurchaseDocumentLineSchema;
var init_purchaseDocuments = __esm({
  "../../lib/db/src/schema/purchaseDocuments.ts"() {
    "use strict";
    init_suppliers();
    init_products();
    init_companies();
    init_inventory();
    init_mktPurchaseOrders();
    purchaseDocKindEnum = pgEnum12("purchase_doc_kind", ["rfq", "order"]);
    purchaseDocStatusEnum = pgEnum12("purchase_doc_status", [
      "draft",
      "sent",
      "confirmed",
      "done",
      "cancelled"
    ]);
    purchaseReceiveStatusEnum = pgEnum12("purchase_receive_status", [
      "none",
      "to_receive",
      "received"
    ]);
    purchaseBillStatusEnum = pgEnum12("purchase_bill_status", [
      "none",
      "to_bill",
      "billed"
    ]);
    purchasePaymentStatusEnum = pgEnum12("purchase_payment_status", [
      "unpaid",
      "partial",
      "paid",
      "overdue"
    ]);
    purchaseDocumentsTable = pgTable24("purchase_documents", {
      id: serial22("id").primaryKey(),
      companyId: integer22("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      docNumber: text23("doc_number").notNull().unique(),
      kind: purchaseDocKindEnum("kind").notNull().default("rfq"),
      status: purchaseDocStatusEnum("status").notNull().default("draft"),
      receiveStatus: purchaseReceiveStatusEnum("receive_status").notNull().default("none"),
      billStatus: purchaseBillStatusEnum("bill_status").notNull().default("none"),
      paymentStatus: purchasePaymentStatusEnum("payment_status").notNull().default("unpaid"),
      amountPaid: numeric15("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
      warehouseId: integer22("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
      supplierId: integer22("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      supplierName: text23("supplier_name").notNull(),
      supplierAddress: text23("supplier_address"),
      totalAmount: numeric15("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      taxRateId: integer22("tax_rate_id"),
      taxAmount: numeric15("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric15("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      expectedDate: timestamp24("expected_date"),
      notes: text23("notes"),
      confirmedAt: timestamp24("confirmed_at"),
      // Bill automation fields
      billNumber: text23("bill_number"),
      billDate: text23("bill_date"),
      dueDate: text23("due_date"),
      paymentTermDays: integer22("payment_term_days").default(30),
      productCategory: text23("product_category"),
      incoterm: text23("incoterm"),
      deliveryTerm: text23("delivery_term"),
      targetPrice: numeric15("target_price", { precision: 14, scale: 2 }),
      commoditySpecs: jsonb10("commodity_specs"),
      requiredDocuments: jsonb10("required_documents"),
      categoryKey: text23("category_key"),
      templateId: text23("template_id"),
      templateVersion: text23("template_version"),
      templateSnapshot: jsonb10("template_snapshot").$type(),
      cancelledAt: timestamp24("cancelled_at"),
      cancelledBy: text23("cancelled_by"),
      cancelReason: text23("cancel_reason"),
      approvedBy: text23("approved_by"),
      approvedAt: timestamp24("approved_at"),
      editReason: text23("edit_reason"),
      createdById: text23("created_by_id"),
      createdAt: timestamp24("created_at").defaultNow().notNull(),
      updatedAt: timestamp24("updated_at").defaultNow().notNull(),
      // Marketplace link — Added Phase 1C (2026-07-02), Group D migration
      mktPurchaseOrderId: integer22("mkt_purchase_order_id").references(() => mktPurchaseOrdersTable.id, { onDelete: "set null" })
    }, (t) => [
      index18("purchase_docs_company_idx").on(t.companyId),
      index18("purchase_docs_supplier_idx").on(t.supplierId),
      index18("purchase_docs_status_idx").on(t.status, t.kind),
      index18("purchase_documents_mkt_po_idx").on(t.mktPurchaseOrderId)
    ]);
    purchaseDocumentLinesTable = pgTable24("purchase_document_lines", {
      id: serial22("id").primaryKey(),
      documentId: integer22("document_id").notNull().references(() => purchaseDocumentsTable.id, { onDelete: "cascade" }),
      productId: integer22("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text23("name").notNull(),
      description: text23("description"),
      quantity: numeric15("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
      unit: text23("unit"),
      uomId: integer22("uom_id"),
      unitCost: numeric15("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric15("subtotal", { precision: 14, scale: 2 }).notNull().default("0")
    }, (t) => [
      index18("purchase_doc_lines_doc_idx").on(t.documentId),
      index18("purchase_doc_lines_product_idx").on(t.productId)
    ]);
    insertPurchaseDocumentSchema = createInsertSchema18(purchaseDocumentsTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true,
      docNumber: true
    });
    insertPurchaseDocumentLineSchema = createInsertSchema18(purchaseDocumentLinesTable).omit({
      id: true
    });
  }
});

// ../../lib/db/src/schema/payments.ts
import { pgTable as pgTable25, serial as serial23, text as text24, integer as integer23, numeric as numeric16, timestamp as timestamp25, pgEnum as pgEnum13, jsonb as jsonb11, boolean as boolean13, index as index19 } from "drizzle-orm/pg-core";
var paymentRefKindEnum, paymentStatusEnum, paymentProviderEnum, paymentsTable, paylabsConfigurationsTable;
var init_payments = __esm({
  "../../lib/db/src/schema/payments.ts"() {
    "use strict";
    paymentRefKindEnum = pgEnum13("payment_ref_kind", ["sales", "purchase", "logistic"]);
    paymentStatusEnum = pgEnum13("payment_status", [
      "pending",
      "paid",
      "expired",
      "cancelled",
      "failed"
    ]);
    paymentProviderEnum = pgEnum13("payment_provider", ["paylabs"]);
    paymentsTable = pgTable25("payments", {
      id: serial23("id").primaryKey(),
      // Phase 1 isolation — nullable during backfill; enforce NOT NULL after data migration
      companyId: integer23("company_id"),
      refKind: paymentRefKindEnum("ref_kind").notNull(),
      refId: integer23("ref_id").notNull(),
      refDocNumber: text24("ref_doc_number").notNull(),
      amount: numeric16("amount", { precision: 14, scale: 2 }).notNull(),
      status: paymentStatusEnum("status").notNull().default("pending"),
      provider: paymentProviderEnum("provider").notNull().default("paylabs"),
      /** Metode pembayaran yang dipilih di provider, mis. qris, transfer, atau cash. */
      paymentMethod: text24("payment_method"),
      providerOrderId: text24("provider_order_id"),
      providerMerchantTradeNo: text24("provider_merchant_trade_no").notNull().unique(),
      paymentUrl: text24("payment_url"),
      raw: jsonb11("raw"),
      expiredAt: timestamp25("expired_at"),
      paidAt: timestamp25("paid_at"),
      createdAt: timestamp25("created_at").defaultNow().notNull(),
      updatedAt: timestamp25("updated_at").defaultNow().notNull()
    }, (t) => [
      index19("payments_company_idx").on(t.companyId),
      index19("payments_ref_idx").on(t.refKind, t.refId),
      index19("payments_paid_at_idx").on(t.paidAt),
      index19("payments_status_paid_at_idx").on(t.status, t.paidAt)
    ]);
    paylabsConfigurationsTable = pgTable25("paylabs_configurations", {
      id: serial23("id").primaryKey(),
      sandboxMode: boolean13("sandbox_mode").notNull().default(false),
      storeId: text24("store_id"),
      sandboxPublicKey: text24("sandbox_public_key"),
      sandboxPrivateKey: text24("sandbox_private_key"),
      sandboxMerchantId: text24("sandbox_merchant_id"),
      prodPublicKey: text24("prod_public_key"),
      prodPrivateKey: text24("prod_private_key"),
      prodMerchantId: text24("prod_merchant_id"),
      updatedAt: timestamp25("updated_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/correspondences.ts
import { pgTable as pgTable26, serial as serial24, text as text25, integer as integer24, timestamp as timestamp26, pgEnum as pgEnum14, index as index20 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema19 } from "drizzle-zod";
var correspondenceKindEnum, correspondenceDirectionEnum, correspondencesTable, insertCorrespondenceSchema, correspondenceAttachmentsTable;
var init_correspondences = __esm({
  "../../lib/db/src/schema/correspondences.ts"() {
    "use strict";
    init_companies();
    correspondenceKindEnum = pgEnum14("correspondence_kind", [
      "email",
      "whatsapp",
      "letter",
      "other"
    ]);
    correspondenceDirectionEnum = pgEnum14("correspondence_direction", [
      "inbound",
      "outbound"
    ]);
    correspondencesTable = pgTable26("correspondences", {
      id: serial24("id").primaryKey(),
      companyId: integer24("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      kind: correspondenceKindEnum("kind").notNull().default("email"),
      direction: correspondenceDirectionEnum("direction").notNull().default("inbound"),
      subject: text25("subject").notNull(),
      body: text25("body"),
      extractedText: text25("extracted_text"),
      senderName: text25("sender_name"),
      senderEmail: text25("sender_email"),
      receiverName: text25("receiver_name"),
      receiverEmail: text25("receiver_email"),
      ccEmail: text25("cc_email"),
      status: text25("status").notNull().default("new"),
      linkedDocType: text25("linked_doc_type"),
      linkedDocId: integer24("linked_doc_id"),
      customerId: integer24("customer_id"),
      supplierId: integer24("supplier_id"),
      tags: text25("tags"),
      attachments: text25("attachments"),
      emailMessageId: text25("email_message_id"),
      emailThreadId: text25("email_thread_id"),
      correspondedAt: timestamp26("corresponded_at").notNull().defaultNow(),
      createdById: text25("created_by_id"),
      createdAt: timestamp26("created_at").defaultNow().notNull()
    }, (t) => [
      index20("correspondences_company_idx").on(t.companyId)
    ]);
    insertCorrespondenceSchema = createInsertSchema19(correspondencesTable).omit({
      id: true,
      createdAt: true
    });
    correspondenceAttachmentsTable = pgTable26("correspondence_attachments", {
      id: serial24("id").primaryKey(),
      correspondenceId: integer24("correspondence_id").notNull(),
      fileName: text25("file_name").notNull(),
      objectPath: text25("object_path").notNull(),
      mimeType: text25("mime_type"),
      extractedText: text25("extracted_text"),
      createdAt: timestamp26("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/freightShipments.ts
import { pgTable as pgTable27, serial as serial25, text as text26, numeric as numeric17, integer as integer25, timestamp as timestamp27, date as date7, pgEnum as pgEnum15 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema20 } from "drizzle-zod";
var freightServiceCategoryEnum, freightShipmentStatusEnum, freightQuoteStatusEnum, freightShipmentsTable, freightRfqsTable, freightQuotesTable, insertFreightShipmentSchema, insertFreightRfqSchema, insertFreightQuoteSchema;
var init_freightShipments = __esm({
  "../../lib/db/src/schema/freightShipments.ts"() {
    "use strict";
    init_salesDocuments();
    init_purchaseDocuments();
    init_companies();
    freightServiceCategoryEnum = pgEnum15("freight_service_category", [
      "FF_UDARA",
      // Air Freight Forwarding
      "FF_LAUT",
      // Sea/Ocean Freight Forwarding
      "PPJK",
      // Customs Clearance (Pengusaha Pengurusan Jasa Kepabeanan)
      "TRUCKING",
      // Darat / Trucking
      "MULTIMODAL",
      // Kombinasi lebih dari satu moda
      "GENERAL_FORWARDING"
      // Forwarding umum / belum dikategorikan
    ]);
    freightShipmentStatusEnum = pgEnum15("freight_shipment_status", [
      "draft",
      "rfq_sent",
      "confirmed",
      "in_transit",
      "completed",
      "cancelled"
    ]);
    freightQuoteStatusEnum = pgEnum15("freight_quote_status", [
      "pending",
      "approved",
      "rejected"
    ]);
    freightShipmentsTable = pgTable27("freight_shipments", {
      id: serial25("id").primaryKey(),
      shipmentNumber: text26("shipment_number").notNull().unique(),
      shipperName: text26("shipper_name").notNull(),
      shipperAddress: text26("shipper_address"),
      consigneeName: text26("consignee_name").notNull(),
      consigneeAddress: text26("consignee_address"),
      commodity: text26("commodity").notNull(),
      grossWeight: numeric17("gross_weight", { precision: 12, scale: 3 }),
      netWeight: numeric17("net_weight", { precision: 12, scale: 3 }),
      quantity: integer25("quantity"),
      packingType: text26("packing_type"),
      dimensions: text26("dimensions"),
      hsCode: text26("hs_code"),
      origin: text26("origin").notNull(),
      destination: text26("destination").notNull(),
      portOfLoading: text26("port_of_loading"),
      portOfDischarge: text26("port_of_discharge"),
      vessel: text26("vessel"),
      voyage: text26("voyage"),
      notifyParty: text26("notify_party"),
      marksAndNumbers: text26("marks_and_numbers"),
      measurement: text26("measurement"),
      status: freightShipmentStatusEnum("status").default("draft").notNull(),
      notes: text26("notes"),
      actualCost: numeric17("actual_cost", { precision: 14, scale: 2 }),
      departureDate: date7("departure_date"),
      arrivalDate: date7("arrival_date"),
      trackingNumber: text26("tracking_number"),
      awbNumber: text26("awb_number"),
      transportMode: text26("transport_mode"),
      cargoType: text26("cargo_type"),
      containerNo: text26("container_no"),
      freightCost: numeric17("freight_cost", { precision: 14, scale: 2 }).default("0"),
      salesDocId: integer25("sales_doc_id").references(() => salesDocumentsTable.id, { onDelete: "set null" }),
      purchaseDocId: integer25("purchase_doc_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
      approvedVendorName: text26("approved_vendor_name"),
      createdById: text26("created_by_id"),
      companyId: integer25("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      // ── Unified Shipment Core (ditambahkan 2026-06-11) ──────────────────────────
      // Semua kolom nullable agar data lama tidak rusak.
      serviceCategory: freightServiceCategoryEnum("service_category"),
      sourceModule: text26("source_module"),
      // 'air_freight'|'ocean_freight'|'logistic_order'|'freight'|'manual'
      sourceOrderId: integer25("source_order_id"),
      // ID dari tabel sumber (nullable, tanpa FK constraint agar lintas tabel)
      createdAt: timestamp27("created_at").defaultNow().notNull(),
      // ── FASE 10: Accounting Linkage (ditambahkan 2026-06-11) ────────────────────
      estimatedRevenue: numeric17("estimated_revenue", { precision: 14, scale: 2 }),
      estimatedCost: numeric17("estimated_cost", { precision: 14, scale: 2 }),
      actualRevenue: numeric17("actual_revenue", { precision: 14, scale: 2 }),
      invoiceStatus: text26("invoice_status").notNull().default("none"),
      // 'none'|'to_invoice'|'invoiced'
      vendorBillStatus: text26("vendor_bill_status").notNull().default("none")
      // 'none'|'to_bill'|'billed'
    });
    freightRfqsTable = pgTable27("freight_rfqs", {
      id: serial25("id").primaryKey(),
      rfqNumber: text26("rfq_number").notNull().unique(),
      shipmentId: integer25("shipment_id").notNull().references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
      vendorNames: text26("vendor_names").array().notNull().default([]),
      notes: text26("notes"),
      status: text26("status").notNull().default("open"),
      createdAt: timestamp27("created_at").defaultNow().notNull()
    });
    freightQuotesTable = pgTable27("freight_quotes", {
      id: serial25("id").primaryKey(),
      rfqId: integer25("rfq_id").notNull().references(() => freightRfqsTable.id, { onDelete: "cascade" }),
      shipmentId: integer25("shipment_id").notNull(),
      vendorName: text26("vendor_name").notNull(),
      truckingCost: numeric17("trucking_cost", { precision: 14, scale: 2 }).default("0"),
      handlingCost: numeric17("handling_cost", { precision: 14, scale: 2 }).default("0"),
      freightCost: numeric17("freight_cost", { precision: 14, scale: 2 }).default("0"),
      otherCost: numeric17("other_cost", { precision: 14, scale: 2 }).default("0"),
      totalCost: numeric17("total_cost", { precision: 14, scale: 2 }).default("0"),
      estimatedDays: integer25("estimated_days"),
      notes: text26("notes"),
      status: freightQuoteStatusEnum("status").default("pending").notNull(),
      createdAt: timestamp27("created_at").defaultNow().notNull()
    });
    insertFreightShipmentSchema = createInsertSchema20(freightShipmentsTable).omit({ id: true, shipmentNumber: true, createdAt: true });
    insertFreightRfqSchema = createInsertSchema20(freightRfqsTable).omit({ id: true, rfqNumber: true, createdAt: true });
    insertFreightQuoteSchema = createInsertSchema20(freightQuotesTable).omit({ id: true, createdAt: true });
  }
});

// ../../lib/db/src/schema/freightAttachments.ts
import { pgTable as pgTable28, serial as serial26, integer as integer26, text as text27, timestamp as timestamp28, date as date8, pgEnum as pgEnum16 } from "drizzle-orm/pg-core";
var freightAttachmentTypeEnum, freightAttachmentsTable;
var init_freightAttachments = __esm({
  "../../lib/db/src/schema/freightAttachments.ts"() {
    "use strict";
    init_freightShipments();
    freightAttachmentTypeEnum = pgEnum16("freight_attachment_type", [
      "photo",
      "document"
    ]);
    freightAttachmentsTable = pgTable28("freight_attachments", {
      id: serial26("id").primaryKey(),
      shipmentId: integer26("shipment_id").notNull().references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
      objectPath: text27("object_path").notNull(),
      fileName: text27("file_name").notNull(),
      contentType: text27("content_type").notNull(),
      fileType: freightAttachmentTypeEnum("file_type").notNull(),
      label: text27("label"),
      uploadedById: text27("uploaded_by_id"),
      // Document management fields
      docType: text27("doc_type"),
      docNumber: text27("doc_number"),
      docDate: date8("doc_date"),
      docStatus: text27("doc_status"),
      invoiceId: integer26("invoice_id"),
      createdAt: timestamp28("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/shipmentStages.ts
import { pgTable as pgTable29, serial as serial27, integer as integer27, text as text28, date as date9, timestamp as timestamp29, pgEnum as pgEnum17 } from "drizzle-orm/pg-core";
var shipmentStageTypeEnum, SHIPMENT_STAGE_TYPES, shipmentStagesTable;
var init_shipmentStages = __esm({
  "../../lib/db/src/schema/shipmentStages.ts"() {
    "use strict";
    shipmentStageTypeEnum = pgEnum17("shipment_stage_type", [
      "booking",
      "trucking",
      "handling",
      "customs",
      "pickup",
      "customs_export",
      "sea_freight",
      "customs_import",
      "delivery"
    ]);
    SHIPMENT_STAGE_TYPES = shipmentStageTypeEnum.enumValues;
    shipmentStagesTable = pgTable29("shipment_stages", {
      id: serial27("id").primaryKey(),
      shipmentId: integer27("shipment_id").notNull(),
      stageType: shipmentStageTypeEnum("stage_type").notNull(),
      vendorName: text28("vendor_name"),
      date: date9("date"),
      status: text28("status").default("pending").notNull(),
      notes: text28("notes"),
      createdAt: timestamp29("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/apiResponseTimes.ts
import { pgTable as pgTable30, serial as serial28, text as text29, integer as integer28, timestamp as timestamp30 } from "drizzle-orm/pg-core";
var apiResponseTimesTable;
var init_apiResponseTimes = __esm({
  "../../lib/db/src/schema/apiResponseTimes.ts"() {
    "use strict";
    apiResponseTimesTable = pgTable30("api_response_times", {
      id: serial28("id").primaryKey(),
      timestamp: timestamp30("timestamp").defaultNow().notNull(),
      path: text29("path").notNull(),
      durationMs: integer28("duration_ms").notNull()
    });
  }
});

// ../../lib/db/src/schema/expenses.ts
import {
  pgTable as pgTable31,
  serial as serial29,
  text as text30,
  integer as integer29,
  numeric as numeric18,
  boolean as boolean14,
  timestamp as timestamp31,
  date as date10,
  index as index21,
  uniqueIndex as uniqueIndex11
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema21 } from "drizzle-zod";
var expenseCategoriesTable, expensesTable, expenseAttachmentsTable, insertExpenseCategorySchema, insertExpenseSchema;
var init_expenses = __esm({
  "../../lib/db/src/schema/expenses.ts"() {
    "use strict";
    init_accounting();
    init_companies();
    expenseCategoriesTable = pgTable31("expense_categories", {
      id: serial29("id").primaryKey(),
      // Nullable only for legacy/backfill safety; every row is expected to carry
      // a companyId after the per-company backfill migration runs (see
      // ensureExpenseCategoriesCompanyScoped in routes/expenses.ts). Categories
      // used to be global across all companies — this is what scopes them.
      companyId: integer29("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      name: text30("name").notNull(),
      code: text30("code").notNull(),
      expenseAccountId: integer29("expense_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      payableAccountId: integer29("payable_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      defaultTaxId: integer29("default_tax_id").references(() => accountingTaxesTable.id, { onDelete: "set null" }),
      defaultAmount: numeric18("default_amount", { precision: 14, scale: 2 }),
      defaultCoaId: integer29("default_coa_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      requiresAttachment: boolean14("requires_attachment").notNull().default(false),
      isActive: boolean14("is_active").notNull().default(true),
      createdAt: timestamp31("created_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex11("expense_categories_company_code_uniq").on(t.companyId, t.code),
      index21("expense_categories_company_idx").on(t.companyId)
    ]);
    expensesTable = pgTable31("expenses", {
      id: serial29("id").primaryKey(),
      companyId: integer29("company_id"),
      expenseNumber: text30("expense_number").notNull().unique(),
      date: date10("date").notNull(),
      vendorEmployee: text30("vendor_employee"),
      expenseType: text30("expense_type").notNull().default("vendor_bill"),
      salesDocId: integer29("sales_doc_id"),
      shipmentId: integer29("shipment_id"),
      categoryId: integer29("category_id").references(() => expenseCategoriesTable.id, { onDelete: "set null" }),
      description: text30("description"),
      qty: numeric18("qty", { precision: 14, scale: 4 }).notNull().default("1"),
      unit: text30("unit"),
      unitPrice: numeric18("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric18("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      taxRateId: integer29("tax_rate_id").references(() => accountingTaxesTable.id, { onDelete: "set null" }),
      taxAmount: numeric18("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      total: numeric18("total", { precision: 14, scale: 2 }).notNull().default("0"),
      currency: text30("currency").notNull().default("IDR"),
      status: text30("status").notNull().default("draft"),
      notes: text30("notes"),
      entryId: integer29("entry_id"),
      expenseAccountId: integer29("expense_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      payableAccountId: integer29("payable_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      sourceAccountId: integer29("source_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
      vendorId: integer29("vendor_id"),
      userId: text30("user_id"),
      rejectionReason: text30("rejection_reason"),
      createdById: text30("created_by_id"),
      // Bridge (nullable) ke bank_disbursements — diisi saat expense dibayar
      // lewat modul Bank Disbursement. Tidak menggabungkan tabel; expenses
      // tetap sumber pencatatan beban, bank_disbursements tetap modul pembayaran.
      disbursementId: integer29("disbursement_id"),
      createdAt: timestamp31("created_at").defaultNow().notNull(),
      updatedAt: timestamp31("updated_at").defaultNow().notNull()
    }, (t) => [
      index21("expenses_company_idx").on(t.companyId),
      index21("expenses_category_idx").on(t.categoryId),
      index21("expenses_status_idx").on(t.status),
      index21("expenses_date_idx").on(t.date),
      index21("expenses_disbursement_idx").on(t.disbursementId)
    ]);
    expenseAttachmentsTable = pgTable31("expense_attachments", {
      id: serial29("id").primaryKey(),
      expenseId: integer29("expense_id").notNull(),
      objectPath: text30("object_path").notNull(),
      fileName: text30("file_name").notNull(),
      contentType: text30("content_type"),
      createdAt: timestamp31("created_at").defaultNow().notNull()
    });
    insertExpenseCategorySchema = createInsertSchema21(expenseCategoriesTable).omit({
      id: true,
      createdAt: true
    });
    insertExpenseSchema = createInsertSchema21(expensesTable).omit({
      id: true,
      expenseNumber: true,
      entryId: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/emailCorrespondences.ts
import { pgTable as pgTable32, serial as serial30, text as text31, integer as integer30, boolean as boolean15, timestamp as timestamp32 } from "drizzle-orm/pg-core";
var emailCorrespondencesTable, emailAttachmentsTable, emailLinksTable;
var init_emailCorrespondences = __esm({
  "../../lib/db/src/schema/emailCorrespondences.ts"() {
    "use strict";
    emailCorrespondencesTable = pgTable32("email_correspondences", {
      id: serial30("id").primaryKey(),
      emailMessageId: text31("email_message_id").unique(),
      fromEmail: text31("from_email"),
      toEmail: text31("to_email"),
      ccEmail: text31("cc_email"),
      subject: text31("subject").notNull().default(""),
      body: text31("body"),
      receivedAt: timestamp32("received_at").notNull().defaultNow(),
      status: text31("status").notNull().default("new"),
      validatedBy: text31("validated_by"),
      validatedAt: timestamp32("validated_at"),
      aiProcessed: boolean15("ai_processed").notNull().default(false),
      aiSkipReason: text31("ai_skip_reason"),
      linkedSalesDocId: integer30("linked_sales_doc_id"),
      inReplyTo: text31("in_reply_to"),
      emailRole: text31("email_role").default("inquiry"),
      threadSalesDocId: integer30("thread_sales_doc_id"),
      createdAt: timestamp32("created_at").notNull().defaultNow(),
      updatedAt: timestamp32("updated_at").notNull().defaultNow()
    });
    emailAttachmentsTable = pgTable32("email_attachments", {
      id: serial30("id").primaryKey(),
      emailCorrespondenceId: integer30("email_correspondence_id").notNull(),
      fileName: text31("file_name").notNull(),
      fileUrl: text31("file_url").notNull(),
      mimeType: text31("mime_type"),
      createdAt: timestamp32("created_at").notNull().defaultNow()
    });
    emailLinksTable = pgTable32("email_links", {
      id: serial30("id").primaryKey(),
      emailCorrespondenceId: integer30("email_correspondence_id").notNull(),
      linkedType: text31("linked_type").notNull(),
      linkedId: integer30("linked_id").notNull(),
      linkReason: text31("link_reason"),
      isValidated: boolean15("is_validated").notNull().default(false),
      validatedBy: text31("validated_by"),
      validatedAt: timestamp32("validated_at"),
      notes: text31("notes"),
      createdAt: timestamp32("created_at").notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/freightCustomsDocs.ts
import { pgTable as pgTable33, serial as serial31, integer as integer31, text as text32, date as date11, jsonb as jsonb12, timestamp as timestamp33, index as index22 } from "drizzle-orm/pg-core";
var freightCustomsDocsTable;
var init_freightCustomsDocs = __esm({
  "../../lib/db/src/schema/freightCustomsDocs.ts"() {
    "use strict";
    init_freightShipments();
    freightCustomsDocsTable = pgTable33("freight_customs_docs", {
      id: serial31("id").primaryKey(),
      shipmentId: integer31("shipment_id").references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
      sourceModule: text32("source_module"),
      sourceOrderId: integer31("source_order_id"),
      docType: text32("doc_type").notNull(),
      nomorAju: text32("nomor_aju"),
      nomorDokumen: text32("nomor_dokumen"),
      tanggalDokumen: date11("tanggal_dokumen"),
      customsStatus: text32("customs_status"),
      data: jsonb12("data").default({}).$type(),
      scanSource: text32("scan_source").default("manual"),
      notes: text32("notes"),
      createdAt: timestamp33("created_at").defaultNow().notNull(),
      updatedAt: timestamp33("updated_at").defaultNow().notNull()
    }, (t) => ({
      shipmentIdx: index22("fcd_shipment_idx").on(t.shipmentId),
      sourceIdx: index22("fcd_source_idx").on(t.sourceModule, t.sourceOrderId)
    }));
  }
});

// ../../lib/db/src/schema/vendorRates.ts
import { pgTable as pgTable34, serial as serial32, integer as integer32, text as text33, numeric as numeric19, boolean as boolean16, timestamp as timestamp34 } from "drizzle-orm/pg-core";
var vendorRatesTable;
var init_vendorRates = __esm({
  "../../lib/db/src/schema/vendorRates.ts"() {
    "use strict";
    init_suppliers();
    vendorRatesTable = pgTable34("vendor_rates", {
      id: serial32("id").primaryKey(),
      vendorId: integer32("vendor_id").references(() => suppliersTable.id, { onDelete: "cascade" }),
      transportMode: text33("transport_mode").notNull(),
      truckType: text33("truck_type"),
      originKeyword: text33("origin_keyword"),
      destKeyword: text33("dest_keyword"),
      baseRate: numeric19("base_rate", { precision: 15, scale: 2 }).notNull().default("0"),
      unit: text33("unit").notNull().default("per_trip"),
      isActive: boolean16("is_active").notNull().default(true),
      createdAt: timestamp34("created_at", { withTimezone: true }).defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/drivers.ts
import { pgTable as pgTable35, serial as serial33, text as text34, boolean as boolean17, numeric as numeric20, timestamp as timestamp35, integer as integer33, index as index23 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema22 } from "drizzle-zod";
var driversTable, insertDriverSchema;
var init_drivers = __esm({
  "../../lib/db/src/schema/drivers.ts"() {
    "use strict";
    init_companies();
    driversTable = pgTable35("drivers", {
      id: serial33("id").primaryKey(),
      companyId: integer33("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      name: text34("name").notNull(),
      email: text34("email").notNull().unique(),
      passwordHash: text34("password_hash").notNull(),
      phone: text34("phone"),
      licenseNumber: text34("license_number"),
      vehiclePlate: text34("vehicle_plate"),
      vehicleType: text34("vehicle_type"),
      isActive: boolean17("is_active").default(true).notNull(),
      currentLat: numeric20("current_lat", { precision: 10, scale: 7 }),
      currentLng: numeric20("current_lng", { precision: 10, scale: 7 }),
      lastLocationAt: timestamp35("last_location_at"),
      createdAt: timestamp35("created_at").defaultNow().notNull()
    }, (t) => [
      index23("drivers_company_idx").on(t.companyId)
    ]);
    insertDriverSchema = createInsertSchema22(driversTable).omit({
      id: true,
      passwordHash: true,
      createdAt: true,
      lastLocationAt: true,
      currentLat: true,
      currentLng: true
    });
  }
});

// ../../lib/db/src/schema/driverJobs.ts
import { pgTable as pgTable36, serial as serial34, integer as integer34, text as text35, timestamp as timestamp36, pgEnum as pgEnum18, index as index24 } from "drizzle-orm/pg-core";
var driverJobStatusEnum, driverJobsTable, driverJobLogsTable, driverPhotosTable;
var init_driverJobs = __esm({
  "../../lib/db/src/schema/driverJobs.ts"() {
    "use strict";
    init_drivers();
    init_freightShipments();
    init_logisticOrders();
    driverJobStatusEnum = pgEnum18("driver_job_status", [
      "ASSIGNED",
      "ACCEPTED",
      "ON_THE_WAY_TO_PICKUP",
      "ARRIVED_AT_PICKUP",
      "PICKED_UP",
      "IN_TRANSIT",
      "ARRIVED_AT_DESTINATION",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED"
    ]);
    driverJobsTable = pgTable36("driver_jobs", {
      id: serial34("id").primaryKey(),
      // Phase 1 isolation — nullable; backfill from logistic_orders.company_id via logistic_order_id
      companyId: integer34("company_id"),
      driverId: integer34("driver_id").references(() => driversTable.id, { onDelete: "set null" }),
      freightShipmentId: integer34("freight_shipment_id").references(
        () => freightShipmentsTable.id,
        { onDelete: "set null" }
      ),
      logisticOrderId: integer34("logistic_order_id").references(
        () => logisticOrdersTable.id,
        { onDelete: "set null" }
      ),
      jobNumber: text35("job_number").notNull().unique(),
      customerName: text35("customer_name"),
      pickupAddress: text35("pickup_address"),
      deliveryAddress: text35("delivery_address"),
      cargoDescription: text35("cargo_description"),
      vehicleType: text35("vehicle_type"),
      truckPlate: text35("truck_plate"),
      pickupDateTime: timestamp36("pickup_date_time"),
      deliveryDateTime: timestamp36("delivery_date_time"),
      specialInstruction: text35("special_instruction"),
      weight: text35("weight"),
      distance: text35("distance"),
      status: driverJobStatusEnum("status").default("ASSIGNED").notNull(),
      notes: text35("notes"),
      podReceiverName: text35("pod_receiver_name"),
      podReceiverPosition: text35("pod_receiver_position"),
      podNotes: text35("pod_notes"),
      podPhotos: text35("pod_photos"),
      podSubmittedAt: timestamp36("pod_submitted_at"),
      podGeoLat: text35("pod_geo_lat"),
      podGeoLng: text35("pod_geo_lng"),
      podDeviceTimestamp: timestamp36("pod_device_timestamp"),
      podMapUrl: text35("pod_map_url"),
      podStreetViewUrl: text35("pod_street_view_url"),
      podSignatureDataUrl: text35("pod_signature_data_url"),
      assignedAt: timestamp36("assigned_at").defaultNow().notNull(),
      completedAt: timestamp36("completed_at"),
      createdAt: timestamp36("created_at").defaultNow().notNull(),
      driverType: text35("driver_type").default("EXTERNAL"),
      executionMode: text35("execution_mode").default("DRIVER_APP"),
      waProgressToken: text35("wa_progress_token"),
      driverNameOverride: text35("driver_name_override"),
      driverPhoneOverride: text35("driver_phone_override"),
      vehiclePlateOverride: text35("vehicle_plate_override"),
      legacySource: text35("legacy_source")
    }, (t) => [
      index24("driver_jobs_company_idx").on(t.companyId),
      index24("driver_jobs_driver_idx").on(t.driverId),
      index24("driver_jobs_logistic_order_idx").on(t.logisticOrderId)
    ]);
    driverJobLogsTable = pgTable36("driver_job_logs", {
      id: serial34("id").primaryKey(),
      driverJobId: integer34("driver_job_id").notNull().references(() => driverJobsTable.id, { onDelete: "cascade" }),
      status: driverJobStatusEnum("status").notNull(),
      note: text35("note"),
      timestamp: timestamp36("timestamp").defaultNow().notNull()
    });
    driverPhotosTable = pgTable36("driver_photos", {
      id: serial34("id").primaryKey(),
      driverJobId: integer34("driver_job_id").notNull().references(() => driverJobsTable.id, { onDelete: "cascade" }),
      url: text35("url").notNull(),
      photoType: text35("photo_type").notNull().default("general"),
      takenAt: timestamp36("taken_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/aiChat.ts
import { pgTable as pgTable37, serial as serial35, text as text36, integer as integer35, timestamp as timestamp37, boolean as boolean18 } from "drizzle-orm/pg-core";
var aiAgentSettingsTable, aiChatSessionsTable, aiChatMessagesTable, chatbotKnowledgeBaseTable;
var init_aiChat = __esm({
  "../../lib/db/src/schema/aiChat.ts"() {
    "use strict";
    init_logisticOrders();
    aiAgentSettingsTable = pgTable37("ai_agent_settings", {
      id: serial35("id").primaryKey(),
      key: text36("key").notNull().unique(),
      value: text36("value").notNull(),
      updatedAt: timestamp37("updated_at").defaultNow().notNull()
    });
    aiChatSessionsTable = pgTable37("ai_chat_sessions", {
      id: serial35("id").primaryKey(),
      sessionToken: text36("session_token").notNull().unique(),
      logisticOrderId: integer35("logistic_order_id").references(
        () => logisticOrdersTable.id,
        { onDelete: "set null" }
      ),
      createdAt: timestamp37("created_at").defaultNow().notNull()
    });
    aiChatMessagesTable = pgTable37("ai_chat_messages", {
      id: serial35("id").primaryKey(),
      sessionId: integer35("session_id").notNull().references(() => aiChatSessionsTable.id, { onDelete: "cascade" }),
      role: text36("role").notNull(),
      content: text36("content").notNull(),
      createdAt: timestamp37("created_at").defaultNow().notNull()
    });
    chatbotKnowledgeBaseTable = pgTable37("chatbot_knowledge_base", {
      id: serial35("id").primaryKey(),
      title: text36("title").notNull(),
      category: text36("category").notNull().default("umum"),
      content: text36("content").notNull(),
      isActive: boolean18("is_active").notNull().default(true),
      sortOrder: integer35("sort_order").notNull().default(0),
      createdAt: timestamp37("created_at").defaultNow().notNull(),
      updatedAt: timestamp37("updated_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/waAiIntakeLog.ts
import { pgTable as pgTable38, serial as serial36, text as text37, timestamp as timestamp38 } from "drizzle-orm/pg-core";
var waAiIntakeLogTable;
var init_waAiIntakeLog = __esm({
  "../../lib/db/src/schema/waAiIntakeLog.ts"() {
    "use strict";
    waAiIntakeLogTable = pgTable38("wa_ai_intake_log", {
      id: serial36("id").primaryKey(),
      phone: text37("phone").notNull(),
      senderName: text37("sender_name"),
      status: text37("status").notNull(),
      skipReason: text37("skip_reason"),
      processedAt: timestamp38("processed_at").notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/portalProductOrders.ts
import {
  pgTable as pgTable39,
  serial as serial37,
  text as text38,
  numeric as numeric21,
  integer as integer36,
  timestamp as timestamp39,
  jsonb as jsonb13
} from "drizzle-orm/pg-core";
import { relations as relations2 } from "drizzle-orm";
var portalProductOrdersTable, portalProductOrderItemsTable, portalProductOrdersRelations, portalProductOrderItemsRelations;
var init_portalProductOrders = __esm({
  "../../lib/db/src/schema/portalProductOrders.ts"() {
    "use strict";
    init_products();
    portalProductOrdersTable = pgTable39("portal_product_orders", {
      id: serial37("id").primaryKey(),
      orderNumber: text38("order_number").notNull().unique(),
      customerName: text38("customer_name").notNull(),
      email: text38("email").notNull(),
      phone: text38("phone").notNull(),
      shippingAddress: text38("shipping_address").notNull(),
      notes: text38("notes"),
      subtotal: numeric21("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric21("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      status: text38("status").notNull().default("New Order"),
      // Product Template Engine fields
      productCategory: text38("product_category"),
      templateId: text38("template_id"),
      templateVersion: text38("template_version"),
      customFieldValues: jsonb13("custom_field_values").$type().default({}),
      uploadedDocuments: jsonb13("uploaded_documents").$type().default([]),
      checklistStatus: jsonb13("checklist_status").$type().default({}),
      packagingNotes: text38("packaging_notes"),
      conditionalFlags: jsonb13("conditional_flags").$type().default({}),
      // Audit trail — immutable snapshot of the resolved template at the moment
      // the order was placed. Lets old orders keep rendering correctly even if
      // an admin later edits/deactivates the template definition.
      templateSnapshot: jsonb13("template_snapshot").$type(),
      // Payment tracking
      paymentStatus: text38("payment_status").default("unpaid"),
      paidAt: timestamp39("paid_at", { withTimezone: true }),
      // Product-first order fields (Phase 2B)
      orderType: text38("order_type").default("standard"),
      productApproveToken: text38("product_approve_token"),
      shipmentMode: text38("shipment_mode"),
      vendorQuotedPrice: numeric21("vendor_quoted_price", { precision: 14, scale: 2 }),
      vendorNameSelected: text38("vendor_name_selected"),
      readyDate: text38("ready_date"),
      pickupLocation: text38("pickup_location"),
      // Phase 2B-4: invoice cost breakdown
      shipmentCost: numeric21("shipment_cost", { precision: 14, scale: 2 }),
      truckCost: numeric21("truck_cost", { precision: 14, scale: 2 }),
      // Analytics / profitability fields
      productPrice: numeric21("product_price", { precision: 14, scale: 2 }),
      companyId: integer36("company_id"),
      // Audit timestamps
      createdAt: timestamp39("created_at").defaultNow().notNull(),
      updatedAt: timestamp39("updated_at", { withTimezone: true }).defaultNow()
    });
    portalProductOrderItemsTable = pgTable39("portal_product_order_items", {
      id: serial37("id").primaryKey(),
      orderId: integer36("order_id").notNull().references(() => portalProductOrdersTable.id, { onDelete: "cascade" }),
      productId: integer36("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      productName: text38("product_name").notNull(),
      productSku: text38("product_sku"),
      unit: text38("unit"),
      unitPrice: numeric21("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
      qty: integer36("qty").notNull().default(1),
      subtotal: numeric21("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      // Shipping specs — auto-filled from product catalog, no customer input needed
      weightKg: numeric21("weight_kg", { precision: 10, scale: 3 }),
      lengthCm: numeric21("length_cm", { precision: 10, scale: 2 }),
      widthCm: numeric21("width_cm", { precision: 10, scale: 2 }),
      heightCm: numeric21("height_cm", { precision: 10, scale: 2 }),
      goodsType: text38("goods_type"),
      createdAt: timestamp39("created_at").defaultNow().notNull()
    });
    portalProductOrdersRelations = relations2(portalProductOrdersTable, ({ many }) => ({
      items: many(portalProductOrderItemsTable)
    }));
    portalProductOrderItemsRelations = relations2(portalProductOrderItemsTable, ({ one }) => ({
      order: one(portalProductOrdersTable, {
        fields: [portalProductOrderItemsTable.orderId],
        references: [portalProductOrdersTable.id]
      }),
      product: one(productsTable, {
        fields: [portalProductOrderItemsTable.productId],
        references: [productsTable.id]
      })
    }));
  }
});

// ../../lib/db/src/schema/quotationReplyLogs.ts
import {
  pgTable as pgTable40,
  serial as serial38,
  text as text39,
  numeric as numeric22,
  boolean as boolean19,
  jsonb as jsonb14,
  timestamp as timestamp40,
  integer as integer37
} from "drizzle-orm/pg-core";
var quotationReplyLogsTable;
var init_quotationReplyLogs = __esm({
  "../../lib/db/src/schema/quotationReplyLogs.ts"() {
    "use strict";
    quotationReplyLogsTable = pgTable40("quotation_reply_logs", {
      id: serial38("id").primaryKey(),
      rfqId: text39("rfq_id"),
      orderId: integer37("order_id"),
      customerName: text39("customer_name").notNull(),
      customerPhone: text39("customer_phone").notNull(),
      vendorName: text39("vendor_name"),
      vendorPhone: text39("vendor_phone"),
      serviceType: text39("service_type"),
      route: text39("route"),
      vendorPrice: numeric22("vendor_price", { precision: 14, scale: 2 }),
      markupType: text39("markup_type").notNull().default("percentage"),
      markupValue: numeric22("markup_value", { precision: 14, scale: 2 }).notNull().default("0"),
      finalPrice: numeric22("final_price", { precision: 14, scale: 2 }).notNull(),
      pickupDate: text39("pickup_date"),
      deliveryDate: text39("delivery_date"),
      notes: text39("notes"),
      status: text39("status").notNull().default("Ready"),
      messageBody: text39("message_body").notNull(),
      fonnteResponse: jsonb14("fonnte_response"),
      sentStatus: text39("sent_status").notNull().default("draft"),
      sentToAdmin: boolean19("sent_to_admin").default(false),
      sentAt: timestamp40("sent_at"),
      createdBy: text39("created_by"),
      createdAt: timestamp40("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/holding.ts
import {
  pgTable as pgTable41,
  serial as serial39,
  text as text40,
  integer as integer38,
  numeric as numeric23,
  timestamp as timestamp41
} from "drizzle-orm/pg-core";
var holdingGroupsTable, companyHoldingMembersTable;
var init_holding = __esm({
  "../../lib/db/src/schema/holding.ts"() {
    "use strict";
    holdingGroupsTable = pgTable41("holding_groups", {
      id: serial39("id").primaryKey(),
      holdingName: text40("holding_name").notNull(),
      holdingCode: text40("holding_code").notNull().unique(),
      description: text40("description"),
      createdAt: timestamp41("created_at").defaultNow().notNull()
    });
    companyHoldingMembersTable = pgTable41("company_holding_members", {
      id: serial39("id").primaryKey(),
      holdingGroupId: integer38("holding_group_id").references(() => holdingGroupsTable.id),
      companyId: integer38("company_id").notNull(),
      ownershipPercentage: numeric23("ownership_percentage", { precision: 5, scale: 2 }).default("100.00"),
      consolidationMethod: text40("consolidation_method").default("full"),
      createdAt: timestamp41("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/waIncomingMessages.ts
import {
  pgTable as pgTable42,
  serial as serial40,
  text as text41,
  boolean as boolean20,
  jsonb as jsonb15,
  timestamp as timestamp42
} from "drizzle-orm/pg-core";
var waIncomingMessagesTable;
var init_waIncomingMessages = __esm({
  "../../lib/db/src/schema/waIncomingMessages.ts"() {
    "use strict";
    waIncomingMessagesTable = pgTable42("wa_incoming_messages", {
      id: serial40("id").primaryKey(),
      sender: text41("sender").notNull(),
      senderName: text41("sender_name"),
      message: text41("message").notNull(),
      deviceId: text41("device_id"),
      messageType: text41("message_type").default("text"),
      isRead: boolean20("is_read").default(false).notNull(),
      repliedAt: timestamp42("replied_at"),
      replyMessage: text41("reply_message"),
      rawPayload: jsonb15("raw_payload"),
      receivedAt: timestamp42("received_at").defaultNow().notNull(),
      createdAt: timestamp42("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/quoteRequests.ts
import { pgTable as pgTable43, serial as serial41, text as text42, numeric as numeric24, timestamp as timestamp43, boolean as boolean21 } from "drizzle-orm/pg-core";
var quoteRequestsTable;
var init_quoteRequests = __esm({
  "../../lib/db/src/schema/quoteRequests.ts"() {
    "use strict";
    quoteRequestsTable = pgTable43("quote_requests", {
      id: serial41("id").primaryKey(),
      name: text42("name").notNull(),
      email: text42("email"),
      whatsapp: text42("whatsapp").notNull(),
      service: text42("service").notNull(),
      origin: text42("origin").notNull(),
      destination: text42("destination").notNull(),
      weight: text42("weight"),
      length: text42("length"),
      width: text42("width"),
      height: text42("height"),
      incoterms: text42("incoterms"),
      insurance: boolean21("insurance").default(false),
      express: boolean21("express").default(false),
      estimatedTotal: numeric24("estimated_total", { precision: 14, scale: 2 }),
      estimatedCbm: numeric24("estimated_cbm", { precision: 10, scale: 4 }),
      estimatedChargeableWeight: numeric24("estimated_chargeable_weight", { precision: 10, scale: 2 }),
      status: text42("status").notNull().default("new"),
      notes: text42("notes"),
      handledBy: text42("handled_by"),
      createdAt: timestamp43("created_at").defaultNow().notNull(),
      updatedAt: timestamp43("updated_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/mediaAssets.ts
import { pgTable as pgTable44, serial as serial42, text as text43, integer as integer39, timestamp as timestamp44 } from "drizzle-orm/pg-core";
var mediaAssetsTable;
var init_mediaAssets = __esm({
  "../../lib/db/src/schema/mediaAssets.ts"() {
    "use strict";
    mediaAssetsTable = pgTable44("media_assets", {
      id: serial42("id").primaryKey(),
      originalName: text43("original_name").notNull(),
      contentType: text43("content_type").notNull(),
      sizeBytes: integer39("size_bytes"),
      url: text43("url").notNull(),
      objectPath: text43("object_path").notNull(),
      uploadedBy: text43("uploaded_by"),
      folder: text43("folder").notNull().default("Umum"),
      createdAt: timestamp44("created_at").defaultNow().notNull(),
      publicUrl: text43("public_url")
    });
  }
});

// ../../lib/db/src/schema/warehouse.ts
import {
  pgTable as pgTable45,
  serial as serial43,
  text as text44,
  integer as integer40,
  numeric as numeric25,
  boolean as boolean22,
  timestamp as timestamp45,
  pgEnum as pgEnum19,
  uniqueIndex as uniqueIndex12,
  index as index25
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema23 } from "drizzle-zod";
var whMovementTypeEnum, whTransferStatusEnum, whDamageStatusEnum, whReturnTypeEnum, whReturnStatusEnum, whDamageTypeEnum, whStockTable, whMovementsTable, whTransfersTable, whTransferLinesTable, whDamageReportsTable, whDamageLinesTable, whReturnsTable, whReturnLinesTable, productRecipesTable, productRecipeItemsTable, whOpnamesTable, whOpnameLinesTable, insertWhStockSchema, insertWhMovementSchema, insertWhTransferSchema, insertWhTransferLineSchema, insertWhDamageReportSchema, insertWhDamageLineSchema, insertWhReturnSchema, insertWhReturnLineSchema, insertProductRecipeSchema, insertProductRecipeItemSchema, insertWhOpnameSchema, insertWhOpnameLineSchema;
var init_warehouse = __esm({
  "../../lib/db/src/schema/warehouse.ts"() {
    "use strict";
    init_products();
    init_inventory();
    init_companies();
    whMovementTypeEnum = pgEnum19("wh_movement_type", [
      "po_receipt",
      "so_delivery",
      "transfer_in",
      "transfer_out",
      "opname_adjust",
      "damage",
      "return_in",
      "return_out",
      "manual_in",
      "manual_out"
    ]);
    whTransferStatusEnum = pgEnum19("wh_transfer_status", [
      "draft",
      "in_transit",
      "received",
      "cancelled"
    ]);
    whDamageStatusEnum = pgEnum19("wh_damage_status", [
      "draft",
      "confirmed",
      "cancelled"
    ]);
    whReturnTypeEnum = pgEnum19("wh_return_type", [
      "purchase",
      "sales"
    ]);
    whReturnStatusEnum = pgEnum19("wh_return_status", [
      "draft",
      "confirmed",
      "cancelled"
    ]);
    whDamageTypeEnum = pgEnum19("wh_damage_type", [
      "rusak",
      "hilang",
      "expired",
      "lainnya"
    ]);
    whStockTable = pgTable45("wh_stock", {
      id: serial43("id").primaryKey(),
      companyId: integer40("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      warehouseId: integer40("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "cascade" }),
      rackId: integer40("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
      qty: numeric25("qty", { precision: 14, scale: 3 }).notNull().default("0"),
      costPrice: numeric25("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
      updatedAt: timestamp45("updated_at").defaultNow().notNull()
    }, (t) => [
      index25("wh_stock_company_idx").on(t.companyId),
      uniqueIndex12("wh_stock_product_warehouse_rack_idx").on(t.productId, t.warehouseId, t.rackId)
    ]);
    whMovementsTable = pgTable45("wh_movements", {
      id: serial43("id").primaryKey(),
      companyId: integer40("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      warehouseId: integer40("warehouse_id").notNull().references(() => warehousesTable.id),
      rackId: integer40("rack_id").references(() => warehouseRacksTable.id),
      type: whMovementTypeEnum("type").notNull(),
      qty: numeric25("qty", { precision: 14, scale: 3 }).notNull(),
      qtyBefore: numeric25("qty_before", { precision: 14, scale: 3 }).notNull().default("0"),
      qtyAfter: numeric25("qty_after", { precision: 14, scale: 3 }).notNull().default("0"),
      costPrice: numeric25("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
      refType: text44("ref_type"),
      refId: integer40("ref_id"),
      note: text44("note"),
      createdById: text44("created_by_id"),
      createdAt: timestamp45("created_at").defaultNow().notNull()
    }, (t) => [
      index25("wh_movements_company_idx").on(t.companyId),
      index25("wh_movements_product_idx").on(t.productId),
      index25("wh_movements_warehouse_idx").on(t.warehouseId),
      index25("wh_movements_type_idx").on(t.type),
      index25("wh_movements_created_idx").on(t.createdAt)
    ]);
    whTransfersTable = pgTable45("wh_transfers", {
      id: serial43("id").primaryKey(),
      companyId: integer40("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      transferNumber: text44("transfer_number").notNull().unique(),
      fromWarehouseId: integer40("from_warehouse_id").notNull().references(() => warehousesTable.id),
      toWarehouseId: integer40("to_warehouse_id").notNull().references(() => warehousesTable.id),
      status: whTransferStatusEnum("status").notNull().default("draft"),
      note: text44("note"),
      createdById: text44("created_by_id"),
      createdAt: timestamp45("created_at").defaultNow().notNull(),
      sentAt: timestamp45("sent_at"),
      receivedAt: timestamp45("received_at"),
      cancelledAt: timestamp45("cancelled_at")
    }, (t) => [
      index25("wh_transfers_from_idx").on(t.fromWarehouseId),
      index25("wh_transfers_to_idx").on(t.toWarehouseId),
      index25("wh_transfers_status_idx").on(t.status)
    ]);
    whTransferLinesTable = pgTable45("wh_transfer_lines", {
      id: serial43("id").primaryKey(),
      transferId: integer40("transfer_id").notNull().references(() => whTransfersTable.id, { onDelete: "cascade" }),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      fromRackId: integer40("from_rack_id").references(() => warehouseRacksTable.id),
      toRackId: integer40("to_rack_id").references(() => warehouseRacksTable.id),
      qtyRequested: numeric25("qty_requested", { precision: 14, scale: 3 }).notNull().default("0"),
      qtySent: numeric25("qty_sent", { precision: 14, scale: 3 }).notNull().default("0"),
      qtyReceived: numeric25("qty_received", { precision: 14, scale: 3 }).notNull().default("0")
    });
    whDamageReportsTable = pgTable45("wh_damage_reports", {
      id: serial43("id").primaryKey(),
      companyId: integer40("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      reportNumber: text44("report_number").notNull().unique(),
      warehouseId: integer40("warehouse_id").notNull().references(() => warehousesTable.id),
      status: whDamageStatusEnum("status").notNull().default("draft"),
      note: text44("note"),
      createdById: text44("created_by_id"),
      confirmedById: text44("confirmed_by_id"),
      createdAt: timestamp45("created_at").defaultNow().notNull(),
      confirmedAt: timestamp45("confirmed_at"),
      cancelledAt: timestamp45("cancelled_at")
    });
    whDamageLinesTable = pgTable45("wh_damage_lines", {
      id: serial43("id").primaryKey(),
      reportId: integer40("report_id").notNull().references(() => whDamageReportsTable.id, { onDelete: "cascade" }),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      rackId: integer40("rack_id").references(() => warehouseRacksTable.id),
      qty: numeric25("qty", { precision: 14, scale: 3 }).notNull().default("0"),
      damageType: whDamageTypeEnum("damage_type").notNull().default("rusak"),
      note: text44("note")
    });
    whReturnsTable = pgTable45("wh_returns", {
      id: serial43("id").primaryKey(),
      companyId: integer40("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      returnNumber: text44("return_number").notNull().unique(),
      type: whReturnTypeEnum("type").notNull(),
      refDocId: integer40("ref_doc_id"),
      refDocNumber: text44("ref_doc_number"),
      warehouseId: integer40("warehouse_id").notNull().references(() => warehousesTable.id),
      status: whReturnStatusEnum("status").notNull().default("draft"),
      note: text44("note"),
      createdById: text44("created_by_id"),
      createdAt: timestamp45("created_at").defaultNow().notNull(),
      confirmedAt: timestamp45("confirmed_at"),
      cancelledAt: timestamp45("cancelled_at")
    });
    whReturnLinesTable = pgTable45("wh_return_lines", {
      id: serial43("id").primaryKey(),
      returnId: integer40("return_id").notNull().references(() => whReturnsTable.id, { onDelete: "cascade" }),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      rackId: integer40("rack_id").references(() => warehouseRacksTable.id),
      qty: numeric25("qty", { precision: 14, scale: 3 }).notNull().default("0"),
      unitCost: numeric25("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      note: text44("note")
    });
    productRecipesTable = pgTable45("product_recipes", {
      id: serial43("id").primaryKey(),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }).unique(),
      yieldQty: numeric25("yield_qty", { precision: 12, scale: 3 }).notNull().default("1"),
      yieldUnit: text44("yield_unit").notNull().default("pcs"),
      note: text44("note"),
      isActive: boolean22("is_active").notNull().default(true),
      createdAt: timestamp45("created_at").defaultNow().notNull(),
      updatedAt: timestamp45("updated_at").defaultNow().notNull()
    });
    productRecipeItemsTable = pgTable45("product_recipe_items", {
      id: serial43("id").primaryKey(),
      recipeId: integer40("recipe_id").notNull().references(() => productRecipesTable.id, { onDelete: "cascade" }),
      ingredientProductId: integer40("ingredient_product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      qty: numeric25("qty", { precision: 12, scale: 3 }).notNull().default("0"),
      unit: text44("unit").notNull().default("pcs"),
      note: text44("note")
    });
    whOpnamesTable = pgTable45("wh_opnames", {
      id: serial43("id").primaryKey(),
      companyId: integer40("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      opnameNumber: text44("opname_number").notNull().unique(),
      warehouseId: integer40("warehouse_id").notNull().references(() => warehousesTable.id),
      status: text44("status").notNull().default("draft"),
      note: text44("note"),
      createdById: text44("created_by_id"),
      confirmedById: text44("confirmed_by_id"),
      createdAt: timestamp45("created_at").defaultNow().notNull(),
      confirmedAt: timestamp45("confirmed_at")
    });
    whOpnameLinesTable = pgTable45("wh_opname_lines", {
      id: serial43("id").primaryKey(),
      opnameId: integer40("opname_id").notNull().references(() => whOpnamesTable.id, { onDelete: "cascade" }),
      productId: integer40("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      rackId: integer40("rack_id").references(() => warehouseRacksTable.id),
      systemQty: numeric25("system_qty", { precision: 14, scale: 3 }).notNull().default("0"),
      actualQty: numeric25("actual_qty", { precision: 14, scale: 3 }).notNull().default("0"),
      diffQty: numeric25("diff_qty", { precision: 14, scale: 3 }).notNull().default("0"),
      note: text44("note")
    });
    insertWhStockSchema = createInsertSchema23(whStockTable).omit({ id: true, updatedAt: true });
    insertWhMovementSchema = createInsertSchema23(whMovementsTable).omit({ id: true, createdAt: true });
    insertWhTransferSchema = createInsertSchema23(whTransfersTable).omit({ id: true, createdAt: true, transferNumber: true });
    insertWhTransferLineSchema = createInsertSchema23(whTransferLinesTable).omit({ id: true });
    insertWhDamageReportSchema = createInsertSchema23(whDamageReportsTable).omit({ id: true, createdAt: true, reportNumber: true });
    insertWhDamageLineSchema = createInsertSchema23(whDamageLinesTable).omit({ id: true });
    insertWhReturnSchema = createInsertSchema23(whReturnsTable).omit({ id: true, createdAt: true, returnNumber: true });
    insertWhReturnLineSchema = createInsertSchema23(whReturnLinesTable).omit({ id: true });
    insertProductRecipeSchema = createInsertSchema23(productRecipesTable).omit({ id: true, createdAt: true, updatedAt: true });
    insertProductRecipeItemSchema = createInsertSchema23(productRecipeItemsTable).omit({ id: true });
    insertWhOpnameSchema = createInsertSchema23(whOpnamesTable).omit({ id: true, createdAt: true, opnameNumber: true });
    insertWhOpnameLineSchema = createInsertSchema23(whOpnameLinesTable).omit({ id: true });
  }
});

// ../../lib/db/src/schema/thaiTea.ts
var init_thaiTea = __esm({
  "../../lib/db/src/schema/thaiTea.ts"() {
    "use strict";
  }
});

// ../../lib/db/src/schema/mktPurchaseOrderLines.ts
import { pgTable as pgTable46, serial as serial44, text as text45, integer as integer41, numeric as numeric26, timestamp as timestamp46, index as index26 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema24 } from "drizzle-zod";
var mktPurchaseOrderLinesTable, insertMktPurchaseOrderLineSchema;
var init_mktPurchaseOrderLines = __esm({
  "../../lib/db/src/schema/mktPurchaseOrderLines.ts"() {
    "use strict";
    init_mktPurchaseOrders();
    mktPurchaseOrderLinesTable = pgTable46("mkt_purchase_order_lines", {
      id: serial44("id").primaryKey(),
      poId: integer41("po_id").notNull().references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
      itemName: text45("item_name").notNull(),
      qty: numeric26("qty", { precision: 14, scale: 2 }).notNull(),
      unit: text45("unit"),
      unitPrice: numeric26("unit_price", { precision: 14, scale: 2 }).notNull(),
      subtotal: numeric26("subtotal", { precision: 14, scale: 2 }).notNull(),
      notes: text45("notes"),
      createdAt: timestamp46("created_at").defaultNow().notNull()
    }, (t) => [
      index26("mkt_po_lines_po_idx").on(t.poId)
    ]);
    insertMktPurchaseOrderLineSchema = createInsertSchema24(mktPurchaseOrderLinesTable).omit({
      id: true,
      createdAt: true
    });
  }
});

// ../../lib/db/src/schema/mktPoShipments.ts
import { pgTable as pgTable47, serial as serial45, text as text46, integer as integer42, timestamp as timestamp47, index as index27 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema25 } from "drizzle-zod";
var mktPoShipmentsTable, insertMktPoShipmentSchema;
var init_mktPoShipments = __esm({
  "../../lib/db/src/schema/mktPoShipments.ts"() {
    "use strict";
    init_mktPurchaseOrders();
    mktPoShipmentsTable = pgTable47("mkt_po_shipments", {
      id: serial45("id").primaryKey(),
      poId: integer42("po_id").notNull().references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
      shipmentNumber: text46("shipment_number").notNull().unique(),
      // format: MKT-SHP-YYYYMM-XXXX
      shipmentStatus: text46("shipment_status").notNull().default("planned"),
      shipmentType: text46("shipment_type"),
      // trucking | sea_freight | air_freight | other
      carrierName: text46("carrier_name"),
      trackingNumber: text46("tracking_number"),
      vehicleType: text46("vehicle_type"),
      vehicleNumber: text46("vehicle_number"),
      driverName: text46("driver_name"),
      driverPhone: text46("driver_phone"),
      containerNumber: text46("container_number"),
      sealNumber: text46("seal_number"),
      origin: text46("origin"),
      destination: text46("destination"),
      // Snapshot from mkt_purchase_orders.incotermSnapshot at shipment creation
      // time — NOT re-queried from vendor/quote later.
      incotermSnapshot: text46("incoterm_snapshot"),
      plannedDeparture: timestamp47("planned_departure"),
      actualDeparture: timestamp47("actual_departure"),
      estimatedArrival: timestamp47("estimated_arrival"),
      actualArrival: timestamp47("actual_arrival"),
      notes: text46("notes"),
      createdBy: text46("created_by"),
      createdAt: timestamp47("created_at").defaultNow().notNull(),
      updatedAt: timestamp47("updated_at").defaultNow().notNull()
    }, (t) => [
      index27("mkt_po_shipments_po_idx").on(t.poId),
      index27("mkt_po_shipments_po_status_idx").on(t.poId, t.shipmentStatus)
    ]);
    insertMktPoShipmentSchema = createInsertSchema25(mktPoShipmentsTable).omit({
      id: true,
      shipmentNumber: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktPoGoodsReceipts.ts
import { pgTable as pgTable48, serial as serial46, text as text47, integer as integer43, timestamp as timestamp48, index as index28 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema26 } from "drizzle-zod";
var mktPoGoodsReceiptsTable, insertMktPoGoodsReceiptSchema;
var init_mktPoGoodsReceipts = __esm({
  "../../lib/db/src/schema/mktPoGoodsReceipts.ts"() {
    "use strict";
    init_mktPoShipments();
    mktPoGoodsReceiptsTable = pgTable48("mkt_po_goods_receipts", {
      id: serial46("id").primaryKey(),
      shipmentId: integer43("shipment_id").notNull().references(() => mktPoShipmentsTable.id, { onDelete: "restrict" }),
      receiptNumber: text47("receipt_number").notNull().unique(),
      // format: MKT-GR-YYYYMM-XXXX
      receiptType: text47("receipt_type").notNull(),
      // full | partial | rejected
      // Quality inspection status, kept separate from physical `condition` on
      // the item rows so QC workflow isn't conflated with physical condition.
      inspectionStatus: text47("inspection_status").notNull().default("pending"),
      // pending | passed | failed
      receivedBy: text47("received_by"),
      receivedAt: timestamp48("received_at"),
      // physical receive time, separate from createdAt (system input time)
      notes: text47("notes"),
      createdAt: timestamp48("created_at").defaultNow().notNull()
    }, (t) => [
      index28("mkt_po_goods_receipts_shipment_idx").on(t.shipmentId)
    ]);
    insertMktPoGoodsReceiptSchema = createInsertSchema26(mktPoGoodsReceiptsTable).omit({
      id: true,
      receiptNumber: true,
      createdAt: true
    });
  }
});

// ../../lib/db/src/schema/purchaseWorkflow.ts
import {
  pgTable as pgTable49,
  pgEnum as pgEnum20,
  serial as serial47,
  text as text48,
  integer as integer44,
  numeric as numeric27,
  boolean as boolean23,
  timestamp as timestamp49,
  index as index29,
  unique as unique3,
  jsonb as jsonb16
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema27 } from "drizzle-zod";
var prStatusEnum, pwApprovalStatusEnum, vqStatusEnum, grStatusEnum, qcStatusEnum, prReturnStatusEnum, viStatusEnum, payReqStatusEnum, lcMethodEnum, purchaseRequestsTable, purchaseRequestLinesTable, purchaseApprovalsTable, vendorQuotationsTable, vendorQuotationLinesTable, goodsReceiptsTable, goodsReceiptLinesTable, qcInspectionsTable, qcLinesTable, purchaseReturnsTable, purchaseReturnLinesTable, vendorInvoicesTable, vendorInvoiceLinesTable, paymentRequestsTable, paymentRequestItemsTable, landedCostsTable, landedCostLinesTable, landedCostAllocationsTable, purchaseReceiptsTable, purchaseReceiptLinesTable, insertPurchaseRequestSchema, insertPurchaseRequestLineSchema, insertPurchaseApprovalSchema, insertVendorQuotationSchema, insertVendorQuotationLineSchema, insertGoodsReceiptSchema, insertGoodsReceiptLineSchema, insertQcInspectionSchema, insertQcLineSchema, insertPurchaseReturnSchema, insertPurchaseReturnLineSchema, insertVendorInvoiceSchema, insertVendorInvoiceLineSchema, insertPaymentRequestSchema, insertPaymentRequestItemSchema, insertLandedCostSchema, insertLandedCostLineSchema, insertLandedCostAllocationSchema, insertPurchaseReceiptSchema, insertPurchaseReceiptLineSchema;
var init_purchaseWorkflow = __esm({
  "../../lib/db/src/schema/purchaseWorkflow.ts"() {
    "use strict";
    init_suppliers();
    init_products();
    init_companies();
    init_purchaseDocuments();
    init_inventory();
    init_uom();
    init_mktPurchaseOrders();
    init_mktPurchaseOrderLines();
    init_mktPoGoodsReceipts();
    prStatusEnum = pgEnum20("pr_status", [
      "draft",
      "submitted",
      "approved",
      "rejected",
      "converted",
      "cancelled"
    ]);
    pwApprovalStatusEnum = pgEnum20("pw_approval_status", [
      "pending",
      "approved",
      "rejected"
    ]);
    vqStatusEnum = pgEnum20("vq_status", [
      "draft",
      "submitted",
      "selected",
      "rejected"
    ]);
    grStatusEnum = pgEnum20("gr_status", [
      "draft",
      "confirmed",
      "cancelled"
    ]);
    qcStatusEnum = pgEnum20("qc_status", [
      "pending",
      "passed",
      "failed",
      "partial"
    ]);
    prReturnStatusEnum = pgEnum20("pr_return_status", [
      "draft",
      "confirmed",
      "done",
      "cancelled"
    ]);
    viStatusEnum = pgEnum20("vi_status", [
      "draft",
      "submitted",
      "posted",
      "matched",
      "ready_for_ap",
      "paid",
      "cancelled"
    ]);
    payReqStatusEnum = pgEnum20("pay_req_status", [
      "draft",
      "submitted",
      "approved",
      "rejected",
      "paid",
      "cancelled"
    ]);
    lcMethodEnum = pgEnum20("lc_method", [
      "equal",
      "by_quantity",
      "by_amount",
      "by_weight",
      "by_volume"
    ]);
    purchaseRequestsTable = pgTable49("purchase_requests", {
      id: serial47("id").primaryKey(),
      prNumber: text48("pr_number").notNull().unique(),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      warehouseId: integer44("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
      status: prStatusEnum("status").notNull().default("draft"),
      requestedBy: text48("requested_by"),
      department: text48("department"),
      requiredDate: timestamp49("required_date"),
      notes: text48("notes"),
      rfqId: integer44("rfq_id"),
      cancelledAt: timestamp49("cancelled_at"),
      createdBy: text48("created_by"),
      // ── Template Engine ──────────────────────────────────────────────────────────
      categoryKey: text48("category_key"),
      templateId: text48("template_id"),
      templateVersion: text48("template_version"),
      templateSnapshot: jsonb16("template_snapshot"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("pr_company_idx").on(t.companyId),
      index29("pr_status_idx").on(t.status)
    ]);
    purchaseRequestLinesTable = pgTable49("purchase_request_lines", {
      id: serial47("id").primaryKey(),
      prId: integer44("pr_id").notNull().references(() => purchaseRequestsTable.id, { onDelete: "cascade" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      description: text48("description"),
      quantity: numeric27("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
      unit: text48("unit").notNull().default("pcs"),
      estimatedCost: numeric27("estimated_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      notes: text48("notes"),
      productCategory: text48("product_category"),
      customFieldValues: jsonb16("custom_field_values")
    }, (t) => [
      index29("pr_lines_pr_idx").on(t.prId)
    ]);
    purchaseApprovalsTable = pgTable49("purchase_approvals", {
      id: serial47("id").primaryKey(),
      docType: text48("doc_type").notNull(),
      docId: integer44("doc_id").notNull(),
      step: integer44("step").notNull().default(1),
      approverName: text48("approver_name"),
      approverId: text48("approver_id"),
      status: pwApprovalStatusEnum("status").notNull().default("pending"),
      notes: text48("notes"),
      approvedAt: timestamp49("approved_at"),
      rejectedAt: timestamp49("rejected_at"),
      createdAt: timestamp49("created_at").defaultNow().notNull()
    }, (t) => [
      index29("pw_approvals_doc_idx").on(t.docType, t.docId)
    ]);
    vendorQuotationsTable = pgTable49("vendor_quotations", {
      id: serial47("id").primaryKey(),
      rfqId: integer44("rfq_id").notNull().references(() => purchaseDocumentsTable.id, { onDelete: "cascade" }),
      supplierId: integer44("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      supplierName: text48("supplier_name").notNull(),
      status: vqStatusEnum("status").notNull().default("draft"),
      validUntil: timestamp49("valid_until"),
      paymentTermDays: integer44("payment_term_days").default(30),
      deliveryDays: integer44("delivery_days"),
      notes: text48("notes"),
      totalAmount: numeric27("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      taxAmount: numeric27("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric27("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      incoterm: text48("incoterm"),
      deliveryTerm: text48("delivery_term"),
      availability: text48("availability"),
      documentRefs: jsonb16("document_refs"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("vq_rfq_idx").on(t.rfqId),
      index29("vq_supplier_idx").on(t.supplierId)
    ]);
    vendorQuotationLinesTable = pgTable49("vendor_quotation_lines", {
      id: serial47("id").primaryKey(),
      quotationId: integer44("quotation_id").notNull().references(() => vendorQuotationsTable.id, { onDelete: "cascade" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      description: text48("description"),
      quantity: numeric27("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
      unit: text48("unit").notNull().default("pcs"),
      unitCost: numeric27("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric27("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      leadTimeDays: integer44("lead_time_days"),
      notes: text48("notes")
    }, (t) => [
      index29("vq_lines_quotation_idx").on(t.quotationId)
    ]);
    goodsReceiptsTable = pgTable49("goods_receipts", {
      id: serial47("id").primaryKey(),
      grNumber: text48("gr_number").notNull().unique(),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      poId: integer44("po_id").notNull().references(() => purchaseDocumentsTable.id, { onDelete: "restrict" }),
      warehouseId: integer44("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
      supplierId: integer44("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      status: grStatusEnum("status").notNull().default("draft"),
      receiveDate: timestamp49("receive_date").defaultNow().notNull(),
      deliveryNote: text48("delivery_note"),
      notes: text48("notes"),
      confirmedBy: text48("confirmed_by"),
      confirmedAt: timestamp49("confirmed_at"),
      cancelledAt: timestamp49("cancelled_at"),
      createdBy: text48("created_by"),
      journalEntryId: integer44("journal_entry_id"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("gr_po_idx").on(t.poId),
      index29("gr_company_idx").on(t.companyId),
      index29("gr_status_idx").on(t.status)
    ]);
    goodsReceiptLinesTable = pgTable49("goods_receipt_lines", {
      id: serial47("id").primaryKey(),
      grId: integer44("gr_id").notNull().references(() => goodsReceiptsTable.id, { onDelete: "cascade" }),
      poLineId: integer44("po_line_id"),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      qtyOrdered: numeric27("qty_ordered", { precision: 12, scale: 3 }).notNull().default("0"),
      qtyReceived: numeric27("qty_received", { precision: 12, scale: 3 }).notNull().default("0"),
      qtyRejected: numeric27("qty_rejected", { precision: 12, scale: 3 }).notNull().default("0"),
      unit: text48("unit").notNull().default("pcs"),
      unitCost: numeric27("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric27("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      rackId: integer44("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
      notes: text48("notes"),
      condition: text48("condition"),
      receivingNotes: text48("receiving_notes"),
      attachments: jsonb16("attachments")
    }, (t) => [
      index29("gr_lines_gr_idx").on(t.grId)
    ]);
    qcInspectionsTable = pgTable49("qc_inspections", {
      id: serial47("id").primaryKey(),
      qcNumber: text48("qc_number").notNull().unique(),
      grId: integer44("gr_id").notNull().references(() => goodsReceiptsTable.id, { onDelete: "restrict" }),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      status: qcStatusEnum("status").notNull().default("pending"),
      inspectorName: text48("inspector_name"),
      inspectedAt: timestamp49("inspected_at"),
      notes: text48("notes"),
      createdBy: text48("created_by"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("qc_gr_idx").on(t.grId)
    ]);
    qcLinesTable = pgTable49("qc_lines", {
      id: serial47("id").primaryKey(),
      qcId: integer44("qc_id").notNull().references(() => qcInspectionsTable.id, { onDelete: "cascade" }),
      grLineId: integer44("gr_line_id").references(() => goodsReceiptLinesTable.id, { onDelete: "set null" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      qtyInspected: numeric27("qty_inspected", { precision: 12, scale: 3 }).notNull().default("0"),
      qtyPassed: numeric27("qty_passed", { precision: 12, scale: 3 }).notNull().default("0"),
      qtyFailed: numeric27("qty_failed", { precision: 12, scale: 3 }).notNull().default("0"),
      failReason: text48("fail_reason"),
      notes: text48("notes")
    }, (t) => [
      index29("qc_lines_qc_idx").on(t.qcId)
    ]);
    purchaseReturnsTable = pgTable49("purchase_returns", {
      id: serial47("id").primaryKey(),
      returnNumber: text48("return_number").notNull().unique(),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      poId: integer44("po_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
      grId: integer44("gr_id").references(() => goodsReceiptsTable.id, { onDelete: "set null" }),
      supplierId: integer44("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      supplierName: text48("supplier_name").notNull(),
      warehouseId: integer44("warehouse_id").references(() => warehousesTable.id, { onDelete: "set null" }),
      status: prReturnStatusEnum("status").notNull().default("draft"),
      returnDate: timestamp49("return_date").defaultNow().notNull(),
      reason: text48("reason"),
      totalAmount: numeric27("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      notes: text48("notes"),
      confirmedBy: text48("confirmed_by"),
      confirmedAt: timestamp49("confirmed_at"),
      cancelledAt: timestamp49("cancelled_at"),
      createdBy: text48("created_by"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("purchase_returns_po_idx").on(t.poId),
      index29("purchase_returns_status_idx").on(t.status)
    ]);
    purchaseReturnLinesTable = pgTable49("purchase_return_lines", {
      id: serial47("id").primaryKey(),
      returnId: integer44("return_id").notNull().references(() => purchaseReturnsTable.id, { onDelete: "cascade" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      quantity: numeric27("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
      unit: text48("unit").notNull().default("pcs"),
      unitCost: numeric27("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric27("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      reason: text48("reason")
    }, (t) => [
      index29("purchase_return_lines_return_idx").on(t.returnId)
    ]);
    vendorInvoicesTable = pgTable49("vendor_invoices", {
      id: serial47("id").primaryKey(),
      invoiceNumber: text48("invoice_number").notNull().unique(),
      vendorInvoiceRef: text48("vendor_invoice_ref"),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      supplierId: integer44("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      supplierName: text48("supplier_name").notNull(),
      poId: integer44("po_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
      grId: integer44("gr_id").references(() => goodsReceiptsTable.id, { onDelete: "set null" }),
      mktPurchaseOrderId: integer44("mkt_purchase_order_id").references(() => mktPurchaseOrdersTable.id, { onDelete: "set null" }),
      mktGoodsReceiptId: integer44("mkt_goods_receipt_id").references(() => mktPoGoodsReceiptsTable.id, { onDelete: "set null" }),
      status: viStatusEnum("status").notNull().default("draft"),
      invoiceDate: timestamp49("invoice_date").defaultNow().notNull(),
      dueDate: timestamp49("due_date"),
      paymentTermDays: integer44("payment_term_days").default(30),
      currency: text48("currency").notNull().default("IDR"),
      totalAmount: numeric27("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      taxAmount: numeric27("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      grandTotal: numeric27("grand_total", { precision: 14, scale: 2 }).notNull().default("0"),
      amountPaid: numeric27("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
      threeWayMatchStatus: text48("three_way_match_status").notNull().default("unmatched"),
      matchNotes: text48("match_notes"),
      journalEntryId: integer44("journal_entry_id"),
      notes: text48("notes"),
      attachmentObjectPath: text48("attachment_object_path"),
      attachmentFileName: text48("attachment_file_name"),
      attachmentContentType: text48("attachment_content_type"),
      attachmentSize: integer44("attachment_size"),
      categoryKey: text48("category_key"),
      templateId: text48("template_id"),
      templateVersion: text48("template_version"),
      templateSnapshot: jsonb16("template_snapshot").$type(),
      cancelledAt: timestamp49("cancelled_at"),
      // SAP Invoice Lock fields
      isLocked: boolean23("is_locked").notNull().default(false),
      sapLockSnapshot: jsonb16("sap_lock_snapshot").$type(),
      createdBy: text48("created_by"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("vi_po_idx").on(t.poId),
      index29("vi_supplier_idx").on(t.supplierId),
      index29("vi_status_idx").on(t.status)
    ]);
    vendorInvoiceLinesTable = pgTable49("vendor_invoice_lines", {
      id: serial47("id").primaryKey(),
      invoiceId: integer44("invoice_id").notNull().references(() => vendorInvoicesTable.id, { onDelete: "cascade" }),
      mktPurchaseOrderLineId: integer44("mkt_purchase_order_line_id").references(() => mktPurchaseOrderLinesTable.id, { onDelete: "set null" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      quantity: numeric27("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
      unit: text48("unit").notNull().default("pcs"),
      unitCost: numeric27("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      subtotal: numeric27("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      taxAmount: numeric27("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      notes: text48("notes")
    }, (t) => [
      index29("vi_lines_invoice_idx").on(t.invoiceId)
    ]);
    paymentRequestsTable = pgTable49("payment_requests", {
      id: serial47("id").primaryKey(),
      payReqNumber: text48("pay_req_number").notNull().unique(),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      supplierId: integer44("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      supplierName: text48("supplier_name").notNull(),
      status: payReqStatusEnum("status").notNull().default("draft"),
      requestedBy: text48("requested_by"),
      approvedBy: text48("approved_by"),
      approvedAt: timestamp49("approved_at"),
      totalAmount: numeric27("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      paidAmount: numeric27("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      currency: text48("currency").notNull().default("IDR"),
      paymentMethod: text48("payment_method"),
      bankAccount: text48("bank_account"),
      paymentDate: timestamp49("payment_date"),
      journalEntryId: integer44("journal_entry_id"),
      notes: text48("notes"),
      // Marketplace AP handoff metadata. These fields are additive and do not
      // authorize, execute, post, or settle a payment.
      sourceType: text48("source_type"),
      sourceId: integer44("source_id"),
      mktApPreparationId: integer44("mkt_ap_preparation_id"),
      idempotencyKey: text48("idempotency_key"),
      payloadFingerprint: text48("payload_fingerprint"),
      mktLifecycleStatus: text48("mkt_lifecycle_status"),
      mktFinanceReviewedBy: text48("mkt_finance_reviewed_by"),
      mktFinanceReviewedAt: timestamp49("mkt_finance_reviewed_at"),
      mktApprovedBy: text48("mkt_approved_by"),
      mktApprovedAt: timestamp49("mkt_approved_at"),
      mktTreasuryReadyBy: text48("mkt_treasury_ready_by"),
      mktTreasuryReadyAt: timestamp49("mkt_treasury_ready_at"),
      mktExecutionStartedAt: timestamp49("mkt_execution_started_at"),
      mktCompletedAt: timestamp49("mkt_completed_at"),
      mktFailureCode: text48("mkt_failure_code"),
      mktFailureReason: text48("mkt_failure_reason"),
      mktFailureAt: timestamp49("mkt_failure_at"),
      mktFailedBy: text48("mkt_failed_by"),
      mktCancellationIdempotencyKey: text48("mkt_cancellation_idempotency_key"),
      mktCancelledBy: text48("mkt_cancelled_by"),
      mktCancellationReason: text48("mkt_cancellation_reason"),
      cancelledAt: timestamp49("cancelled_at"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("pay_req_supplier_idx").on(t.supplierId),
      index29("pay_req_status_idx").on(t.status),
      index29("pay_req_source_idx").on(t.sourceType, t.sourceId),
      index29("pay_req_mkt_ap_idx").on(t.mktApPreparationId),
      unique3("pay_req_idempotency_unique").on(t.idempotencyKey),
      unique3("pay_req_mkt_ap_unique").on(t.mktApPreparationId)
    ]);
    paymentRequestItemsTable = pgTable49("payment_request_items", {
      id: serial47("id").primaryKey(),
      paymentRequestId: integer44("payment_request_id").notNull().references(() => paymentRequestsTable.id, { onDelete: "cascade" }),
      vendorInvoiceId: integer44("vendor_invoice_id").references(() => vendorInvoicesTable.id, { onDelete: "set null" }),
      description: text48("description").notNull(),
      amount: numeric27("amount", { precision: 14, scale: 2 }).notNull().default("0")
    }, (t) => [
      index29("pay_req_items_pr_idx").on(t.paymentRequestId)
    ]);
    landedCostsTable = pgTable49("landed_costs", {
      id: serial47("id").primaryKey(),
      lcNumber: text48("lc_number").notNull().unique(),
      companyId: integer44("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      grId: integer44("gr_id").references(() => goodsReceiptsTable.id, { onDelete: "set null" }),
      poId: integer44("po_id").references(() => purchaseDocumentsTable.id, { onDelete: "set null" }),
      status: text48("status").notNull().default("draft"),
      allocationMethod: lcMethodEnum("allocation_method").notNull().default("by_amount"),
      notes: text48("notes"),
      totalCost: numeric27("total_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      createdBy: text48("created_by"),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("landed_costs_gr_idx").on(t.grId),
      index29("landed_costs_po_idx").on(t.poId)
    ]);
    landedCostLinesTable = pgTable49("landed_cost_lines", {
      id: serial47("id").primaryKey(),
      lcId: integer44("lc_id").notNull().references(() => landedCostsTable.id, { onDelete: "cascade" }),
      description: text48("description").notNull(),
      amount: numeric27("amount", { precision: 14, scale: 2 }).notNull().default("0"),
      supplierId: integer44("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      accountId: integer44("account_id")
    }, (t) => [
      index29("lc_lines_lc_idx").on(t.lcId)
    ]);
    landedCostAllocationsTable = pgTable49("landed_cost_allocations", {
      id: serial47("id").primaryKey(),
      lcId: integer44("lc_id").notNull().references(() => landedCostsTable.id, { onDelete: "cascade" }),
      grLineId: integer44("gr_line_id").references(() => goodsReceiptLinesTable.id, { onDelete: "set null" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      name: text48("name").notNull(),
      allocatedAmount: numeric27("allocated_amount", { precision: 14, scale: 2 }).notNull().default("0")
    }, (t) => [
      index29("lc_alloc_lc_idx").on(t.lcId)
    ]);
    purchaseReceiptsTable = pgTable49("purchase_receipts", {
      id: serial47("id").primaryKey(),
      receiptNo: text48("receipt_no").notNull().unique(),
      poId: integer44("po_id").notNull().references(() => purchaseDocumentsTable.id, { onDelete: "restrict" }),
      warehouseId: integer44("warehouse_id").notNull().references(() => warehousesTable.id, { onDelete: "restrict" }),
      status: text48("status").notNull().default("posted"),
      notes: text48("notes"),
      receivedBy: text48("received_by"),
      receivedAt: timestamp49("received_at").defaultNow().notNull(),
      createdAt: timestamp49("created_at").defaultNow().notNull(),
      updatedAt: timestamp49("updated_at").defaultNow().notNull()
    }, (t) => [
      index29("purchase_receipts_po_idx").on(t.poId),
      index29("purchase_receipts_wh_idx").on(t.warehouseId)
    ]);
    purchaseReceiptLinesTable = pgTable49("purchase_receipt_lines", {
      id: serial47("id").primaryKey(),
      receiptId: integer44("receipt_id").notNull().references(() => purchaseReceiptsTable.id, { onDelete: "cascade" }),
      poLineId: integer44("po_line_id").references(() => purchaseDocumentLinesTable.id, { onDelete: "set null" }),
      productId: integer44("product_id").references(() => productsTable.id, { onDelete: "set null" }),
      rackId: integer44("rack_id").references(() => warehouseRacksTable.id, { onDelete: "set null" }),
      qtyOrdered: numeric27("qty_ordered", { precision: 12, scale: 3 }).notNull().default("0"),
      qtyReceived: numeric27("qty_received", { precision: 12, scale: 3 }).notNull().default("0"),
      unitCost: numeric27("unit_cost", { precision: 14, scale: 2 }).notNull().default("0"),
      totalCost: numeric27("total_cost", { precision: 14, scale: 2 }).notNull().default("0")
    }, (t) => [
      index29("purchase_receipt_lines_receipt_idx").on(t.receiptId)
    ]);
    insertPurchaseRequestSchema = createInsertSchema27(purchaseRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, prNumber: true });
    insertPurchaseRequestLineSchema = createInsertSchema27(purchaseRequestLinesTable).omit({ id: true });
    insertPurchaseApprovalSchema = createInsertSchema27(purchaseApprovalsTable).omit({ id: true, createdAt: true });
    insertVendorQuotationSchema = createInsertSchema27(vendorQuotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
    insertVendorQuotationLineSchema = createInsertSchema27(vendorQuotationLinesTable).omit({ id: true });
    insertGoodsReceiptSchema = createInsertSchema27(goodsReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true, grNumber: true });
    insertGoodsReceiptLineSchema = createInsertSchema27(goodsReceiptLinesTable).omit({ id: true });
    insertQcInspectionSchema = createInsertSchema27(qcInspectionsTable).omit({ id: true, createdAt: true, updatedAt: true, qcNumber: true });
    insertQcLineSchema = createInsertSchema27(qcLinesTable).omit({ id: true });
    insertPurchaseReturnSchema = createInsertSchema27(purchaseReturnsTable).omit({ id: true, createdAt: true, updatedAt: true, returnNumber: true });
    insertPurchaseReturnLineSchema = createInsertSchema27(purchaseReturnLinesTable).omit({ id: true });
    insertVendorInvoiceSchema = createInsertSchema27(vendorInvoicesTable).omit({ id: true, createdAt: true, updatedAt: true, invoiceNumber: true });
    insertVendorInvoiceLineSchema = createInsertSchema27(vendorInvoiceLinesTable).omit({ id: true });
    insertPaymentRequestSchema = createInsertSchema27(paymentRequestsTable).omit({ id: true, createdAt: true, updatedAt: true, payReqNumber: true });
    insertPaymentRequestItemSchema = createInsertSchema27(paymentRequestItemsTable).omit({ id: true });
    insertLandedCostSchema = createInsertSchema27(landedCostsTable).omit({ id: true, createdAt: true, updatedAt: true, lcNumber: true });
    insertLandedCostLineSchema = createInsertSchema27(landedCostLinesTable).omit({ id: true });
    insertLandedCostAllocationSchema = createInsertSchema27(landedCostAllocationsTable).omit({ id: true });
    insertPurchaseReceiptSchema = createInsertSchema27(purchaseReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true, receiptNo: true });
    insertPurchaseReceiptLineSchema = createInsertSchema27(purchaseReceiptLinesTable).omit({ id: true });
  }
});

// ../../lib/db/src/schema/freightAuditLog.ts
import { pgTable as pgTable50, serial as serial48, integer as integer45, text as text49, timestamp as timestamp50 } from "drizzle-orm/pg-core";
var freightShipmentAuditLogsTable;
var init_freightAuditLog = __esm({
  "../../lib/db/src/schema/freightAuditLog.ts"() {
    "use strict";
    init_freightShipments();
    freightShipmentAuditLogsTable = pgTable50("freight_shipment_audit_logs", {
      id: serial48("id").primaryKey(),
      shipmentId: integer45("shipment_id").notNull().references(() => freightShipmentsTable.id, { onDelete: "cascade" }),
      shipmentNumber: text49("shipment_number").notNull(),
      fromStatus: text49("from_status"),
      toStatus: text49("to_status").notNull(),
      changedBy: text49("changed_by").notNull(),
      changedById: text49("changed_by_id"),
      notes: text49("notes"),
      createdAt: timestamp50("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/approvalRules.ts
import { pgTable as pgTable51, serial as serial49, text as text50, integer as integer46, boolean as boolean24, timestamp as timestamp51, numeric as numeric28, pgEnum as pgEnum21, index as index30 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema28 } from "drizzle-zod";
var approvalScopeEnum, approvalModuleEnum, approvalRulesTable, insertApprovalRuleSchema;
var init_approvalRules = __esm({
  "../../lib/db/src/schema/approvalRules.ts"() {
    "use strict";
    init_companies();
    init_orgStructure();
    init_customRoles();
    approvalScopeEnum = pgEnum21("approval_scope", [
      "company",
      "branch",
      "division",
      "department"
    ]);
    approvalModuleEnum = pgEnum21("approval_module", [
      "purchase_request",
      "purchase_order",
      "rfq",
      "sales_order",
      "expense",
      "inventory_transfer",
      "general"
    ]);
    approvalRulesTable = pgTable51("approval_rules", {
      id: serial49("id").primaryKey(),
      name: text50("name").notNull(),
      module: approvalModuleEnum("module").notNull().default("general"),
      scope: approvalScopeEnum("scope").notNull().default("company"),
      companyId: integer46("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      branchId: integer46("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
      divisionId: integer46("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
      departmentId: integer46("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
      amountThreshold: numeric28("amount_threshold", { precision: 18, scale: 2 }),
      approverRoleId: integer46("approver_role_id").references(() => customRolesTable.id, { onDelete: "set null" }),
      approverUserId: text50("approver_user_id"),
      level: integer46("level").notNull().default(1),
      description: text50("description"),
      isActive: boolean24("is_active").notNull().default(true),
      createdAt: timestamp51("created_at").defaultNow().notNull(),
      updatedAt: timestamp51("updated_at").defaultNow().notNull()
    }, (t) => [
      index30("approval_rules_company_idx").on(t.companyId),
      index30("approval_rules_module_idx").on(t.module),
      index30("approval_rules_scope_idx").on(t.scope)
    ]);
    insertApprovalRuleSchema = createInsertSchema28(approvalRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
  }
});

// ../../lib/db/src/schema/productBom.ts
import {
  pgTable as pgTable52,
  serial as serial50,
  text as text51,
  integer as integer47,
  numeric as numeric29,
  boolean as boolean25,
  timestamp as timestamp52,
  index as index31
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema29 } from "drizzle-zod";
var rawMaterialsTable, recipesTable, recipeItemsTable, insertRawMaterialSchema, insertRecipeSchema, insertRecipeItemSchema;
var init_productBom = __esm({
  "../../lib/db/src/schema/productBom.ts"() {
    "use strict";
    init_companies();
    init_products();
    rawMaterialsTable = pgTable52("raw_materials", {
      id: serial50("id").primaryKey(),
      companyId: integer47("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
      name: text51("name").notNull(),
      sku: text51("sku").notNull(),
      unit: text51("unit").notNull().default("gram"),
      costPrice: numeric29("cost_price", { precision: 14, scale: 2 }).notNull().default("0"),
      description: text51("description"),
      isActive: boolean25("is_active").notNull().default(true),
      createdAt: timestamp52("created_at").defaultNow().notNull()
    }, (t) => [
      index31("raw_materials_company_idx").on(t.companyId)
    ]);
    recipesTable = pgTable52("recipes", {
      id: serial50("id").primaryKey(),
      companyId: integer47("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
      productId: integer47("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
      note: text51("note"),
      isActive: boolean25("is_active").notNull().default(true),
      createdAt: timestamp52("created_at").defaultNow().notNull(),
      updatedAt: timestamp52("updated_at").defaultNow().notNull()
    }, (t) => [
      index31("recipes_company_idx").on(t.companyId),
      index31("recipes_product_idx").on(t.productId)
    ]);
    recipeItemsTable = pgTable52("recipe_items", {
      id: serial50("id").primaryKey(),
      recipeId: integer47("recipe_id").notNull().references(() => recipesTable.id, { onDelete: "cascade" }),
      rawMaterialId: integer47("raw_material_id").notNull().references(() => rawMaterialsTable.id, { onDelete: "cascade" }),
      qty: numeric29("qty", { precision: 12, scale: 3 }).notNull().default("0"),
      unit: text51("unit").notNull().default("gram")
    });
    insertRawMaterialSchema = createInsertSchema29(rawMaterialsTable).omit({ id: true, createdAt: true });
    insertRecipeSchema = createInsertSchema29(recipesTable).omit({ id: true, createdAt: true, updatedAt: true });
    insertRecipeItemSchema = createInsertSchema29(recipeItemsTable).omit({ id: true });
  }
});

// ../../lib/db/src/schema/notificationLogs.ts
import { pgTable as pgTable53, serial as serial51, text as text52, timestamp as timestamp53, index as index32, uniqueIndex as uniqueIndex13, integer as integer48 } from "drizzle-orm/pg-core";
var notificationLogsTable;
var init_notificationLogs = __esm({
  "../../lib/db/src/schema/notificationLogs.ts"() {
    "use strict";
    notificationLogsTable = pgTable53("notification_logs", {
      id: serial51("id").primaryKey(),
      channel: text52("channel").notNull(),
      recipient: text52("recipient").notNull(),
      subject: text52("subject"),
      message: text52("message").notNull(),
      status: text52("status").notNull().default("sent"),
      errorMsg: text52("error_msg"),
      context: text52("context").notNull().default("general"),
      refType: text52("ref_type"),
      refId: text52("ref_id"),
      createdAt: timestamp53("created_at").defaultNow().notNull(),
      /**
       * Dedup key — hash dari (channel:recipient:context:refId:timeBucket) untuk status 'sent'.
       * NULL untuk status 'failed' / 'deduped' supaya retry tetap bisa dilog.
       * UNIQUE constraint mencegah dua concurrent INSERT lolos dedup in-memory bersamaan.
       */
      dedupKey: text52("dedup_key"),
      /**
       * Retry tracking — hanya digunakan untuk channel='wa' status='failed'.
       * retryCount: berapa kali sudah dicoba ulang (0 = belum pernah retry).
       * nextRetryAt: kapan retry berikutnya boleh dijalankan (NULL = segera boleh dicoba).
       */
      retryCount: integer48("retry_count").notNull().default(0),
      nextRetryAt: timestamp53("next_retry_at"),
      /**
       * URL media (gambar/dokumen) yang dikirim bersama pesan WA.
       * Disimpan agar retry worker bisa mengirim ulang dengan media yang sama.
       */
      mediaUrl: text52("media_url"),
      /**
       * WA Delivery Tracking — diisi dari Fonnte API response saat kirim.
       * waMessageId: ID pesan dari Fonnte, dipakai untuk match delivery callback.
       * waDeliveryStatus: status terakhir dari Fonnte callback ('sent'|'delivered'|'read').
       * deliveredAt / readAt: timestamp dari delivery callback.
       */
      waMessageId: text52("wa_message_id"),
      waDeliveryStatus: text52("wa_delivery_status"),
      deliveredAt: timestamp53("delivered_at"),
      readAt: timestamp53("read_at")
    }, (t) => [
      index32("notif_logs_channel_idx").on(t.channel),
      index32("notif_logs_status_idx").on(t.status),
      index32("notif_logs_context_idx").on(t.context),
      index32("notif_logs_created_idx").on(t.createdAt),
      index32("notif_logs_retry_idx").on(t.status, t.channel, t.retryCount, t.nextRetryAt),
      uniqueIndex13("notif_logs_dedup_key_idx").on(t.dedupKey)
    ]);
  }
});

// ../../lib/db/src/schema/shortLinks.ts
import { pgTable as pgTable54, serial as serial52, text as text53, timestamp as timestamp54, integer as integer49, index as index33 } from "drizzle-orm/pg-core";
var shortLinksTable;
var init_shortLinks = __esm({
  "../../lib/db/src/schema/shortLinks.ts"() {
    "use strict";
    shortLinksTable = pgTable54("short_links", {
      id: serial52("id").primaryKey(),
      code: text53("code").notNull().unique(),
      targetUrl: text53("target_url").notNull(),
      context: text53("context").notNull().default("general"),
      refType: text53("ref_type"),
      refId: text53("ref_id"),
      hitCount: integer49("hit_count").notNull().default(0),
      expiresAt: timestamp54("expires_at"),
      createdAt: timestamp54("created_at").defaultNow().notNull()
    }, (t) => [
      index33("short_links_context_idx").on(t.context),
      index33("short_links_ref_idx").on(t.refType, t.refId)
    ]);
  }
});

// ../../lib/db/src/schema/onboarding.ts
import {
  pgTable as pgTable55,
  serial as serial53,
  integer as integer50,
  text as text54,
  timestamp as timestamp55,
  boolean as boolean26
} from "drizzle-orm/pg-core";
var userProfilesTable, identityDocumentsTable, ocrResultsTable, vendorProfilesTable, driverProfilesTable, employeeProfilesTable, onboardingApprovalsTable;
var init_onboarding = __esm({
  "../../lib/db/src/schema/onboarding.ts"() {
    "use strict";
    init_portalCustomers();
    userProfilesTable = pgTable55("user_profiles", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      fullName: text54("full_name"),
      phone: text54("phone"),
      address: text54("address"),
      accountType: text54("account_type").notNull().default("customer"),
      status: text54("status").notNull().default("incomplete"),
      ktpUrl: text54("ktp_url"),
      rejectionReason: text54("rejection_reason"),
      completedAt: timestamp55("completed_at"),
      createdAt: timestamp55("created_at").defaultNow().notNull(),
      updatedAt: timestamp55("updated_at").defaultNow().notNull()
    });
    identityDocumentsTable = pgTable55("identity_documents", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      docType: text54("doc_type").notNull(),
      url: text54("url").notNull(),
      fileName: text54("file_name"),
      createdAt: timestamp55("created_at").defaultNow().notNull()
    });
    ocrResultsTable = pgTable55("ocr_results", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      docType: text54("doc_type").notNull().default("ktp"),
      nik: text54("nik"),
      name: text54("name"),
      birthPlace: text54("birth_place"),
      birthDate: text54("birth_date"),
      address: text54("address"),
      rt: text54("rt"),
      rw: text54("rw"),
      kelurahan: text54("kelurahan"),
      kecamatan: text54("kecamatan"),
      kabupaten: text54("kabupaten"),
      provinsi: text54("provinsi"),
      gender: text54("gender"),
      religion: text54("religion"),
      maritalStatus: text54("marital_status"),
      occupation: text54("occupation"),
      nationality: text54("nationality"),
      rawJson: text54("raw_json"),
      createdAt: timestamp55("created_at").defaultNow().notNull()
    });
    vendorProfilesTable = pgTable55("vendor_profiles", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      // ── Company ────────────────────────────────────────────────────────────────
      companyName: text54("company_name"),
      businessType: text54("business_type"),
      companyLogo: text54("company_logo"),
      companyDescription: text54("company_description"),
      // ── Legal ──────────────────────────────────────────────────────────────────
      nib: text54("nib"),
      npwp: text54("npwp"),
      siup: text54("siup"),
      tdp: text54("tdp"),
      legalityDocUrl: text54("legality_doc_url"),
      // ── Contact ────────────────────────────────────────────────────────────────
      picName: text54("pic_name"),
      picPosition: text54("pic_position"),
      phone: text54("phone"),
      whatsapp: text54("whatsapp"),
      email: text54("email"),
      // ── Address ────────────────────────────────────────────────────────────────
      province: text54("province"),
      city: text54("city"),
      district: text54("district"),
      postalCode: text54("postal_code"),
      fullAddress: text54("full_address"),
      // ── Finance ────────────────────────────────────────────────────────────────
      bankName: text54("bank_name"),
      bankAccountName: text54("bank_account_name"),
      bankAccountNumber: text54("bank_account_number"),
      // ── Service type (existing) ────────────────────────────────────────────────
      serviceType: text54("service_type"),
      // ── Marketplace bridge ─────────────────────────────────────────────────────
      supplierId: integer50("supplier_id"),
      catalogSubmissionLinkId: integer50("catalog_submission_link_id"),
      verificationStatus: text54("verification_status").notNull().default("unverified"),
      approvedAt: timestamp55("approved_at"),
      createdAt: timestamp55("created_at").defaultNow().notNull(),
      updatedAt: timestamp55("updated_at").defaultNow().notNull()
    });
    driverProfilesTable = pgTable55("driver_profiles", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      licenseNumber: text54("license_number"),
      vehicleType: text54("vehicle_type"),
      plateNumber: text54("plate_number"),
      simUrl: text54("sim_url"),
      stnkUrl: text54("stnk_url"),
      createdAt: timestamp55("created_at").defaultNow().notNull(),
      updatedAt: timestamp55("updated_at").defaultNow().notNull()
    });
    employeeProfilesTable = pgTable55("employee_profiles", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().unique().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      companyName: text54("company_name"),
      branch: text54("branch"),
      department: text54("department"),
      division: text54("division"),
      position: text54("position"),
      createdAt: timestamp55("created_at").defaultNow().notNull(),
      updatedAt: timestamp55("updated_at").defaultNow().notNull()
    });
    onboardingApprovalsTable = pgTable55("onboarding_approvals", {
      id: serial53("id").primaryKey(),
      customerId: integer50("customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      accountType: text54("account_type").notNull(),
      status: text54("status").notNull().default("pending"),
      adminNote: text54("admin_note"),
      reviewedBy: text54("reviewed_by"),
      reviewedAt: timestamp55("reviewed_at"),
      notified: boolean26("notified").notNull().default(false),
      createdAt: timestamp55("created_at").defaultNow().notNull(),
      updatedAt: timestamp55("updated_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/waOtpCodes.ts
import { pgTable as pgTable56, serial as serial54, text as text55, timestamp as timestamp56, integer as integer51, boolean as boolean27, index as index34 } from "drizzle-orm/pg-core";
var waOtpCodesTable;
var init_waOtpCodes = __esm({
  "../../lib/db/src/schema/waOtpCodes.ts"() {
    "use strict";
    waOtpCodesTable = pgTable56(
      "wa_otp_codes",
      {
        id: serial54("id").primaryKey(),
        phone: text55("phone").notNull(),
        codeHash: text55("code_hash").notNull(),
        purpose: text55("purpose").notNull().default("register"),
        attempts: integer51("attempts").notNull().default(0),
        verified: boolean27("verified").notNull().default(false),
        verifyToken: text55("verify_token"),
        // Phase 1B: HMAC-SHA256 hash for secure lookup; raw token kept for backward compat
        verifyTokenHash: text55("verify_token_hash"),
        expiresAt: timestamp56("expires_at").notNull(),
        createdAt: timestamp56("created_at").defaultNow().notNull()
      },
      (t) => ({
        phoneIdx: index34("wa_otp_phone_idx").on(t.phone),
        tokenIdx: index34("wa_otp_token_idx").on(t.verifyToken),
        verifyTokenHashIdx: index34("wa_otp_verify_token_hash_idx").on(t.verifyTokenHash)
      })
    );
  }
});

// ../../lib/db/src/schema/rfqVendorLinks.ts
import {
  pgTable as pgTable57,
  serial as serial55,
  integer as integer52,
  text as text56,
  numeric as numeric30,
  boolean as boolean28,
  timestamp as timestamp57
} from "drizzle-orm/pg-core";
var rfqVendorLinksTable, rfqActivityLogsTable;
var init_rfqVendorLinks = __esm({
  "../../lib/db/src/schema/rfqVendorLinks.ts"() {
    "use strict";
    init_logisticOrders();
    init_suppliers();
    rfqVendorLinksTable = pgTable57("rfq_vendor_links", {
      id: serial55("id").primaryKey(),
      rfqId: integer52("rfq_id").notNull().references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
      vendorId: integer52("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      token: text56("token").notNull().unique(),
      tokenHash: text56("token_hash"),
      // P0.1 — HMAC-SHA256 of raw token
      status: text56("status").notNull().default("waiting_response"),
      // waiting_response | accepted_basic_price | counter_offer | rejected
      // expired | selected | not_selected | late_response
      basicPrice: numeric30("basic_price", { precision: 14, scale: 2 }),
      offeredPrice: numeric30("offered_price", { precision: 14, scale: 2 }),
      eta: text56("eta"),
      notes: text56("notes"),
      attachmentUrl: text56("attachment_url"),
      leadTimeDays: integer52("lead_time_days"),
      stockAvailability: text56("stock_availability").default("unknown"),
      isNewUpdate: boolean28("is_new_update").notNull().default(false),
      openedAt: timestamp57("opened_at"),
      submittedAt: timestamp57("submitted_at"),
      lastUpdatedAt: timestamp57("last_updated_at"),
      expiredAt: timestamp57("expired_at"),
      // ── Phase 2A: Product-First Flow ──────────────────────────────────────────
      rfqType: text56("rfq_type"),
      pickupAddress: text56("pickup_address"),
      readyDate: text56("ready_date"),
      qtyConfirmed: numeric30("qty_confirmed", { precision: 12, scale: 3 }),
      qtyUnit: text56("qty_unit"),
      createdAt: timestamp57("created_at").defaultNow().notNull()
    });
    rfqActivityLogsTable = pgTable57("rfq_activity_logs", {
      id: serial55("id").primaryKey(),
      rfqId: integer52("rfq_id").notNull(),
      actorType: text56("actor_type").notNull(),
      actorId: text56("actor_id"),
      actorName: text56("actor_name"),
      action: text56("action").notNull(),
      description: text56("description"),
      createdAt: timestamp57("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/vendorMiniForm.ts
import { pgTable as pgTable58, serial as serial56, integer as integer53, text as text57, boolean as boolean29, timestamp as timestamp58, jsonb as jsonb17, numeric as numeric31, uniqueIndex as uniqueIndex14 } from "drizzle-orm/pg-core";
import { sql as sql3 } from "drizzle-orm";
var vendorMiniFormLinksTable, vendorMiniFormSubmissionsTable, customerApprovalsTable, vendorOperationalConfirmationsTable, vendorPriceHistoryTable, vmfActivityLogTable, customerInvoiceLinksTable;
var init_vendorMiniForm = __esm({
  "../../lib/db/src/schema/vendorMiniForm.ts"() {
    "use strict";
    init_suppliers();
    vendorMiniFormLinksTable = pgTable58("vendor_mini_form_links", {
      id: serial56("id").primaryKey(),
      token: text57("token").notNull().unique(),
      supplierId: integer53("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      serviceType: text57("service_type").notNull(),
      title: text57("title"),
      notes: text57("notes"),
      expiresAt: timestamp58("expires_at"),
      isActive: boolean29("is_active").notNull().default(true),
      shortUrl: text57("short_url"),
      createdAt: timestamp58("created_at").defaultNow().notNull(),
      createdBy: text57("created_by"),
      // Order-based mode columns
      mode: text57("mode").notNull().default("rate_collection"),
      orderId: integer53("order_id"),
      orderNumber: text57("order_number"),
      orderItemId: integer53("order_item_id"),
      itemStatus: text57("item_status").default("waiting_vendor"),
      phase: text57("phase").default("quotation"),
      vendorName: text57("vendor_name"),
      // Security & limits
      maxSubmissions: integer53("max_submissions"),
      resubmitAllowed: boolean29("resubmit_allowed").default(false),
      // Internal
      adminNotes: text57("admin_notes"),
      // Target audience: vendor | customer | admin
      formTarget: text57("form_target").notNull().default("vendor"),
      // Commodity template integration (legacy)
      commodityTemplateId: integer53("commodity_template_id"),
      // Product Template Engine columns (Step 1F cutover)
      categoryKey: text57("category_key"),
      templateId: text57("template_id"),
      templateVersion: text57("template_version"),
      templateSnapshot: jsonb17("template_snapshot").$type()
    });
    vendorMiniFormSubmissionsTable = pgTable58("vendor_mini_form_submissions", {
      id: serial56("id").primaryKey(),
      linkId: integer53("link_id").references(() => vendorMiniFormLinksTable.id, { onDelete: "set null" }),
      token: text57("token").notNull().unique(),
      supplierId: integer53("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      serviceType: text57("service_type").notNull(),
      vendorName: text57("vendor_name"),
      contactPerson: text57("contact_person"),
      contactPhone: text57("contact_phone"),
      formData: jsonb17("form_data").notNull().default({}),
      staffData: jsonb17("staff_data").notNull().default({}),
      submittedAt: timestamp58("submitted_at").defaultNow().notNull(),
      // Order-based fields
      responseStatus: text57("response_status").default("submitted"),
      vendorPrice: numeric31("vendor_price", { precision: 14, scale: 2 }),
      currency: text57("currency").default("IDR"),
      eta: text57("eta"),
      validUntil: text57("valid_until"),
      attachmentUrl: text57("attachment_url"),
      orderId: integer53("order_id"),
      orderItemId: integer53("order_item_id"),
      selectedByAdmin: boolean29("selected_by_admin").default(false),
      selectedAt: timestamp58("selected_at"),
      // Security tracking
      submittedIp: text57("submitted_ip"),
      submittedUa: text57("submitted_ua"),
      // Revision tracking
      revisionCount: integer53("revision_count").default(0),
      // Admin internal
      adminNotes: text57("admin_notes"),
      // Lock after customer approve
      locked: boolean29("locked").default(false),
      unlockReason: text57("unlock_reason"),
      // ── Template Engine: version snapshot of the form template used at submission time ─
      templateId: text57("template_id"),
      templateVersion: text57("template_version"),
      templateSnapshot: jsonb17("template_snapshot").$type(),
      // ── Media Foundation ──────────────────────────────────────────────────────
      mediaAssets: jsonb17("media_assets").$type().notNull().default([])
    }, (t) => [
      // Mencegah vendor yang sama (supplier_id tidak null) submit 2x untuk link yang sama.
      // Vendor anonim (supplier_id IS NULL) dikecualikan karena diidentifikasi via token unik.
      uniqueIndex14("vmf_submissions_link_supplier_uidx").on(t.linkId, t.supplierId).where(sql3`${t.supplierId} IS NOT NULL`)
    ]);
    customerApprovalsTable = pgTable58("customer_approvals", {
      id: serial56("id").primaryKey(),
      token: text57("token").notNull().unique(),
      orderId: integer53("order_id"),
      orderNumber: text57("order_number"),
      customerName: text57("customer_name"),
      customerPhone: text57("customer_phone"),
      customerEmail: text57("customer_email"),
      offerSummary: jsonb17("offer_summary").default({}),
      // Margin calculator fields
      submissionId: integer53("submission_id"),
      vendorCost: numeric31("vendor_cost", { precision: 14, scale: 2 }),
      markupPct: numeric31("markup_pct", { precision: 8, scale: 2 }),
      markupNominal: numeric31("markup_nominal", { precision: 14, scale: 2 }),
      sellingPrice: numeric31("selling_price", { precision: 14, scale: 2 }),
      currency: text57("currency").default("IDR"),
      ppnPct: numeric31("ppn_pct", { precision: 5, scale: 2 }).default("11"),
      ppnNominal: numeric31("ppn_nominal", { precision: 14, scale: 2 }),
      profitMarginPct: numeric31("profit_margin_pct", { precision: 8, scale: 2 }),
      termsNotes: text57("terms_notes"),
      adminNotes: text57("admin_notes"),
      status: text57("status").notNull().default("pending"),
      approvedAt: timestamp58("approved_at"),
      rejectedAt: timestamp58("rejected_at"),
      notes: text57("notes"),
      soId: integer53("so_id"),
      soNumber: text57("so_number"),
      locked: boolean29("locked").default(false),
      createdAt: timestamp58("created_at").defaultNow().notNull(),
      createdBy: text57("created_by"),
      expiresAt: timestamp58("expires_at"),
      usedAt: timestamp58("used_at"),
      revokedAt: timestamp58("revoked_at"),
      categoryKey: text57("category_key"),
      templateId: text57("template_id"),
      templateVersion: text57("template_version"),
      templateSnapshot: jsonb17("template_snapshot").$type(),
      requiredDocumentsFromTemplate: jsonb17("required_documents_from_template").$type(),
      checklistFromTemplate: jsonb17("checklist_from_template").$type(),
      // ── Media Foundation ──────────────────────────────────────────────────────
      mediaAssets: jsonb17("media_assets").$type().notNull().default([])
    });
    vendorOperationalConfirmationsTable = pgTable58("vendor_operational_confirmations", {
      id: serial56("id").primaryKey(),
      token: text57("token").notNull().unique(),
      orderId: integer53("order_id"),
      orderNumber: text57("order_number"),
      orderItemId: integer53("order_item_id"),
      supplierId: integer53("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      vendorName: text57("vendor_name"),
      serviceType: text57("service_type").notNull(),
      payload: jsonb17("payload").notNull().default({}),
      status: text57("status").notNull().default("pending"),
      submittedAt: timestamp58("submitted_at"),
      instruction: text57("instruction"),
      createdAt: timestamp58("created_at").defaultNow().notNull()
    });
    vendorPriceHistoryTable = pgTable58("vendor_price_history", {
      id: serial56("id").primaryKey(),
      submissionId: integer53("submission_id").references(() => vendorMiniFormSubmissionsTable.id, { onDelete: "cascade" }),
      versionNumber: integer53("version_number").notNull().default(1),
      oldPrice: numeric31("old_price", { precision: 14, scale: 2 }),
      newPrice: numeric31("new_price", { precision: 14, scale: 2 }),
      currency: text57("currency").default("IDR"),
      reason: text57("reason"),
      changedBy: text57("changed_by"),
      changedAt: timestamp58("changed_at").defaultNow().notNull()
    });
    vmfActivityLogTable = pgTable58("vmf_activity_log", {
      id: serial56("id").primaryKey(),
      entityType: text57("entity_type").notNull(),
      // link|submission|customer_approval|op_confirm
      entityId: integer53("entity_id").notNull(),
      action: text57("action").notNull(),
      // submitted|selected|revision_requested|sent_wa|approved|rejected|so_created|locked|unlocked|created
      actor: text57("actor"),
      // user id | "vendor" | "customer" | "system"
      note: text57("note"),
      data: jsonb17("data").default({}),
      createdAt: timestamp58("created_at").defaultNow().notNull()
    });
    customerInvoiceLinksTable = pgTable58("customer_invoice_links", {
      id: serial56("id").primaryKey(),
      token: text57("token").notNull().unique(),
      // Company owner is copied from the canonical sales/logistic/portal order.
      // It is nullable only for legacy rows awaiting the startup backfill; all
      // newly-created customer portal invoices must provide it.
      companyId: integer53("company_id"),
      salesDocId: integer53("sales_doc_id"),
      orderId: integer53("order_id"),
      orderNumber: text57("order_number"),
      invoiceNumber: text57("invoice_number"),
      customerName: text57("customer_name"),
      customerPhone: text57("customer_phone"),
      currency: text57("currency").default("IDR"),
      subtotal: numeric31("subtotal", { precision: 14, scale: 2 }),
      taxRate: numeric31("tax_rate", { precision: 5, scale: 2 }).default("11"),
      taxAmount: numeric31("tax_amount", { precision: 14, scale: 2 }),
      grandTotal: numeric31("grand_total", { precision: 14, scale: 2 }),
      amountPaid: numeric31("amount_paid", { precision: 14, scale: 2 }).default("0"),
      paymentStatus: text57("payment_status").notNull().default("unpaid"),
      paymentMethod: text57("payment_method"),
      dueDate: timestamp58("due_date"),
      notes: text57("notes"),
      lineItems: jsonb17("line_items").default([]),
      viewedAt: timestamp58("viewed_at"),
      acknowledgedAt: timestamp58("acknowledged_at"),
      confirmedAt: timestamp58("confirmed_at"),
      status: text57("status").notNull().default("sent"),
      createdBy: text57("created_by"),
      createdAt: timestamp58("created_at").defaultNow().notNull(),
      expiresAt: timestamp58("expires_at"),
      revokedAt: timestamp58("revoked_at"),
      lastAccessedAt: timestamp58("last_accessed_at"),
      accessCount: integer53("access_count").notNull().default(0),
      // Template context snapshot (immutable at creation time)
      categoryKey: text57("category_key"),
      templateId: text57("template_id"),
      templateVersion: text57("template_version"),
      templateSnapshot: jsonb17("template_snapshot").$type()
    });
  }
});

// ../../lib/db/src/schema/customerQuoteFlow.ts
import {
  pgTable as pgTable59,
  serial as serial57,
  integer as integer54,
  text as text58,
  numeric as numeric32,
  timestamp as timestamp59,
  boolean as boolean30,
  jsonb as jsonb18
} from "drizzle-orm/pg-core";
var customerQuoteLinksTable, customerQuoteResponsesTable, orderTaskLinksTable, orderUpdatesTable, customerOrderLinksTable;
var init_customerQuoteFlow = __esm({
  "../../lib/db/src/schema/customerQuoteFlow.ts"() {
    "use strict";
    init_logisticOrders();
    init_suppliers();
    customerQuoteLinksTable = pgTable59("customer_quote_links", {
      id: serial57("id").primaryKey(),
      rfqId: integer54("rfq_id").references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
      orderId: integer54("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      token: text58("token").notNull().unique(),
      status: text58("status").notNull().default("pending"),
      // pending | approved | revision_requested | rejected | expired
      etaFinal: text58("eta_final"),
      termsConditions: text58("terms_conditions"),
      quoteNotes: text58("quote_notes"),
      finalCustomerPrice: numeric32("final_customer_price", { precision: 14, scale: 2 }),
      vendorCost: numeric32("vendor_cost", { precision: 14, scale: 2 }),
      margin: numeric32("margin", { precision: 14, scale: 2 }),
      validUntil: timestamp59("valid_until"),
      openedAt: timestamp59("opened_at"),
      respondedAt: timestamp59("responded_at"),
      sentAt: timestamp59("sent_at").defaultNow(),
      quotationPdfUrl: text58("quotation_pdf_url"),
      quotationNumber: text58("quotation_number"),
      categoryKey: text58("category_key"),
      templateId: text58("template_id"),
      templateVersion: text58("template_version"),
      templateSnapshot: jsonb18("template_snapshot").$type(),
      // ── Media Foundation ──────────────────────────────────────────────────────
      mediaAssets: jsonb18("media_assets").$type().notNull().default([]),
      revokedAt: timestamp59("revoked_at"),
      createdAt: timestamp59("created_at").defaultNow().notNull()
    });
    customerQuoteResponsesTable = pgTable59("customer_quote_responses", {
      id: serial57("id").primaryKey(),
      rfqId: integer54("rfq_id"),
      orderId: integer54("order_id").references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      token: text58("token").notNull(),
      response: text58("response").notNull(),
      // approve | revise | reject
      revisionNotes: text58("revision_notes"),
      rejectionReason: text58("rejection_reason"),
      respondedAt: timestamp59("responded_at").defaultNow().notNull()
    });
    orderTaskLinksTable = pgTable59("order_task_links", {
      id: serial57("id").primaryKey(),
      orderId: integer54("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      vendorId: integer54("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      driverId: integer54("driver_id"),
      token: text58("token").notNull().unique(),
      roleType: text58("role_type").notNull().default("vendor"),
      // vendor | driver | staff
      label: text58("label"),
      status: text58("status").notNull().default("active"),
      expiredAt: timestamp59("expired_at"),
      revokedAt: timestamp59("revoked_at"),
      openedAt: timestamp59("opened_at"),
      createdAt: timestamp59("created_at").defaultNow().notNull()
    });
    orderUpdatesTable = pgTable59("order_updates", {
      id: serial57("id").primaryKey(),
      orderId: integer54("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      actorType: text58("actor_type").notNull().default("admin"),
      // admin | vendor | driver | system | customer
      actorId: text58("actor_id"),
      actorName: text58("actor_name"),
      status: text58("status"),
      notes: text58("notes"),
      attachmentUrl: text58("attachment_url"),
      isPublic: boolean30("is_public").notNull().default(false),
      // visible to customer tracking
      createdAt: timestamp59("created_at").defaultNow().notNull()
    });
    customerOrderLinksTable = pgTable59("customer_order_links", {
      id: serial57("id").primaryKey(),
      orderId: integer54("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      token: text58("token").notNull().unique(),
      status: text58("status").notNull().default("active"),
      expiresAt: timestamp59("expires_at"),
      revokedAt: timestamp59("revoked_at"),
      createdAt: timestamp59("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/vendorPerformance.ts
import { pgTable as pgTable60, serial as serial58, integer as integer55, numeric as numeric33, text as text59, timestamp as timestamp60, index as index35 } from "drizzle-orm/pg-core";
var vendorPerformanceTable;
var init_vendorPerformance = __esm({
  "../../lib/db/src/schema/vendorPerformance.ts"() {
    "use strict";
    init_suppliers();
    vendorPerformanceTable = pgTable60("vendor_performance", {
      id: serial58("id").primaryKey(),
      vendorId: integer55("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      totalOrders: integer55("total_orders").notNull().default(0),
      completedOrders: integer55("completed_orders").notNull().default(0),
      cancelledOrders: integer55("cancelled_orders").notNull().default(0),
      ontimePercentage: numeric33("ontime_percentage", { precision: 5, scale: 2 }).default("0"),
      averageResponseMinutes: numeric33("average_response_minutes", { precision: 10, scale: 2 }).default("0"),
      podCompletenessScore: numeric33("pod_completeness_score", { precision: 5, scale: 2 }).default("0"),
      etaAccuracyScore: numeric33("eta_accuracy_score", { precision: 5, scale: 2 }).default("0"),
      customerRating: numeric33("customer_rating", { precision: 3, scale: 2 }).default("0"),
      orderSuccessRate: numeric33("order_success_rate", { precision: 5, scale: 2 }).default("0"),
      cancelRate: numeric33("cancel_rate", { precision: 5, scale: 2 }).default("0"),
      totalComplaints: integer55("total_complaints").notNull().default(0),
      recommendationScore: numeric33("recommendation_score", { precision: 5, scale: 2 }).default("0"),
      updatedAt: timestamp60("updated_at").defaultNow().notNull(),
      // Extended spec columns (additive)
      totalRfqInvites: integer55("total_rfq_invites").default(0),
      totalSubmitted: integer55("total_submitted").default(0),
      totalSelected: integer55("total_selected").default(0),
      totalRejected: integer55("total_rejected").default(0),
      avgResponseHours: numeric33("avg_response_hours", { precision: 10, scale: 2 }).default("0"),
      onTimeOrders: integer55("on_time_orders").default(0),
      lateOrders: integer55("late_orders").default(0),
      podCompleteOrders: integer55("pod_complete_orders").default(0),
      score: numeric33("score", { precision: 5, scale: 2 }).default("0"),
      lastCalculatedAt: timestamp60("last_calculated_at"),
      // Financial metrics
      totalRevenue: numeric33("total_revenue", { precision: 18, scale: 2 }).default("0"),
      totalCost: numeric33("total_cost", { precision: 18, scale: 2 }).default("0"),
      totalMargin: numeric33("total_margin", { precision: 18, scale: 2 }).default("0"),
      marginPct: numeric33("margin_pct", { precision: 7, scale: 2 }).default("0"),
      // POD counts
      podUploadedCount: integer55("pod_uploaded_count").default(0),
      podMissingCount: integer55("pod_missing_count").default(0),
      // Invoice counts
      invoiceIssuedCount: integer55("invoice_issued_count").default(0),
      invoiceDisputeCount: integer55("invoice_dispute_count").default(0),
      // Complaint count
      customerComplaintCount: integer55("customer_complaint_count").default(0),
      // Preferred vendor score & grade
      preferredVendorScore: numeric33("preferred_vendor_score", { precision: 5, scale: 2 }).default("0"),
      vendorGrade: text59("vendor_grade").default("D")
    }, (t) => [
      index35("vendor_perf_vendor_idx").on(t.vendorId)
    ]);
  }
});

// ../../lib/db/src/schema/driverLocations.ts
import { pgTable as pgTable61, serial as serial59, integer as integer56, numeric as numeric34, timestamp as timestamp61, text as text60, index as index36 } from "drizzle-orm/pg-core";
var driverLocationsTable;
var init_driverLocations = __esm({
  "../../lib/db/src/schema/driverLocations.ts"() {
    "use strict";
    init_drivers();
    init_logisticOrders();
    driverLocationsTable = pgTable61("driver_locations", {
      id: serial59("id").primaryKey(),
      orderId: integer56("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
      driverId: integer56("driver_id").references(() => driversTable.id, { onDelete: "set null" }),
      jobToken: text60("job_token"),
      latitude: numeric34("latitude", { precision: 10, scale: 7 }).notNull(),
      longitude: numeric34("longitude", { precision: 10, scale: 7 }).notNull(),
      accuracy: numeric34("accuracy", { precision: 8, scale: 2 }),
      speed: numeric34("speed", { precision: 8, scale: 2 }),
      heading: numeric34("heading", { precision: 6, scale: 2 }),
      checkpointType: text60("checkpoint_type"),
      updatedAt: timestamp61("updated_at").defaultNow().notNull()
    }, (t) => [
      index36("driver_loc_order_idx").on(t.orderId),
      index36("driver_loc_driver_idx").on(t.driverId),
      index36("driver_loc_token_idx").on(t.jobToken),
      index36("driver_loc_updated_idx").on(t.updatedAt)
    ]);
  }
});

// ../../lib/db/src/schema/podOcrResults.ts
import { pgTable as pgTable62, serial as serial60, integer as integer57, text as text61, numeric as numeric35, timestamp as timestamp62, index as index37 } from "drizzle-orm/pg-core";
var podOcrResultsTable;
var init_podOcrResults = __esm({
  "../../lib/db/src/schema/podOcrResults.ts"() {
    "use strict";
    init_logisticOrders();
    podOcrResultsTable = pgTable62("pod_ocr_results", {
      id: serial60("id").primaryKey(),
      orderId: integer57("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
      orderNumber: text61("order_number"),
      imageUrl: text61("image_url"),
      extractedText: text61("extracted_text"),
      extractedOrderNumber: text61("extracted_order_number"),
      extractedDate: text61("extracted_date"),
      extractedReceiver: text61("extracted_receiver"),
      extractedCompany: text61("extracted_company"),
      hasSignature: text61("has_signature"),
      verificationStatus: text61("verification_status").notNull().default("pending"),
      mismatchFields: text61("mismatch_fields"),
      confidenceScore: numeric35("confidence_score", { precision: 5, scale: 2 }).default("0"),
      rawResponse: text61("raw_response"),
      createdAt: timestamp62("created_at").defaultNow().notNull()
    }, (t) => [
      index37("pod_ocr_order_idx").on(t.orderId),
      index37("pod_ocr_status_idx").on(t.verificationStatus)
    ]);
  }
});

// ../../lib/db/src/schema/internalTasks.ts
import { pgTable as pgTable63, serial as serial61, integer as integer58, text as text62, timestamp as timestamp63, index as index38 } from "drizzle-orm/pg-core";
var internalTasksTable;
var init_internalTasks = __esm({
  "../../lib/db/src/schema/internalTasks.ts"() {
    "use strict";
    init_logisticOrders();
    internalTasksTable = pgTable63("internal_tasks", {
      id: serial61("id").primaryKey(),
      orderId: integer58("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
      orderNumber: text62("order_number"),
      refType: text62("ref_type").notNull().default("logistic_order"),
      refId: text62("ref_id"),
      assignedTo: text62("assigned_to"),
      assignedUserId: integer58("assigned_user_id"),
      department: text62("department"),
      taskType: text62("task_type").notNull(),
      title: text62("title").notNull(),
      description: text62("description"),
      deadline: timestamp63("deadline"),
      status: text62("status").notNull().default("open"),
      priority: text62("priority").notNull().default("normal"),
      completedAt: timestamp63("completed_at"),
      completedBy: text62("completed_by"),
      companyId: integer58("company_id"),
      createdBy: text62("created_by"),
      createdAt: timestamp63("created_at").defaultNow().notNull(),
      updatedAt: timestamp63("updated_at").defaultNow().notNull()
    }, (t) => [
      index38("int_tasks_order_idx").on(t.orderId),
      index38("int_tasks_status_idx").on(t.status),
      index38("int_tasks_dept_idx").on(t.department),
      index38("int_tasks_assigned_idx").on(t.assignedTo),
      index38("int_tasks_company_idx").on(t.companyId)
    ]);
  }
});

// ../../lib/db/src/schema/marginRules.ts
import { pgTable as pgTable64, serial as serial62, text as text63, numeric as numeric36, boolean as boolean31, timestamp as timestamp64 } from "drizzle-orm/pg-core";
var marginRulesTable;
var init_marginRules = __esm({
  "../../lib/db/src/schema/marginRules.ts"() {
    "use strict";
    marginRulesTable = pgTable64("margin_rules", {
      id: serial62("id").primaryKey(),
      name: text63("name").notNull(),
      serviceType: text63("service_type"),
      route: text63("route"),
      customerType: text63("customer_type"),
      marginType: text63("margin_type").notNull().default("percentage"),
      // percentage | fixed | minimum
      marginValue: numeric36("margin_value", { precision: 14, scale: 2 }).notNull().default("0"),
      minimumMargin: numeric36("minimum_margin", { precision: 14, scale: 2 }),
      isActive: boolean31("is_active").notNull().default(true),
      priority: numeric36("priority", { precision: 5, scale: 0 }).notNull().default("0"),
      notes: text63("notes"),
      createdAt: timestamp64("created_at").defaultNow().notNull(),
      updatedAt: timestamp64("updated_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/activityLogs.ts
import { pgTable as pgTable65, serial as serial63, integer as integer59, text as text64, jsonb as jsonb19, timestamp as timestamp65 } from "drizzle-orm/pg-core";
var activityLogsTable;
var init_activityLogs = __esm({
  "../../lib/db/src/schema/activityLogs.ts"() {
    "use strict";
    init_mktRfqs();
    init_mktVendorQuotes();
    init_mktPurchaseOrders();
    activityLogsTable = pgTable65("activity_logs", {
      id: serial63("id").primaryKey(),
      rfqId: integer59("rfq_id"),
      orderId: integer59("order_id"),
      actorType: text64("actor_type").notNull().default("admin"),
      // admin | vendor | customer | driver | system
      actorId: text64("actor_id"),
      actorName: text64("actor_name"),
      action: text64("action").notNull(),
      oldValue: jsonb19("old_value"),
      newValue: jsonb19("new_value"),
      description: text64("description"),
      ipAddress: text64("ip_address"),
      // Marketplace audit trail — Added Phase 1C (2026-07-02), Group D migration
      mktRfqId: integer59("mkt_rfq_id").references(() => mktRfqsTable.id, { onDelete: "set null" }),
      mktVendorQuoteId: integer59("mkt_vendor_quote_id").references(() => mktVendorQuotesTable.id, { onDelete: "set null" }),
      mktPurchaseOrderId: integer59("mkt_purchase_order_id").references(() => mktPurchaseOrdersTable.id, { onDelete: "set null" }),
      createdAt: timestamp65("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/adminActionLinks.ts
import {
  pgTable as pgTable66,
  serial as serial64,
  integer as integer60,
  text as text65,
  timestamp as timestamp66,
  index as index39
} from "drizzle-orm/pg-core";
var adminActionLinksTable;
var init_adminActionLinks = __esm({
  "../../lib/db/src/schema/adminActionLinks.ts"() {
    "use strict";
    init_logisticOrders();
    adminActionLinksTable = pgTable66("admin_action_links", {
      id: serial64("id").primaryKey(),
      // Transition: token = raw (legacy lookup); token_hash = HMAC-SHA256 (new lookup)
      token: text65("token").notNull().unique(),
      tokenHash: text65("token_hash"),
      // P0.1 — HMAC-SHA256 of raw token
      actionType: text65("action_type").notNull(),
      // review_order | compare_vendors | forward_vendor
      orderId: integer60("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      rfqId: integer60("rfq_id").references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
      expiresAt: timestamp66("expires_at"),
      usedAt: timestamp66("used_at"),
      revokedAt: timestamp66("revoked_at"),
      createdAt: timestamp66("created_at").defaultNow().notNull()
    }, (t) => [
      index39("admin_action_links_token_hash_idx").on(t.tokenHash),
      index39("admin_action_links_order_idx").on(t.orderId)
    ]);
  }
});

// ../../lib/db/src/schema/vendorFulfillmentLinks.ts
import {
  pgTable as pgTable67,
  serial as serial65,
  integer as integer61,
  text as text66,
  timestamp as timestamp67
} from "drizzle-orm/pg-core";
var vendorFulfillmentLinksTable;
var init_vendorFulfillmentLinks = __esm({
  "../../lib/db/src/schema/vendorFulfillmentLinks.ts"() {
    "use strict";
    init_logisticOrders();
    init_suppliers();
    vendorFulfillmentLinksTable = pgTable67("vendor_fulfillment_links", {
      id: serial65("id").primaryKey(),
      token: text66("token").notNull().unique(),
      tokenHash: text66("token_hash"),
      // P0.1 — HMAC-SHA256 of raw token
      orderId: integer61("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      vendorId: integer61("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      serviceType: text66("service_type").notNull(),
      // trucking | freight_air | freight_sea | product | customs | general
      status: text66("status").notNull().default("pending"),
      // pending | submitted | expired
      // --- Trucking fields ---
      driverName: text66("driver_name"),
      driverPhone: text66("driver_phone"),
      plateNumber: text66("plate_number"),
      vehicleType: text66("vehicle_type"),
      pickupTime: text66("pickup_time"),
      // --- Freight (Air / Sea) fields ---
      carrierName: text66("carrier_name"),
      etd: text66("etd"),
      eta: text66("eta"),
      bookingNumber: text66("booking_number"),
      awbBlNumber: text66("awb_bl_number"),
      flightVessel: text66("flight_vessel"),
      // --- Product / warehouse fields ---
      stockConfirmed: text66("stock_confirmed"),
      qtyConfirmed: text66("qty_confirmed"),
      readyDate: text66("ready_date"),
      warehouseLocation: text66("warehouse_location"),
      // --- Customs / handling fields ---
      customsPicName: text66("customs_pic_name"),
      customsDocuments: text66("customs_documents"),
      customsProcessEta: text66("customs_process_eta"),
      // --- Common ---
      notes: text66("notes"),
      expiresAt: timestamp67("expires_at"),
      revokedAt: timestamp67("revoked_at"),
      submittedAt: timestamp67("submitted_at"),
      createdAt: timestamp67("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/orderFulfillment.ts
import {
  pgTable as pgTable68,
  serial as serial66,
  integer as integer62,
  text as text67,
  jsonb as jsonb20,
  timestamp as timestamp68,
  index as index40
} from "drizzle-orm/pg-core";
var orderFulfillmentLinksTable, orderFulfillmentSubmissionsTable;
var init_orderFulfillment = __esm({
  "../../lib/db/src/schema/orderFulfillment.ts"() {
    "use strict";
    init_logisticOrders();
    init_suppliers();
    orderFulfillmentLinksTable = pgTable68("order_fulfillment_links", {
      id: serial66("id").primaryKey(),
      orderId: integer62("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      vendorId: integer62("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      serviceType: text67("service_type").notNull(),
      token: text67("token").notNull().unique(),
      status: text67("status").notNull().default("pending"),
      sentAt: timestamp68("sent_at"),
      expiresAt: timestamp68("expires_at"),
      submittedAt: timestamp68("submitted_at"),
      createdAt: timestamp68("created_at").defaultNow().notNull()
    }, (t) => [
      index40("ofl_order_idx").on(t.orderId),
      index40("ofl_token_idx").on(t.token)
    ]);
    orderFulfillmentSubmissionsTable = pgTable68("order_fulfillment_submissions", {
      id: serial66("id").primaryKey(),
      linkId: integer62("link_id").notNull().references(() => orderFulfillmentLinksTable.id, { onDelete: "cascade" }),
      orderId: integer62("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      serviceType: text67("service_type").notNull(),
      fulfillmentData: jsonb20("fulfillment_data").notNull(),
      submittedAt: timestamp68("submitted_at").defaultNow().notNull(),
      createdAt: timestamp68("created_at").defaultNow().notNull()
    }, (t) => [
      index40("ofs_order_idx").on(t.orderId),
      index40("ofs_link_idx").on(t.linkId)
    ]);
  }
});

// ../../lib/db/src/schema/trustedDevices.ts
import { pgTable as pgTable69, serial as serial67, text as text68, timestamp as timestamp69, index as index41 } from "drizzle-orm/pg-core";
var trustedDevicesTable;
var init_trustedDevices = __esm({
  "../../lib/db/src/schema/trustedDevices.ts"() {
    "use strict";
    trustedDevicesTable = pgTable69(
      "trusted_devices",
      {
        id: serial67("id").primaryKey(),
        phone: text68("phone").notNull(),
        deviceToken: text68("device_token").notNull().unique(),
        // Phase 1B: HMAC-SHA256 hash for secure lookup; raw token kept for backward compat
        deviceTokenHash: text68("device_token_hash"),
        expiresAt: timestamp69("expires_at").notNull(),
        createdAt: timestamp69("created_at").defaultNow().notNull()
      },
      (t) => ({
        phoneIdx: index41("trusted_devices_phone_idx").on(t.phone),
        tokenIdx: index41("trusted_devices_token_idx").on(t.deviceToken),
        tokenHashIdx: index41("trusted_devices_token_hash_idx").on(t.deviceTokenHash)
      })
    );
  }
});

// ../../lib/db/src/schema/auditReports.ts
import {
  pgTable as pgTable70,
  serial as serial68,
  text as text69,
  integer as integer63,
  timestamp as timestamp70,
  date as date12,
  uniqueIndex as uniqueIndex15
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema30 } from "drizzle-zod";
var erpAuditReportsTable, erpAuditResponsesTable, insertErpAuditReportSchema, insertErpAuditResponseSchema;
var init_auditReports = __esm({
  "../../lib/db/src/schema/auditReports.ts"() {
    "use strict";
    erpAuditReportsTable = pgTable70("erp_audit_reports", {
      id: serial68("id").primaryKey(),
      companyId: integer63("company_id"),
      reportNumber: text69("report_number").notNull().unique(),
      title: text69("title").notNull(),
      auditorName: text69("auditor_name"),
      periodStart: date12("period_start"),
      periodEnd: date12("period_end"),
      status: text69("status").notNull().default("draft"),
      okCount: integer63("ok_count").notNull().default(0),
      notOkCount: integer63("not_ok_count").notNull().default(0),
      warningCount: integer63("warning_count").notNull().default(0),
      naCount: integer63("na_count").notNull().default(0),
      totalAnswered: integer63("total_answered").notNull().default(0),
      conclusion: text69("conclusion"),
      overallNotes: text69("overall_notes"),
      createdById: text69("created_by_id"),
      createdAt: timestamp70("created_at").defaultNow().notNull(),
      updatedAt: timestamp70("updated_at").defaultNow().notNull()
    });
    erpAuditResponsesTable = pgTable70("erp_audit_responses", {
      id: serial68("id").primaryKey(),
      reportId: integer63("report_id").notNull().references(() => erpAuditReportsTable.id, { onDelete: "cascade" }),
      itemId: text69("item_id").notNull(),
      status: text69("status").notNull().default("na"),
      notes: text69("notes"),
      updatedAt: timestamp70("updated_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex15("erp_audit_responses_report_item_idx").on(t.reportId, t.itemId)
    ]);
    insertErpAuditReportSchema = createInsertSchema30(erpAuditReportsTable);
    insertErpAuditResponseSchema = createInsertSchema30(erpAuditResponsesTable);
  }
});

// ../../lib/db/src/schema/waTemplateConfigs.ts
import { pgTable as pgTable71, serial as serial69, text as text70, integer as integer64, timestamp as timestamp71 } from "drizzle-orm/pg-core";
var waTemplateConfigsTable;
var init_waTemplateConfigs = __esm({
  "../../lib/db/src/schema/waTemplateConfigs.ts"() {
    "use strict";
    init_companies();
    waTemplateConfigsTable = pgTable71(
      "whatsapp_template_configs",
      {
        id: serial69("id").primaryKey(),
        companyId: integer64("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
        recipient: text70("recipient").notNull(),
        workflow: text70("workflow").notNull(),
        body: text70("body").notNull().default(""),
        createdAt: timestamp71("created_at").defaultNow().notNull(),
        updatedAt: timestamp71("updated_at").defaultNow().notNull()
      }
    );
  }
});

// ../../lib/db/src/schema/storageAuditLog.ts
import { pgTable as pgTable72, serial as serial70, text as text71, integer as integer65, bigint, timestamp as timestamp72, pgEnum as pgEnum22 } from "drizzle-orm/pg-core";
var storageAuditActionEnum, storageAuditEntityTypeEnum, storageAuditLogTable;
var init_storageAuditLog = __esm({
  "../../lib/db/src/schema/storageAuditLog.ts"() {
    "use strict";
    storageAuditActionEnum = pgEnum22("storage_audit_action", [
      "upload",
      "upload_presigned_issued",
      "download",
      "delete",
      "delete_orphan"
    ]);
    storageAuditEntityTypeEnum = pgEnum22("storage_audit_entity_type", [
      "freight_attachment",
      "expense_attachment",
      "media_asset",
      "pod_ocr",
      "presigned_upload",
      "other"
    ]);
    storageAuditLogTable = pgTable72("storage_audit_log", {
      id: serial70("id").primaryKey(),
      action: storageAuditActionEnum("action").notNull(),
      entityType: storageAuditEntityTypeEnum("entity_type").notNull(),
      entityId: integer65("entity_id"),
      objectPath: text71("object_path"),
      fileName: text71("file_name"),
      contentType: text71("content_type"),
      fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
      actorId: text71("actor_id"),
      actorType: text71("actor_type").default("staff"),
      ipAddress: text71("ip_address"),
      details: text71("details"),
      createdAt: timestamp72("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/intelligenceAlerts.ts
import { pgTable as pgTable73, serial as serial71, integer as integer66, text as text72, jsonb as jsonb21, timestamp as timestamp73, boolean as boolean32, index as index42 } from "drizzle-orm/pg-core";
var intelligenceAlertsTable;
var init_intelligenceAlerts = __esm({
  "../../lib/db/src/schema/intelligenceAlerts.ts"() {
    "use strict";
    intelligenceAlertsTable = pgTable73("intelligence_alerts", {
      id: serial71("id").primaryKey(),
      companyId: integer66("company_id"),
      alertType: text72("alert_type").notNull(),
      // vendor_slow_response | rfq_no_response | quote_expired | order_eta_breach |
      // margin_below_minimum | missing_required_doc | stage_stalled | duplicate_order
      entityType: text72("entity_type").notNull(),
      // logistic_order | rfq | customer_quote | shipment | vendor
      entityId: integer66("entity_id"),
      entityRef: text72("entity_ref"),
      // human-readable ref e.g. order number, rfq number
      severity: text72("severity").notNull().default("warning"),
      // info | warning | critical
      title: text72("title").notNull(),
      message: text72("message").notNull(),
      contextJson: jsonb21("context_json").default({}),
      status: text72("status").notNull().default("open"),
      // open | acknowledged | resolved
      isRead: boolean32("is_read").notNull().default(false),
      acknowledgedAt: timestamp73("acknowledged_at"),
      acknowledgedBy: text72("acknowledged_by"),
      resolvedAt: timestamp73("resolved_at"),
      resolvedBy: text72("resolved_by"),
      triggeredAt: timestamp73("triggered_at").defaultNow().notNull(),
      createdAt: timestamp73("created_at").defaultNow().notNull()
    }, (t) => [
      index42("intelligence_alerts_company_status_idx").on(t.companyId, t.status),
      index42("intelligence_alerts_type_entity_idx").on(t.alertType, t.entityType, t.entityId),
      index42("intelligence_alerts_severity_idx").on(t.severity, t.status)
    ]);
  }
});

// ../../lib/db/src/schema/intelligenceAlertSettings.ts
import { pgTable as pgTable74, serial as serial72, integer as integer67, text as text73, boolean as boolean33, numeric as numeric37, timestamp as timestamp74 } from "drizzle-orm/pg-core";
var intelligenceAlertSettingsTable;
var init_intelligenceAlertSettings = __esm({
  "../../lib/db/src/schema/intelligenceAlertSettings.ts"() {
    "use strict";
    intelligenceAlertSettingsTable = pgTable74("intelligence_alert_settings", {
      id: serial72("id").primaryKey(),
      companyId: integer67("company_id"),
      masterEnabled: boolean33("master_enabled").notNull().default(true),
      rfqAlertEnabled: boolean33("rfq_alert_enabled").notNull().default(true),
      rfqWarningHours: integer67("rfq_warning_hours").notNull().default(24),
      rfqCriticalHours: integer67("rfq_critical_hours").notNull().default(48),
      marginAlertEnabled: boolean33("margin_alert_enabled").notNull().default(true),
      marginMinPct: numeric37("margin_min_pct", { precision: 6, scale: 2 }).notNull().default("5.00"),
      etaAlertEnabled: boolean33("eta_alert_enabled").notNull().default(true),
      quoteExpiredAlertEnabled: boolean33("quote_expired_alert_enabled").notNull().default(true),
      invoiceReminderEnabled: boolean33("invoice_reminder_enabled").notNull().default(true),
      alertWindowStart: text73("alert_window_start").notNull().default("00:00"),
      alertWindowEnd: text73("alert_window_end").notNull().default("23:59"),
      updatedAt: timestamp74("updated_at").defaultNow().notNull(),
      updatedBy: text73("updated_by")
    });
  }
});

// ../../lib/db/src/schema/orderStageLogs.ts
import { pgTable as pgTable75, serial as serial73, integer as integer68, text as text74, numeric as numeric38, timestamp as timestamp75, index as index43 } from "drizzle-orm/pg-core";
var orderStageLogsTable;
var init_orderStageLogs = __esm({
  "../../lib/db/src/schema/orderStageLogs.ts"() {
    "use strict";
    init_logisticOrders();
    orderStageLogsTable = pgTable75("order_stage_logs", {
      id: serial73("id").primaryKey(),
      orderId: integer68("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      companyId: integer68("company_id"),
      stageFrom: text74("stage_from"),
      stageTo: text74("stage_to").notNull(),
      durationHours: numeric38("duration_hours", { precision: 10, scale: 2 }),
      actorId: text74("actor_id"),
      actorType: text74("actor_type").notNull().default("system"),
      // admin | vendor | driver | customer | system
      actorName: text74("actor_name"),
      notes: text74("notes"),
      createdAt: timestamp75("created_at").defaultNow().notNull()
    }, (t) => [
      index43("order_stage_logs_order_idx").on(t.orderId),
      index43("order_stage_logs_company_idx").on(t.companyId)
    ]);
  }
});

// ../../lib/db/src/schema/aiGovernance.ts
import {
  pgTable as pgTable76,
  serial as serial74,
  text as text75,
  integer as integer69,
  boolean as boolean34,
  timestamp as timestamp76,
  jsonb as jsonb22,
  numeric as numeric39,
  index as index44
} from "drizzle-orm/pg-core";
var aiAgentExecutionsTable, aiApprovalQueueTable, aiDecisionMemoryTable;
var init_aiGovernance = __esm({
  "../../lib/db/src/schema/aiGovernance.ts"() {
    "use strict";
    aiAgentExecutionsTable = pgTable76("ai_agent_executions", {
      id: serial74("id").primaryKey(),
      // ── Identity ──────────────────────────────────────────────────────────────
      agentType: text75("agent_type").notNull(),
      // customer | vendor | ops | customs | finance | intake | ocr | document
      action: text75("action").notNull(),
      // create_draft_quote | send_reminder | classify_document | extract_data
      // assign_vendor | escalate_order | verify_pod | parse_vendor_reply | ...
      // ── Lifecycle ─────────────────────────────────────────────────────────────
      status: text75("status").notNull().default("running"),
      // pending | running | completed | failed | skipped | awaiting_approval
      // ── AI Quality ────────────────────────────────────────────────────────────
      confidence: numeric39("confidence", { precision: 5, scale: 4 }),
      // 0.0000 – 1.0000; NULL jika model tidak memberikan confidence score
      reasoning: text75("reasoning"),
      // Ringkasan alasan AI membuat keputusan ini (max ~500 char)
      modelUsed: text75("model_used"),
      // gpt-4o | gpt-4o-mini | gpt-4-vision-preview | ...
      inputTokens: integer69("input_tokens"),
      outputTokens: integer69("output_tokens"),
      // ── Context ───────────────────────────────────────────────────────────────
      inputSummary: text75("input_summary"),
      // Deskripsi singkat input yang diproses AI
      outputSummary: text75("output_summary"),
      // Deskripsi singkat output/keputusan AI
      inputData: jsonb22("input_data"),
      // Full input (ditruncate jika terlalu besar)
      outputData: jsonb22("output_data"),
      // Full structured output dari AI
      // ── References ────────────────────────────────────────────────────────────
      orderId: integer69("order_id"),
      rfqId: integer69("rfq_id"),
      companyId: integer69("company_id"),
      // ── Trigger ───────────────────────────────────────────────────────────────
      triggeredBy: text75("triggered_by").notNull().default("system"),
      // system | user | agent | webhook | scheduler
      triggeredById: text75("triggered_by_id"),
      // user_id atau agent execution ID yang memicu
      reqId: text75("req_id"),
      // Correlation ID dari X-Request-ID header
      // ── Safety & Governance ───────────────────────────────────────────────────
      safetyChecks: jsonb22("safety_checks"),
      // Array of: { check: string, passed: boolean, value?: unknown }
      humanApprovalRequired: boolean34("human_approval_required").notNull().default(false),
      approvalId: integer69("approval_id"),
      // FK ke ai_approval_queue.id — diisi setelah approval record dibuat
      // ── Override ──────────────────────────────────────────────────────────────
      wasOverridden: boolean34("was_overridden").notNull().default(false),
      overrideBy: text75("override_by"),
      overrideReason: text75("override_reason"),
      // ── Performance ──────────────────────────────────────────────────────────
      durationMs: integer69("duration_ms"),
      errorMessage: text75("error_message"),
      // ── Timestamps ────────────────────────────────────────────────────────────
      createdAt: timestamp76("created_at").defaultNow().notNull(),
      completedAt: timestamp76("completed_at")
    });
    aiApprovalQueueTable = pgTable76("ai_approval_queue", {
      id: serial74("id").primaryKey(),
      // ── Link ke execution ─────────────────────────────────────────────────────
      executionId: integer69("execution_id"),
      // FK ke ai_agent_executions.id
      // ── Identity ──────────────────────────────────────────────────────────────
      agentType: text75("agent_type").notNull(),
      action: text75("action").notNull(),
      actionDescription: text75("action_description").notNull(),
      // Deskripsi human-readable: "AI ingin assign vendor PT. Maju ke order #CST/2026/001234"
      // ── Context untuk reviewer ────────────────────────────────────────────────
      contextData: jsonb22("context_data"),
      // Data relevan agar reviewer bisa membuat keputusan tanpa buka sistem
      priority: text75("priority").notNull().default("medium"),
      // low | medium | high | critical
      amount: numeric39("amount", { precision: 18, scale: 2 }),
      // Nilai moneter jika relevan (untuk threshold check)
      // ── References ────────────────────────────────────────────────────────────
      orderId: integer69("order_id"),
      rfqId: integer69("rfq_id"),
      companyId: integer69("company_id"),
      requestedById: text75("requested_by_id"),
      // user_id atau "system" yang meminta approval
      // ── Status ────────────────────────────────────────────────────────────────
      status: text75("status").notNull().default("pending"),
      // pending | approved | rejected | expired | auto_approved
      // ── Expiry & Auto-approve ─────────────────────────────────────────────────
      expiresAt: timestamp76("expires_at").notNull(),
      // Jika tidak ada keputusan sampai waktu ini → status = expired
      autoApproveAt: timestamp76("auto_approve_at"),
      // Opsional: jika tidak ada respons, auto-approve pada waktu ini
      // ── Decision ──────────────────────────────────────────────────────────────
      decidedBy: text75("decided_by"),
      // user_id reviewer atau "system" untuk auto-approve
      decidedAt: timestamp76("decided_at"),
      decisionReason: text75("decision_reason"),
      // ── Undo window ───────────────────────────────────────────────────────────
      undoDeadline: timestamp76("undo_deadline"),
      // Approved actions bisa di-undo sampai timestamp ini (default: +30 menit)
      wasUndone: boolean34("was_undone").notNull().default(false),
      undoneBy: text75("undone_by"),
      undoneAt: timestamp76("undone_at"),
      // ── Timestamps ────────────────────────────────────────────────────────────
      requestedAt: timestamp76("requested_at").defaultNow().notNull()
    });
    aiDecisionMemoryTable = pgTable76("ai_decision_memory", {
      id: serial74("id").primaryKey(),
      // ── Decision Type ──────────────────────────────────────────────────────────
      decisionType: text75("decision_type").notNull(),
      // vendor_assignment | route_selection | pricing | escalation | classification
      // ── Context (fingerprint untuk similarity matching) ────────────────────────
      origin: text75("origin"),
      destination: text75("destination"),
      shipmentType: text75("shipment_type"),
      transportMode: text75("transport_mode"),
      commodity: text75("commodity"),
      weightKg: numeric39("weight_kg", { precision: 12, scale: 3 }),
      direction: text75("direction"),
      // import | export | domestic | transit
      // ── Decision ──────────────────────────────────────────────────────────────
      chosenEntityType: text75("chosen_entity_type").notNull(),
      // vendor | route | price_tier | escalation_level
      chosenEntityId: integer69("chosen_entity_id"),
      // FK ke suppliers.id / dll (nullable untuk entity non-integer)
      chosenEntityName: text75("chosen_entity_name").notNull(),
      // Nama human-readable: "PT. Maju Jaya Logistics"
      reasoning: text75("reasoning"),
      // Ringkasan mengapa keputusan ini diambil (dari AI atau admin)
      confidence: numeric39("confidence", { precision: 5, scale: 4 }),
      // 0.0000 – 1.0000
      decidedBy: text75("decided_by").notNull().default("admin"),
      // admin | ai | system
      // ── References ────────────────────────────────────────────────────────────
      orderId: integer69("order_id"),
      // FK ke logistic_orders.id
      orderNumber: text75("order_number"),
      rfqId: integer69("rfq_id"),
      quoteId: integer69("quote_id"),
      companyId: integer69("company_id"),
      executionId: integer69("execution_id"),
      // FK ke ai_agent_executions.id (jika dipicu oleh AI)
      // ── Outcome (diisi setelah order selesai) ─────────────────────────────────
      outcome: text75("outcome"),
      // success | failure | partial | cancelled | unknown
      onTimeDelivery: boolean34("on_time_delivery"),
      // true = delivered on/before ETA | false = delayed | null = belum diketahui
      delayDays: integer69("delay_days"),
      // Jumlah hari terlambat (positif = terlambat, negatif = lebih cepat)
      actualVendorPrice: numeric39("actual_vendor_price", { precision: 14, scale: 2 }),
      quotedVendorPrice: numeric39("quoted_vendor_price", { precision: 14, scale: 2 }),
      outcomeNotes: text75("outcome_notes"),
      // Catatan tambahan: "Vendor minta reschedule H-1", "Dokumen incomplete"
      outcomeUpdatedAt: timestamp76("outcome_updated_at"),
      // ── Extra context snapshot ─────────────────────────────────────────────────
      contextSnapshot: jsonb22("context_snapshot"),
      // Snapshot lengkap context saat keputusan dibuat (untuk audit/replay)
      // ── Timestamps ────────────────────────────────────────────────────────────
      createdAt: timestamp76("created_at").defaultNow().notNull()
    }, (t) => [
      index44("ai_dm_decision_type_idx").on(t.decisionType),
      index44("ai_dm_entity_idx").on(t.chosenEntityId, t.chosenEntityType),
      index44("ai_dm_order_idx").on(t.orderId),
      index44("ai_dm_route_idx").on(t.origin, t.destination),
      index44("ai_dm_outcome_idx").on(t.outcome)
    ]);
  }
});

// ../../lib/db/src/schema/productTemplates.ts
import { pgTable as pgTable77, serial as serial75, text as text76, boolean as boolean35, jsonb as jsonb23, timestamp as timestamp77, integer as integer70 } from "drizzle-orm/pg-core";
var productTemplatesTable;
var init_productTemplates = __esm({
  "../../lib/db/src/schema/productTemplates.ts"() {
    "use strict";
    init_companies();
    productTemplatesTable = pgTable77("product_templates", {
      id: serial75("id").primaryKey(),
      companyId: integer70("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      categoryKey: text76("category_key").notNull(),
      label: text76("label").notNull(),
      version: text76("version").notNull().default("1.0.0"),
      isActive: boolean35("is_active").notNull().default(true),
      icon: text76("icon"),
      description: text76("description"),
      sortOrder: integer70("sort_order").notNull().default(0),
      requiredDocuments: jsonb23("required_documents").notNull().default([]),
      checklist: jsonb23("checklist").notNull().default([]),
      customFields: jsonb23("custom_fields").notNull().default([]),
      packagingInstructions: text76("packaging_instructions").default(""),
      conditionalRules: jsonb23("conditional_rules").notNull().default([]),
      validationRules: jsonb23("validation_rules").notNull().default([]),
      // ── Media Foundation ──────────────────────────────────────────────────────
      mediaAssets: jsonb23("media_assets").$type().notNull().default([]),
      createdAt: timestamp77("created_at").notNull().defaultNow(),
      updatedAt: timestamp77("updated_at").notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/serviceTemplates.ts
import { pgTable as pgTable78, serial as serial76, text as text77, boolean as boolean36, jsonb as jsonb24, timestamp as timestamp78, integer as integer71 } from "drizzle-orm/pg-core";
var serviceTemplatesTable;
var init_serviceTemplates = __esm({
  "../../lib/db/src/schema/serviceTemplates.ts"() {
    "use strict";
    init_companies();
    serviceTemplatesTable = pgTable78("service_templates", {
      id: serial76("id").primaryKey(),
      companyId: integer71("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      serviceType: text77("service_type").notNull(),
      label: text77("label").notNull(),
      emoji: text77("emoji").notNull().default("\u{1F4CB}"),
      version: text77("version").notNull().default("1.0.0"),
      isActive: boolean36("is_active").notNull().default(true),
      description: text77("description"),
      sortOrder: integer71("sort_order").notNull().default(0),
      fields: jsonb24("fields").notNull().default([]),
      requiredDocuments: jsonb24("required_documents").notNull().default([]),
      checklist: jsonb24("checklist").notNull().default([]),
      conditionalRules: jsonb24("conditional_rules").notNull().default([]),
      validationRules: jsonb24("validation_rules").notNull().default([]),
      // ── Media Foundation ──────────────────────────────────────────────────────
      mediaAssets: jsonb24("media_assets").$type().notNull().default([]),
      createdAt: timestamp78("created_at").notNull().defaultNow(),
      updatedAt: timestamp78("updated_at").notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/purchaseMiniForm.ts
import { pgTable as pgTable79, serial as serial77, text as text78, integer as integer72, timestamp as timestamp79, jsonb as jsonb25 } from "drizzle-orm/pg-core";
var customerFeedbackLinksTable, purchaseMiniFormsTable;
var init_purchaseMiniForm = __esm({
  "../../lib/db/src/schema/purchaseMiniForm.ts"() {
    "use strict";
    customerFeedbackLinksTable = pgTable79("customer_feedback_links", {
      id: serial77("id").primaryKey(),
      token: text78("token").notNull().unique(),
      orderId: integer72("order_id"),
      orderNumber: text78("order_number"),
      customerName: text78("customer_name"),
      serviceType: text78("service_type"),
      completedAt: timestamp79("completed_at"),
      status: text78("status").notNull().default("pending"),
      rating: integer72("rating"),
      feedback: text78("feedback"),
      submittedAt: timestamp79("submitted_at"),
      createdAt: timestamp79("created_at").defaultNow().notNull(),
      createdBy: text78("created_by"),
      expiresAt: timestamp79("expires_at")
    });
    purchaseMiniFormsTable = pgTable79("purchase_mini_forms", {
      id: serial77("id").primaryKey(),
      token: text78("token").notNull().unique(),
      formType: text78("form_type").notNull(),
      refNumber: text78("ref_number"),
      title: text78("title"),
      notes: text78("notes"),
      targetName: text78("target_name"),
      currency: text78("currency").notNull().default("IDR"),
      payload: jsonb25("payload").notNull().default({}),
      status: text78("status").notNull().default("pending"),
      submissionData: jsonb25("submission_data").default({}),
      submittedAt: timestamp79("submitted_at"),
      orderId: integer72("order_id"),
      purchaseDocId: integer72("purchase_doc_id"),
      createdAt: timestamp79("created_at").defaultNow().notNull(),
      createdBy: text78("created_by"),
      expiresAt: timestamp79("expires_at")
    });
  }
});

// ../../lib/db/src/schema/rbac.ts
import { pgTable as pgTable80, serial as serial78, text as text79, timestamp as timestamp80, unique as unique4 } from "drizzle-orm/pg-core";
var rbacRolePermissionsTable;
var init_rbac = __esm({
  "../../lib/db/src/schema/rbac.ts"() {
    "use strict";
    rbacRolePermissionsTable = pgTable80("rbac_role_permissions", {
      id: serial78("id").primaryKey(),
      roleName: text79("role_name").notNull(),
      module: text79("module").notNull(),
      action: text79("action").notNull(),
      createdAt: timestamp80("created_at").defaultNow().notNull()
    }, (t) => [
      unique4("rbac_role_permissions_unique").on(t.roleName, t.module, t.action)
    ]);
  }
});

// ../../lib/db/src/schema/orderStatusHistory.ts
import {
  pgTable as pgTable81,
  serial as serial79,
  integer as integer73,
  text as text80,
  timestamp as timestamp81,
  index as index45
} from "drizzle-orm/pg-core";
var orderStatusHistoryTable;
var init_orderStatusHistory = __esm({
  "../../lib/db/src/schema/orderStatusHistory.ts"() {
    "use strict";
    init_logisticOrders();
    orderStatusHistoryTable = pgTable81("order_status_history", {
      id: serial79("id").primaryKey(),
      orderId: integer73("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      orderNumber: text80("order_number"),
      oldStatus: text80("old_status"),
      newStatus: text80("new_status").notNull(),
      changedByType: text80("changed_by_type").notNull().default("admin"),
      // admin | vendor | customer | driver | system
      changedById: text80("changed_by_id"),
      changedByName: text80("changed_by_name"),
      changedByIp: text80("changed_by_ip"),
      notes: text80("notes"),
      source: text80("source"),
      // route path / endpoint yang memicu perubahan
      createdAt: timestamp81("created_at").defaultNow().notNull()
    }, (t) => [
      index45("order_status_hist_order_idx").on(t.orderId),
      index45("order_status_hist_new_status_idx").on(t.newStatus),
      index45("order_status_hist_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/orderAuditLogs.ts
import {
  pgTable as pgTable82,
  serial as serial80,
  integer as integer74,
  text as text81,
  jsonb as jsonb26,
  timestamp as timestamp82,
  index as index46
} from "drizzle-orm/pg-core";
var orderAuditLogsTable;
var init_orderAuditLogs = __esm({
  "../../lib/db/src/schema/orderAuditLogs.ts"() {
    "use strict";
    init_logisticOrders();
    orderAuditLogsTable = pgTable82("order_audit_logs", {
      id: serial80("id").primaryKey(),
      orderId: integer74("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      orderNumber: text81("order_number"),
      rfqId: integer74("rfq_id"),
      actorType: text81("actor_type").notNull().default("admin"),
      // admin | vendor | customer | driver | system
      actorId: text81("actor_id"),
      actorName: text81("actor_name"),
      action: text81("action").notNull(),
      // order_created | status_changed | rfq_sent | vendor_confirmed | vendor_rejected
      // vendor_selected | customer_quoted | customer_approved | customer_rejected
      // customer_revision_requested | so_created | driver_assigned | pod_submitted
      // note_added | details_updated | cancelled | completed
      description: text81("description"),
      oldValue: jsonb26("old_value"),
      newValue: jsonb26("new_value"),
      ipAddress: text81("ip_address"),
      createdAt: timestamp82("created_at").defaultNow().notNull()
    }, (t) => [
      index46("order_audit_logs_order_idx").on(t.orderId),
      index46("order_audit_logs_rfq_idx").on(t.rfqId),
      index46("order_audit_logs_action_idx").on(t.action),
      index46("order_audit_logs_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/vendorQuoteHistory.ts
import {
  pgTable as pgTable83,
  serial as serial81,
  integer as integer75,
  text as text82,
  numeric as numeric40,
  timestamp as timestamp83,
  index as index47
} from "drizzle-orm/pg-core";
var vendorQuoteHistoryTable;
var init_vendorQuoteHistory = __esm({
  "../../lib/db/src/schema/vendorQuoteHistory.ts"() {
    "use strict";
    init_logisticOrders();
    init_suppliers();
    vendorQuoteHistoryTable = pgTable83("vendor_quote_history", {
      id: serial81("id").primaryKey(),
      orderId: integer75("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      orderNumber: text82("order_number"),
      rfqId: integer75("rfq_id").references(() => logisticOrderRfqsTable.id, { onDelete: "set null" }),
      rfqNumber: text82("rfq_number"),
      vendorId: integer75("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      vendorName: text82("vendor_name"),
      eventType: text82("event_type").notNull(),
      // rfq_blasted | quote_submitted | quote_revised | quote_approved | quote_rejected
      // quote_expired | vendor_selected | vendor_not_selected | vendor_confirmed | vendor_rejected
      oldStatus: text82("old_status"),
      newStatus: text82("new_status"),
      oldPrice: numeric40("old_price", { precision: 14, scale: 2 }),
      newPrice: numeric40("new_price", { precision: 14, scale: 2 }),
      changedByType: text82("changed_by_type").notNull().default("system"),
      changedById: text82("changed_by_id"),
      changedByName: text82("changed_by_name"),
      notes: text82("notes"),
      createdAt: timestamp83("created_at").defaultNow().notNull()
    }, (t) => [
      index47("vendor_quote_hist_order_idx").on(t.orderId),
      index47("vendor_quote_hist_rfq_idx").on(t.rfqId),
      index47("vendor_quote_hist_vendor_idx").on(t.vendorId),
      index47("vendor_quote_hist_event_idx").on(t.eventType),
      index47("vendor_quote_hist_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/customerApprovalHistory.ts
import {
  pgTable as pgTable84,
  serial as serial82,
  integer as integer76,
  text as text83,
  timestamp as timestamp84,
  index as index48
} from "drizzle-orm/pg-core";
var customerApprovalHistoryTable;
var init_customerApprovalHistory = __esm({
  "../../lib/db/src/schema/customerApprovalHistory.ts"() {
    "use strict";
    init_logisticOrders();
    customerApprovalHistoryTable = pgTable84("customer_approval_history", {
      id: serial82("id").primaryKey(),
      orderId: integer76("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
      orderNumber: text83("order_number"),
      rfqId: integer76("rfq_id"),
      eventType: text83("event_type").notNull(),
      // quotation_sent | quotation_opened | quotation_approved | quotation_revision_requested
      // quotation_rejected | order_confirmed | order_cancelled | quote_link_created
      oldStatus: text83("old_status"),
      newStatus: text83("new_status"),
      customerName: text83("customer_name"),
      customerEmail: text83("customer_email"),
      customerPhone: text83("customer_phone"),
      tokenUsed: text83("token_used"),
      response: text83("response"),
      // approve | revise | reject
      revisionNotes: text83("revision_notes"),
      rejectionReason: text83("rejection_reason"),
      actorType: text83("actor_type").notNull().default("customer"),
      actorId: text83("actor_id"),
      actorName: text83("actor_name"),
      ipAddress: text83("ip_address"),
      createdAt: timestamp84("created_at").defaultNow().notNull()
    }, (t) => [
      index48("customer_approval_hist_order_idx").on(t.orderId),
      index48("customer_approval_hist_event_idx").on(t.eventType),
      index48("customer_approval_hist_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/exceptions.ts
import { pgEnum as pgEnum23, pgTable as pgTable85, serial as serial83, integer as integer77, text as text84, timestamp as timestamp85, index as index49, jsonb as jsonb27 } from "drizzle-orm/pg-core";
var exceptionTypeEnum, exceptionStatusEnum, exceptionSeverityEnum, exceptionsTable;
var init_exceptions = __esm({
  "../../lib/db/src/schema/exceptions.ts"() {
    "use strict";
    init_companies();
    exceptionTypeEnum = pgEnum23("exception_type", [
      "order_rejected",
      "vendor_reject_rfq",
      "vendor_out_of_stock",
      "price_changed",
      "delivery_delayed",
      "failed_delivery",
      "customer_complaint",
      "document_missing",
      "payment_overdue",
      "vendor_rejected",
      "pod_pending_review"
    ]);
    exceptionStatusEnum = pgEnum23("exception_status", [
      "open",
      "in_progress",
      "resolved",
      "closed"
    ]);
    exceptionSeverityEnum = pgEnum23("exception_severity", [
      "low",
      "medium",
      "high",
      "critical"
    ]);
    exceptionsTable = pgTable85("exceptions", {
      id: serial83("id").primaryKey(),
      companyId: integer77("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      exceptionType: exceptionTypeEnum("exception_type").notNull(),
      severity: exceptionSeverityEnum("severity").notNull().default("medium"),
      status: exceptionStatusEnum("status").notNull().default("open"),
      title: text84("title").notNull(),
      description: text84("description"),
      refType: text84("ref_type"),
      refId: text84("ref_id"),
      refNumber: text84("ref_number"),
      customerName: text84("customer_name"),
      supplierName: text84("supplier_name"),
      assignedTo: text84("assigned_to"),
      resolvedBy: text84("resolved_by"),
      resolvedAt: timestamp85("resolved_at"),
      resolutionNotes: text84("resolution_notes"),
      reportedByType: text84("reported_by_type"),
      reportedById: text84("reported_by_id"),
      attachments: jsonb27("attachments").$type(),
      createdBy: text84("created_by"),
      createdAt: timestamp85("created_at").notNull().defaultNow(),
      updatedAt: timestamp85("updated_at").notNull().defaultNow()
    }, (t) => [
      index49("exc_company_idx").on(t.companyId),
      index49("exc_type_idx").on(t.exceptionType),
      index49("exc_status_idx").on(t.status),
      index49("exc_severity_idx").on(t.severity),
      index49("exc_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/cashAdvances.ts
import {
  pgTable as pgTable86,
  serial as serial84,
  text as text85,
  integer as integer78,
  numeric as numeric41,
  timestamp as timestamp86,
  date as date13,
  index as index50
} from "drizzle-orm/pg-core";
var cashAdvancesTable, cashAdvanceRepaymentsTable, cashAdvanceSettlementsTable;
var init_cashAdvances = __esm({
  "../../lib/db/src/schema/cashAdvances.ts"() {
    "use strict";
    init_accounting();
    cashAdvancesTable = pgTable86("cash_advances", {
      id: serial84("id").primaryKey(),
      companyId: integer78("company_id"),
      advanceNumber: text85("advance_number").notNull().unique(),
      type: text85("type").notNull(),
      // 'kasbon' | 'talangan'
      partyName: text85("party_name").notNull(),
      amount: numeric41("amount", { precision: 14, scale: 2 }).notNull(),
      paidAmount: numeric41("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      remainingAmount: numeric41("remaining_amount", { precision: 14, scale: 2 }).notNull(),
      paymentMethod: text85("payment_method").notNull().default("bank"),
      // 'cash' | 'bank'
      date: date13("date").notNull(),
      notes: text85("notes"),
      status: text85("status").notNull().default("active"),
      // 'active' | 'partial' | 'repaid'
      receivableAccountId: integer78("receivable_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      cashBankAccountId: integer78("cash_bank_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      vendorId: integer78("vendor_id"),
      userId: text85("user_id"),
      entryId: integer78("entry_id"),
      createdById: text85("created_by_id"),
      createdAt: timestamp86("created_at").defaultNow().notNull(),
      updatedAt: timestamp86("updated_at").defaultNow().notNull(),
      disbursedAt: timestamp86("disbursed_at"),
      repaidAt: timestamp86("repaid_at"),
      voidedAt: timestamp86("voided_at"),
      voidedBy: text85("voided_by"),
      voidReason: text85("void_reason"),
      reversalJournalId: integer78("reversal_journal_id"),
      repaymentJournalId: integer78("repayment_journal_id"),
      settledAmount: numeric41("settled_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      receiptUrl: text85("receipt_url"),
      ocrRawData: text85("ocr_raw_data"),
      // ── Payroll deduction plan (Cash Advance & Payroll Accounting Automation) ──
      repaymentMethod: text85("repayment_method").notNull().default("one_time"),
      // 'one_time' | 'installment'
      installmentCount: integer78("installment_count"),
      installmentAmount: numeric41("installment_amount", { precision: 14, scale: 2 }),
      postingStatus: text85("posting_status").notNull().default("posted"),
      // 'pending' | 'posted' | 'error'
      postingError: text85("posting_error"),
      accountingPaymentId: integer78("accounting_payment_id"),
      // ── Dana Talangan extended fields ──
      category: text85("category"),
      // e.g. Operasional, Pembayaran Vendor, ...
      categoryOther: text85("category_other"),
      // jika category='lainnya'
      purpose: text85("purpose"),
      // tujuan / keperluan dana
      fundingSourceType: text85("funding_source_type"),
      // kas_perusahaan | rekening_bank | perusahaan_lain | bank | pribadi | pihak_lain
      sourceCompanyId: integer78("source_company_id"),
      // untuk perusahaan_lain
      sourceBankName: text85("source_bank_name"),
      // untuk bank / rekening_bank (nama bank)
      sourcePartyName: text85("source_party_name"),
      // untuk pribadi / pihak_lain / perusahaan_lain manual
      responsiblePartyType: text85("responsible_party_type"),
      // perusahaan_aktif | perusahaan_lain | bank | vendor | karyawan | pihak_lain
      responsibleCompanyId: integer78("responsible_company_id"),
      responsibleBankName: text85("responsible_bank_name"),
      responsibleVendorId: integer78("responsible_vendor_id"),
      responsibleEmployeeId: text85("responsible_employee_id"),
      responsiblePartyName: text85("responsible_party_name"),
      // nama bebas untuk pihak_lain / manual
      referenceNumber: text85("reference_number")
      // no. dokumen / referensi
    }, (t) => [
      index50("cash_advances_company_idx").on(t.companyId),
      index50("cash_advances_type_idx").on(t.type),
      index50("cash_advances_status_idx").on(t.status),
      index50("cash_advances_date_idx").on(t.date)
    ]);
    cashAdvanceRepaymentsTable = pgTable86("cash_advance_repayments", {
      id: serial84("id").primaryKey(),
      advanceId: integer78("advance_id").notNull(),
      amount: numeric41("amount", { precision: 14, scale: 2 }).notNull(),
      paymentMethod: text85("payment_method").notNull().default("bank"),
      sourceAccountId: integer78("source_account_id"),
      date: date13("date").notNull(),
      notes: text85("notes"),
      receiptUrl: text85("receipt_url"),
      entryId: integer78("entry_id"),
      createdAt: timestamp86("created_at").defaultNow().notNull()
    });
    cashAdvanceSettlementsTable = pgTable86("cash_advance_settlements", {
      id: serial84("id").primaryKey(),
      advanceId: integer78("advance_id").notNull(),
      amount: numeric41("amount", { precision: 14, scale: 2 }).notNull(),
      expenseAccountId: integer78("expense_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      category: text85("category"),
      date: date13("date").notNull(),
      notes: text85("notes"),
      receiptUrl: text85("receipt_url"),
      entryId: integer78("entry_id"),
      createdAt: timestamp86("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/vendorInstallments.ts
import {
  pgTable as pgTable87,
  serial as serial85,
  text as text86,
  integer as integer79,
  numeric as numeric42,
  timestamp as timestamp87,
  date as date14,
  index as index51
} from "drizzle-orm/pg-core";
var vendorInstallmentsTable, vendorInstallmentPaymentsTable;
var init_vendorInstallments = __esm({
  "../../lib/db/src/schema/vendorInstallments.ts"() {
    "use strict";
    init_accounting();
    vendorInstallmentsTable = pgTable87("vendor_installments", {
      id: serial85("id").primaryKey(),
      companyId: integer79("company_id"),
      installmentNumber: text86("installment_number").notNull().unique(),
      vendorName: text86("vendor_name").notNull(),
      totalAmount: numeric42("total_amount", { precision: 14, scale: 2 }).notNull(),
      paidAmount: numeric42("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      remainingAmount: numeric42("remaining_amount", { precision: 14, scale: 2 }).notNull(),
      paymentMethod: text86("payment_method").notNull().default("bank"),
      // 'cash' | 'bank'
      date: date14("date").notNull(),
      reference: text86("reference"),
      notes: text86("notes"),
      status: text86("status").notNull().default("active"),
      // 'active' | 'partial' | 'paid'
      apAccountId: integer79("ap_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      cashBankAccountId: integer79("cash_bank_account_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      entryId: integer79("entry_id"),
      createdById: text86("created_by_id"),
      createdAt: timestamp87("created_at").defaultNow().notNull(),
      updatedAt: timestamp87("updated_at").defaultNow().notNull()
    }, (t) => [
      index51("vendor_installments_company_idx").on(t.companyId),
      index51("vendor_installments_status_idx").on(t.status),
      index51("vendor_installments_date_idx").on(t.date)
    ]);
    vendorInstallmentPaymentsTable = pgTable87("vendor_installment_payments", {
      id: serial85("id").primaryKey(),
      installmentId: integer79("installment_id").notNull(),
      amount: numeric42("amount", { precision: 14, scale: 2 }).notNull(),
      paymentMethod: text86("payment_method").notNull().default("bank"),
      date: date14("date").notNull(),
      reference: text86("reference"),
      notes: text86("notes"),
      entryId: integer79("entry_id"),
      createdAt: timestamp87("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/bankLoans.ts
import { pgTable as pgTable88, serial as serial86, integer as integer80, text as text87, numeric as numeric43, date as date15, timestamp as timestamp88 } from "drizzle-orm/pg-core";
var bankLoansTable, bankLoanPaymentsTable;
var init_bankLoans = __esm({
  "../../lib/db/src/schema/bankLoans.ts"() {
    "use strict";
    bankLoansTable = pgTable88("bank_loans", {
      id: serial86("id").primaryKey(),
      companyId: integer80("company_id"),
      loanNumber: text87("loan_number").notNull().unique(),
      loanType: text87("loan_type").notNull().default("bank"),
      // bank | leasing | other
      lenderName: text87("lender_name").notNull(),
      principalAmount: numeric43("principal_amount", { precision: 14, scale: 2 }).notNull(),
      outstandingAmount: numeric43("outstanding_amount", { precision: 14, scale: 2 }).notNull(),
      paidAmount: numeric43("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      paymentMethod: text87("payment_method").notNull().default("bank"),
      disbursementDate: date15("disbursement_date").notNull(),
      tenorMonths: integer80("tenor_months"),
      interestRate: numeric43("interest_rate", { precision: 7, scale: 4 }).default("0"),
      adminFee: numeric43("admin_fee", { precision: 14, scale: 2 }).default("0"),
      notes: text87("notes"),
      status: text87("status").notNull().default("active"),
      // active | partial | paid
      journalEntryId: integer80("journal_entry_id"),
      createdById: text87("created_by_id"),
      createdAt: timestamp88("created_at").defaultNow()
    });
    bankLoanPaymentsTable = pgTable88("bank_loan_payments", {
      id: serial86("id").primaryKey(),
      loanId: integer80("loan_id").notNull(),
      paymentDate: date15("payment_date").notNull(),
      principalAmount: numeric43("principal_amount", { precision: 14, scale: 2 }).notNull(),
      interestAmount: numeric43("interest_amount", { precision: 14, scale: 2 }).notNull().default("0"),
      totalAmount: numeric43("total_amount", { precision: 14, scale: 2 }).notNull(),
      paymentMethod: text87("payment_method").notNull().default("bank"),
      reference: text87("reference"),
      notes: text87("notes"),
      journalEntryId: integer80("journal_entry_id"),
      createdAt: timestamp88("created_at").defaultNow()
    });
  }
});

// ../../lib/db/src/schema/fixedAssets.ts
import { pgTable as pgTable89, serial as serial87, integer as integer81, text as text88, numeric as numeric44, date as date16, timestamp as timestamp89, boolean as boolean38 } from "drizzle-orm/pg-core";
var fixedAssetsTable, assetDepreciationRecordsTable;
var init_fixedAssets = __esm({
  "../../lib/db/src/schema/fixedAssets.ts"() {
    "use strict";
    fixedAssetsTable = pgTable89("fixed_assets", {
      id: serial87("id").primaryKey(),
      companyId: integer81("company_id"),
      assetNumber: text88("asset_number").notNull().unique(),
      assetName: text88("asset_name").notNull(),
      assetType: text88("asset_type").notNull().default("equipment"),
      // equipment | vehicle | building | land | other
      purchaseDate: date16("purchase_date").notNull(),
      purchasePrice: numeric44("purchase_price", { precision: 14, scale: 2 }).notNull(),
      usefulLifeMonths: integer81("useful_life_months").notNull().default(60),
      salvageValue: numeric44("salvage_value", { precision: 14, scale: 2 }).notNull().default("0"),
      depreciationMethod: text88("depreciation_method").notNull().default("straight_line"),
      // straight_line | declining_balance
      accumulatedDepreciation: numeric44("accumulated_depreciation", { precision: 14, scale: 2 }).notNull().default("0"),
      bookValue: numeric44("book_value", { precision: 14, scale: 2 }).notNull(),
      paymentMethod: text88("payment_method").notNull().default("bank"),
      notes: text88("notes"),
      taxRelated: boolean38("tax_related").notNull().default(false),
      isActive: boolean38("is_active").notNull().default(true),
      journalEntryId: integer81("journal_entry_id"),
      createdById: text88("created_by_id"),
      createdAt: timestamp89("created_at").defaultNow()
    });
    assetDepreciationRecordsTable = pgTable89("asset_depreciation_records", {
      id: serial87("id").primaryKey(),
      assetId: integer81("asset_id").notNull(),
      periodDate: date16("period_date").notNull(),
      // YYYY-MM-01
      depreciationAmount: numeric44("depreciation_amount", { precision: 14, scale: 2 }).notNull(),
      accumulatedAfter: numeric44("accumulated_after", { precision: 14, scale: 2 }).notNull(),
      bookValueAfter: numeric44("book_value_after", { precision: 14, scale: 2 }).notNull(),
      journalEntryId: integer81("journal_entry_id"),
      notes: text88("notes"),
      createdAt: timestamp89("created_at").defaultNow()
    });
  }
});

// ../../lib/db/src/schema/expenseApprovals.ts
import { pgTable as pgTable90, serial as serial88, integer as integer82, text as text89, numeric as numeric45, timestamp as timestamp90 } from "drizzle-orm/pg-core";
var expenseApprovalLimitsTable, expenseApprovalRequestsTable;
var init_expenseApprovals = __esm({
  "../../lib/db/src/schema/expenseApprovals.ts"() {
    "use strict";
    expenseApprovalLimitsTable = pgTable90("expense_approval_limits", {
      id: serial88("id").primaryKey(),
      companyId: integer82("company_id"),
      category: text89("category").notNull(),
      // kasbon | talangan | expense | bank_loan | vendor_installment
      userId: text89("user_id"),
      // NULL = berlaku global untuk kategori ini
      maxAutoApprove: numeric45("max_auto_approve", { precision: 14, scale: 2 }).notNull().default("0"),
      l1ApproverId: text89("l1_approver_id"),
      l2ApproverId: text89("l2_approver_id"),
      notes: text89("notes"),
      createdAt: timestamp90("created_at").defaultNow(),
      updatedAt: timestamp90("updated_at").defaultNow()
    });
    expenseApprovalRequestsTable = pgTable90("expense_approval_requests", {
      id: serial88("id").primaryKey(),
      companyId: integer82("company_id"),
      refType: text89("ref_type").notNull(),
      // kasbon | talangan | expense | bank_loan | vendor_installment
      refId: integer82("ref_id"),
      description: text89("description").notNull(),
      amount: numeric45("amount", { precision: 14, scale: 2 }).notNull(),
      requesterId: text89("requester_id"),
      requesterName: text89("requester_name"),
      status: text89("status").notNull().default("pending"),
      // pending | l1_approved | l2_approved | approved | rejected
      l1ApproverId: text89("l1_approver_id"),
      l1ApproverName: text89("l1_approver_name"),
      l1Status: text89("l1_status"),
      // pending | approved | rejected
      l1Notes: text89("l1_notes"),
      l1At: timestamp90("l1_at"),
      l2ApproverId: text89("l2_approver_id"),
      l2ApproverName: text89("l2_approver_name"),
      l2Status: text89("l2_status"),
      // pending | approved | rejected | skipped
      l2Notes: text89("l2_notes"),
      l2At: timestamp90("l2_at"),
      notes: text89("notes"),
      createdAt: timestamp90("created_at").defaultNow(),
      updatedAt: timestamp90("updated_at").defaultNow()
    });
  }
});

// ../../lib/db/src/schema/productMedia.ts
import { pgTable as pgTable91, serial as serial89, integer as integer83, text as text90, boolean as boolean40, timestamp as timestamp91 } from "drizzle-orm/pg-core";
var productMediaTable;
var init_productMedia = __esm({
  "../../lib/db/src/schema/productMedia.ts"() {
    "use strict";
    init_suppliers();
    productMediaTable = pgTable91("product_media", {
      id: serial89("id").primaryKey(),
      vendorCatalogItemId: integer83("vendor_catalog_item_id").references(() => vendorCatalogItemsTable.id, { onDelete: "cascade" }),
      vendorId: integer83("vendor_id"),
      mediaType: text90("media_type").notNull().default("image"),
      fileUrl: text90("file_url"),
      thumbnailUrl: text90("thumbnail_url"),
      externalUrl: text90("external_url"),
      title: text90("title"),
      description: text90("description"),
      sortOrder: integer83("sort_order").notNull().default(0),
      isPrimary: boolean40("is_primary").notNull().default(false),
      isActive: boolean40("is_active").notNull().default(true),
      uploadedBy: text90("uploaded_by"),
      uploadedByRole: text90("uploaded_by_role"),
      storagePath: text90("storage_path"),
      imageSource: text90("image_source").default("admin"),
      aiImageStatus: text90("ai_image_status"),
      generationPrompt: text90("generation_prompt"),
      duration: integer83("duration"),
      fileSizeBytes: integer83("file_size_bytes"),
      documentType: text90("document_type"),
      visibility: text90("visibility").default("public"),
      originalFilename: text90("original_filename"),
      createdAt: timestamp91("created_at").defaultNow().notNull(),
      updatedAt: timestamp91("updated_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/vendorCatalogEngine.ts
import {
  pgTable as pgTable92,
  serial as serial90,
  integer as integer84,
  text as text91,
  boolean as boolean41,
  timestamp as timestamp92,
  jsonb as jsonb28,
  numeric as numeric46,
  index as index52
} from "drizzle-orm/pg-core";
var vendorCatalogSubmissionLinksTable, vendorCatalogSubmissionsTable;
var init_vendorCatalogEngine = __esm({
  "../../lib/db/src/schema/vendorCatalogEngine.ts"() {
    "use strict";
    init_suppliers();
    vendorCatalogSubmissionLinksTable = pgTable92("vendor_catalog_submission_links", {
      id: serial90("id").primaryKey(),
      token: text91("token").notNull().unique(),
      tokenHash: text91("token_hash"),
      // P0 — HMAC-SHA256 hash; NULL for legacy tokens
      supplierId: integer84("supplier_id").references(() => suppliersTable.id, { onDelete: "cascade" }).notNull(),
      vendorName: text91("vendor_name"),
      title: text91("title"),
      notes: text91("notes"),
      categoryKey: text91("category_key"),
      serviceType: text91("service_type"),
      templateKind: text91("template_kind"),
      templateId: text91("template_id"),
      templateVersion: text91("template_version"),
      templateSnapshot: jsonb28("template_snapshot").$type(),
      isActive: boolean41("is_active").notNull().default(true),
      expiresAt: timestamp92("expires_at"),
      maxSubmissions: integer84("max_submissions"),
      submissionCount: integer84("submission_count").notNull().default(0),
      createdAt: timestamp92("created_at").defaultNow().notNull(),
      createdBy: text91("created_by")
    }, (t) => [
      index52("vcsl_supplier_idx").on(t.supplierId)
    ]);
    vendorCatalogSubmissionsTable = pgTable92("vendor_catalog_submissions", {
      id: serial90("id").primaryKey(),
      linkId: integer84("link_id").references(() => vendorCatalogSubmissionLinksTable.id, { onDelete: "set null" }),
      token: text91("token").notNull().unique(),
      supplierId: integer84("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      vendorName: text91("vendor_name"),
      // ── Template / spec ────────────────────────────────────────────────────────
      categoryKey: text91("category_key"),
      serviceType: text91("service_type"),
      templateKind: text91("template_kind"),
      templateId: text91("template_id"),
      templateVersion: text91("template_version"),
      templateSnapshot: jsonb28("template_snapshot").$type(),
      specValues: jsonb28("spec_values").$type(),
      // ── Item info ──────────────────────────────────────────────────────────────
      name: text91("name").notNull(),
      description: text91("description"),
      unit: text91("unit"),
      // ── Media ──────────────────────────────────────────────────────────────────
      mediaAssets: jsonb28("media_assets").$type().notNull().default([]),
      // ── Pricing ────────────────────────────────────────────────────────────────
      priceBase: numeric46("price_base", { precision: 15, scale: 2 }).notNull().default("0"),
      currency: text91("currency").notNull().default("IDR"),
      // ── Availability ──────────────────────────────────────────────────────────
      stockStatus: text91("stock_status"),
      stockQty: numeric46("stock_qty", { precision: 15, scale: 3 }),
      leadTime: text91("lead_time"),
      validityDate: text91("validity_date"),
      location: text91("location"),
      origin: text91("origin"),
      // ── Review flow ───────────────────────────────────────────────────────────
      // status: submitted | approved | rejected
      status: text91("status").notNull().default("submitted"),
      catalogItemId: integer84("catalog_item_id"),
      // set after approval
      reviewedBy: text91("reviewed_by"),
      reviewedAt: timestamp92("reviewed_at"),
      reviewNotes: text91("review_notes"),
      submittedAt: timestamp92("submitted_at").defaultNow().notNull(),
      createdAt: timestamp92("created_at").defaultNow().notNull(),
      updatedAt: timestamp92("updated_at").defaultNow()
    }, (t) => [
      index52("vcs_supplier_idx").on(t.supplierId),
      index52("vcs_status_idx").on(t.status),
      index52("vcs_link_idx").on(t.linkId)
    ]);
  }
});

// ../../lib/db/src/schema/logisticVendorFulfillments.ts
import {
  pgTable as pgTable93,
  serial as serial91,
  integer as integer85,
  text as text92,
  jsonb as jsonb29,
  timestamp as timestamp93,
  uniqueIndex as uniqueIndex16
} from "drizzle-orm/pg-core";
var logisticVendorFulfillmentsTable;
var init_logisticVendorFulfillments = __esm({
  "../../lib/db/src/schema/logisticVendorFulfillments.ts"() {
    "use strict";
    init_logisticOrders();
    init_suppliers();
    logisticVendorFulfillmentsTable = pgTable93(
      "logistic_vendor_fulfillments",
      {
        id: serial91("id").primaryKey(),
        orderId: integer85("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
        orderItemId: integer85("order_item_id").notNull().references(() => logisticOrderItemsTable.id, { onDelete: "cascade" }),
        vendorCatalogItemId: integer85("vendor_catalog_item_id").notNull(),
        vendorId: integer85("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
        serviceType: text92("service_type"),
        status: text92("status").notNull().default("pending"),
        // pending | confirmed | in_progress | completed | cancelled
        vendorPoId: integer85("vendor_po_id"),
        fulfillmentPayload: jsonb29("fulfillment_payload"),
        calculationInput: jsonb29("calculation_input"),
        templateSnapshot: jsonb29("template_snapshot"),
        priceSnapshot: jsonb29("price_snapshot"),
        adminNotes: text92("admin_notes"),
        createdAt: timestamp93("created_at").defaultNow().notNull(),
        updatedAt: timestamp93("updated_at").defaultNow().notNull()
      },
      (t) => [
        uniqueIndex16("lvf_order_item_uidx").on(t.orderItemId)
      ]
    );
  }
});

// ../../lib/db/src/schema/airFreight.ts
import {
  pgTable as pgTable94,
  serial as serial92,
  text as text93,
  numeric as numeric47,
  integer as integer86,
  jsonb as jsonb30,
  timestamp as timestamp94,
  boolean as boolean42,
  date as date17,
  index as index53
} from "drizzle-orm/pg-core";
var airFreightOrdersTable, airFreightDimensionsTable, airFreightRfqsTable, airFreightRateSubmissionsTable, airFreightRatesTable;
var init_airFreight = __esm({
  "../../lib/db/src/schema/airFreight.ts"() {
    "use strict";
    init_suppliers();
    init_companies();
    airFreightOrdersTable = pgTable94("air_freight_orders", {
      id: serial92("id").primaryKey(),
      orderNumber: text93("order_number").notNull().unique(),
      companyId: integer86("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      customerName: text93("customer_name").notNull(),
      customerEmail: text93("customer_email"),
      customerPhone: text93("customer_phone"),
      customerCompany: text93("customer_company"),
      originAirport: text93("origin_airport").notNull(),
      destAirport: text93("dest_airport").notNull(),
      tradeType: text93("trade_type").notNull().default("export"),
      cargoType: text93("cargo_type").notNull().default("general"),
      commodity: text93("commodity"),
      pieces: integer86("pieces"),
      packingType: text93("packing_type"),
      grossWeight: numeric47("gross_weight", { precision: 12, scale: 3 }),
      volumetricWeight: numeric47("volumetric_weight", { precision: 12, scale: 3 }),
      chargeableWeight: numeric47("chargeable_weight", { precision: 12, scale: 3 }),
      volumeCbm: numeric47("volume_cbm", { precision: 12, scale: 3 }),
      incoterm: text93("incoterm"),
      etdRequested: text93("etd_requested"),
      additionalServices: text93("additional_services").array(),
      specialInstructions: text93("special_instructions"),
      notes: text93("notes"),
      estimatedPrice: numeric47("estimated_price", { precision: 14, scale: 2 }),
      selectedRfqSubmissionId: integer86("selected_rfq_submission_id"),
      finalRatePerKg: numeric47("final_rate_per_kg", { precision: 12, scale: 2 }),
      fuelSurcharge: numeric47("fuel_surcharge", { precision: 12, scale: 2 }),
      securitySurcharge: numeric47("security_surcharge", { precision: 12, scale: 2 }),
      awbFee: numeric47("awb_fee", { precision: 12, scale: 2 }),
      handlingFee: numeric47("handling_fee", { precision: 12, scale: 2 }),
      xrayFee: numeric47("xray_fee", { precision: 12, scale: 2 }),
      docFee: numeric47("doc_fee", { precision: 12, scale: 2 }),
      customsClearanceFee: numeric47("customs_clearance_fee", { precision: 12, scale: 2 }),
      pickupTrucking: numeric47("pickup_trucking", { precision: 12, scale: 2 }),
      deliveryTrucking: numeric47("delivery_trucking", { precision: 12, scale: 2 }),
      cargoSurcharge: numeric47("cargo_surcharge", { precision: 12, scale: 2 }),
      markupAmount: numeric47("markup_amount", { precision: 12, scale: 2 }),
      ppnPct: numeric47("ppn_pct", { precision: 5, scale: 2 }).default("11"),
      ppnAmount: numeric47("ppn_amount", { precision: 14, scale: 2 }),
      subtotal: numeric47("subtotal", { precision: 14, scale: 2 }).default("0"),
      grandTotal: numeric47("grand_total", { precision: 14, scale: 2 }).default("0"),
      airline: text93("airline"),
      flightNumber: text93("flight_number"),
      etd: text93("etd"),
      eta: text93("eta"),
      transitDays: integer86("transit_days"),
      awbNumber: text93("awb_number"),
      trackingNotes: text93("tracking_notes"),
      status: text93("status").notNull().default("inquiry"),
      adminQuoteAttachmentUrl: text93("admin_quote_attachment_url"),
      quoteToken: text93("quote_token").unique(),
      quoteSentAt: timestamp94("quote_sent_at", { withTimezone: true }),
      bookingConfirmedAt: timestamp94("booking_confirmed_at", { withTimezone: true }),
      approvedVendorId: integer86("approved_vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      createdAt: timestamp94("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp94("updated_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      companyStatusIdx: index53("afr_orders_company_status_idx").on(t.companyId, t.status),
      statusIdx: index53("afr_orders_status_idx").on(t.status)
    }));
    airFreightDimensionsTable = pgTable94("air_freight_dimensions", {
      id: serial92("id").primaryKey(),
      orderId: integer86("order_id").notNull().references(() => airFreightOrdersTable.id, { onDelete: "cascade" }),
      length: numeric47("length", { precision: 10, scale: 2 }),
      width: numeric47("width", { precision: 10, scale: 2 }),
      height: numeric47("height", { precision: 10, scale: 2 }),
      pieces: integer86("pieces").default(1),
      grossWeight: numeric47("gross_weight", { precision: 10, scale: 3 }),
      volumetricWeight: numeric47("volumetric_weight", { precision: 10, scale: 3 }),
      createdAt: timestamp94("created_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      orderIdx: index53("afr_dimensions_order_idx").on(t.orderId)
    }));
    airFreightRfqsTable = pgTable94("air_freight_rfqs", {
      id: serial92("id").primaryKey(),
      orderId: integer86("order_id").notNull().references(() => airFreightOrdersTable.id, { onDelete: "cascade" }),
      rfqNumber: text93("rfq_number").notNull().unique(),
      blastVendorIds: integer86("blast_vendor_ids").array(),
      blastCount: integer86("blast_count").default(0),
      responseDeadline: timestamp94("response_deadline", { withTimezone: true }),
      status: text93("status").notNull().default("open"),
      blastNotes: text93("blast_notes"),
      blastAt: timestamp94("blast_at", { withTimezone: true }),
      createdAt: timestamp94("created_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      orderIdx: index53("afr_rfqs_order_idx").on(t.orderId)
    }));
    airFreightRateSubmissionsTable = pgTable94("air_freight_rate_submissions", {
      id: serial92("id").primaryKey(),
      rfqId: integer86("rfq_id").notNull().references(() => airFreightRfqsTable.id, { onDelete: "cascade" }),
      orderId: integer86("order_id").notNull().references(() => airFreightOrdersTable.id, { onDelete: "cascade" }),
      vendorId: integer86("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      vendorName: text93("vendor_name"),
      token: text93("token").notNull().unique(),
      airline: text93("airline"),
      flightNumber: text93("flight_number"),
      etd: text93("etd"),
      eta: text93("eta"),
      transitDays: integer86("transit_days"),
      isDirect: boolean42("is_direct").default(true),
      currency: text93("currency").default("IDR"),
      exchangeRate: numeric47("exchange_rate", { precision: 12, scale: 4 }).default("1"),
      ratePerKg: numeric47("rate_per_kg", { precision: 12, scale: 2 }),
      weightBreakRates: jsonb30("weight_break_rates"),
      fuelSurcharge: numeric47("fuel_surcharge", { precision: 12, scale: 2 }).default("0"),
      securitySurcharge: numeric47("security_surcharge", { precision: 12, scale: 2 }).default("0"),
      awbFee: numeric47("awb_fee", { precision: 12, scale: 2 }).default("0"),
      handlingFee: numeric47("handling_fee", { precision: 12, scale: 2 }).default("0"),
      xrayFee: numeric47("xray_fee", { precision: 12, scale: 2 }).default("0"),
      docFee: numeric47("doc_fee", { precision: 12, scale: 2 }).default("0"),
      customsClearanceFee: numeric47("customs_clearance_fee", { precision: 12, scale: 2 }).default("0"),
      pickupTrucking: numeric47("pickup_trucking", { precision: 12, scale: 2 }).default("0"),
      deliveryTrucking: numeric47("delivery_trucking", { precision: 12, scale: 2 }).default("0"),
      cargoSurcharge: numeric47("cargo_surcharge", { precision: 12, scale: 2 }).default("0"),
      otherFees: jsonb30("other_fees"),
      totalIDR: numeric47("total_idr", { precision: 14, scale: 2 }),
      validityDate: text93("validity_date"),
      notes: text93("notes"),
      attachmentUrl: text93("attachment_url"),
      status: text93("status").notNull().default("pending"),
      submittedAt: timestamp94("submitted_at", { withTimezone: true }),
      submitterIp: text93("submitter_ip"),
      formOpenedAt: timestamp94("form_opened_at", { withTimezone: true }),
      isActive: boolean42("is_active").default(true).notNull(),
      createdAt: timestamp94("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp94("updated_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      rfqIdx: index53("afr_submissions_rfq_idx").on(t.rfqId),
      orderIdx: index53("afr_submissions_order_idx").on(t.orderId)
    }));
    airFreightRatesTable = pgTable94("air_freight_rates", {
      id: serial92("id").primaryKey(),
      rateSourceType: text93("rate_source_type").notNull().default("agent"),
      rateSourceName: text93("rate_source_name").notNull().default(""),
      airline: text93("airline").notNull().default(""),
      originCity: text93("origin_city").notNull().default(""),
      originAirport: text93("origin_airport").notNull().default(""),
      destinationCity: text93("destination_city").notNull().default(""),
      destinationAirport: text93("destination_airport").notNull().default(""),
      tradeType: text93("trade_type").notNull().default("export"),
      serviceMode: text93("service_mode").notNull().default("door_to_door"),
      serviceLevel: text93("service_level").notNull().default("standard"),
      currency: text93("currency").notNull().default("IDR"),
      exchangeRateToIdr: numeric47("exchange_rate_to_idr", { precision: 15, scale: 4 }).notNull().default("1"),
      rateMinimum: numeric47("rate_minimum", { precision: 15, scale: 2 }),
      rate45: numeric47("rate_45", { precision: 15, scale: 2 }),
      rate100: numeric47("rate_100", { precision: 15, scale: 2 }),
      rate250: numeric47("rate_250", { precision: 15, scale: 2 }),
      rate300: numeric47("rate_300", { precision: 15, scale: 2 }),
      rate500: numeric47("rate_500", { precision: 15, scale: 2 }),
      rate1000: numeric47("rate_1000", { precision: 15, scale: 2 }),
      fuelSurchargePerKg: numeric47("fuel_surcharge_per_kg", { precision: 15, scale: 2 }).notNull().default("0"),
      securitySurchargePerKg: numeric47("security_surcharge_per_kg", { precision: 15, scale: 2 }).notNull().default("0"),
      xrayFee: numeric47("xray_fee", { precision: 15, scale: 2 }).notNull().default("0"),
      awbFee: numeric47("awb_fee", { precision: 15, scale: 2 }).notNull().default("0"),
      handlingFee: numeric47("handling_fee", { precision: 15, scale: 2 }).notNull().default("0"),
      docFee: numeric47("doc_fee", { precision: 15, scale: 2 }).notNull().default("0"),
      ediFee: numeric47("edi_fee", { precision: 15, scale: 2 }).notNull().default("0"),
      customsClearanceFee: numeric47("customs_clearance_fee", { precision: 15, scale: 2 }).notNull().default("0"),
      pickupTruckingEstimate: numeric47("pickup_trucking_estimate", { precision: 15, scale: 2 }).notNull().default("0"),
      deliveryTruckingEstimate: numeric47("delivery_trucking_estimate", { precision: 15, scale: 2 }).notNull().default("0"),
      insurancePercent: numeric47("insurance_percent", { precision: 8, scale: 4 }).notNull().default("0"),
      dgSurchargePercent: numeric47("dg_surcharge_percent", { precision: 8, scale: 4 }).notNull().default("0"),
      perishableSurchargePercent: numeric47("perishable_surcharge_percent", { precision: 8, scale: 4 }).notNull().default("0"),
      liveAnimalSurchargePercent: numeric47("live_animal_surcharge_percent", { precision: 8, scale: 4 }).notNull().default("0"),
      valuableSurchargePercent: numeric47("valuable_surcharge_percent", { precision: 8, scale: 4 }).notNull().default("0"),
      oversizeSurchargePercent: numeric47("oversize_surcharge_percent", { precision: 8, scale: 4 }).notNull().default("0"),
      coldChainSurcharge: numeric47("cold_chain_surcharge", { precision: 15, scale: 2 }).notNull().default("0"),
      peakSeasonSurcharge: numeric47("peak_season_surcharge", { precision: 15, scale: 2 }).notNull().default("0"),
      minimumCharge: numeric47("minimum_charge", { precision: 15, scale: 2 }).notNull().default("0"),
      transitDays: integer86("transit_days"),
      flightNumber: text93("flight_number"),
      etd: text93("etd"),
      eta: text93("eta"),
      routingType: text93("routing_type").notNull().default("direct"),
      cargoType: text93("cargo_type").notNull().default("general"),
      validFrom: date17("valid_from").notNull(),
      validUntil: date17("valid_until").notNull(),
      priceStatus: text93("price_status").notNull().default("active"),
      isActive: boolean42("is_active").notNull().default(true),
      companyId: integer86("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      createdBy: text93("created_by"),
      createdAt: timestamp94("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp94("updated_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      routeIdx: index53("afr_rates_route_idx").on(t.originAirport, t.destinationAirport),
      activeIdx: index53("afr_rates_active_idx").on(t.isActive, t.validFrom, t.validUntil)
    }));
  }
});

// ../../lib/db/src/schema/oceanFreight.ts
import {
  pgTable as pgTable95,
  serial as serial93,
  text as text94,
  numeric as numeric48,
  integer as integer87,
  jsonb as jsonb31,
  timestamp as timestamp95,
  boolean as boolean43,
  index as index54
} from "drizzle-orm/pg-core";
var oceanFreightRatesTable, oceanFreightOrdersTable, oceanFreightRfqsTable, oceanFreightRateSubmissionsTable;
var init_oceanFreight = __esm({
  "../../lib/db/src/schema/oceanFreight.ts"() {
    "use strict";
    init_suppliers();
    init_companies();
    oceanFreightRatesTable = pgTable95("ocean_freight_rates", {
      id: serial93("id").primaryKey(),
      rateCode: text94("rate_code"),
      rateSourceType: text94("rate_source_type").notNull().default("shipping_line"),
      rateSourceName: text94("rate_source_name").notNull().default(""),
      vendorId: integer87("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      carrierName: text94("carrier_name"),
      originCity: text94("origin_city").notNull().default(""),
      originPort: text94("origin_port").notNull().default(""),
      destinationCity: text94("destination_city").notNull().default(""),
      destinationPort: text94("destination_port").notNull().default(""),
      tradeType: text94("trade_type").notNull().default("export"),
      shipmentType: text94("shipment_type").notNull().default("FCL"),
      serviceMode: text94("service_mode").notNull().default("port_to_port"),
      containerType: text94("container_type"),
      currency: text94("currency").notNull().default("USD"),
      exchangeRateToIdr: numeric48("exchange_rate_to_idr", { precision: 15, scale: 4 }).default("16500"),
      oceanFreightAmount: numeric48("ocean_freight_amount", { precision: 15, scale: 2 }).default("0"),
      lclRatePerCbm: numeric48("lcl_rate_per_cbm", { precision: 15, scale: 2 }),
      lclMinimumCbm: numeric48("lcl_minimum_cbm", { precision: 10, scale: 2 }),
      thcOrigin: numeric48("thc_origin", { precision: 12, scale: 2 }).default("0"),
      thcDestination: numeric48("thc_destination", { precision: 12, scale: 2 }).default("0"),
      docFee: numeric48("doc_fee", { precision: 12, scale: 2 }).default("0"),
      blFee: numeric48("bl_fee", { precision: 12, scale: 2 }).default("0"),
      doFee: numeric48("do_fee", { precision: 12, scale: 2 }).default("0"),
      handlingFee: numeric48("handling_fee", { precision: 12, scale: 2 }).default("0"),
      customsClearanceFee: numeric48("customs_clearance_fee", { precision: 12, scale: 2 }).default("0"),
      truckingPickupEstimate: numeric48("trucking_pickup_estimate", { precision: 12, scale: 2 }).default("0"),
      truckingDeliveryEstimate: numeric48("trucking_delivery_estimate", { precision: 12, scale: 2 }).default("0"),
      insurancePercent: numeric48("insurance_percent", { precision: 8, scale: 4 }).default("0"),
      dgSurchargePercent: numeric48("dg_surcharge_percent", { precision: 8, scale: 4 }).default("0"),
      reeferSurcharge: numeric48("reefer_surcharge", { precision: 12, scale: 2 }).default("0"),
      peakSeasonSurcharge: numeric48("peak_season_surcharge", { precision: 12, scale: 2 }).default("0"),
      emergencyBunkerSurcharge: numeric48("emergency_bunker_surcharge", { precision: 12, scale: 2 }).default("0"),
      currencyAdjustmentFactor: numeric48("currency_adjustment_factor", { precision: 12, scale: 2 }).default("0"),
      validFrom: text94("valid_from").notNull(),
      validUntil: text94("valid_until").notNull(),
      transitDays: integer87("transit_days"),
      carrier: text94("carrier"),
      vesselName: text94("vessel_name"),
      voyage: text94("voyage"),
      directOrTransshipment: text94("direct_or_transshipment").notNull().default("direct"),
      priceStatus: text94("price_status").notNull().default("estimate"),
      notes: text94("notes"),
      isActive: boolean43("is_active").notNull().default(true),
      companyId: integer87("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      createdAt: timestamp95("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp95("updated_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      routeIdx: index54("ofr_rates_route_idx").on(t.originPort, t.destinationPort, t.shipmentType),
      activeIdx: index54("ofr_rates_active_idx").on(t.isActive, t.validFrom, t.validUntil)
    }));
    oceanFreightOrdersTable = pgTable95("ocean_freight_orders", {
      id: serial93("id").primaryKey(),
      orderNumber: text94("order_number").notNull().unique(),
      companyId: integer87("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      customerId: integer87("customer_id"),
      customerName: text94("customer_name").notNull().default(""),
      customerPhone: text94("customer_phone"),
      customerEmail: text94("customer_email"),
      customerCompany: text94("customer_company"),
      originCity: text94("origin_city").notNull().default(""),
      originPort: text94("origin_port").notNull().default(""),
      destinationCity: text94("destination_city").notNull().default(""),
      destinationPort: text94("destination_port").notNull().default(""),
      tradeType: text94("trade_type").notNull().default("export"),
      serviceMode: text94("service_mode").notNull().default("port_to_port"),
      shipmentType: text94("shipment_type").notNull().default("FCL"),
      containerType: text94("container_type"),
      containerQty: integer87("container_qty"),
      totalCbm: numeric48("total_cbm", { precision: 12, scale: 3 }),
      grossWeight: numeric48("gross_weight", { precision: 12, scale: 3 }),
      koli: integer87("koli"),
      commodity: text94("commodity").notNull().default("General Cargo"),
      hsCode: text94("hs_code"),
      cargoValue: numeric48("cargo_value", { precision: 14, scale: 2 }),
      cargoCondition: text94("cargo_condition").notNull().default("general"),
      incoterm: text94("incoterm"),
      etdPreferred: text94("etd_preferred"),
      etaTarget: text94("eta_target"),
      selectedAdditionalServices: jsonb31("selected_additional_services"),
      selectedEstimateOption: text94("selected_estimate_option"),
      estimatedPrice: numeric48("estimated_price", { precision: 14, scale: 2 }),
      estimatedPriceIdr: numeric48("estimated_price_idr", { precision: 14, scale: 2 }),
      currency: text94("currency").default("IDR"),
      pricingBreakdown: jsonb31("pricing_breakdown"),
      selectedRateId: integer87("selected_rate_id"),
      candidateRateIds: jsonb31("candidate_rate_ids"),
      finalRateId: integer87("final_rate_id"),
      finalPrice: numeric48("final_price", { precision: 14, scale: 2 }),
      finalPriceIdr: numeric48("final_price_idr", { precision: 14, scale: 2 }),
      markupAmount: numeric48("markup_amount", { precision: 14, scale: 2 }),
      ppnAmount: numeric48("ppn_amount", { precision: 14, scale: 2 }),
      grandTotal: numeric48("grand_total", { precision: 14, scale: 2 }),
      finalBreakdown: jsonb31("final_breakdown"),
      adminNotes: text94("admin_notes"),
      customerNotes: text94("customer_notes"),
      priceStatus: text94("price_status").notNull().default("estimate"),
      status: text94("status").notNull().default("waiting_rate"),
      source: text94("source").notNull().default("customer_portal"),
      // Booking fields
      bookingNumber: text94("booking_number"),
      carrier: text94("carrier"),
      vesselName: text94("vessel_name"),
      voyage: text94("voyage"),
      etd: text94("etd"),
      eta: text94("eta"),
      pol: text94("pol"),
      pod: text94("pod"),
      containerNumber: text94("container_number"),
      sealNumber: text94("seal_number"),
      blNumber: text94("bl_number"),
      bookingConfirmationUrl: text94("booking_confirmation_url"),
      adminQuoteAttachmentUrl: text94("admin_quote_attachment_url"),
      // Quote flow
      quoteToken: text94("quote_token").unique(),
      quoteSentAt: timestamp95("quote_sent_at", { withTimezone: true }),
      bookingConfirmedAt: timestamp95("booking_confirmed_at", { withTimezone: true }),
      // Tracking status (post-booking)
      trackingStatus: text94("tracking_status"),
      createdAt: timestamp95("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp95("updated_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      statusIdx: index54("ofo_orders_status_idx").on(t.status),
      companyIdx: index54("ofo_orders_company_idx").on(t.companyId, t.status)
    }));
    oceanFreightRfqsTable = pgTable95("ocean_freight_rfqs", {
      id: serial93("id").primaryKey(),
      orderId: integer87("order_id").notNull().references(() => oceanFreightOrdersTable.id, { onDelete: "cascade" }),
      rfqNumber: text94("rfq_number").notNull().unique(),
      blastVendorIds: integer87("blast_vendor_ids").array(),
      blastCount: integer87("blast_count").default(0),
      responseDeadline: timestamp95("response_deadline", { withTimezone: true }),
      status: text94("status").notNull().default("open"),
      blastNotes: text94("blast_notes"),
      blastAt: timestamp95("blast_at", { withTimezone: true }),
      createdAt: timestamp95("created_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      orderIdx: index54("ofo_rfqs_order_idx").on(t.orderId)
    }));
    oceanFreightRateSubmissionsTable = pgTable95("ocean_freight_rate_submissions", {
      id: serial93("id").primaryKey(),
      rfqId: integer87("rfq_id").notNull().references(() => oceanFreightRfqsTable.id, { onDelete: "cascade" }),
      orderId: integer87("order_id").notNull().references(() => oceanFreightOrdersTable.id, { onDelete: "cascade" }),
      vendorId: integer87("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      vendorName: text94("vendor_name"),
      token: text94("token").notNull().unique(),
      rateSourceType: text94("rate_source_type").default("forwarder_partner"),
      rateSourceName: text94("rate_source_name"),
      carrier: text94("carrier"),
      oceanFreightAmount: numeric48("ocean_freight_amount", { precision: 15, scale: 2 }),
      currency: text94("currency").default("USD"),
      exchangeRate: numeric48("exchange_rate", { precision: 12, scale: 4 }).default("16500"),
      validityDate: text94("validity_date"),
      vesselName: text94("vessel_name"),
      voyage: text94("voyage"),
      etd: text94("etd"),
      eta: text94("eta"),
      transitDays: integer87("transit_days"),
      directOrTransshipment: text94("direct_or_transshipment").default("direct"),
      thcOrigin: numeric48("thc_origin", { precision: 12, scale: 2 }).default("0"),
      thcDestination: numeric48("thc_destination", { precision: 12, scale: 2 }).default("0"),
      docFee: numeric48("doc_fee", { precision: 12, scale: 2 }).default("0"),
      blFee: numeric48("bl_fee", { precision: 12, scale: 2 }).default("0"),
      doFee: numeric48("do_fee", { precision: 12, scale: 2 }).default("0"),
      handlingFee: numeric48("handling_fee", { precision: 12, scale: 2 }).default("0"),
      truckingPickup: numeric48("trucking_pickup", { precision: 12, scale: 2 }).default("0"),
      truckingDelivery: numeric48("trucking_delivery", { precision: 12, scale: 2 }).default("0"),
      customsClearanceFee: numeric48("customs_clearance_fee", { precision: 12, scale: 2 }).default("0"),
      surchargeAmount: numeric48("surcharge_amount", { precision: 12, scale: 2 }).default("0"),
      notes: text94("notes"),
      attachmentUrl: text94("attachment_url"),
      totalAmount: numeric48("total_amount", { precision: 14, scale: 2 }),
      totalAmountIdr: numeric48("total_amount_idr", { precision: 14, scale: 2 }),
      status: text94("status").notNull().default("pending"),
      isActive: boolean43("is_active").default(true).notNull(),
      submittedAt: timestamp95("submitted_at", { withTimezone: true }),
      formOpenedAt: timestamp95("form_opened_at", { withTimezone: true }),
      submitterIp: text94("submitter_ip"),
      createdAt: timestamp95("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp95("updated_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => ({
      rfqIdx: index54("ofo_submissions_rfq_idx").on(t.rfqId),
      orderIdx: index54("ofo_submissions_order_idx").on(t.orderId)
    }));
  }
});

// ../../lib/db/src/schema/freightMasterData.ts
import {
  pgTable as pgTable96,
  serial as serial94,
  text as text95,
  numeric as numeric49,
  integer as integer88,
  boolean as boolean44,
  timestamp as timestamp96,
  uniqueIndex as uniqueIndex18
} from "drizzle-orm/pg-core";
var freightPortsTable, freightCarriersTable, freightContainerTypesTable, oceanFreightRouteMatrixTable;
var init_freightMasterData = __esm({
  "../../lib/db/src/schema/freightMasterData.ts"() {
    "use strict";
    freightPortsTable = pgTable96("freight_ports", {
      id: serial94("id").primaryKey(),
      code: text95("code").notNull().unique(),
      name: text95("name").notNull(),
      city: text95("city").notNull().default(""),
      country: text95("country").notNull().default(""),
      countryCode: text95("country_code").notNull().default(""),
      region: text95("region").notNull().default(""),
      portType: text95("port_type").notNull().default("sea"),
      timezone: text95("timezone").notNull().default("Asia/Jakarta"),
      isActive: boolean44("is_active").notNull().default(true),
      sortOrder: integer88("sort_order").notNull().default(0),
      notes: text95("notes"),
      createdAt: timestamp96("created_at", { withTimezone: true }).defaultNow(),
      updatedAt: timestamp96("updated_at", { withTimezone: true }).defaultNow()
    });
    freightCarriersTable = pgTable96("freight_carriers", {
      id: serial94("id").primaryKey(),
      code: text95("code").notNull().unique(),
      name: text95("name").notNull(),
      carrierType: text95("carrier_type").notNull().default("shipping_line"),
      country: text95("country").notNull().default(""),
      countryCode: text95("country_code").notNull().default(""),
      logoUrl: text95("logo_url"),
      isActive: boolean44("is_active").notNull().default(true),
      sortOrder: integer88("sort_order").notNull().default(0),
      notes: text95("notes"),
      createdAt: timestamp96("created_at", { withTimezone: true }).defaultNow(),
      updatedAt: timestamp96("updated_at", { withTimezone: true }).defaultNow()
    });
    freightContainerTypesTable = pgTable96("freight_container_types", {
      id: serial94("id").primaryKey(),
      code: text95("code").notNull().unique(),
      name: text95("name").notNull(),
      teu: numeric49("teu", { precision: 5, scale: 2 }).notNull().default("1"),
      maxCbm: numeric49("max_cbm", { precision: 10, scale: 2 }),
      maxPayloadKg: integer88("max_payload_kg"),
      isReefer: boolean44("is_reefer").notNull().default(false),
      isSpecial: boolean44("is_special").notNull().default(false),
      isActive: boolean44("is_active").notNull().default(true),
      sortOrder: integer88("sort_order").notNull().default(0),
      notes: text95("notes")
    });
    oceanFreightRouteMatrixTable = pgTable96("ocean_freight_route_matrix", {
      id: serial94("id").primaryKey(),
      originPortCode: text95("origin_port_code").notNull(),
      destinationPortCode: text95("destination_port_code").notNull(),
      carrierCode: text95("carrier_code").notNull(),
      serviceName: text95("service_name").notNull().default(""),
      transitDaysMin: integer88("transit_days_min"),
      transitDaysMax: integer88("transit_days_max"),
      frequency: text95("frequency").notNull().default("weekly"),
      directOrTransshipment: text95("direct_or_transshipment").notNull().default("direct"),
      pol: text95("pol"),
      pod: text95("pod"),
      transshipmentPort: text95("transshipment_port"),
      isActive: boolean44("is_active").notNull().default(true),
      notes: text95("notes"),
      createdAt: timestamp96("created_at", { withTimezone: true }).defaultNow(),
      updatedAt: timestamp96("updated_at", { withTimezone: true }).defaultNow()
    }, (t) => ({
      routeUq: uniqueIndex18("ofr_route_matrix_uq").on(t.originPortCode, t.destinationPortCode, t.carrierCode)
    }));
  }
});

// ../../lib/db/src/schema/ppjkOrders.ts
import {
  pgTable as pgTable97,
  serial as serial95,
  integer as integer89,
  text as text96,
  numeric as numeric50,
  timestamp as timestamp97,
  index as index55
} from "drizzle-orm/pg-core";
var ppjkOrdersTable, ppjkAuditLogsTable;
var init_ppjkOrders = __esm({
  "../../lib/db/src/schema/ppjkOrders.ts"() {
    "use strict";
    init_companies();
    init_suppliers();
    init_logisticOrders();
    ppjkOrdersTable = pgTable97("ppjk_orders", {
      id: serial95("id").primaryKey(),
      orderNumber: text96("order_number").notNull().unique(),
      companyId: integer89("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      // ── Link ke portal order customer (logistic_orders)
      portalOrderId: integer89("portal_order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
      // ── Customer
      customerName: text96("customer_name").notNull(),
      customerEmail: text96("customer_email"),
      customerPhone: text96("customer_phone"),
      customerCompany: text96("customer_company"),
      customerNpwp: text96("customer_npwp"),
      // ── Cargo & Customs
      tradeType: text96("trade_type").notNull().default("import"),
      commodity: text96("commodity"),
      hsCode: text96("hs_code"),
      origin: text96("origin"),
      destination: text96("destination"),
      grossWeight: numeric50("gross_weight", { precision: 12, scale: 3 }),
      cbm: numeric50("cbm", { precision: 12, scale: 3 }),
      packingType: text96("packing_type"),
      koli: integer89("koli"),
      portOfEntry: text96("port_of_entry"),
      kantorPabean: text96("kantor_pabean"),
      // ── Service type
      jenisPelayanan: text96("jenis_pelayanan"),
      // ── Status
      status: text96("status").notNull().default("draft"),
      customsStatus: text96("customs_status"),
      // ── Key document numbers (denormalized for quick access)
      nomorAju: text96("nomor_aju"),
      nomorPib: text96("nomor_pib"),
      nomorPeb: text96("nomor_peb"),
      nomorSppb: text96("nomor_sppb"),
      tanggalAju: text96("tanggal_aju"),
      // ── Financial (pabean)
      nilaiPabean: numeric50("nilai_pabean", { precision: 14, scale: 2 }),
      beaMasuk: numeric50("bea_masuk", { precision: 14, scale: 2 }),
      ppnImpor: numeric50("ppn_impor", { precision: 14, scale: 2 }),
      pphImpor: numeric50("pph_impor", { precision: 14, scale: 2 }),
      totalTagihanPabean: numeric50("total_tagihan_pabean", { precision: 14, scale: 2 }),
      // ── Service fee (PPJK charge to customer)
      serviceFee: numeric50("service_fee", { precision: 14, scale: 2 }),
      ppnServiceFee: numeric50("ppn_service_fee", { precision: 14, scale: 2 }),
      totalServiceFee: numeric50("total_service_fee", { precision: 14, scale: 2 }),
      // ── Vendor (who handles clearance)
      vendorId: integer89("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      vendorName: text96("vendor_name"),
      // ── Phase 2: Workflow engine flag
      workflowValidated: text96("workflow_validated").default("no"),
      // "yes" | "no"
      // ── Phase 7: SLA monitoring
      slaDeadline: timestamp97("sla_deadline"),
      isOverdue: text96("is_overdue").default("no"),
      // "yes" | "no"
      statusEnteredAt: timestamp97("status_entered_at").defaultNow(),
      // ── Phase 8: Assignment
      assignedOfficerName: text96("assigned_officer_name"),
      assignedOfficerId: text96("assigned_officer_id"),
      assignedTeam: text96("assigned_team"),
      assignedSupervisor: text96("assigned_supervisor"),
      assignedAt: timestamp97("assigned_at"),
      // ── Phase 9: Extended financial breakdown
      bmtp: text96("bmtp"),
      // Bea Masuk Tindakan Pengamanan
      bmad: text96("bmad"),
      // Bea Masuk Anti Dumping
      storageFee: text96("storage_fee"),
      handlingFee: text96("handling_fee"),
      thc: text96("thc"),
      // Terminal Handling Charge
      doFee: text96("do_fee"),
      // Delivery Order
      forwardingFee: text96("forwarding_fee"),
      truckingFee: text96("trucking_fee"),
      miscFee: text96("misc_fee"),
      // ── Meta
      notes: text96("notes"),
      adminNotes: text96("admin_notes"),
      createdById: text96("created_by_id"),
      createdAt: timestamp97("created_at").defaultNow().notNull(),
      updatedAt: timestamp97("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyIdx: index55("ppjk_company_idx").on(t.companyId, t.status),
      statusIdx: index55("ppjk_status_idx").on(t.status),
      tradeIdx: index55("ppjk_trade_idx").on(t.tradeType)
    }));
    ppjkAuditLogsTable = pgTable97("ppjk_audit_logs", {
      id: serial95("id").primaryKey(),
      ppjkOrderId: integer89("ppjk_order_id").notNull().references(() => ppjkOrdersTable.id, { onDelete: "cascade" }),
      action: text96("action").notNull(),
      fromStatus: text96("from_status"),
      toStatus: text96("to_status"),
      field: text96("field"),
      oldValue: text96("old_value"),
      newValue: text96("new_value"),
      changedBy: text96("changed_by").notNull(),
      changedById: text96("changed_by_id"),
      notes: text96("notes"),
      createdAt: timestamp97("created_at").defaultNow().notNull()
    }, (t) => ({
      orderIdx: index55("ppjk_audit_order_idx").on(t.ppjkOrderId)
    }));
  }
});

// ../../lib/db/src/schema/ppjkPhase2.ts
import {
  pgTable as pgTable98,
  serial as serial96,
  integer as integer90,
  text as text97,
  timestamp as timestamp98,
  index as index56,
  boolean as boolean45
} from "drizzle-orm/pg-core";
var ppjkStatusLogsTable, PPJK_DOC_TYPES, PPJK_DOC_LABELS, ppjkDocumentChecklistTable;
var init_ppjkPhase2 = __esm({
  "../../lib/db/src/schema/ppjkPhase2.ts"() {
    "use strict";
    init_ppjkOrders();
    ppjkStatusLogsTable = pgTable98("ppjk_status_logs", {
      id: serial96("id").primaryKey(),
      ppjkOrderId: integer90("ppjk_order_id").notNull().references(() => ppjkOrdersTable.id, { onDelete: "cascade" }),
      oldStatus: text97("old_status"),
      newStatus: text97("new_status").notNull(),
      changedBy: text97("changed_by").notNull(),
      changedById: text97("changed_by_id"),
      changedAt: timestamp98("changed_at").defaultNow().notNull(),
      notes: text97("notes"),
      ipAddress: text97("ip_address"),
      userAgent: text97("user_agent")
    }, (t) => ({
      orderIdx: index56("ppjk_sl_order_idx").on(t.ppjkOrderId),
      changedAtIdx: index56("ppjk_sl_changed_at_idx").on(t.changedAt)
    }));
    PPJK_DOC_TYPES = [
      "invoice",
      "packing_list",
      "bl",
      "awb",
      "coo",
      "insurance",
      "pib",
      "peb",
      "ska",
      "ls",
      "msds",
      "photo_cargo"
    ];
    PPJK_DOC_LABELS = {
      invoice: "Commercial Invoice",
      packing_list: "Packing List",
      bl: "Bill of Lading (BL)",
      awb: "Air Waybill (AWB)",
      coo: "Certificate of Origin (COO)",
      insurance: "Insurance Certificate",
      pib: "PIB (Pemberitahuan Impor Barang)",
      peb: "PEB (Pemberitahuan Ekspor Barang)",
      ska: "SKA (Surat Keterangan Asal)",
      ls: "Laporan Surveyor (LS)",
      msds: "Material Safety Data Sheet (MSDS)",
      photo_cargo: "Foto Kargo"
    };
    ppjkDocumentChecklistTable = pgTable98("ppjk_document_checklist", {
      id: serial96("id").primaryKey(),
      ppjkOrderId: integer90("ppjk_order_id").notNull().references(() => ppjkOrdersTable.id, { onDelete: "cascade" }),
      docType: text97("doc_type").notNull(),
      docLabel: text97("doc_label").notNull(),
      status: text97("status").notNull().default("pending"),
      // pending | uploaded | verified | rejected
      isRequired: boolean45("is_required").notNull().default(false),
      fileUrl: text97("file_url"),
      fileName: text97("file_name"),
      rejectionReason: text97("rejection_reason"),
      verifiedBy: text97("verified_by"),
      verifiedAt: timestamp98("verified_at"),
      uploadedBy: text97("uploaded_by"),
      uploadedAt: timestamp98("uploaded_at"),
      createdAt: timestamp98("created_at").defaultNow().notNull(),
      updatedAt: timestamp98("updated_at").defaultNow().notNull()
    }, (t) => ({
      orderIdx: index56("ppjk_dc_order_idx").on(t.ppjkOrderId),
      typeIdx: index56("ppjk_dc_type_idx").on(t.ppjkOrderId, t.docType)
    }));
  }
});

// ../../lib/db/src/schema/customerServiceRequests.ts
import {
  pgTable as pgTable99,
  serial as serial97,
  text as text98,
  integer as integer91,
  timestamp as timestamp99,
  jsonb as jsonb32,
  numeric as numeric51,
  boolean as boolean46
} from "drizzle-orm/pg-core";
import { relations as relations3 } from "drizzle-orm";
import { createInsertSchema as createInsertSchema31 } from "drizzle-zod";
var customerServiceRequestsTable, customerServiceRequestItemsTable, customerServiceRequestDocumentsTable, customerServiceRequestsRelations, customerServiceRequestItemsRelations, customerServiceRequestDocumentsRelations, insertCustomerServiceRequestSchema, insertCustomerServiceRequestItemSchema;
var init_customerServiceRequests = __esm({
  "../../lib/db/src/schema/customerServiceRequests.ts"() {
    "use strict";
    init_portalCustomers();
    init_suppliers();
    customerServiceRequestsTable = pgTable99("customer_service_requests", {
      id: serial97("id").primaryKey(),
      requestNumber: text98("request_number").notNull().unique(),
      customerId: integer91("customer_id"),
      customerName: text98("customer_name").notNull(),
      customerEmail: text98("customer_email").notNull(),
      customerPhone: text98("customer_phone"),
      customerCompany: text98("customer_company"),
      requestType: text98("request_type").notNull().default("service"),
      tradeType: text98("trade_type").notNull(),
      // EXPORT | IMPORT | DOMESTIC
      orderMode: text98("order_mode").notNull().default("ITEM_MANDIRI"),
      // ITEM_MANDIRI | PAKET_BORONGAN
      packageId: integer91("package_id"),
      packageNameSnapshot: text98("package_name_snapshot"),
      pricingMode: text98("pricing_mode").notNull().default("PER_ITEM"),
      // TOTAL_BORONGAN | PER_ITEM | HYBRID
      status: text98("status").notNull().default("draft"),
      // draft | submitted | reviewing | quoted | approved | rejected | cancelled
      notes: text98("notes"),
      adminNotes: text98("admin_notes"),
      handledBy: text98("handled_by"),
      totalEstimatedPrice: numeric51("total_estimated_price", { precision: 14, scale: 2 }),
      totalQuotedPrice: numeric51("total_quoted_price", { precision: 14, scale: 2 }),
      submittedAt: timestamp99("submitted_at", { withTimezone: true }),
      createdAt: timestamp99("created_at").defaultNow().notNull(),
      updatedAt: timestamp99("updated_at", { withTimezone: true }).defaultNow()
    });
    customerServiceRequestItemsTable = pgTable99("customer_service_request_items", {
      id: serial97("id").primaryKey(),
      requestId: integer91("request_id").notNull(),
      itemType: text98("item_type").notNull(),
      // air_freight | ocean_freight | ppjk | trucking | warehousing | handling | insurance | survey | project_cargo
      serviceCategory: text98("service_category"),
      sequenceNo: integer91("sequence_no").notNull().default(1),
      title: text98("title").notNull(),
      description: text98("description"),
      formData: jsonb32("form_data").$type().default({}),
      requiredDocuments: jsonb32("required_documents").$type().default([]),
      isRequired: boolean46("is_required").notNull().default(true),
      status: text98("status").notNull().default("pending"),
      // pending | quoted | accepted | rejected
      estimatedPrice: numeric51("estimated_price", { precision: 14, scale: 2 }),
      quotedPrice: numeric51("quoted_price", { precision: 14, scale: 2 }),
      vendorId: integer91("vendor_id"),
      vendorNotes: text98("vendor_notes"),
      createdAt: timestamp99("created_at").defaultNow().notNull(),
      updatedAt: timestamp99("updated_at", { withTimezone: true }).defaultNow()
    });
    customerServiceRequestDocumentsTable = pgTable99("customer_service_request_documents", {
      id: serial97("id").primaryKey(),
      requestId: integer91("request_id").notNull(),
      requestItemId: integer91("request_item_id"),
      documentType: text98("document_type").notNull(),
      fileUrl: text98("file_url").notNull(),
      fileName: text98("file_name"),
      fileSize: integer91("file_size"),
      verificationStatus: text98("verification_status").notNull().default("pending"),
      // pending | verified | rejected
      uploadedBy: text98("uploaded_by"),
      notes: text98("notes"),
      createdAt: timestamp99("created_at").defaultNow().notNull()
    });
    customerServiceRequestsRelations = relations3(
      customerServiceRequestsTable,
      ({ one, many }) => ({
        customer: one(portalCustomersTable, {
          fields: [customerServiceRequestsTable.customerId],
          references: [portalCustomersTable.id]
        }),
        items: many(customerServiceRequestItemsTable),
        documents: many(customerServiceRequestDocumentsTable)
      })
    );
    customerServiceRequestItemsRelations = relations3(
      customerServiceRequestItemsTable,
      ({ one, many }) => ({
        request: one(customerServiceRequestsTable, {
          fields: [customerServiceRequestItemsTable.requestId],
          references: [customerServiceRequestsTable.id]
        }),
        vendor: one(suppliersTable, {
          fields: [customerServiceRequestItemsTable.vendorId],
          references: [suppliersTable.id]
        }),
        documents: many(customerServiceRequestDocumentsTable)
      })
    );
    customerServiceRequestDocumentsRelations = relations3(
      customerServiceRequestDocumentsTable,
      ({ one }) => ({
        request: one(customerServiceRequestsTable, {
          fields: [customerServiceRequestDocumentsTable.requestId],
          references: [customerServiceRequestsTable.id]
        }),
        item: one(customerServiceRequestItemsTable, {
          fields: [customerServiceRequestDocumentsTable.requestItemId],
          references: [customerServiceRequestItemsTable.id]
        })
      })
    );
    insertCustomerServiceRequestSchema = createInsertSchema31(customerServiceRequestsTable).omit({
      id: true,
      requestNumber: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true
    });
    insertCustomerServiceRequestItemSchema = createInsertSchema31(customerServiceRequestItemsTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/servicePackages.ts
import {
  pgTable as pgTable100,
  serial as serial98,
  text as text99,
  integer as integer92,
  boolean as boolean47,
  timestamp as timestamp100,
  jsonb as jsonb33
} from "drizzle-orm/pg-core";
import { relations as relations4 } from "drizzle-orm";
var servicePackagesTable, servicePackageItemsTable, servicePackagesRelations, servicePackageItemsRelations;
var init_servicePackages = __esm({
  "../../lib/db/src/schema/servicePackages.ts"() {
    "use strict";
    servicePackagesTable = pgTable100("service_packages", {
      id: serial98("id").primaryKey(),
      packageCode: text99("package_code").notNull().unique(),
      packageName: text99("package_name").notNull(),
      packageType: text99("package_type").notNull(),
      // air_export | sea_import | customs | domestic | multimodal
      tradeType: text99("trade_type").notNull(),
      // EXPORT | IMPORT | DOMESTIC | ANY
      description: text99("description"),
      pricingMode: text99("pricing_mode").notNull().default("PER_ITEM"),
      // TOTAL_BORONGAN | PER_ITEM | HYBRID
      iconEmoji: text99("icon_emoji").default("\u{1F4E6}"),
      isActive: boolean47("is_active").notNull().default(true),
      sortOrder: integer92("sort_order").notNull().default(0),
      createdAt: timestamp100("created_at").defaultNow().notNull()
    });
    servicePackageItemsTable = pgTable100("service_package_items", {
      id: serial98("id").primaryKey(),
      packageId: integer92("package_id").notNull(),
      itemType: text99("item_type").notNull(),
      serviceCategory: text99("service_category"),
      itemTitle: text99("item_title").notNull(),
      isRequired: boolean47("is_required").notNull().default(true),
      sequenceNo: integer92("sequence_no").notNull().default(1),
      defaultFormSchema: jsonb33("default_form_schema").$type().default({}),
      requiredDocuments: jsonb33("required_documents").$type().default([]),
      description: text99("description")
    });
    servicePackagesRelations = relations4(servicePackagesTable, ({ many }) => ({
      items: many(servicePackageItemsTable)
    }));
    servicePackageItemsRelations = relations4(servicePackageItemsTable, ({ one }) => ({
      package: one(servicePackagesTable, {
        fields: [servicePackageItemsTable.packageId],
        references: [servicePackagesTable.id]
      })
    }));
  }
});

// ../../lib/db/src/schema/portalCustomerProfiles.ts
import {
  pgTable as pgTable101,
  serial as serial99,
  integer as integer93,
  text as text100,
  boolean as boolean48,
  timestamp as timestamp101
} from "drizzle-orm/pg-core";
import { relations as relations5 } from "drizzle-orm";
function computeProfileStatus(p) {
  const filled = PROFILE_REQUIRED_FIELDS.filter((f) => !!p[f]);
  if (filled.length === PROFILE_REQUIRED_FIELDS.length) return "complete";
  if (filled.length > 0) return "partial";
  return "incomplete";
}
var portalCustomerProfilesTable, portalCustomerProfilesRelations, PROFILE_REQUIRED_FIELDS;
var init_portalCustomerProfiles = __esm({
  "../../lib/db/src/schema/portalCustomerProfiles.ts"() {
    "use strict";
    init_portalCustomers();
    portalCustomerProfilesTable = pgTable101("portal_customer_profiles", {
      id: serial99("id").primaryKey(),
      customerId: integer93("customer_id"),
      guestEmail: text100("guest_email"),
      companyName: text100("company_name"),
      npwp: text100("npwp"),
      nib: text100("nib"),
      companyAddress: text100("company_address"),
      picName: text100("pic_name"),
      picWhatsapp: text100("pic_whatsapp"),
      picEmail: text100("pic_email"),
      legalDocUrl: text100("legal_doc_url"),
      ktpPicUrl: text100("ktp_pic_url"),
      suratKuasaUrl: text100("surat_kuasa_url"),
      apiNikIzinUrl: text100("api_nik_izin_url"),
      additionalNotes: text100("additional_notes"),
      profileStatus: text100("profile_status").notNull().default("incomplete"),
      isVerified: boolean48("is_verified").notNull().default(false),
      verifiedBy: text100("verified_by"),
      verifiedAt: timestamp101("verified_at", { withTimezone: true }),
      // ── Verification Center (P1A) ─────────────────────────────────────────────
      verificationStatus: text100("verification_status").notNull().default("DRAFT"),
      verificationSubmittedAt: timestamp101("verification_submitted_at", { withTimezone: true }),
      verificationExpiredAt: timestamp101("verification_expired_at", { withTimezone: true }),
      verificationNotes: text100("verification_notes"),
      // ─────────────────────────────────────────────────────────────────────────
      createdAt: timestamp101("created_at").defaultNow().notNull(),
      updatedAt: timestamp101("updated_at", { withTimezone: true }).defaultNow()
    });
    portalCustomerProfilesRelations = relations5(
      portalCustomerProfilesTable,
      ({ one }) => ({
        customer: one(portalCustomersTable, {
          fields: [portalCustomerProfilesTable.customerId],
          references: [portalCustomersTable.id]
        })
      })
    );
    PROFILE_REQUIRED_FIELDS = [
      "companyName",
      "npwp",
      "nib",
      "companyAddress",
      "picName",
      "picWhatsapp",
      "picEmail"
    ];
  }
});

// ../../lib/db/src/schema/customerVerificationDocuments.ts
import { pgTable as pgTable102, serial as serial100, integer as integer94, text as text101, timestamp as timestamp102 } from "drizzle-orm/pg-core";
import { relations as relations6 } from "drizzle-orm";
var VERIFICATION_DOC_TYPES, VERIFICATION_DOC_STATUSES, CUSTOMER_VERIFICATION_STATUSES, PPJK_REQUIRED_DOCS, customerVerificationDocumentsTable, customerVerificationDocumentsRelations, DOC_TYPE_LABELS;
var init_customerVerificationDocuments = __esm({
  "../../lib/db/src/schema/customerVerificationDocuments.ts"() {
    "use strict";
    init_portalCustomerProfiles();
    VERIFICATION_DOC_TYPES = [
      "NPWP",
      "NIB",
      "KTP_PIC",
      "AKTA_PERUSAHAAN",
      "SURAT_KUASA",
      "API_U",
      "API_P",
      "NIK_KEPABEANAN",
      "SIUP_NIB_ACTIVITY",
      "OTHER"
    ];
    VERIFICATION_DOC_STATUSES = [
      "UPLOADED",
      "PENDING_REVIEW",
      "VERIFIED",
      "REJECTED",
      "EXPIRED"
    ];
    CUSTOMER_VERIFICATION_STATUSES = [
      "DRAFT",
      "PENDING_VERIFICATION",
      "NEED_REVISION",
      "VERIFIED",
      "REJECTED",
      "EXPIRED"
    ];
    PPJK_REQUIRED_DOCS = ["NPWP", "NIB", "KTP_PIC"];
    customerVerificationDocumentsTable = pgTable102("customer_verification_documents", {
      id: serial100("id").primaryKey(),
      profileId: integer94("profile_id").notNull().references(() => portalCustomerProfilesTable.id, { onDelete: "cascade" }),
      documentType: text101("document_type").notNull(),
      documentNumber: text101("document_number"),
      fileUrl: text101("file_url").notNull(),
      fileName: text101("file_name"),
      verificationStatus: text101("verification_status").notNull().default("UPLOADED"),
      verifiedBy: text101("verified_by"),
      verifiedAt: timestamp102("verified_at", { withTimezone: true }),
      rejectionReason: text101("rejection_reason"),
      expiryDate: timestamp102("expiry_date", { withTimezone: true }),
      uploadedVersion: integer94("uploaded_version").notNull().default(1),
      createdAt: timestamp102("created_at").defaultNow().notNull(),
      updatedAt: timestamp102("updated_at", { withTimezone: true }).defaultNow()
    });
    customerVerificationDocumentsRelations = relations6(
      customerVerificationDocumentsTable,
      ({ one }) => ({
        profile: one(portalCustomerProfilesTable, {
          fields: [customerVerificationDocumentsTable.profileId],
          references: [portalCustomerProfilesTable.id]
        })
      })
    );
    DOC_TYPE_LABELS = {
      NPWP: "NPWP",
      NIB: "NIB (Nomor Induk Berusaha)",
      KTP_PIC: "KTP PIC",
      AKTA_PERUSAHAAN: "Akta Perusahaan",
      SURAT_KUASA: "Surat Kuasa",
      API_U: "API-U",
      API_P: "API-P",
      NIK_KEPABEANAN: "NIK Kepabeanan",
      SIUP_NIB_ACTIVITY: "SIUP / NIB Activity",
      OTHER: "Dokumen Lainnya"
    };
  }
});

// ../../lib/db/src/schema/logisticsRateCards.ts
import { pgTable as pgTable103, serial as serial101, text as text102, boolean as boolean49, timestamp as timestamp103, pgEnum as pgEnum24 } from "drizzle-orm/pg-core";
var logisticsServiceTypeEnum, logisticsRateCardsTable;
var init_logisticsRateCards = __esm({
  "../../lib/db/src/schema/logisticsRateCards.ts"() {
    "use strict";
    logisticsServiceTypeEnum = pgEnum24("logistics_service_type", [
      "seaFreight",
      "airFreight",
      "customs",
      "trucking",
      "warehousing",
      "projectCargo"
    ]);
    logisticsRateCardsTable = pgTable103("logistics_rate_cards", {
      id: serial101("id").primaryKey(),
      serviceType: logisticsServiceTypeEnum("service_type").notNull(),
      name: text102("name").notNull(),
      description: text102("description"),
      currency: text102("currency").notNull().default("IDR"),
      isActive: boolean49("is_active").notNull().default(true),
      validFrom: timestamp103("valid_from", { withTimezone: true }),
      validTo: timestamp103("valid_to", { withTimezone: true }),
      createdAt: timestamp103("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp103("updated_at", { withTimezone: true }).notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/logisticsServiceRates.ts
import { pgTable as pgTable104, serial as serial102, integer as integer95, text as text103, timestamp as timestamp104, numeric as numeric52, pgEnum as pgEnum25 } from "drizzle-orm/pg-core";
import { relations as relations7 } from "drizzle-orm";
var rateValueTypeEnum, logisticsServiceRatesTable, logisticsServiceRatesRelations;
var init_logisticsServiceRates = __esm({
  "../../lib/db/src/schema/logisticsServiceRates.ts"() {
    "use strict";
    init_logisticsRateCards();
    rateValueTypeEnum = pgEnum25("rate_value_type", ["fixed", "percentage"]);
    logisticsServiceRatesTable = pgTable104("logistics_service_rates", {
      id: serial102("id").primaryKey(),
      rateCardId: integer95("rate_card_id").notNull().references(() => logisticsRateCardsTable.id, { onDelete: "cascade" }),
      rateKey: text103("rate_key").notNull(),
      label: text103("label").notNull(),
      valueType: rateValueTypeEnum("value_type").notNull().default("fixed"),
      valueAmount: numeric52("value_amount", { precision: 18, scale: 4 }).notNull().default("0"),
      containerType: text103("container_type"),
      vehicleType: text103("vehicle_type"),
      notes: text103("notes"),
      sortOrder: integer95("sort_order").notNull().default(0),
      createdAt: timestamp104("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp104("updated_at", { withTimezone: true }).notNull().defaultNow()
    });
    logisticsServiceRatesRelations = relations7(logisticsServiceRatesTable, ({ one }) => ({
      rateCard: one(logisticsRateCardsTable, {
        fields: [logisticsServiceRatesTable.rateCardId],
        references: [logisticsRateCardsTable.id]
      })
    }));
  }
});

// ../../lib/db/src/schema/logisticsSurcharges.ts
import { pgTable as pgTable105, serial as serial103, text as text104, boolean as boolean51, integer as integer96, timestamp as timestamp105, numeric as numeric53, pgEnum as pgEnum26 } from "drizzle-orm/pg-core";
var surchargeTypeEnum, surchargeUnitEnum, surchargeAppliesToEnum, logisticsSurchargesTable;
var init_logisticsSurcharges = __esm({
  "../../lib/db/src/schema/logisticsSurcharges.ts"() {
    "use strict";
    surchargeTypeEnum = pgEnum26("surcharge_type", ["fixed", "percentage", "per_unit"]);
    surchargeUnitEnum = pgEnum26("surcharge_unit", [
      "per_kg",
      "per_cbm",
      "per_container",
      "per_day",
      "per_pallet",
      "flat"
    ]);
    surchargeAppliesToEnum = pgEnum26("surcharge_applies_to", [
      "all",
      "dg",
      "temp_controlled",
      "oversize",
      "overnight"
    ]);
    logisticsSurchargesTable = pgTable105("logistics_surcharges", {
      id: serial103("id").primaryKey(),
      serviceType: text104("service_type").notNull(),
      name: text104("name").notNull(),
      label: text104("label").notNull(),
      surchargeType: surchargeTypeEnum("surcharge_type").notNull().default("fixed"),
      amount: numeric53("amount", { precision: 18, scale: 4 }).notNull().default("0"),
      unit: surchargeUnitEnum("unit").notNull().default("flat"),
      isMandatory: boolean51("is_mandatory").notNull().default(false),
      isActive: boolean51("is_active").notNull().default(true),
      appliesTo: surchargeAppliesToEnum("applies_to").notNull().default("all"),
      sortOrder: integer96("sort_order").notNull().default(0),
      createdAt: timestamp105("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp105("updated_at", { withTimezone: true }).notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/sportExpenses.ts
import {
  pgTable as pgTable106,
  serial as serial104,
  text as text105,
  integer as integer97,
  numeric as numeric54,
  timestamp as timestamp106,
  date as date18,
  index as index57
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema32 } from "drizzle-zod";
import { z } from "zod/v4";
var sportExpensesTable, insertSportExpenseSchema;
var init_sportExpenses = __esm({
  "../../lib/db/src/schema/sportExpenses.ts"() {
    "use strict";
    sportExpensesTable = pgTable106(
      "sport_expenses",
      {
        id: serial104("id").primaryKey(),
        companyId: integer97("company_id"),
        facilityId: integer97("facility_id"),
        expenseNumber: text105("expense_number").notNull().unique(),
        date: date18("date").notNull(),
        category: text105("category").notNull().default("lain-lain"),
        description: text105("description"),
        amount: numeric54("amount", { precision: 14, scale: 2 }).notNull().default("0"),
        paymentMethod: text105("payment_method").notNull().default("cash"),
        status: text105("status").notNull().default("draft"),
        entryId: integer97("entry_id"),
        notes: text105("notes"),
        createdBy: text105("created_by"),
        createdAt: timestamp106("created_at").defaultNow().notNull(),
        updatedAt: timestamp106("updated_at").defaultNow().notNull()
      },
      (t) => [
        index57("idx_sport_expenses_company").on(t.companyId),
        index57("idx_sport_expenses_facility").on(t.facilityId),
        index57("idx_sport_expenses_date").on(t.date),
        index57("idx_sport_expenses_status").on(t.status)
      ]
    );
    insertSportExpenseSchema = createInsertSchema32(sportExpensesTable, {
      date: z.string().min(1),
      category: z.string().min(1),
      amount: z.union([z.string(), z.number()]).transform(String),
      paymentMethod: z.enum(["cash", "transfer", "hutang"]).default("cash"),
      status: z.enum(["draft", "posted", "void"]).default("draft")
    }).omit({ id: true, expenseNumber: true, entryId: true, createdAt: true, updatedAt: true });
  }
});

// ../../lib/db/src/schema/bankMutationImports.ts
import { pgTable as pgTable107, serial as serial105, integer as integer98, text as text106, numeric as numeric55, date as date19, timestamp as timestamp107 } from "drizzle-orm/pg-core";
var bankMutationImportsTable;
var init_bankMutationImports = __esm({
  "../../lib/db/src/schema/bankMutationImports.ts"() {
    "use strict";
    bankMutationImportsTable = pgTable107("bank_mutation_imports", {
      id: serial105("id").primaryKey(),
      importBatchId: integer98("import_batch_id"),
      transactionDate: date19("transaction_date"),
      description: text106("description"),
      debit: numeric55("debit", { precision: 18, scale: 2 }),
      credit: numeric55("credit", { precision: 18, scale: 2 }),
      balance: numeric55("balance", { precision: 18, scale: 2 }),
      erpCategory: text106("erp_category"),
      entityType: text106("entity_type"),
      entityName: text106("entity_name"),
      businessUnit: text106("business_unit"),
      company: text106("company"),
      taxType: text106("tax_type"),
      paymentMethod: text106("payment_method"),
      sourceAccount: text106("source_account"),
      plFlag: text106("pl_flag"),
      accountingClass: text106("accounting_class"),
      uniqueKey: text106("unique_key"),
      status: text106("status").notNull().default("DRAFT"),
      createdAt: timestamp107("created_at").defaultNow()
    });
  }
});

// ../../lib/db/src/schema/bankReconciliation.ts
import {
  boolean as boolean52,
  integer as integer99,
  pgTable as pgTable108,
  serial as serial106,
  text as text107,
  timestamp as timestamp108
} from "drizzle-orm/pg-core";
function isQrisSettlementCandidate(candidateType) {
  return candidateType === "qris_settlement";
}
function reconciliationCandidateIdentityKey(identity) {
  return [
    identity.candidateType,
    identity.candidateId,
    identity.candidateSource ?? "<historical-null>"
  ].join(":");
}
var bankReconciliationMatchesTable, RECONCILIATION_CANDIDATE_SOURCES;
var init_bankReconciliation = __esm({
  "../../lib/db/src/schema/bankReconciliation.ts"() {
    "use strict";
    bankReconciliationMatchesTable = pgTable108("bank_reconciliation_matches", {
      id: serial106("id").primaryKey(),
      mutationId: integer99("mutation_id").notNull(),
      candidateType: text107("candidate_type").notNull(),
      candidateId: integer99("candidate_id").notNull(),
      candidateSource: text107("candidate_source"),
      matchScore: integer99("match_score").notNull().default(0),
      matchReason: text107("match_reason"),
      amountMatch: boolean52("amount_match").notNull().default(false),
      dateMatch: boolean52("date_match").notNull().default(false),
      nameMatch: boolean52("name_match").notNull().default(false),
      orderIdMatch: boolean52("order_id_match").notNull().default(false),
      proofMatch: boolean52("proof_match").notNull().default(false),
      status: text107("status").notNull().default("candidate"),
      createdAt: timestamp108("created_at", { withTimezone: true }).notNull().defaultNow(),
      customerName: text107("customer_name"),
      orderRef: text107("order_ref")
    });
    RECONCILIATION_CANDIDATE_SOURCES = {
      LEGACY_QRIS: "public.qris_settlements",
      CANONICAL_SPORT_CENTER: "sport_center.payment_settlement_batches"
    };
  }
});

// ../../lib/db/src/schema/fleetIntelligence.ts
import {
  pgTable as pgTable109,
  serial as serial107,
  text as text108,
  numeric as numeric56,
  integer as integer100,
  timestamp as timestamp109,
  boolean as boolean53,
  date as date20,
  index as index58,
  jsonb as jsonb34,
  uniqueIndex as uniqueIndex19
} from "drizzle-orm/pg-core";
var fleetPartnersTable, fleetReportsTable, fleetDriversTable, fleetVehiclesTable, fleetTransactionsTable, fleetDailySummaryTable, fleetOutstandingTable, fleetAlertsTable, fleetAccountingJournalsTable, fleetAlertSuppressionTable, fleetWaLogsTable, fleetCashPaymentsTable;
var init_fleetIntelligence = __esm({
  "../../lib/db/src/schema/fleetIntelligence.ts"() {
    "use strict";
    init_companies();
    fleetPartnersTable = pgTable109("fleet_partners", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      name: text108("name").notNull(),
      partnerType: text108("partner_type").notNull().default("gojek"),
      contractNumber: text108("contract_number"),
      contactName: text108("contact_name"),
      contactPhone: text108("contact_phone"),
      contactEmail: text108("contact_email"),
      address: text108("address"),
      commissionRate: numeric56("commission_rate", { precision: 5, scale: 2 }).default("0"),
      isActive: boolean53("is_active").default(true).notNull(),
      notes: text108("notes"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_partners_company_idx").on(t.companyId)
    ]);
    fleetReportsTable = pgTable109("fleet_reports", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      partnerId: integer100("partner_id").references(() => fleetPartnersTable.id, { onDelete: "set null" }),
      filename: text108("filename").notNull(),
      originalFilename: text108("original_filename").notNull(),
      fileHash: text108("file_hash"),
      version: integer100("version").default(1).notNull(),
      reportType: text108("report_type").notNull().default("gojek_driver"),
      periodStart: date20("period_start"),
      periodEnd: date20("period_end"),
      status: text108("status").notNull().default("processing"),
      rowCount: integer100("row_count").default(0),
      processedCount: integer100("processed_count").default(0),
      errorCount: integer100("error_count").default(0),
      errorDetails: jsonb34("error_details"),
      uploadedBy: text108("uploaded_by"),
      uploadedByEmail: text108("uploaded_by_email"),
      columnMapping: jsonb34("column_mapping"),
      summaryStats: jsonb34("summary_stats"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_reports_company_idx").on(t.companyId),
      index58("fleet_reports_status_idx").on(t.status),
      index58("fleet_reports_period_idx").on(t.periodStart, t.periodEnd)
    ]);
    fleetDriversTable = pgTable109("fleet_drivers", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      partnerId: integer100("partner_id").references(() => fleetPartnersTable.id, { onDelete: "set null" }),
      driverExternalId: text108("driver_external_id"),
      name: text108("name").notNull(),
      phone: text108("phone"),
      email: text108("email"),
      licenseNumber: text108("license_number"),
      vehiclePlate: text108("vehicle_plate"),
      vehicleType: text108("vehicle_type"),
      joinDate: date20("join_date"),
      status: text108("status").notNull().default("active"),
      lastActiveDate: date20("last_active_date"),
      totalTrips: integer100("total_trips").default(0),
      totalRevenue: numeric56("total_revenue", { precision: 18, scale: 2 }).default("0"),
      avgDailyTrips: numeric56("avg_daily_trips", { precision: 8, scale: 2 }).default("0"),
      performanceTier: text108("performance_tier").default("standard"),
      notes: text108("notes"),
      rawData: jsonb34("raw_data"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_drivers_company_idx").on(t.companyId),
      index58("fleet_drivers_partner_idx").on(t.partnerId),
      index58("fleet_drivers_status_idx").on(t.status),
      index58("fleet_drivers_ext_id_idx").on(t.driverExternalId)
    ]);
    fleetVehiclesTable = pgTable109("fleet_vehicles", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      partnerId: integer100("partner_id").references(() => fleetPartnersTable.id, { onDelete: "set null" }),
      driverId: integer100("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
      plate: text108("plate").notNull(),
      vehicleType: text108("vehicle_type").notNull().default("motor"),
      brand: text108("brand"),
      model: text108("model"),
      year: integer100("year"),
      color: text108("color"),
      status: text108("status").notNull().default("active"),
      lastServiceDate: date20("last_service_date"),
      notes: text108("notes"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_vehicles_company_idx").on(t.companyId),
      index58("fleet_vehicles_plate_idx").on(t.plate)
    ]);
    fleetTransactionsTable = pgTable109("fleet_transactions", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      reportId: integer100("report_id").references(() => fleetReportsTable.id, { onDelete: "set null" }),
      driverId: integer100("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
      vehicleId: integer100("vehicle_id").references(() => fleetVehiclesTable.id, { onDelete: "set null" }),
      driverExternalId: text108("driver_external_id"),
      driverName: text108("driver_name"),
      vehiclePlate: text108("vehicle_plate"),
      transactionDate: date20("transaction_date").notNull(),
      tripCount: integer100("trip_count").default(0),
      grossRevenue: numeric56("gross_revenue", { precision: 18, scale: 2 }).default("0"),
      incentive: numeric56("incentive", { precision: 18, scale: 2 }).default("0"),
      commission: numeric56("commission", { precision: 18, scale: 2 }).default("0"),
      deduction: numeric56("deduction", { precision: 18, scale: 2 }).default("0"),
      netRevenue: numeric56("net_revenue", { precision: 18, scale: 2 }).default("0"),
      outstandingBalance: numeric56("outstanding_balance", { precision: 18, scale: 2 }).default("0"),
      ppnRate: numeric56("ppn_rate", { precision: 5, scale: 2 }).default("0"),
      ppnAmount: numeric56("ppn_amount", { precision: 18, scale: 2 }).default("0"),
      serviceType: text108("service_type").default("GoRide"),
      rawData: jsonb34("raw_data"),
      createdAt: timestamp109("created_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_trx_company_idx").on(t.companyId),
      index58("fleet_trx_date_idx").on(t.transactionDate),
      index58("fleet_trx_driver_idx").on(t.driverId),
      index58("fleet_trx_report_idx").on(t.reportId),
      index58("fleet_trx_plate_idx").on(t.vehiclePlate)
    ]);
    fleetDailySummaryTable = pgTable109("fleet_daily_summary", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      summaryDate: date20("summary_date").notNull(),
      activeDrivers: integer100("active_drivers").default(0),
      totalTrips: integer100("total_trips").default(0),
      grossRevenue: numeric56("gross_revenue", { precision: 18, scale: 2 }).default("0"),
      totalIncentive: numeric56("total_incentive", { precision: 18, scale: 2 }).default("0"),
      totalCommission: numeric56("total_commission", { precision: 18, scale: 2 }).default("0"),
      totalDeduction: numeric56("total_deduction", { precision: 18, scale: 2 }).default("0"),
      netRevenue: numeric56("net_revenue", { precision: 18, scale: 2 }).default("0"),
      avgRevenuePerDriver: numeric56("avg_revenue_per_driver", { precision: 18, scale: 2 }).default("0"),
      avgTripsPerDriver: numeric56("avg_trips_per_driver", { precision: 8, scale: 2 }).default("0"),
      topDriverId: integer100("top_driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
      createdAt: timestamp109("created_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_daily_company_date_idx").on(t.companyId, t.summaryDate)
    ]);
    fleetOutstandingTable = pgTable109("fleet_outstanding", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      driverId: integer100("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
      driverExternalId: text108("driver_external_id"),
      driverName: text108("driver_name").notNull(),
      outstandingAmount: numeric56("outstanding_amount", { precision: 18, scale: 2 }).default("0"),
      lastUpdatedDate: date20("last_updated_date"),
      dueDays: integer100("due_days").default(0),
      status: text108("status").notNull().default("open"),
      notes: text108("notes"),
      resolvedAt: timestamp109("resolved_at"),
      isNotified: boolean53("is_notified").default(false).notNull(),
      lastWaSentAt: timestamp109("last_wa_sent_at"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_outstanding_company_idx").on(t.companyId),
      index58("fleet_outstanding_status_idx").on(t.status),
      index58("fleet_outstanding_driver_idx").on(t.driverId)
    ]);
    fleetAlertsTable = pgTable109("fleet_alerts", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      alertType: text108("alert_type").notNull(),
      severity: text108("severity").notNull().default("info"),
      title: text108("title").notNull(),
      message: text108("message").notNull(),
      referenceType: text108("reference_type"),
      referenceId: text108("reference_id"),
      driverId: integer100("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
      isRead: boolean53("is_read").default(false).notNull(),
      isNotified: boolean53("is_notified").default(false).notNull(),
      notifiedAt: timestamp109("notified_at"),
      notifiedTo: text108("notified_to"),
      autoResolvedAt: timestamp109("auto_resolved_at"),
      createdAt: timestamp109("created_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_alerts_company_idx").on(t.companyId),
      index58("fleet_alerts_type_idx").on(t.alertType),
      index58("fleet_alerts_read_idx").on(t.isRead)
    ]);
    fleetAccountingJournalsTable = pgTable109("fleet_accounting_journals", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      reportId: integer100("report_id").references(() => fleetReportsTable.id, { onDelete: "set null" }),
      journalDate: date20("journal_date").notNull(),
      referenceNo: text108("reference_no"),
      status: text108("status").notNull().default("draft"),
      journalType: text108("journal_type").notNull().default("fleet_revenue"),
      revenueAccount: text108("revenue_account").default("Fleet Revenue"),
      grossRevenue: numeric56("gross_revenue", { precision: 18, scale: 2 }).default("0"),
      arAccount: text108("ar_account").default("Accounts Receivable"),
      outstandingAmount: numeric56("outstanding_amount", { precision: 18, scale: 2 }).default("0"),
      costAccount: text108("cost_account").default("Cost of Service - Fleet"),
      driverPayout: numeric56("driver_payout", { precision: 18, scale: 2 }).default("0"),
      ppnAccount: text108("ppn_account").default("PPN Keluaran"),
      ppnAmount: numeric56("ppn_amount", { precision: 18, scale: 2 }).default("0"),
      ppnRate: numeric56("ppn_rate", { precision: 5, scale: 2 }).default("11"),
      netRevenue: numeric56("net_revenue", { precision: 18, scale: 2 }).default("0"),
      commissionTotal: numeric56("commission_total", { precision: 18, scale: 2 }).default("0"),
      incentiveTotal: numeric56("incentive_total", { precision: 18, scale: 2 }).default("0"),
      periodStart: date20("period_start"),
      periodEnd: date20("period_end"),
      createdBy: text108("created_by"),
      approvedBy: text108("approved_by"),
      approvedAt: timestamp109("approved_at"),
      postedBy: text108("posted_by"),
      postedAt: timestamp109("posted_at"),
      notes: text108("notes"),
      rawStats: jsonb34("raw_stats"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_acc_journals_company_idx").on(t.companyId),
      index58("fleet_acc_journals_status_idx").on(t.status),
      index58("fleet_acc_journals_date_idx").on(t.journalDate)
    ]);
    fleetAlertSuppressionTable = pgTable109("fleet_alert_suppression", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      alertType: text108("alert_type").notNull(),
      referenceId: text108("reference_id").notNull(),
      suppressedUntil: timestamp109("suppressed_until").notNull(),
      createdAt: timestamp109("created_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex19("fleet_alert_sup_unique").on(t.companyId, t.alertType, t.referenceId)
    ]);
    fleetWaLogsTable = pgTable109("fleet_wa_logs", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      outstandingId: integer100("outstanding_id").references(() => fleetOutstandingTable.id, { onDelete: "set null" }),
      driverName: text108("driver_name"),
      driverPhone: text108("driver_phone"),
      vehiclePlate: text108("vehicle_plate"),
      outstandingAmount: numeric56("outstanding_amount", { precision: 18, scale: 2 }),
      message: text108("message"),
      sentBy: text108("sent_by").notNull().default("system"),
      sendType: text108("send_type").notNull().default("manual"),
      status: text108("status").notNull().default("sent"),
      sentAt: timestamp109("sent_at").defaultNow().notNull()
    }, (t) => [
      index58("fleet_wa_logs_company_idx").on(t.companyId, t.sentAt),
      index58("fleet_wa_logs_outstanding_idx").on(t.outstandingId)
    ]);
    fleetCashPaymentsTable = pgTable109("fleet_cash_payments", {
      id: serial107("id").primaryKey(),
      companyId: integer100("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
      outstandingId: integer100("outstanding_id").references(() => fleetOutstandingTable.id, { onDelete: "set null" }),
      driverId: integer100("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
      driverName: text108("driver_name").notNull(),
      driverExternalId: text108("driver_external_id"),
      driverPhone: text108("driver_phone"),
      vehiclePlate: text108("vehicle_plate"),
      paymentDate: date20("payment_date").notNull().defaultNow(),
      amount: numeric56("amount", { precision: 18, scale: 4 }).notNull(),
      paymentMethod: text108("payment_method").notNull().default("cash"),
      referenceNo: text108("reference_no"),
      notes: text108("notes"),
      recordedBy: text108("recorded_by"),
      status: text108("status").notNull().default("confirmed"),
      createdAt: timestamp109("created_at").defaultNow().notNull(),
      updatedAt: timestamp109("updated_at").defaultNow().notNull()
    }, (t) => [
      index58("fcp_company_idx").on(t.companyId),
      index58("fcp_driver_idx").on(t.driverId),
      index58("fcp_outstanding_idx").on(t.outstandingId),
      index58("fcp_date_idx").on(t.paymentDate),
      index58("fcp_ext_id_idx").on(t.driverExternalId)
    ]);
  }
});

// ../../lib/db/src/schema/systemErrorLogs.ts
import { pgTable as pgTable110, serial as serial108, integer as integer101, text as text109, timestamp as timestamp110, jsonb as jsonb35, pgEnum as pgEnum27 } from "drizzle-orm/pg-core";
var errorSeverityEnum, errorTypeEnum, systemErrorLogs;
var init_systemErrorLogs = __esm({
  "../../lib/db/src/schema/systemErrorLogs.ts"() {
    "use strict";
    errorSeverityEnum = pgEnum27("error_severity", ["low", "medium", "high", "critical"]);
    errorTypeEnum = pgEnum27("error_type_enum", ["ui_crash", "api_failure", "validation_error", "network_error", "unknown"]);
    systemErrorLogs = pgTable110("system_error_logs", {
      id: serial108("id").primaryKey(),
      company_id: integer101("company_id"),
      error_message: text109("error_message").notNull(),
      stack_trace: text109("stack_trace"),
      route: text109("route"),
      component: text109("component"),
      severity: errorSeverityEnum("severity").notNull().default("medium"),
      error_type: errorTypeEnum("error_type").notNull().default("unknown"),
      metadata: jsonb35("metadata"),
      created_at: timestamp110("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/btkiTariff.ts
import {
  pgTable as pgTable111,
  serial as serial109,
  text as text110,
  numeric as numeric57,
  boolean as boolean54,
  timestamp as timestamp111,
  index as index59,
  uniqueIndex as uniqueIndex20,
  jsonb as jsonb36
} from "drizzle-orm/pg-core";
var btkiTariffTable;
var init_btkiTariff = __esm({
  "../../lib/db/src/schema/btkiTariff.ts"() {
    "use strict";
    btkiTariffTable = pgTable111(
      "btki_tariff",
      {
        id: serial109("id").primaryKey(),
        hsCode: text110("hs_code").notNull(),
        hsCode6: text110("hs_code_6").notNull(),
        hsCode4: text110("hs_code_4").notNull(),
        hsCode2: text110("hs_code_2").notNull(),
        descriptionId: text110("description_id").notNull(),
        descriptionEn: text110("description_en"),
        unit: text110("unit"),
        bmMfn: numeric57("bm_mfn"),
        bmAcfta: numeric57("bm_acfta"),
        bmAfta: numeric57("bm_afta"),
        bmAifta: numeric57("bm_aifta"),
        bmAanzfta: numeric57("bm_aanzfta"),
        bmAhkfta: numeric57("bm_ahkfta"),
        bmAsfta: numeric57("bm_asfta"),
        bmAkfta: numeric57("bm_akfta"),
        bmIndonesiaAustralia: numeric57("bm_indonesia_australia"),
        ppnRate: numeric57("ppn_rate").default("11"),
        ppnbmRate: numeric57("ppnbm_rate").default("0"),
        pph22Rate: numeric57("pph22_rate").default("2.5"),
        pph22NonApi: numeric57("pph22_non_api").default("7.5"),
        lartasImport: boolean54("lartas_import").default(false),
        lartasExport: boolean54("lartas_export").default(false),
        lartasDesc: text110("lartas_desc"),
        regulatorImport: text110("regulator_import"),
        regulatorExport: text110("regulator_export"),
        perizinanImport: jsonb36("perizinan_import"),
        perizinanExport: jsonb36("perizinan_export"),
        // Spec fields: duty_export, export_duty_actual, royalty_rate, fta_flag, btki_version, source
        dutyExport: numeric57("duty_export"),
        exportDutyActual: numeric57("export_duty_actual"),
        royaltyRate: numeric57("royalty_rate"),
        ftaFlag: boolean54("fta_flag").default(false),
        btkiVersion: text110("btki_version").default("2022"),
        source: text110("source").default("BTKI 2022"),
        notes: text110("notes"),
        category: text110("category"),
        updatedAt: timestamp111("updated_at").defaultNow()
      },
      (t) => [
        uniqueIndex20("btki_hs_code_unique").on(t.hsCode),
        index59("btki_hs_code_6_idx").on(t.hsCode6),
        index59("btki_hs_code_4_idx").on(t.hsCode4),
        index59("btki_hs_code_2_idx").on(t.hsCode2),
        index59("btki_category_idx").on(t.category)
      ]
    );
  }
});

// ../../lib/db/src/schema/approvalMatrix.ts
import { pgTable as pgTable112, serial as serial110, text as text111, integer as integer102, boolean as boolean55, timestamp as timestamp112, numeric as numeric58, index as index60 } from "drizzle-orm/pg-core";
var approvalMatrixTable, approvalMatrixLevelTable;
var init_approvalMatrix = __esm({
  "../../lib/db/src/schema/approvalMatrix.ts"() {
    "use strict";
    init_companies();
    init_orgStructure();
    init_customRoles();
    init_suppliers();
    approvalMatrixTable = pgTable112("approval_matrix", {
      id: serial110("id").primaryKey(),
      companyId: integer102("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      name: text111("name").notNull(),
      module: text111("module").notNull().default("general"),
      departmentId: integer102("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
      currency: text111("currency"),
      vendorId: integer102("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
      description: text111("description"),
      isActive: boolean55("is_active").notNull().default(true),
      priority: integer102("priority").notNull().default(0),
      createdAt: timestamp112("created_at").defaultNow().notNull(),
      updatedAt: timestamp112("updated_at").defaultNow().notNull()
    }, (t) => [
      index60("approval_matrix_company_idx").on(t.companyId),
      index60("approval_matrix_module_idx").on(t.module)
    ]);
    approvalMatrixLevelTable = pgTable112("approval_matrix_levels", {
      id: serial110("id").primaryKey(),
      matrixId: integer102("matrix_id").references(() => approvalMatrixTable.id, { onDelete: "cascade" }).notNull(),
      level: integer102("level").notNull().default(1),
      label: text111("label"),
      minAmount: numeric58("min_amount", { precision: 18, scale: 2 }).notNull().default("0"),
      maxAmount: numeric58("max_amount", { precision: 18, scale: 2 }),
      approverRoleId: integer102("approver_role_id").references(() => customRolesTable.id, { onDelete: "set null" }),
      approverUserId: text111("approver_user_id"),
      createdAt: timestamp112("created_at").defaultNow().notNull()
    }, (t) => [
      index60("approval_matrix_levels_matrix_idx").on(t.matrixId)
    ]);
  }
});

// ../../lib/db/src/schema/portalQuickQuotes.ts
import { pgTable as pgTable113, serial as serial111, text as text112, timestamp as timestamp113, numeric as numeric59, jsonb as jsonb37 } from "drizzle-orm/pg-core";
var portalQuickQuotesTable;
var init_portalQuickQuotes = __esm({
  "../../lib/db/src/schema/portalQuickQuotes.ts"() {
    "use strict";
    portalQuickQuotesTable = pgTable113("portal_quick_quotes", {
      id: serial111("id").primaryKey(),
      quoteNumber: text112("quote_number").notNull().unique(),
      name: text112("name").notNull(),
      company: text112("company"),
      email: text112("email"),
      phone: text112("phone").notNull(),
      serviceCategory: text112("service_category").notNull(),
      origin: text112("origin"),
      destination: text112("destination"),
      commodity: text112("commodity"),
      weightKg: numeric59("weight_kg", { precision: 12, scale: 2 }),
      volume: text112("volume"),
      description: text112("description"),
      status: text112("status").notNull().default("new"),
      adminNotes: text112("admin_notes"),
      assignedTo: text112("assigned_to"),
      contactedAt: timestamp113("contacted_at"),
      meta: jsonb37("meta").default({}),
      createdAt: timestamp113("created_at").defaultNow().notNull(),
      updatedAt: timestamp113("updated_at").defaultNow()
    });
  }
});

// ../../lib/db/src/schema/portalCompanyMembers.ts
import {
  pgTable as pgTable114,
  serial as serial112,
  integer as integer103,
  text as text113,
  boolean as boolean56,
  numeric as numeric60,
  timestamp as timestamp114,
  uniqueIndex as uniqueIndex21,
  index as index61
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema33 } from "drizzle-zod";
var portalCompanyMembersTable, insertPortalCompanyMemberSchema;
var init_portalCompanyMembers = __esm({
  "../../lib/db/src/schema/portalCompanyMembers.ts"() {
    "use strict";
    init_companies();
    init_portalCustomers();
    portalCompanyMembersTable = pgTable114("portal_company_members", {
      id: serial112("id").primaryKey(),
      // FK — both sides of the bridge
      portalCustomerId: integer103("portal_customer_id").notNull().references(() => portalCustomersTable.id, { onDelete: "cascade" }),
      companyId: integer103("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
      // Procurement identity — snapshotted into mkt_rfqs at RFQ creation
      buyerRole: text113("buyer_role").notNull().default("requester"),
      // Valid values: requester | procurement | finance | admin | viewer
      // Stored as TEXT (not pgEnum) — extensible without DDL migration
      department: text113("department"),
      // mis. "Procurement", "Finance", "Operations"
      costCenter: text113("cost_center"),
      // mis. "CC-OPS-01", "PROJ-2024-TOLL"
      // Approval chain foundation (draft) — engine diimplementasikan di fase berikutnya
      approvalLevel: integer103("approval_level"),
      // NULL  = no approval config yet
      // 1     = self-approve
      // 2     = needs L1 approval (mis. procurement manager)
      // 3     = needs L1 + L2 (mis. finance director)
      spendingLimit: numeric60("spending_limit", { precision: 15, scale: 2 }),
      // NULL = unlimited / belum dikonfigurasi
      // Threshold yang nanti memicu requirement approval berdasarkan approval_level
      // Membership status
      isActive: boolean56("is_active").notNull().default(true),
      // Invitation audit
      invitedBy: integer103("invited_by").references(() => portalCustomersTable.id, {
        onDelete: "set null"
      }),
      invitedAt: timestamp114("invited_at"),
      joinedAt: timestamp114("joined_at"),
      createdAt: timestamp114("created_at").defaultNow().notNull(),
      updatedAt: timestamp114("updated_at").defaultNow().notNull()
    }, (t) => [
      // Satu portal customer hanya bisa menjadi member satu kali per company
      uniqueIndex21("pcm_unique_member").on(t.portalCustomerId, t.companyId),
      index61("pcm_company_idx").on(t.companyId),
      index61("pcm_portal_customer_idx").on(t.portalCustomerId),
      // Partial index — hanya active members yang sering di-query
      index61("pcm_active_company_idx").on(t.companyId, t.isActive)
    ]);
    insertPortalCompanyMemberSchema = createInsertSchema33(portalCompanyMembersTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktRfqLines.ts
import { pgTable as pgTable115, serial as serial113, text as text114, integer as integer104, numeric as numeric61, timestamp as timestamp115, index as index62 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema34 } from "drizzle-zod";
var mktRfqLinesTable, insertMktRfqLineSchema;
var init_mktRfqLines = __esm({
  "../../lib/db/src/schema/mktRfqLines.ts"() {
    "use strict";
    init_mktRfqs();
    init_suppliers();
    mktRfqLinesTable = pgTable115("mkt_rfq_lines", {
      id: serial113("id").primaryKey(),
      rfqId: integer104("rfq_id").notNull().references(() => mktRfqsTable.id, { onDelete: "cascade" }),
      vendorCatalogItemId: integer104("vendor_catalog_item_id").references(() => vendorCatalogItemsTable.id, { onDelete: "set null" }),
      // KEPUTUSAN #4
      itemName: text114("item_name").notNull(),
      // snapshot nama item saat RFQ dibuat
      itemDescription: text114("item_description"),
      itemUnit: text114("item_unit"),
      requestedQty: numeric61("requested_qty", { precision: 12, scale: 3 }).notNull().default("1"),
      targetPricePerUnit: numeric61("target_price_per_unit", { precision: 14, scale: 2 }),
      // budget buyer, opsional
      notes: text114("notes"),
      sortOrder: integer104("sort_order").notNull().default(0),
      createdAt: timestamp115("created_at").defaultNow().notNull(),
      updatedAt: timestamp115("updated_at").defaultNow().notNull()
    }, (t) => [
      index62("mkt_rfq_lines_rfq_idx").on(t.rfqId),
      index62("mkt_rfq_lines_vendor_catalog_item_idx").on(t.vendorCatalogItemId)
    ]);
    insertMktRfqLineSchema = createInsertSchema34(mktRfqLinesTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktRfqApprovals.ts
import {
  pgTable as pgTable116,
  serial as serial114,
  integer as integer105,
  text as text115,
  timestamp as timestamp116,
  index as index63
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema35 } from "drizzle-zod";
var mktRfqApprovalsTable, insertMktRfqApprovalSchema;
var init_mktRfqApprovals = __esm({
  "../../lib/db/src/schema/mktRfqApprovals.ts"() {
    "use strict";
    init_mktRfqs();
    init_portalCompanyMembers();
    mktRfqApprovalsTable = pgTable116("mkt_rfq_approvals", {
      id: serial114("id").primaryKey(),
      // FK ke RFQ yang dimintakan approval-nya
      rfqId: integer105("rfq_id").notNull().references(() => mktRfqsTable.id, { onDelete: "cascade" }),
      // Level approval (1 = L1, 2 = L2, dst.) — untuk multi-level future support
      approverLevel: integer105("approver_level").notNull().default(1),
      // Member yang bertanggung jawab atas approval ini (set pada waktu request, bisa NULL = terbuka)
      // Untuk Phase 2F: NULL = any eligible approver in same company can respond
      approverMemberId: integer105("approver_member_id").references(
        () => portalCompanyMembersTable.id,
        { onDelete: "set null" }
      ),
      // Approval status: pending | approved | rejected | delegated
      status: text115("status").notNull().default("pending"),
      // Timestamps
      requestedAt: timestamp116("requested_at").notNull().defaultNow(),
      respondedAt: timestamp116("responded_at"),
      // Catatan dari approver saat merespons
      responseNotes: text115("response_notes"),
      // Member yang benar-benar merespons (untuk audit — bisa berbeda dari approverMemberId)
      responderMemberId: integer105("responder_member_id").references(
        () => portalCompanyMembersTable.id,
        { onDelete: "set null" }
      ),
      createdAt: timestamp116("created_at").notNull().defaultNow()
    }, (t) => [
      index63("mkt_rfq_approvals_rfq_idx").on(t.rfqId),
      index63("mkt_rfq_approvals_status_idx").on(t.status),
      index63("mkt_rfq_approvals_approver_idx").on(t.approverMemberId)
    ]);
    insertMktRfqApprovalSchema = createInsertSchema35(mktRfqApprovalsTable).omit({
      id: true,
      createdAt: true,
      requestedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktDualWriteLog.ts
import {
  pgTable as pgTable117,
  bigserial,
  integer as integer106,
  text as text116,
  numeric as numeric62,
  jsonb as jsonb38,
  timestamp as timestamp117,
  index as index64,
  pgEnum as pgEnum28
} from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema36 } from "drizzle-zod";
import { z as z2 } from "zod/v4";
var mktDualWriteStatusEnum, mktDualWriteLogTable, insertMktDualWriteLogSchema;
var init_mktDualWriteLog = __esm({
  "../../lib/db/src/schema/mktDualWriteLog.ts"() {
    "use strict";
    mktDualWriteStatusEnum = pgEnum28("mkt_dual_write_status", [
      "pending",
      "success",
      "linked",
      "failed",
      "retrying",
      "exhausted"
    ]);
    mktDualWriteLogTable = pgTable117(
      "mkt_dual_write_log",
      {
        id: bigserial("id", { mode: "number" }).primaryKey(),
        // ── Structured fields (fast dashboard queries, diambil dari opts saat log dibuat)
        catalogItemId: integer106("catalog_item_id").notNull(),
        buyerName: text116("buyer_name").notNull().default(""),
        buyerEmail: text116("buyer_email").notNull(),
        buyerCompany: text116("buyer_company"),
        qty: numeric62("qty", { precision: 10, scale: 2 }).notNull().default("1"),
        unit: text116("unit").notNull().default("unit"),
        shippingAddress: text116("shipping_address"),
        // ── Full snapshot for retry (tidak re-fetch catalog saat retry)
        payload: jsonb38("payload").$type().notNull(),
        // ── State machine
        status: mktDualWriteStatusEnum("status").notNull().default("pending"),
        attempt: integer106("attempt").notNull().default(0),
        lastError: text116("last_error"),
        // ── New pipeline result (set saat success)
        mktRfqId: integer106("mkt_rfq_id"),
        mktRfqNumber: text116("mkt_rfq_number"),
        // ── Legacy backlink (set oleh linkLegacyOrder)
        portalOrderId: integer106("portal_order_id"),
        portalOrderNumber: text116("portal_order_number"),
        // ── Timestamps
        createdAt: timestamp117("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp117("updated_at", { withTimezone: true }).notNull().defaultNow(),
        lastRetryAt: timestamp117("last_retry_at", { withTimezone: true }),
        resolvedAt: timestamp117("resolved_at", { withTimezone: true }),
        // ── Retry timing (untuk average_retry_duration metric)
        retryStartedAt: timestamp117("retry_started_at", { withTimezone: true }),
        retryCompletedAt: timestamp117("retry_completed_at", { withTimezone: true }),
        // ── Resolution label
        resolution: text116("resolution")
        // AUTO_SUCCESS | AUTO_RETRIED | MANUAL_RECOVERY | EXHAUSTED
      },
      (t) => [
        index64("mdwl_status_idx").on(t.status),
        index64("mdwl_mkt_rfq_id_idx").on(t.mktRfqId),
        index64("mdwl_created_at_idx").on(t.createdAt),
        index64("mdwl_portal_order_id_idx").on(t.portalOrderId),
        index64("mdwl_buyer_email_idx").on(t.buyerEmail)
      ]
    );
    insertMktDualWriteLogSchema = createInsertSchema36(mktDualWriteLogTable, {
      qty: z2.union([z2.string(), z2.number()]).optional()
    }).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktVendorQuoteLines.ts
import { pgTable as pgTable118, serial as serial115, text as text117, integer as integer107, numeric as numeric63, timestamp as timestamp118, date as date21, pgEnum as pgEnum29, index as index65 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema37 } from "drizzle-zod";
var mktStockStatusEnum, mktVendorQuoteLinesTable, insertMktVendorQuoteLineSchema;
var init_mktVendorQuoteLines = __esm({
  "../../lib/db/src/schema/mktVendorQuoteLines.ts"() {
    "use strict";
    init_mktVendorQuotes();
    init_mktRfqLines();
    init_suppliers();
    mktStockStatusEnum = pgEnum29("mkt_stock_status", [
      "available",
      "limited",
      "backorder",
      "unavailable"
    ]);
    mktVendorQuoteLinesTable = pgTable118("mkt_vendor_quote_lines", {
      id: serial115("id").primaryKey(),
      quoteId: integer107("quote_id").notNull().references(() => mktVendorQuotesTable.id, { onDelete: "cascade" }),
      rfqLineId: integer107("rfq_line_id").notNull().references(() => mktRfqLinesTable.id, { onDelete: "cascade" }),
      vendorCatalogItemId: integer107("vendor_catalog_item_id").references(() => vendorCatalogItemsTable.id, { onDelete: "set null" }),
      offeredUnitPrice: numeric63("offered_unit_price", { precision: 14, scale: 2 }).notNull(),
      offeredQty: numeric63("offered_qty", { precision: 12, scale: 3 }).notNull(),
      subtotal: numeric63("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
      // ── Phase 2D — Vendor Quote Submission per-line fields [KEPUTUSAN #7-#9] ──
      currency: text117("currency"),
      // KEPUTUSAN #8 — ISO 4217 text, wajib saat submit
      minimumOrderQty: numeric63("minimum_order_qty", { precision: 12, scale: 3 }),
      // KEPUTUSAN #9 — opsional
      validUntil: date21("valid_until"),
      // KEPUTUSAN #9 — per-line, wajib saat submit, >= quotation_date
      leadTimeDays: integer107("lead_time_days"),
      stockStatus: mktStockStatusEnum("stock_status").default("available"),
      notes: text117("notes"),
      createdAt: timestamp118("created_at").defaultNow().notNull(),
      updatedAt: timestamp118("updated_at").defaultNow().notNull()
    }, (t) => [
      index65("mkt_vendor_quote_lines_quote_idx").on(t.quoteId),
      index65("mkt_vendor_quote_lines_rfq_line_idx").on(t.rfqLineId),
      index65("mkt_vendor_quote_lines_vendor_catalog_item_idx").on(t.vendorCatalogItemId)
    ]);
    insertMktVendorQuoteLineSchema = createInsertSchema37(mktVendorQuoteLinesTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktRfqGuestClaims.ts
import { pgTable as pgTable119, serial as serial116, text as text118, integer as integer108, timestamp as timestamp119, pgEnum as pgEnum30, index as index66 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema38 } from "drizzle-zod";
var mktClaimStatusEnum, mktRfqGuestClaimsTable, insertMktRfqGuestClaimSchema;
var init_mktRfqGuestClaims = __esm({
  "../../lib/db/src/schema/mktRfqGuestClaims.ts"() {
    "use strict";
    init_mktRfqs();
    mktClaimStatusEnum = pgEnum30("mkt_claim_status", [
      "pending",
      "claimed",
      "expired"
    ]);
    mktRfqGuestClaimsTable = pgTable119("mkt_rfq_guest_claims", {
      id: serial116("id").primaryKey(),
      rfqId: integer108("rfq_id").notNull().references(() => mktRfqsTable.id, { onDelete: "cascade" }),
      guestEmail: text118("guest_email").notNull(),
      guestToken: text118("guest_token").notNull(),
      // token dari mkt_rfqs.guest_token
      claimedByUserId: text118("claimed_by_user_id"),
      // user_id setelah login/register
      claimStatus: mktClaimStatusEnum("claim_status").notNull().default("pending"),
      claimedAt: timestamp119("claimed_at"),
      expiresAt: timestamp119("expires_at").notNull(),
      // token claim expired dalam 7 hari
      createdAt: timestamp119("created_at").defaultNow().notNull()
    }, (t) => [
      index66("mkt_rfq_guest_claims_rfq_idx").on(t.rfqId),
      index66("mkt_rfq_guest_claims_guest_token_idx").on(t.guestToken),
      index66("mkt_rfq_guest_claims_status_idx").on(t.claimStatus)
    ]);
    insertMktRfqGuestClaimSchema = createInsertSchema38(mktRfqGuestClaimsTable).omit({
      id: true,
      createdAt: true
    });
  }
});

// ../../lib/db/src/schema/mktCompanySettings.ts
import { pgTable as pgTable120, serial as serial117, integer as integer109, text as text119, jsonb as jsonb39, timestamp as timestamp120, uniqueIndex as uniqueIndex22, index as index67 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema39 } from "drizzle-zod";
var mktCompanySettingsTable, insertMktCompanySettingSchema;
var init_mktCompanySettings = __esm({
  "../../lib/db/src/schema/mktCompanySettings.ts"() {
    "use strict";
    init_companies();
    mktCompanySettingsTable = pgTable120("mkt_company_settings", {
      id: serial117("id").primaryKey(),
      companyId: integer109("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
      // NULL = global default
      settingKey: text119("setting_key").notNull(),
      // contoh: 'mkt_coa_commission_revenue'
      settingValue: jsonb39("setting_value").notNull().$type(),
      // fleksibel: FK id, angka, string, dll
      description: text119("description"),
      createdAt: timestamp120("created_at").defaultNow().notNull(),
      updatedAt: timestamp120("updated_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex22("mkt_company_settings_company_key_uniq").on(t.companyId, t.settingKey),
      index67("mkt_company_settings_key_idx").on(t.settingKey)
    ]);
    insertMktCompanySettingSchema = createInsertSchema39(mktCompanySettingsTable).omit({
      id: true,
      createdAt: true,
      updatedAt: true
    });
  }
});

// ../../lib/db/src/schema/mktNotificationQueue.ts
import {
  pgTable as pgTable121,
  serial as serial118,
  text as text120,
  integer as integer110,
  jsonb as jsonb40,
  timestamp as timestamp121
} from "drizzle-orm/pg-core";
var mktNotificationQueueTable;
var init_mktNotificationQueue = __esm({
  "../../lib/db/src/schema/mktNotificationQueue.ts"() {
    "use strict";
    mktNotificationQueueTable = pgTable121("mkt_notification_queue", {
      id: serial118("id").primaryKey(),
      eventType: text120("event_type").notNull(),
      channel: text120("channel").notNull().default("whatsapp"),
      recipientType: text120("recipient_type").notNull(),
      recipientId: integer110("recipient_id"),
      recipientPhone: text120("recipient_phone"),
      rfqId: integer110("rfq_id"),
      vendorQuoteId: integer110("vendor_quote_id"),
      purchaseOrderId: integer110("purchase_order_id"),
      payloadJson: jsonb40("payload_json").notNull().default({}),
      status: text120("status").notNull().default("pending"),
      attemptCount: integer110("attempt_count").notNull().default(0),
      maxAttempts: integer110("max_attempts").notNull().default(3),
      lastError: text120("last_error"),
      nextRetryAt: timestamp121("next_retry_at", { withTimezone: true }),
      sentAt: timestamp121("sent_at", { withTimezone: true }),
      deduplicationKey: text120("deduplication_key"),
      createdAt: timestamp121("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp121("updated_at", { withTimezone: true }).notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/mktFeaturedProduct.ts
import {
  pgTable as pgTable122,
  serial as serial119,
  integer as integer111,
  text as text121,
  numeric as numeric64,
  boolean as boolean58,
  timestamp as timestamp122
} from "drizzle-orm/pg-core";
var mktFeaturedPackagesTable, mktFeaturedProductRequestsTable;
var init_mktFeaturedProduct = __esm({
  "../../lib/db/src/schema/mktFeaturedProduct.ts"() {
    "use strict";
    init_suppliers();
    init_companies();
    mktFeaturedPackagesTable = pgTable122("mkt_featured_packages", {
      id: serial119("id").primaryKey(),
      code: text121("code").notNull().unique(),
      name: text121("name").notNull(),
      description: text121("description"),
      durationDays: integer111("duration_days").notNull(),
      price: numeric64("price", { precision: 15, scale: 2 }).notNull().default("0"),
      currency: text121("currency").notNull().default("IDR"),
      placementType: text121("placement_type").notNull().default("homepage_top"),
      priorityWeight: integer111("priority_weight").notNull().default(0),
      categoryId: integer111("category_id"),
      internalOnly: boolean58("internal_only").notNull().default(false),
      isActive: boolean58("is_active").notNull().default(true),
      createdAt: timestamp122("created_at").notNull().defaultNow(),
      updatedAt: timestamp122("updated_at").notNull().defaultNow()
    });
    mktFeaturedProductRequestsTable = pgTable122("mkt_featured_product_requests", {
      id: serial119("id").primaryKey(),
      companyId: integer111("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      vendorId: integer111("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
      catalogItemId: integer111("catalog_item_id").notNull().references(() => vendorCatalogItemsTable.id, { onDelete: "cascade" }),
      packageId: integer111("package_id").notNull().references(() => mktFeaturedPackagesTable.id),
      status: text121("status").notNull().default("pending"),
      // pending | approved | rejected | active | expired | cancelled
      requestedStartAt: timestamp122("requested_start_at").notNull(),
      requestedEndAt: timestamp122("requested_end_at").notNull(),
      approvedStartAt: timestamp122("approved_start_at"),
      approvedEndAt: timestamp122("approved_end_at"),
      price: numeric64("price", { precision: 15, scale: 2 }).notNull().default("0"),
      currency: text121("currency").notNull().default("IDR"),
      paymentStatus: text121("payment_status").notNull().default("unpaid"),
      // unpaid | pending_verification | verified | rejected | refunded
      paymentReference: text121("payment_reference"),
      paymentProofUrl: text121("payment_proof_url"),
      paymentProofToken: text121("payment_proof_token").unique(),
      adminNotes: text121("admin_notes"),
      rejectionReason: text121("rejection_reason"),
      approvedBy: text121("approved_by"),
      approvedAt: timestamp122("approved_at"),
      rejectedBy: text121("rejected_by"),
      rejectedAt: timestamp122("rejected_at"),
      activatedAt: timestamp122("activated_at"),
      expiredAt: timestamp122("expired_at"),
      cancelledAt: timestamp122("cancelled_at"),
      createdAt: timestamp122("created_at").notNull().defaultNow(),
      updatedAt: timestamp122("updated_at").notNull().defaultNow()
    });
  }
});

// ../../lib/db/src/schema/mktPoShipmentItems.ts
import { pgTable as pgTable123, serial as serial120, text as text122, integer as integer112, numeric as numeric65, timestamp as timestamp123, index as index68 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema40 } from "drizzle-zod";
var mktPoShipmentItemsTable, insertMktPoShipmentItemSchema;
var init_mktPoShipmentItems = __esm({
  "../../lib/db/src/schema/mktPoShipmentItems.ts"() {
    "use strict";
    init_mktPoShipments();
    init_mktPurchaseOrderLines();
    mktPoShipmentItemsTable = pgTable123("mkt_po_shipment_items", {
      id: serial120("id").primaryKey(),
      shipmentId: integer112("shipment_id").notNull().references(() => mktPoShipmentsTable.id, { onDelete: "cascade" }),
      poLineId: integer112("po_line_id").notNull().references(() => mktPurchaseOrderLinesTable.id, { onDelete: "restrict" }),
      lineNumber: integer112("line_number").notNull(),
      // consistent display order within the shipment
      qty: numeric65("qty", { precision: 14, scale: 2 }).notNull(),
      uom: text122("uom"),
      // snapshot from PO line's unit
      weight: numeric65("weight", { precision: 12, scale: 3 }),
      volume: numeric65("volume", { precision: 12, scale: 3 }),
      packageCount: integer112("package_count"),
      remarks: text122("remarks"),
      createdAt: timestamp123("created_at").defaultNow().notNull()
    }, (t) => [
      index68("mkt_po_shipment_items_shipment_idx").on(t.shipmentId),
      index68("mkt_po_shipment_items_po_line_idx").on(t.poLineId)
    ]);
    insertMktPoShipmentItemSchema = createInsertSchema40(mktPoShipmentItemsTable).omit({
      id: true,
      createdAt: true
    });
  }
});

// ../../lib/db/src/schema/mktPoShipmentEvents.ts
import { pgTable as pgTable124, serial as serial121, text as text123, integer as integer113, numeric as numeric66, timestamp as timestamp124, index as index69, uniqueIndex as uniqueIndex23 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema41 } from "drizzle-zod";
var mktPoShipmentEventsTable, insertMktPoShipmentEventSchema;
var init_mktPoShipmentEvents = __esm({
  "../../lib/db/src/schema/mktPoShipmentEvents.ts"() {
    "use strict";
    init_mktPoShipments();
    mktPoShipmentEventsTable = pgTable124("mkt_po_shipment_events", {
      id: serial121("id").primaryKey(),
      shipmentId: integer113("shipment_id").notNull().references(() => mktPoShipmentsTable.id, { onDelete: "cascade" }),
      eventSequence: integer113("event_sequence").notNull(),
      eventType: text123("event_type").notNull(),
      // packing | loaded | departed | arrived | delivered | completed
      note: text123("note"),
      location: text123("location"),
      latitude: numeric66("latitude", { precision: 10, scale: 7 }),
      longitude: numeric66("longitude", { precision: 10, scale: 7 }),
      attachmentObjectPath: text123("attachment_object_path"),
      actorType: text123("actor_type").notNull().default("vendor"),
      // vendor | admin | system
      actorId: text123("actor_id"),
      createdAt: timestamp124("created_at").defaultNow().notNull()
    }, (t) => [
      index69("mkt_po_shipment_events_shipment_idx").on(t.shipmentId),
      index69("mkt_po_shipment_events_shipment_created_idx").on(t.shipmentId, t.createdAt),
      uniqueIndex23("mkt_po_shipment_events_shipment_seq_unique").on(t.shipmentId, t.eventSequence)
    ]);
    insertMktPoShipmentEventSchema = createInsertSchema41(mktPoShipmentEventsTable).omit({
      id: true,
      createdAt: true
    });
  }
});

// ../../lib/db/src/schema/mktPoGoodsReceiptItems.ts
import { pgTable as pgTable125, serial as serial122, text as text124, integer as integer114, numeric as numeric67, timestamp as timestamp125, index as index70 } from "drizzle-orm/pg-core";
import { createInsertSchema as createInsertSchema42 } from "drizzle-zod";
var mktPoGoodsReceiptItemsTable, insertMktPoGoodsReceiptItemSchema;
var init_mktPoGoodsReceiptItems = __esm({
  "../../lib/db/src/schema/mktPoGoodsReceiptItems.ts"() {
    "use strict";
    init_mktPoGoodsReceipts();
    init_mktPoShipmentItems();
    mktPoGoodsReceiptItemsTable = pgTable125("mkt_po_goods_receipt_items", {
      id: serial122("id").primaryKey(),
      goodsReceiptId: integer114("goods_receipt_id").notNull().references(() => mktPoGoodsReceiptsTable.id, { onDelete: "cascade" }),
      shipmentItemId: integer114("shipment_item_id").notNull().references(() => mktPoShipmentItemsTable.id, { onDelete: "restrict" }),
      receivedQty: numeric67("received_qty", { precision: 14, scale: 2 }).notNull(),
      acceptedQty: numeric67("accepted_qty", { precision: 14, scale: 2 }).notNull().default("0"),
      rejectedQty: numeric67("rejected_qty", { precision: 14, scale: 2 }).notNull().default("0"),
      condition: text124("condition").notNull().default("GOOD"),
      // GOOD | DAMAGED | SHORTAGE | REJECTED
      notes: text124("notes"),
      createdAt: timestamp125("created_at").defaultNow().notNull()
    }, (t) => [
      index70("mkt_po_goods_receipt_items_receipt_idx").on(t.goodsReceiptId),
      index70("mkt_po_goods_receipt_items_shipment_item_idx").on(t.shipmentItemId)
    ]);
    insertMktPoGoodsReceiptItemSchema = createInsertSchema42(mktPoGoodsReceiptItemsTable).omit({
      id: true,
      createdAt: true
    });
  }
});

// ../../lib/db/src/schema/mktApPreparations.ts
import {
  pgEnum as pgEnum31,
  pgTable as pgTable126,
  serial as serial123,
  integer as integer115,
  numeric as numeric68,
  text as text125,
  timestamp as timestamp126,
  uniqueIndex as uniqueIndex24,
  index as index71
} from "drizzle-orm/pg-core";
var mktApPreparationStatusEnum, mktApPreparationsTable;
var init_mktApPreparations = __esm({
  "../../lib/db/src/schema/mktApPreparations.ts"() {
    "use strict";
    init_companies();
    init_suppliers();
    init_purchaseWorkflow();
    init_purchaseWorkflow();
    init_mktPurchaseOrders();
    init_mktPoGoodsReceipts();
    mktApPreparationStatusEnum = pgEnum31("mkt_ap_preparation_status", [
      "ap_preparation",
      "finance_review",
      "waiting_payment"
    ]);
    mktApPreparationsTable = pgTable126("mkt_ap_preparations", {
      id: serial123("id").primaryKey(),
      preparationNumber: text125("preparation_number").notNull().unique(),
      vendorInvoiceId: integer115("vendor_invoice_id").notNull().references(() => vendorInvoicesTable.id, { onDelete: "restrict" }),
      mktPurchaseOrderId: integer115("mkt_purchase_order_id").notNull().references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
      mktGoodsReceiptId: integer115("mkt_goods_receipt_id").notNull().references(() => mktPoGoodsReceiptsTable.id, { onDelete: "restrict" }),
      companyId: integer115("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      supplierId: integer115("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
      supplierName: text125("supplier_name").notNull(),
      invoiceNumberSnapshot: text125("invoice_number_snapshot").notNull(),
      vendorInvoiceRefSnapshot: text125("vendor_invoice_ref_snapshot"),
      currencySnapshot: text125("currency_snapshot").notNull(),
      totalAmountSnapshot: numeric68("total_amount_snapshot", { precision: 14, scale: 2 }).notNull(),
      taxAmountSnapshot: numeric68("tax_amount_snapshot", { precision: 14, scale: 2 }).notNull(),
      grandTotalSnapshot: numeric68("grand_total_snapshot", { precision: 14, scale: 2 }).notNull(),
      status: mktApPreparationStatusEnum("status").notNull().default("ap_preparation"),
      notes: text125("notes"),
      financeReviewedBy: text125("finance_reviewed_by"),
      financeReviewedAt: timestamp126("finance_reviewed_at"),
      waitingPaymentAt: timestamp126("waiting_payment_at"),
      paymentRequestId: integer115("payment_request_id").references(() => paymentRequestsTable.id, { onDelete: "set null" }),
      paymentHandoffAt: timestamp126("payment_handoff_at"),
      paymentHandoffBy: text125("payment_handoff_by"),
      createdBy: text125("created_by"),
      createdAt: timestamp126("created_at").defaultNow().notNull(),
      updatedAt: timestamp126("updated_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex24("mkt_ap_preparations_invoice_unique").on(t.vendorInvoiceId),
      index71("mkt_ap_preparations_status_idx").on(t.status),
      index71("mkt_ap_preparations_company_idx").on(t.companyId),
      index71("mkt_ap_preparations_vendor_idx").on(t.supplierId),
      uniqueIndex24("mkt_ap_preparations_payment_request_unique").on(t.paymentRequestId)
    ]);
  }
});

// ../../lib/db/src/schema/mktPaymentExecutionAttempts.ts
import {
  integer as integer116,
  index as index72,
  serial as serial124,
  text as text126,
  timestamp as timestamp127,
  uniqueIndex as uniqueIndex25,
  pgTable as pgTable127
} from "drizzle-orm/pg-core";
var mktPaymentExecutionAttemptsTable;
var init_mktPaymentExecutionAttempts = __esm({
  "../../lib/db/src/schema/mktPaymentExecutionAttempts.ts"() {
    "use strict";
    init_purchaseWorkflow();
    mktPaymentExecutionAttemptsTable = pgTable127("mkt_payment_execution_attempts", {
      id: serial124("id").primaryKey(),
      paymentRequestId: integer116("payment_request_id").notNull().references(() => paymentRequestsTable.id, { onDelete: "cascade" }),
      attemptNumber: integer116("attempt_number").notNull(),
      status: text126("status").notNull(),
      idempotencyKey: text126("idempotency_key").notNull(),
      failureCode: text126("failure_code"),
      failureReason: text126("failure_reason"),
      failedAt: timestamp127("failed_at"),
      failedBy: text126("failed_by"),
      providerReference: text126("provider_reference"),
      startedAt: timestamp127("started_at"),
      completedAt: timestamp127("completed_at"),
      createdBy: text126("created_by"),
      createdAt: timestamp127("created_at").defaultNow().notNull(),
      updatedAt: timestamp127("updated_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex25("mkt_payment_attempt_request_number_unique").on(t.paymentRequestId, t.attemptNumber),
      uniqueIndex25("mkt_payment_attempt_idempotency_unique").on(t.idempotencyKey),
      index72("mkt_payment_attempt_request_idx").on(t.paymentRequestId),
      index72("mkt_payment_attempt_status_idx").on(t.status)
    ]);
  }
});

// ../../lib/db/src/schema/mktAccountingHandoffs.ts
import {
  index as index73,
  integer as integer117,
  jsonb as jsonb41,
  numeric as numeric69,
  serial as serial125,
  text as text127,
  timestamp as timestamp128,
  uniqueIndex as uniqueIndex26,
  pgTable as pgTable128
} from "drizzle-orm/pg-core";
var mktAccountingHandoffsTable;
var init_mktAccountingHandoffs = __esm({
  "../../lib/db/src/schema/mktAccountingHandoffs.ts"() {
    "use strict";
    init_companies();
    init_suppliers();
    init_purchaseWorkflow();
    init_purchaseWorkflow();
    init_mktApPreparations();
    init_mktPurchaseOrders();
    init_mktPoGoodsReceipts();
    mktAccountingHandoffsTable = pgTable128("mkt_accounting_handoffs", {
      id: serial125("id").primaryKey(),
      handoffKey: text127("handoff_key").notNull(),
      correlationReference: text127("correlation_reference").notNull(),
      payloadFingerprint: text127("payload_fingerprint").notNull(),
      apPreparationId: integer117("ap_preparation_id").notNull().references(() => mktApPreparationsTable.id, { onDelete: "restrict" }),
      vendorInvoiceId: integer117("vendor_invoice_id").notNull().references(() => vendorInvoicesTable.id, { onDelete: "restrict" }),
      mktPurchaseOrderId: integer117("mkt_purchase_order_id").notNull().references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
      mktGoodsReceiptId: integer117("mkt_goods_receipt_id").notNull().references(() => mktPoGoodsReceiptsTable.id, { onDelete: "restrict" }),
      paymentRequestId: integer117("payment_request_id").notNull().references(() => paymentRequestsTable.id, { onDelete: "restrict" }),
      companyId: integer117("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      supplierId: integer117("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
      currency: text127("currency").notNull(),
      amount: numeric69("amount", { precision: 14, scale: 2 }).notNull(),
      approvalState: text127("approval_state").notNull(),
      paymentLifecycleState: text127("payment_lifecycle_state").notNull(),
      status: text127("status").notNull().default("accepted"),
      accountingReference: text127("accounting_reference"),
      accountingStatus: text127("accounting_status"),
      failureCode: text127("failure_code"),
      failureReason: text127("failure_reason"),
      payload: jsonb41("payload").notNull(),
      requestedBy: text127("requested_by"),
      acceptedAt: timestamp128("accepted_at"),
      lastResponseAt: timestamp128("last_response_at"),
      createdAt: timestamp128("created_at").defaultNow().notNull(),
      updatedAt: timestamp128("updated_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex26("mkt_accounting_handoffs_key_unique").on(t.handoffKey),
      uniqueIndex26("mkt_accounting_handoffs_correlation_unique").on(t.correlationReference),
      uniqueIndex26("mkt_accounting_handoffs_ap_unique").on(t.apPreparationId),
      index73("mkt_accounting_handoffs_company_idx").on(t.companyId),
      index73("mkt_accounting_handoffs_status_idx").on(t.status),
      index73("mkt_accounting_handoffs_payment_idx").on(t.paymentRequestId)
    ]);
  }
});

// ../../lib/db/src/schema/mktReconciliationLinks.ts
import {
  index as index74,
  integer as integer118,
  jsonb as jsonb42,
  numeric as numeric70,
  serial as serial126,
  text as text128,
  timestamp as timestamp129,
  uniqueIndex as uniqueIndex27,
  pgTable as pgTable129
} from "drizzle-orm/pg-core";
var mktReconciliationLinksTable;
var init_mktReconciliationLinks = __esm({
  "../../lib/db/src/schema/mktReconciliationLinks.ts"() {
    "use strict";
    init_companies();
    init_suppliers();
    init_purchaseWorkflow();
    init_mktApPreparations();
    init_mktAccountingHandoffs();
    init_mktPurchaseOrders();
    mktReconciliationLinksTable = pgTable129("mkt_reconciliation_links", {
      id: serial126("id").primaryKey(),
      linkKey: text128("link_key").notNull(),
      correlationReference: text128("correlation_reference").notNull(),
      payloadFingerprint: text128("payload_fingerprint").notNull(),
      accountingHandoffId: integer118("accounting_handoff_id").notNull().references(() => mktAccountingHandoffsTable.id, { onDelete: "restrict" }),
      apPreparationId: integer118("ap_preparation_id").notNull().references(() => mktApPreparationsTable.id, { onDelete: "restrict" }),
      mktPurchaseOrderId: integer118("mkt_purchase_order_id").notNull().references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
      paymentRequestId: integer118("payment_request_id").notNull().references(() => paymentRequestsTable.id, { onDelete: "restrict" }),
      companyId: integer118("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
      supplierId: integer118("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "restrict" }),
      currency: text128("currency").notNull(),
      amount: numeric70("amount", { precision: 14, scale: 2 }).notNull(),
      paymentReference: text128("payment_reference").notNull(),
      accountingReference: text128("accounting_reference").notNull(),
      marketplaceReference: text128("marketplace_reference").notNull(),
      status: text128("status").notNull().default("created"),
      payload: jsonb42("payload").notNull(),
      requestedBy: text128("requested_by"),
      createdAt: timestamp129("created_at").defaultNow().notNull(),
      updatedAt: timestamp129("updated_at").defaultNow().notNull()
    }, (t) => [
      uniqueIndex27("mkt_reconciliation_links_key_unique").on(t.linkKey),
      uniqueIndex27("mkt_reconciliation_links_correlation_unique").on(t.correlationReference),
      uniqueIndex27("mkt_reconciliation_links_handoff_unique").on(t.accountingHandoffId),
      uniqueIndex27("mkt_reconciliation_links_payment_unique").on(t.paymentRequestId),
      index74("mkt_reconciliation_links_company_idx").on(t.companyId),
      index74("mkt_reconciliation_links_po_idx").on(t.mktPurchaseOrderId),
      index74("mkt_reconciliation_links_status_idx").on(t.status)
    ]);
  }
});

// ../../lib/db/src/schema/adminNotifications.ts
import {
  pgTable as pgTable130,
  serial as serial127,
  integer as integer119,
  text as text129,
  timestamp as timestamp130,
  jsonb as jsonb43,
  index as index75
} from "drizzle-orm/pg-core";
var adminNotificationsTable;
var init_adminNotifications = __esm({
  "../../lib/db/src/schema/adminNotifications.ts"() {
    "use strict";
    adminNotificationsTable = pgTable130("admin_notifications", {
      id: serial127("id").primaryKey(),
      type: text129("type").notNull(),
      orderId: integer119("order_id"),
      orderNumber: text129("order_number").notNull(),
      customerName: text129("customer_name").notNull(),
      companyName: text129("company_name"),
      payload: jsonb43("payload").$type().notNull().default({}),
      title: text129("title").notNull().default(""),
      body: text129("body").notNull().default(""),
      readAt: timestamp130("read_at", { withTimezone: true }),
      createdAt: timestamp130("created_at", { withTimezone: true }).defaultNow().notNull()
    }, (t) => [
      index75("admin_notif_type_idx").on(t.type),
      index75("admin_notif_read_idx").on(t.readAt),
      index75("admin_notif_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/vendorNotifications.ts
import {
  pgTable as pgTable131,
  serial as serial128,
  integer as integer120,
  text as text130,
  boolean as boolean59,
  timestamp as timestamp131,
  jsonb as jsonb44,
  index as index76
} from "drizzle-orm/pg-core";
var vendorNotificationsTable;
var init_vendorNotifications = __esm({
  "../../lib/db/src/schema/vendorNotifications.ts"() {
    "use strict";
    init_portalCustomers();
    vendorNotificationsTable = pgTable131("vendor_notifications", {
      id: serial128("id").primaryKey(),
      /** portal_customers.id of the vendor whose notification this is */
      vendorId: integer120("vendor_id").references(() => portalCustomersTable.id, { onDelete: "cascade" }).notNull(),
      /** Discriminator: vendor_approved | product_approved | product_rejected */
      type: text130("type").notNull(),
      title: text130("title").notNull(),
      message: text130("message").notNull(),
      payload: jsonb44("payload").$type().notNull().default({}),
      isRead: boolean59("is_read").notNull().default(false),
      createdAt: timestamp131("created_at").defaultNow().notNull(),
      readAt: timestamp131("read_at")
    }, (t) => [
      index76("vn_vendor_idx").on(t.vendorId),
      index76("vn_is_read_idx").on(t.isRead),
      index76("vn_created_idx").on(t.createdAt)
    ]);
  }
});

// ../../lib/db/src/schema/taxAudit.ts
import {
  pgTable as pgTable132,
  serial as serial129,
  integer as integer121,
  text as text131,
  numeric as numeric71,
  timestamp as timestamp132,
  jsonb as jsonb45,
  uuid,
  index as index77,
  uniqueIndex as uniqueIndex28
} from "drizzle-orm/pg-core";
var taxAdjustmentsTable, taxAuditLogsTable, taxSptDraftsTable, taxPeriodsTable, taxExportBatchesTable, taxExportRowsTable;
var init_taxAudit = __esm({
  "../../lib/db/src/schema/taxAudit.ts"() {
    "use strict";
    init_accounting();
    taxAdjustmentsTable = pgTable132("tax_adjustments", {
      id: uuid("id").primaryKey().defaultRandom(),
      companyId: integer121("company_id").notNull(),
      transactionTaxId: integer121("transaction_tax_id").notNull().references(() => transactionTaxesTable.id, { onDelete: "restrict" }),
      adjustmentType: text131("adjustment_type").notNull(),
      oldValue: jsonb45("old_value"),
      newValue: jsonb45("new_value"),
      reason: text131("reason").notNull(),
      createdBy: text131("created_by").notNull(),
      createdAt: timestamp132("created_at", { withTimezone: true }).notNull().defaultNow(),
      approvedBy: text131("approved_by"),
      approvedAt: timestamp132("approved_at", { withTimezone: true }),
      rejectedBy: text131("rejected_by"),
      rejectedAt: timestamp132("rejected_at", { withTimezone: true }),
      rejectionReason: text131("rejection_reason"),
      status: text131("status").notNull().default("PENDING")
    }, (t) => ({
      companyStatusIdx: index77("tax_adj_company_idx").on(t.companyId, t.status),
      txTaxIdx: index77("tax_adj_tx_tax_idx").on(t.transactionTaxId)
    }));
    taxAuditLogsTable = pgTable132("tax_audit_logs", {
      id: uuid("id").primaryKey().defaultRandom(),
      companyId: integer121("company_id").notNull(),
      entityType: text131("entity_type").notNull(),
      entityId: text131("entity_id").notNull(),
      action: text131("action").notNull(),
      beforeData: jsonb45("before_data"),
      afterData: jsonb45("after_data"),
      performedBy: text131("performed_by").notNull(),
      ipAddress: text131("ip_address"),
      timestamp: timestamp132("timestamp", { withTimezone: true }).notNull().defaultNow()
    }, (t) => ({
      companyTimestampIdx: index77("tax_audit_logs_company_idx").on(t.companyId, t.timestamp),
      entityIdx: index77("tax_audit_logs_entity_idx").on(t.entityType, t.entityId)
    }));
    taxSptDraftsTable = pgTable132("tax_spt_drafts", {
      id: serial129("id").primaryKey(),
      companyId: integer121("company_id").notNull(),
      period: text131("period").notNull(),
      type: text131("type").notNull(),
      status: text131("status").notNull().default("draft"),
      payloadJson: jsonb45("payload_json"),
      notes: text131("notes"),
      createdAt: timestamp132("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp132("updated_at", { withTimezone: true }).notNull().defaultNow()
    }, (t) => ({
      companyPeriodIdx: index77("idx_tax_spt_drafts_company_period").on(t.companyId, t.period, t.type)
    }));
    taxPeriodsTable = pgTable132("tax_periods", {
      id: serial129("id").primaryKey(),
      companyId: integer121("company_id").notNull(),
      taxPeriod: text131("tax_period").notNull(),
      taxType: text131("tax_type").notNull().default("ALL"),
      status: text131("status").notNull().default("open"),
      lockedAt: timestamp132("locked_at", { withTimezone: true }),
      lockedBy: text131("locked_by"),
      exportedAt: timestamp132("exported_at", { withTimezone: true }),
      exportedBy: text131("exported_by"),
      revisedAt: timestamp132("revised_at", { withTimezone: true }),
      revisedBy: text131("revised_by"),
      notes: text131("notes"),
      createdAt: timestamp132("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp132("updated_at", { withTimezone: true }).notNull().defaultNow()
    }, (t) => ({
      companyPeriodTypeUniq: uniqueIndex28("tax_periods_company_period_type_uniq").on(t.companyId, t.taxPeriod, t.taxType),
      statusIdx: index77("tax_periods_status_idx").on(t.companyId, t.status)
    }));
    taxExportBatchesTable = pgTable132("tax_export_batches", {
      id: serial129("id").primaryKey(),
      companyId: integer121("company_id").notNull(),
      taxPeriod: text131("tax_period").notNull(),
      taxType: text131("tax_type").notNull(),
      exportType: text131("export_type").notNull().default("CSV"),
      status: text131("status").notNull().default("pending"),
      fileName: text131("file_name"),
      rowCount: integer121("row_count").notNull().default(0),
      totalDpp: numeric71("total_dpp", { precision: 18, scale: 2 }).notNull().default("0"),
      totalTax: numeric71("total_tax", { precision: 18, scale: 2 }).notNull().default("0"),
      createdBy: text131("created_by").notNull(),
      createdAt: timestamp132("created_at", { withTimezone: true }).notNull().defaultNow()
    }, (t) => ({
      companyPeriodIdx: index77("tax_export_batches_company_period_idx").on(t.companyId, t.taxPeriod)
    }));
    taxExportRowsTable = pgTable132("tax_export_rows", {
      id: serial129("id").primaryKey(),
      batchId: integer121("batch_id").notNull().references(() => taxExportBatchesTable.id, { onDelete: "cascade" }),
      transactionTaxId: integer121("transaction_tax_id").references(() => transactionTaxesTable.id, { onDelete: "set null" }),
      rowNumber: integer121("row_number").notNull(),
      rowData: jsonb45("row_data").notNull(),
      validationErrors: jsonb45("validation_errors").notNull().default([]),
      createdAt: timestamp132("created_at", { withTimezone: true }).notNull().defaultNow()
    }, (t) => ({
      batchIdx: index77("tax_export_rows_batch_idx").on(t.batchId)
    }));
  }
});

// ../../lib/db/src/schema/tokenAccessLog.ts
import { pgTable as pgTable133, serial as serial130, text as text132, timestamp as timestamp133, integer as integer122 } from "drizzle-orm/pg-core";
var tokenAccessLogTable;
var init_tokenAccessLog = __esm({
  "../../lib/db/src/schema/tokenAccessLog.ts"() {
    "use strict";
    tokenAccessLogTable = pgTable133("token_access_log", {
      id: serial130("id").primaryKey(),
      // Jenis token: admin_action | customer_quote | customer_approval | customer_invoice |
      //              vendor_mini_form | vendor_fulfillment | vendor_job | customer_feedback |
      //              driver_progress | payment_proof | air_freight_approval | customer_data |
      //              order_task | customer_order | ocean_freight_approval
      tokenType: text132("token_type").notNull(),
      // Token ref — ALWAYS masked (first 8 chars only). Never store raw token here.
      tokenRef: text132("token_ref").notNull(),
      // ID entitas terkait (order ID, approval ID, dsb.)
      entityId: text132("entity_id"),
      // Action yang dilakukan: view | submit | approve | reject | revoke | expired_attempt | used_attempt | revoked_attempt
      action: text132("action").notNull(),
      // Outcome: ok | denied_expired | denied_used | denied_revoked | denied_not_found
      outcome: text132("outcome").notNull().default("ok"),
      // Request metadata (original)
      ipAddress: text132("ip_address"),
      userAgent: text132("user_agent"),
      // P2.1 — Enriched audit fields
      requestId: text132("request_id"),
      // correlation ID per request
      responseStatus: integer122("response_status"),
      // HTTP status code sent back
      latencyMs: integer122("latency_ms"),
      // request processing time in ms
      requestMethod: text132("request_method"),
      // GET | POST | PATCH | etc.
      route: text132("route"),
      // matched Express route path
      createdAt: timestamp133("created_at").defaultNow().notNull()
    });
  }
});

// ../../lib/db/src/schema/orderLinks.ts
import { pgTable as pgTable134, serial as serial131, text as text133, integer as integer123, jsonb as jsonb46, timestamp as timestamp134, index as index78 } from "drizzle-orm/pg-core";
var orderLinksTable;
var init_orderLinks = __esm({
  "../../lib/db/src/schema/orderLinks.ts"() {
    "use strict";
    orderLinksTable = pgTable134(
      "order_links",
      {
        id: serial131("id").primaryKey(),
        companyId: integer123("company_id"),
        // Polymorphic source reference — table name + row id (no DB-level FK possible)
        sourceTable: text133("source_table").notNull(),
        sourceId: integer123("source_id").notNull(),
        // Polymorphic target reference — table name + row id (no DB-level FK possible)
        targetTable: text133("target_table").notNull(),
        targetId: integer123("target_id").notNull(),
        // e.g. "rfq_to_logistic_order" | "product_order_to_sales_document" |
        //      "logistic_order_to_invoice" | "purchase_order_to_fulfillment" |
        //      "ppjk_order_to_logistic_order" | "unified_order_to_accounting_document"
        linkType: text133("link_type").notNull(),
        // e.g. "active" | "superseded" | "cancelled" | "candidate" (dry-run backfill suggestion)
        relationStatus: text133("relation_status").notNull().default("active"),
        metadata: jsonb46("metadata"),
        createdBy: text133("created_by"),
        createdAt: timestamp134("created_at").defaultNow().notNull(),
        updatedAt: timestamp134("updated_at").defaultNow().notNull()
      },
      (t) => ({
        companyIdIdx: index78("order_links_company_id_idx").on(t.companyId),
        sourceIdx: index78("order_links_source_idx").on(t.sourceTable, t.sourceId),
        targetIdx: index78("order_links_target_idx").on(t.targetTable, t.targetId),
        linkTypeIdx: index78("order_links_link_type_idx").on(t.linkType),
        relationStatusIdx: index78("order_links_relation_status_idx").on(t.relationStatus)
      })
    );
  }
});

// ../../lib/db/src/schema/payroll.ts
import {
  pgTable as pgTable135,
  serial as serial132,
  text as text134,
  integer as integer124,
  numeric as numeric72,
  real,
  boolean as boolean61,
  timestamp as timestamp135,
  date as date22,
  index as index79
} from "drizzle-orm/pg-core";
var employeesTable, payrollRunsTable, payrollItemsTable;
var init_payroll = __esm({
  "../../lib/db/src/schema/payroll.ts"() {
    "use strict";
    employeesTable = pgTable135("employees", {
      id: serial132("id").primaryKey(),
      firstName: text134("first_name").notNull(),
      lastName: text134("last_name").notNull(),
      email: text134("email").notNull(),
      phone: text134("phone"),
      position: text134("position"),
      departmentId: integer124("department_id"),
      status: text134("status").notNull().default("active"),
      hireDate: date22("hire_date").notNull(),
      salary: real("salary"),
      createdAt: timestamp135("created_at").defaultNow().notNull(),
      maritalStatus: text134("marital_status").default("TK/0"),
      deletedAt: timestamp135("deleted_at"),
      companyId: integer124("company_id")
    }, (t) => [
      index79("employees_company_idx").on(t.companyId)
    ]);
    payrollRunsTable = pgTable135("payroll_runs", {
      id: serial132("id").primaryKey(),
      month: integer124("month").notNull(),
      year: integer124("year").notNull(),
      status: text134("status").notNull().default("draft"),
      // 'draft'|'calculated'|'approved'|'paid'|'cancelled'
      notes: text134("notes"),
      generatedAt: timestamp135("generated_at").defaultNow().notNull(),
      approvedAt: timestamp135("approved_at"),
      postedAt: timestamp135("posted_at"),
      createdAt: timestamp135("created_at").defaultNow().notNull(),
      companyId: integer124("company_id"),
      accountingEntryId: integer124("accounting_entry_id"),
      // payroll accrual journal entry id
      paymentEntryId: integer124("payment_entry_id"),
      postingStatus: text134("posting_status").notNull().default("pending"),
      // 'pending'|'posted'|'error'
      postingError: text134("posting_error"),
      paymentMethod: text134("payment_method").notNull().default("bank")
      // 'cash'|'bank'
    }, (t) => [
      index79("payroll_runs_company_idx2").on(t.companyId),
      index79("payroll_runs_status_idx2").on(t.status)
    ]);
    payrollItemsTable = pgTable135("payroll_items", {
      id: serial132("id").primaryKey(),
      runId: integer124("run_id").notNull(),
      employeeId: integer124("employee_id").notNull(),
      baseSalary: numeric72("base_salary", { precision: 12, scale: 2 }).notNull(),
      allowance: numeric72("allowance", { precision: 12, scale: 2 }).notNull().default("0"),
      grossSalary: numeric72("gross_salary", { precision: 12, scale: 2 }).notNull(),
      bpjsJhtEmployee: numeric72("bpjs_jht_employee", { precision: 12, scale: 2 }).notNull().default("0"),
      bpjsKesEmployee: numeric72("bpjs_kes_employee", { precision: 12, scale: 2 }).notNull().default("0"),
      pph21: numeric72("pph21", { precision: 12, scale: 2 }).notNull().default("0"),
      kasbonDeduction: numeric72("kasbon_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
      otherDeductions: numeric72("other_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
      totalDeductions: numeric72("total_deductions", { precision: 12, scale: 2 }).notNull(),
      netSalary: numeric72("net_salary", { precision: 12, scale: 2 }).notNull(),
      notes: text134("notes"),
      createdAt: timestamp135("created_at").defaultNow().notNull(),
      isPaid: boolean61("is_paid").notNull().default(false),
      kasbonBalanceAfter: numeric72("kasbon_balance_after", { precision: 12, scale: 2 }).notNull().default("0"),
      paidAt: timestamp135("paid_at"),
      paidBy: text134("paid_by"),
      cashAdvanceId: integer124("cash_advance_id")
      // which cash_advances row this deduction settles (nullable)
    }, (t) => [
      index79("payroll_items_run_idx2").on(t.runId),
      index79("payroll_items_employee_idx").on(t.employeeId)
    ]);
  }
});

// ../../lib/db/src/schema/coaProposals.ts
import {
  pgTable as pgTable136,
  serial as serial133,
  text as text135,
  integer as integer125,
  boolean as boolean62,
  timestamp as timestamp136,
  pgEnum as pgEnum32,
  jsonb as jsonb47,
  uniqueIndex as uniqueIndex29,
  index as index80
} from "drizzle-orm/pg-core";
var coaProposalStatusEnum, coaFinancialStatementEnum, coaProposalSourceTypeEnum, coaProposalEventTypeEnum, coaProposalsTable, coaProposalVersionsTable, coaProposalAuditTable;
var init_coaProposals = __esm({
  "../../lib/db/src/schema/coaProposals.ts"() {
    "use strict";
    init_accounting();
    coaProposalStatusEnum = pgEnum32("coa_proposal_status", [
      "DRAFT",
      "PENDING_REVIEW",
      "APPROVED",
      "REJECTED",
      "IMPLEMENTED",
      "CANCELLED"
    ]);
    coaFinancialStatementEnum = pgEnum32("coa_financial_statement", [
      "BALANCE_SHEET",
      "PROFIT_AND_LOSS",
      "CASH_FLOW_SUPPORT",
      "OFF_STATEMENT"
    ]);
    coaProposalSourceTypeEnum = pgEnum32("coa_proposal_source_type", [
      "BANK_RECONCILIATION",
      "EXPENSE",
      "TREASURY",
      "VENDOR_PAYMENT",
      "CUSTOMER_PAYMENT",
      "MANUAL"
    ]);
    coaProposalEventTypeEnum = pgEnum32("coa_proposal_event_type", [
      "PROPOSAL_CREATED",
      "PROPOSAL_UPDATED",
      "PROPOSAL_SUBMITTED",
      "PROPOSAL_APPROVED",
      "PROPOSAL_REJECTED",
      "PROPOSAL_CANCELLED",
      "COA_IMPLEMENTED",
      "RULE_RECOMMENDATION_CREATED",
      "LEARNING_FEEDBACK_CREATED"
    ]);
    coaProposalsTable = pgTable136("coa_proposals", {
      id: serial133("id").primaryKey(),
      companyId: integer125("company_id").notNull(),
      proposalNumber: text135("proposal_number").notNull(),
      // Source traceability
      sourceType: coaProposalSourceTypeEnum("source_type").notNull().default("MANUAL"),
      sourceRecordId: text135("source_record_id"),
      reviewCaseId: integer125("review_case_id"),
      transactionId: integer125("transaction_id"),
      // Lifecycle status
      status: coaProposalStatusEnum("status").notNull().default("DRAFT"),
      // Proposed account fields
      proposedCode: text135("proposed_code").notNull(),
      proposedName: text135("proposed_name").notNull(),
      proposedParentId: integer125("proposed_parent_id").references(
        () => chartOfAccountsTable.id,
        { onDelete: "set null" }
      ),
      proposedCategory: text135("proposed_category").notNull(),
      proposedNormalBalance: text135("proposed_normal_balance").notNull(),
      proposedIsHeader: boolean62("proposed_is_header").notNull().default(false),
      proposedIsPostable: boolean62("proposed_is_postable").notNull().default(true),
      proposedEffectiveFrom: timestamp136("proposed_effective_from"),
      financialStatement: coaFinancialStatementEnum("financial_statement").notNull(),
      // AI context
      detectedIntent: text135("detected_intent"),
      normalizedDescription: text135("normalized_description"),
      missingMappingType: text135("missing_mapping_type"),
      // AI metrics
      aiConfidence: integer125("ai_confidence"),
      // 0–100
      historicalOccurrences: integer125("historical_occurrences").default(0),
      estimatedMonthlyUsage: integer125("estimated_monthly_usage").default(0),
      // Rich JSON payloads (never contains SQL/stack/secrets)
      reasonJson: jsonb47("reason_json"),
      evidenceJson: jsonb47("evidence_json"),
      impactAnalysisJson: jsonb47("impact_analysis_json"),
      alternativeAccountsJson: jsonb47("alternative_accounts_json"),
      // Workflow actors
      createdBy: text135("created_by").notNull(),
      submittedBy: text135("submitted_by"),
      reviewedBy: text135("reviewed_by"),
      approvedBy: text135("approved_by"),
      implementedBy: text135("implemented_by"),
      // Timestamps
      submittedAt: timestamp136("submitted_at"),
      reviewedAt: timestamp136("reviewed_at"),
      approvedAt: timestamp136("approved_at"),
      implementedAt: timestamp136("implemented_at"),
      rejectedAt: timestamp136("rejected_at"),
      cancelledAt: timestamp136("cancelled_at"),
      // Review outcome
      rejectionReason: text135("rejection_reason"),
      reviewComments: text135("review_comments"),
      // Idempotency & fingerprinting
      idempotencyKey: text135("idempotency_key").notNull(),
      requestFingerprint: text135("request_fingerprint"),
      // Reference to implemented COA (set after IMPLEMENTED)
      implementedCoaId: integer125("implemented_coa_id"),
      // Optimistic locking
      version: integer125("version").notNull().default(1),
      createdAt: timestamp136("created_at").defaultNow().notNull(),
      updatedAt: timestamp136("updated_at").defaultNow().notNull()
    }, (t) => ({
      companyIdempotencyUniq: uniqueIndex29("coa_proposals_company_idempotency_uniq").on(t.companyId, t.idempotencyKey),
      companyProposalNumberUniq: uniqueIndex29("coa_proposals_company_number_uniq").on(t.companyId, t.proposalNumber),
      companyStatusIdx: index80("coa_proposals_company_status_idx").on(t.companyId, t.status),
      companyIntentIdx: index80("coa_proposals_company_intent_idx").on(t.companyId, t.detectedIntent),
      companyCreatedIdx: index80("coa_proposals_company_created_idx").on(t.companyId, t.createdAt),
      sourceIdx: index80("coa_proposals_source_idx").on(t.sourceType, t.sourceRecordId)
    }));
    coaProposalVersionsTable = pgTable136("coa_proposal_versions", {
      id: serial133("id").primaryKey(),
      companyId: integer125("company_id").notNull(),
      proposalId: integer125("proposal_id").notNull(),
      version: integer125("version").notNull(),
      snapshotJson: jsonb47("snapshot_json").notNull(),
      changeReason: text135("change_reason"),
      createdBy: text135("created_by").notNull(),
      createdAt: timestamp136("created_at").defaultNow().notNull()
    }, (t) => ({
      proposalVersionUniq: uniqueIndex29("coa_proposal_versions_proposal_version_uniq").on(t.proposalId, t.version),
      proposalIdx: index80("coa_proposal_versions_proposal_idx").on(t.proposalId),
      companyIdx: index80("coa_proposal_versions_company_idx").on(t.companyId)
    }));
    coaProposalAuditTable = pgTable136("coa_proposal_audit", {
      id: serial133("id").primaryKey(),
      companyId: integer125("company_id").notNull(),
      proposalId: integer125("proposal_id").notNull(),
      eventType: coaProposalEventTypeEnum("event_type").notNull(),
      actorId: text135("actor_id").notNull(),
      actorType: text135("actor_type").notNull().default("user"),
      // user | system
      previousStatus: text135("previous_status"),
      newStatus: text135("new_status"),
      reason: text135("reason"),
      metadataJson: jsonb47("metadata_json"),
      occurredAt: timestamp136("occurred_at").defaultNow().notNull(),
      createdAt: timestamp136("created_at").defaultNow().notNull()
    }, (t) => ({
      proposalIdx: index80("coa_proposal_audit_proposal_idx").on(t.proposalId),
      companyIdx: index80("coa_proposal_audit_company_idx").on(t.companyId),
      eventTypeIdx: index80("coa_proposal_audit_event_idx").on(t.eventType),
      occurredIdx: index80("coa_proposal_audit_occurred_idx").on(t.companyId, t.occurredAt)
    }));
  }
});

// ../../lib/db/src/schema/index.ts
var schema_exports = {};
__export(schema_exports, {
  CUSTOMER_VERIFICATION_STATUSES: () => CUSTOMER_VERIFICATION_STATUSES,
  DOC_TYPE_LABELS: () => DOC_TYPE_LABELS,
  PPJK_DOC_LABELS: () => PPJK_DOC_LABELS,
  PPJK_DOC_TYPES: () => PPJK_DOC_TYPES,
  PPJK_REQUIRED_DOCS: () => PPJK_REQUIRED_DOCS,
  PROFILE_REQUIRED_FIELDS: () => PROFILE_REQUIRED_FIELDS,
  RECONCILIATION_CANDIDATE_SOURCES: () => RECONCILIATION_CANDIDATE_SOURCES,
  SHIPMENT_STAGE_TYPES: () => SHIPMENT_STAGE_TYPES,
  VERIFICATION_DOC_STATUSES: () => VERIFICATION_DOC_STATUSES,
  VERIFICATION_DOC_TYPES: () => VERIFICATION_DOC_TYPES,
  accountTypeEnum: () => accountTypeEnum,
  accountingEntriesTable: () => accountingEntriesTable,
  accountingEntryLinesTable: () => accountingEntryLinesTable,
  accountingEntrySourceEnum: () => accountingEntrySourceEnum,
  accountingEntryStatusEnum: () => accountingEntryStatusEnum,
  accountingJournalsTable: () => accountingJournalsTable,
  accountingPaymentStatusEnum: () => accountingPaymentStatusEnum,
  accountingPaymentTypeEnum: () => accountingPaymentTypeEnum,
  accountingPaymentsTable: () => accountingPaymentsTable,
  accountingPostingErrorsTable: () => accountingPostingErrorsTable,
  accountingReconciliationsTable: () => accountingReconciliationsTable,
  accountingSettingsTable: () => accountingSettingsTable,
  accountingTaxesTable: () => accountingTaxesTable,
  activityLogsTable: () => activityLogsTable,
  adminActionLinksTable: () => adminActionLinksTable,
  adminNotificationsTable: () => adminNotificationsTable,
  aiAgentExecutionsTable: () => aiAgentExecutionsTable,
  aiAgentSettingsTable: () => aiAgentSettingsTable,
  aiApprovalQueueTable: () => aiApprovalQueueTable,
  aiChatMessagesTable: () => aiChatMessagesTable,
  aiChatSessionsTable: () => aiChatSessionsTable,
  aiDecisionMemoryTable: () => aiDecisionMemoryTable,
  aiLearningFeedbackStatusEnum: () => aiLearningFeedbackStatusEnum,
  aiLearningFeedbackTable: () => aiLearningFeedbackTable,
  aiReviewAuditEventTypeEnum: () => aiReviewAuditEventTypeEnum,
  aiReviewAuditEventsTable: () => aiReviewAuditEventsTable,
  aiReviewCasesTable: () => aiReviewCasesTable,
  aiReviewDecisionEnum: () => aiReviewDecisionEnum,
  aiReviewPriorityEnum: () => aiReviewPriorityEnum,
  aiReviewQueueEnum: () => aiReviewQueueEnum,
  aiReviewSnapshotsTable: () => aiReviewSnapshotsTable,
  aiReviewStatusEnum: () => aiReviewStatusEnum,
  aiReviewerDecisionsTable: () => aiReviewerDecisionsTable,
  aiRulePackageStatusEnum: () => aiRulePackageStatusEnum,
  aiRuleRecommendationPackagesTable: () => aiRuleRecommendationPackagesTable,
  airFreightDimensionsTable: () => airFreightDimensionsTable,
  airFreightOrdersTable: () => airFreightOrdersTable,
  airFreightRateSubmissionsTable: () => airFreightRateSubmissionsTable,
  airFreightRatesTable: () => airFreightRatesTable,
  airFreightRfqsTable: () => airFreightRfqsTable,
  apiResponseTimesTable: () => apiResponseTimesTable,
  appConfig: () => appConfig,
  approvalMatrixLevelTable: () => approvalMatrixLevelTable,
  approvalMatrixTable: () => approvalMatrixTable,
  approvalModuleEnum: () => approvalModuleEnum,
  approvalRulesTable: () => approvalRulesTable,
  approvalScopeEnum: () => approvalScopeEnum,
  assetDepreciationRecordsTable: () => assetDepreciationRecordsTable,
  bankLoanPaymentsTable: () => bankLoanPaymentsTable,
  bankLoansTable: () => bankLoansTable,
  bankMutationImportsTable: () => bankMutationImportsTable,
  bankReconciliationMatchesTable: () => bankReconciliationMatchesTable,
  branchesTable: () => branchesTable,
  btkiTariffTable: () => btkiTariffTable,
  cashAdvanceRepaymentsTable: () => cashAdvanceRepaymentsTable,
  cashAdvanceSettlementsTable: () => cashAdvanceSettlementsTable,
  cashAdvancesTable: () => cashAdvancesTable,
  chartOfAccountsTable: () => chartOfAccountsTable,
  chatbotKnowledgeBaseTable: () => chatbotKnowledgeBaseTable,
  coaAccountCategoryEnum: () => coaAccountCategoryEnum,
  coaChangeActionEnum: () => coaChangeActionEnum,
  coaChangeRequestStatusEnum: () => coaChangeRequestStatusEnum,
  coaChangeRequestsTable: () => coaChangeRequestsTable,
  coaFinancialStatementEnum: () => coaFinancialStatementEnum,
  coaModuleMappingTable: () => coaModuleMappingTable,
  coaNormalBalanceEnum: () => coaNormalBalanceEnum,
  coaProposalAuditTable: () => coaProposalAuditTable,
  coaProposalEventTypeEnum: () => coaProposalEventTypeEnum,
  coaProposalSourceTypeEnum: () => coaProposalSourceTypeEnum,
  coaProposalStatusEnum: () => coaProposalStatusEnum,
  coaProposalVersionsTable: () => coaProposalVersionsTable,
  coaProposalsTable: () => coaProposalsTable,
  coaStatusEnum: () => coaStatusEnum,
  coaVersionsTable: () => coaVersionsTable,
  companiesTable: () => companiesTable,
  companyHoldingMembersTable: () => companyHoldingMembersTable,
  companyLegalDocumentsTable: () => companyLegalDocumentsTable,
  computeProfileStatus: () => computeProfileStatus,
  correspondenceAttachmentsTable: () => correspondenceAttachmentsTable,
  correspondenceDirectionEnum: () => correspondenceDirectionEnum,
  correspondenceKindEnum: () => correspondenceKindEnum,
  correspondencesTable: () => correspondencesTable,
  costCentersTable: () => costCentersTable,
  customRolesTable: () => customRolesTable,
  customerApprovalHistoryTable: () => customerApprovalHistoryTable,
  customerApprovalsTable: () => customerApprovalsTable,
  customerFeedbackLinksTable: () => customerFeedbackLinksTable,
  customerInvoiceLinksTable: () => customerInvoiceLinksTable,
  customerOrderLinksTable: () => customerOrderLinksTable,
  customerQuoteLinksTable: () => customerQuoteLinksTable,
  customerQuoteResponsesTable: () => customerQuoteResponsesTable,
  customerServiceRequestDocumentsRelations: () => customerServiceRequestDocumentsRelations,
  customerServiceRequestDocumentsTable: () => customerServiceRequestDocumentsTable,
  customerServiceRequestItemsRelations: () => customerServiceRequestItemsRelations,
  customerServiceRequestItemsTable: () => customerServiceRequestItemsTable,
  customerServiceRequestsRelations: () => customerServiceRequestsRelations,
  customerServiceRequestsTable: () => customerServiceRequestsTable,
  customerVerificationDocumentsRelations: () => customerVerificationDocumentsRelations,
  customerVerificationDocumentsTable: () => customerVerificationDocumentsTable,
  customersTable: () => customersTable,
  cutTypeEnum: () => cutTypeEnum,
  departmentsTable: () => departmentsTable,
  divisionsTable: () => divisionsTable,
  driverJobLogsTable: () => driverJobLogsTable,
  driverJobStatusEnum: () => driverJobStatusEnum,
  driverJobsTable: () => driverJobsTable,
  driverLocationsTable: () => driverLocationsTable,
  driverPhotosTable: () => driverPhotosTable,
  driverProfilesTable: () => driverProfilesTable,
  driversTable: () => driversTable,
  emailAttachmentsTable: () => emailAttachmentsTable,
  emailCorrespondencesTable: () => emailCorrespondencesTable,
  emailLinksTable: () => emailLinksTable,
  employeeProfilesTable: () => employeeProfilesTable,
  employeesTable: () => employeesTable,
  erpAuditReportsTable: () => erpAuditReportsTable,
  erpAuditResponsesTable: () => erpAuditResponsesTable,
  errorSeverityEnum: () => errorSeverityEnum,
  errorTypeEnum: () => errorTypeEnum,
  exceptionSeverityEnum: () => exceptionSeverityEnum,
  exceptionStatusEnum: () => exceptionStatusEnum,
  exceptionTypeEnum: () => exceptionTypeEnum,
  exceptionsTable: () => exceptionsTable,
  expenseApprovalLimitsTable: () => expenseApprovalLimitsTable,
  expenseApprovalRequestsTable: () => expenseApprovalRequestsTable,
  expenseAttachmentsTable: () => expenseAttachmentsTable,
  expenseCategoriesTable: () => expenseCategoriesTable,
  expensesTable: () => expensesTable,
  financeOverrideRequestsTable: () => financeOverrideRequestsTable,
  fixedAssetsTable: () => fixedAssetsTable,
  fleetAccountingJournalsTable: () => fleetAccountingJournalsTable,
  fleetAlertSuppressionTable: () => fleetAlertSuppressionTable,
  fleetAlertsTable: () => fleetAlertsTable,
  fleetCashPaymentsTable: () => fleetCashPaymentsTable,
  fleetDailySummaryTable: () => fleetDailySummaryTable,
  fleetDriversTable: () => fleetDriversTable,
  fleetOutstandingTable: () => fleetOutstandingTable,
  fleetPartnersTable: () => fleetPartnersTable,
  fleetReportsTable: () => fleetReportsTable,
  fleetTransactionsTable: () => fleetTransactionsTable,
  fleetVehiclesTable: () => fleetVehiclesTable,
  fleetWaLogsTable: () => fleetWaLogsTable,
  freightAttachmentTypeEnum: () => freightAttachmentTypeEnum,
  freightAttachmentsTable: () => freightAttachmentsTable,
  freightCarriersTable: () => freightCarriersTable,
  freightContainerTypesTable: () => freightContainerTypesTable,
  freightCustomsDocsTable: () => freightCustomsDocsTable,
  freightPortsTable: () => freightPortsTable,
  freightQuoteStatusEnum: () => freightQuoteStatusEnum,
  freightQuotesTable: () => freightQuotesTable,
  freightRfqsTable: () => freightRfqsTable,
  freightServiceCategoryEnum: () => freightServiceCategoryEnum,
  freightShipmentAuditLogsTable: () => freightShipmentAuditLogsTable,
  freightShipmentStatusEnum: () => freightShipmentStatusEnum,
  freightShipmentsTable: () => freightShipmentsTable,
  goodsReceiptLinesTable: () => goodsReceiptLinesTable,
  goodsReceiptsTable: () => goodsReceiptsTable,
  grStatusEnum: () => grStatusEnum,
  holdingGroupsTable: () => holdingGroupsTable,
  identityDocumentsTable: () => identityDocumentsTable,
  insertAccountSchema: () => insertAccountSchema,
  insertApprovalRuleSchema: () => insertApprovalRuleSchema,
  insertBranchSchema: () => insertBranchSchema,
  insertCompanySchema: () => insertCompanySchema,
  insertCorrespondenceSchema: () => insertCorrespondenceSchema,
  insertCustomRoleSchema: () => insertCustomRoleSchema,
  insertCustomerSchema: () => insertCustomerSchema,
  insertCustomerServiceRequestItemSchema: () => insertCustomerServiceRequestItemSchema,
  insertCustomerServiceRequestSchema: () => insertCustomerServiceRequestSchema,
  insertDepartmentSchema: () => insertDepartmentSchema,
  insertDivisionSchema: () => insertDivisionSchema,
  insertDriverSchema: () => insertDriverSchema,
  insertEntryLineSchema: () => insertEntryLineSchema,
  insertEntrySchema: () => insertEntrySchema,
  insertErpAuditReportSchema: () => insertErpAuditReportSchema,
  insertErpAuditResponseSchema: () => insertErpAuditResponseSchema,
  insertExpenseCategorySchema: () => insertExpenseCategorySchema,
  insertExpenseSchema: () => insertExpenseSchema,
  insertFreightQuoteSchema: () => insertFreightQuoteSchema,
  insertFreightRfqSchema: () => insertFreightRfqSchema,
  insertFreightShipmentSchema: () => insertFreightShipmentSchema,
  insertGoodsReceiptLineSchema: () => insertGoodsReceiptLineSchema,
  insertGoodsReceiptSchema: () => insertGoodsReceiptSchema,
  insertJournalSchema: () => insertJournalSchema,
  insertLandedCostAllocationSchema: () => insertLandedCostAllocationSchema,
  insertLandedCostLineSchema: () => insertLandedCostLineSchema,
  insertLandedCostSchema: () => insertLandedCostSchema,
  insertMktCompanySettingSchema: () => insertMktCompanySettingSchema,
  insertMktDualWriteLogSchema: () => insertMktDualWriteLogSchema,
  insertMktPoGoodsReceiptItemSchema: () => insertMktPoGoodsReceiptItemSchema,
  insertMktPoGoodsReceiptSchema: () => insertMktPoGoodsReceiptSchema,
  insertMktPoShipmentEventSchema: () => insertMktPoShipmentEventSchema,
  insertMktPoShipmentItemSchema: () => insertMktPoShipmentItemSchema,
  insertMktPoShipmentSchema: () => insertMktPoShipmentSchema,
  insertMktPurchaseOrderLineSchema: () => insertMktPurchaseOrderLineSchema,
  insertMktPurchaseOrderSchema: () => insertMktPurchaseOrderSchema,
  insertMktRfqApprovalSchema: () => insertMktRfqApprovalSchema,
  insertMktRfqGuestClaimSchema: () => insertMktRfqGuestClaimSchema,
  insertMktRfqLineSchema: () => insertMktRfqLineSchema,
  insertMktRfqSchema: () => insertMktRfqSchema,
  insertMktVendorQuoteLineSchema: () => insertMktVendorQuoteLineSchema,
  insertMktVendorQuoteSchema: () => insertMktVendorQuoteSchema,
  insertOrderSchema: () => insertOrderSchema,
  insertPaymentRequestItemSchema: () => insertPaymentRequestItemSchema,
  insertPaymentRequestSchema: () => insertPaymentRequestSchema,
  insertPortalCompanyMemberSchema: () => insertPortalCompanyMemberSchema,
  insertPortalCustomerSchema: () => insertPortalCustomerSchema,
  insertProductCategorySchema: () => insertProductCategorySchema,
  insertProductRecipeItemSchema: () => insertProductRecipeItemSchema,
  insertProductRecipeSchema: () => insertProductRecipeSchema,
  insertProductSchema: () => insertProductSchema,
  insertPurchaseApprovalSchema: () => insertPurchaseApprovalSchema,
  insertPurchaseDocumentLineSchema: () => insertPurchaseDocumentLineSchema,
  insertPurchaseDocumentSchema: () => insertPurchaseDocumentSchema,
  insertPurchaseReceiptLineSchema: () => insertPurchaseReceiptLineSchema,
  insertPurchaseReceiptSchema: () => insertPurchaseReceiptSchema,
  insertPurchaseRequestLineSchema: () => insertPurchaseRequestLineSchema,
  insertPurchaseRequestSchema: () => insertPurchaseRequestSchema,
  insertPurchaseReturnLineSchema: () => insertPurchaseReturnLineSchema,
  insertPurchaseReturnSchema: () => insertPurchaseReturnSchema,
  insertQcInspectionSchema: () => insertQcInspectionSchema,
  insertQcLineSchema: () => insertQcLineSchema,
  insertRawMaterialSchema: () => insertRawMaterialSchema,
  insertRecipeItemSchema: () => insertRecipeItemSchema,
  insertRecipeSchema: () => insertRecipeSchema,
  insertSalesDocumentLineSchema: () => insertSalesDocumentLineSchema,
  insertSalesDocumentSchema: () => insertSalesDocumentSchema,
  insertSectionSchema: () => insertSectionSchema,
  insertShipmentSchema: () => insertShipmentSchema,
  insertSportExpenseSchema: () => insertSportExpenseSchema,
  insertStockSchema: () => insertStockSchema,
  insertSupplierSchema: () => insertSupplierSchema,
  insertTaxSchema: () => insertTaxSchema,
  insertTransactionSchema: () => insertTransactionSchema,
  insertUserSchema: () => insertUserSchema,
  insertVendorCatalogItemSchema: () => insertVendorCatalogItemSchema,
  insertVendorInvoiceLineSchema: () => insertVendorInvoiceLineSchema,
  insertVendorInvoiceSchema: () => insertVendorInvoiceSchema,
  insertVendorQuotationLineSchema: () => insertVendorQuotationLineSchema,
  insertVendorQuotationSchema: () => insertVendorQuotationSchema,
  insertWhDamageLineSchema: () => insertWhDamageLineSchema,
  insertWhDamageReportSchema: () => insertWhDamageReportSchema,
  insertWhMovementSchema: () => insertWhMovementSchema,
  insertWhOpnameLineSchema: () => insertWhOpnameLineSchema,
  insertWhOpnameSchema: () => insertWhOpnameSchema,
  insertWhReturnLineSchema: () => insertWhReturnLineSchema,
  insertWhReturnSchema: () => insertWhReturnSchema,
  insertWhStockSchema: () => insertWhStockSchema,
  insertWhTransferLineSchema: () => insertWhTransferLineSchema,
  insertWhTransferSchema: () => insertWhTransferSchema,
  intelligenceAlertSettingsTable: () => intelligenceAlertSettingsTable,
  intelligenceAlertsTable: () => intelligenceAlertsTable,
  internalTasksTable: () => internalTasksTable,
  inventoryStockTable: () => inventoryStockTable,
  isQrisSettlementCandidate: () => isQrisSettlementCandidate,
  journalTypeEnum: () => journalTypeEnum,
  landedCostAllocationsTable: () => landedCostAllocationsTable,
  landedCostLinesTable: () => landedCostLinesTable,
  landedCostsTable: () => landedCostsTable,
  lcMethodEnum: () => lcMethodEnum,
  logisticOrderItemsRelations: () => logisticOrderItemsRelations,
  logisticOrderItemsTable: () => logisticOrderItemsTable,
  logisticOrderQuotesRelations: () => logisticOrderQuotesRelations,
  logisticOrderQuotesTable: () => logisticOrderQuotesTable,
  logisticOrderRfqsRelations: () => logisticOrderRfqsRelations,
  logisticOrderRfqsTable: () => logisticOrderRfqsTable,
  logisticOrdersRelations: () => logisticOrdersRelations,
  logisticOrdersTable: () => logisticOrdersTable,
  logisticVendorFulfillmentsTable: () => logisticVendorFulfillmentsTable,
  logisticsRateCardsTable: () => logisticsRateCardsTable,
  logisticsServiceRatesRelations: () => logisticsServiceRatesRelations,
  logisticsServiceRatesTable: () => logisticsServiceRatesTable,
  logisticsServiceTypeEnum: () => logisticsServiceTypeEnum,
  logisticsSurchargesTable: () => logisticsSurchargesTable,
  marginRulesTable: () => marginRulesTable,
  mediaAssetsTable: () => mediaAssetsTable,
  mktAccountingHandoffsTable: () => mktAccountingHandoffsTable,
  mktApPreparationStatusEnum: () => mktApPreparationStatusEnum,
  mktApPreparationsTable: () => mktApPreparationsTable,
  mktClaimStatusEnum: () => mktClaimStatusEnum,
  mktCompanySettingsTable: () => mktCompanySettingsTable,
  mktDualWriteLogTable: () => mktDualWriteLogTable,
  mktDualWriteStatusEnum: () => mktDualWriteStatusEnum,
  mktFeaturedPackagesTable: () => mktFeaturedPackagesTable,
  mktFeaturedProductRequestsTable: () => mktFeaturedProductRequestsTable,
  mktNotificationQueueTable: () => mktNotificationQueueTable,
  mktPaymentExecutionAttemptsTable: () => mktPaymentExecutionAttemptsTable,
  mktPoGoodsReceiptItemsTable: () => mktPoGoodsReceiptItemsTable,
  mktPoGoodsReceiptsTable: () => mktPoGoodsReceiptsTable,
  mktPoShipmentEventsTable: () => mktPoShipmentEventsTable,
  mktPoShipmentItemsTable: () => mktPoShipmentItemsTable,
  mktPoShipmentsTable: () => mktPoShipmentsTable,
  mktPoStatusEnum: () => mktPoStatusEnum,
  mktPurchaseOrderLinesTable: () => mktPurchaseOrderLinesTable,
  mktPurchaseOrdersTable: () => mktPurchaseOrdersTable,
  mktQuoteStatusEnum: () => mktQuoteStatusEnum,
  mktReconciliationLinksTable: () => mktReconciliationLinksTable,
  mktRfqApprovalsTable: () => mktRfqApprovalsTable,
  mktRfqGuestClaimsTable: () => mktRfqGuestClaimsTable,
  mktRfqLinesTable: () => mktRfqLinesTable,
  mktRfqPriorityEnum: () => mktRfqPriorityEnum,
  mktRfqStatusEnum: () => mktRfqStatusEnum,
  mktRfqsTable: () => mktRfqsTable,
  mktStockStatusEnum: () => mktStockStatusEnum,
  mktVendorQuoteLinesTable: () => mktVendorQuoteLinesTable,
  mktVendorQuotesTable: () => mktVendorQuotesTable,
  movementTypeEnum: () => movementTypeEnum,
  notificationLogsTable: () => notificationLogsTable,
  oceanFreightOrdersTable: () => oceanFreightOrdersTable,
  oceanFreightRateSubmissionsTable: () => oceanFreightRateSubmissionsTable,
  oceanFreightRatesTable: () => oceanFreightRatesTable,
  oceanFreightRfqsTable: () => oceanFreightRfqsTable,
  oceanFreightRouteMatrixTable: () => oceanFreightRouteMatrixTable,
  ocrResultsTable: () => ocrResultsTable,
  onboardingApprovalsTable: () => onboardingApprovalsTable,
  orderAuditLogsTable: () => orderAuditLogsTable,
  orderFulfillmentLinksTable: () => orderFulfillmentLinksTable,
  orderFulfillmentSubmissionsTable: () => orderFulfillmentSubmissionsTable,
  orderLinksTable: () => orderLinksTable,
  orderStageLogsTable: () => orderStageLogsTable,
  orderStatusEnum: () => orderStatusEnum,
  orderStatusHistoryTable: () => orderStatusHistoryTable,
  orderTaskLinksTable: () => orderTaskLinksTable,
  orderUpdatesTable: () => orderUpdatesTable,
  ordersTable: () => ordersTable,
  overrideRequestStatusEnum: () => overrideRequestStatusEnum,
  payReqStatusEnum: () => payReqStatusEnum,
  paylabsConfigurationsTable: () => paylabsConfigurationsTable,
  paymentMethodEnum: () => paymentMethodEnum,
  paymentProviderEnum: () => paymentProviderEnum,
  paymentRefKindEnum: () => paymentRefKindEnum,
  paymentRequestItemsTable: () => paymentRequestItemsTable,
  paymentRequestsTable: () => paymentRequestsTable,
  paymentStatusEnum: () => paymentStatusEnum,
  paymentsTable: () => paymentsTable,
  payrollItemsTable: () => payrollItemsTable,
  payrollRunsTable: () => payrollRunsTable,
  podOcrResultsTable: () => podOcrResultsTable,
  portalCompanyMembersTable: () => portalCompanyMembersTable,
  portalContentTable: () => portalContentTable,
  portalCustomerProfilesRelations: () => portalCustomerProfilesRelations,
  portalCustomerProfilesTable: () => portalCustomerProfilesTable,
  portalCustomerServicesTable: () => portalCustomerServicesTable,
  portalCustomersTable: () => portalCustomersTable,
  portalProductOrderItemsRelations: () => portalProductOrderItemsRelations,
  portalProductOrderItemsTable: () => portalProductOrderItemsTable,
  portalProductOrdersRelations: () => portalProductOrdersRelations,
  portalProductOrdersTable: () => portalProductOrdersTable,
  portalQuickQuotesTable: () => portalQuickQuotesTable,
  ppjkAuditLogsTable: () => ppjkAuditLogsTable,
  ppjkDocumentChecklistTable: () => ppjkDocumentChecklistTable,
  ppjkOrdersTable: () => ppjkOrdersTable,
  ppjkStatusLogsTable: () => ppjkStatusLogsTable,
  prReturnStatusEnum: () => prReturnStatusEnum,
  prStatusEnum: () => prStatusEnum,
  productCategoriesTable: () => productCategoriesTable,
  productCategoryMapTable: () => productCategoryMapTable,
  productMediaTable: () => productMediaTable,
  productRecipeItemsTable: () => productRecipeItemsTable,
  productRecipesTable: () => productRecipesTable,
  productTemplatesTable: () => productTemplatesTable,
  productsTable: () => productsTable,
  purchaseApprovalsTable: () => purchaseApprovalsTable,
  purchaseBillStatusEnum: () => purchaseBillStatusEnum,
  purchaseDocKindEnum: () => purchaseDocKindEnum,
  purchaseDocStatusEnum: () => purchaseDocStatusEnum,
  purchaseDocumentLinesTable: () => purchaseDocumentLinesTable,
  purchaseDocumentsTable: () => purchaseDocumentsTable,
  purchaseMiniFormsTable: () => purchaseMiniFormsTable,
  purchasePaymentStatusEnum: () => purchasePaymentStatusEnum,
  purchaseReceiptLinesTable: () => purchaseReceiptLinesTable,
  purchaseReceiptsTable: () => purchaseReceiptsTable,
  purchaseReceiveStatusEnum: () => purchaseReceiveStatusEnum,
  purchaseRequestLinesTable: () => purchaseRequestLinesTable,
  purchaseRequestsTable: () => purchaseRequestsTable,
  purchaseReturnLinesTable: () => purchaseReturnLinesTable,
  purchaseReturnsTable: () => purchaseReturnsTable,
  pwApprovalStatusEnum: () => pwApprovalStatusEnum,
  qcInspectionsTable: () => qcInspectionsTable,
  qcLinesTable: () => qcLinesTable,
  qcStatusEnum: () => qcStatusEnum,
  quotationReplyLogsTable: () => quotationReplyLogsTable,
  quoteRequestsTable: () => quoteRequestsTable,
  rateValueTypeEnum: () => rateValueTypeEnum,
  rawMaterialsTable: () => rawMaterialsTable,
  rbacRolePermissionsTable: () => rbacRolePermissionsTable,
  recipeItemsTable: () => recipeItemsTable,
  recipesTable: () => recipesTable,
  reconciliationCandidateIdentityKey: () => reconciliationCandidateIdentityKey,
  reconciliationStatusEnum: () => reconciliationStatusEnum,
  referenceTypeEnum: () => referenceTypeEnum,
  rfqActivityLogsTable: () => rfqActivityLogsTable,
  rfqVendorLinksTable: () => rfqVendorLinksTable,
  salesDeliveryStatusEnum: () => salesDeliveryStatusEnum,
  salesDocKindEnum: () => salesDocKindEnum,
  salesDocStatusEnum: () => salesDocStatusEnum,
  salesDocumentLinesTable: () => salesDocumentLinesTable,
  salesDocumentsTable: () => salesDocumentsTable,
  salesInvoiceStatusEnum: () => salesInvoiceStatusEnum,
  salesPaymentStatusEnum: () => salesPaymentStatusEnum,
  sectionsTable: () => sectionsTable,
  servicePackageItemsRelations: () => servicePackageItemsRelations,
  servicePackageItemsTable: () => servicePackageItemsTable,
  servicePackagesRelations: () => servicePackagesRelations,
  servicePackagesTable: () => servicePackagesTable,
  serviceTemplatesTable: () => serviceTemplatesTable,
  sessionsTable: () => sessionsTable,
  shipmentStageTypeEnum: () => shipmentStageTypeEnum,
  shipmentStagesTable: () => shipmentStagesTable,
  shipmentStatusEnum: () => shipmentStatusEnum,
  shipmentsTable: () => shipmentsTable,
  shortLinksTable: () => shortLinksTable,
  sportExpensesTable: () => sportExpensesTable,
  stockMovementsTable: () => stockMovementsTable,
  stocksTable: () => stocksTable,
  storageAuditActionEnum: () => storageAuditActionEnum,
  storageAuditEntityTypeEnum: () => storageAuditEntityTypeEnum,
  storageAuditLogTable: () => storageAuditLogTable,
  supplierDocumentsTable: () => supplierDocumentsTable,
  supplierReviewsTable: () => supplierReviewsTable,
  supplierStatusHistoryTable: () => supplierStatusHistoryTable,
  suppliersTable: () => suppliersTable,
  surchargeAppliesToEnum: () => surchargeAppliesToEnum,
  surchargeTypeEnum: () => surchargeTypeEnum,
  surchargeUnitEnum: () => surchargeUnitEnum,
  systemErrorLogs: () => systemErrorLogs,
  taxAdjustmentsTable: () => taxAdjustmentsTable,
  taxAuditLogsTable: () => taxAuditLogsTable,
  taxExportBatchesTable: () => taxExportBatchesTable,
  taxExportRowsTable: () => taxExportRowsTable,
  taxKindEnum: () => taxKindEnum,
  taxPeriodsTable: () => taxPeriodsTable,
  taxRulesTable: () => taxRulesTable,
  taxSptDraftsTable: () => taxSptDraftsTable,
  tokenAccessLogTable: () => tokenAccessLogTable,
  transactionTaxesTable: () => transactionTaxesTable,
  transactionsTable: () => transactionsTable,
  trustedDevicesTable: () => trustedDevicesTable,
  uomConversionsTable: () => uomConversionsTable,
  uomMasterTable: () => uomTable,
  userAllowedCompaniesTable: () => userAllowedCompaniesTable,
  userProfilesTable: () => userProfilesTable,
  userRoleEnum: () => userRoleEnum,
  usersTable: () => usersTable,
  vendorAuditLogsTable: () => vendorAuditLogsTable,
  vendorCatalogItemsTable: () => vendorCatalogItemsTable,
  vendorCatalogSubmissionLinksTable: () => vendorCatalogSubmissionLinksTable,
  vendorCatalogSubmissionsTable: () => vendorCatalogSubmissionsTable,
  vendorFulfillmentLinksTable: () => vendorFulfillmentLinksTable,
  vendorInstallmentPaymentsTable: () => vendorInstallmentPaymentsTable,
  vendorInstallmentsTable: () => vendorInstallmentsTable,
  vendorInvoiceLinesTable: () => vendorInvoiceLinesTable,
  vendorInvoicesTable: () => vendorInvoicesTable,
  vendorMiniFormLinksTable: () => vendorMiniFormLinksTable,
  vendorMiniFormSubmissionsTable: () => vendorMiniFormSubmissionsTable,
  vendorNotificationsTable: () => vendorNotificationsTable,
  vendorOffersTable: () => vendorOffersTable,
  vendorOperationalConfirmationsTable: () => vendorOperationalConfirmationsTable,
  vendorPerformanceTable: () => vendorPerformanceTable,
  vendorPriceHistoryTable: () => vendorPriceHistoryTable,
  vendorProfilesTable: () => vendorProfilesTable,
  vendorQuotationLinesTable: () => vendorQuotationLinesTable,
  vendorQuotationsTable: () => vendorQuotationsTable,
  vendorQuoteHistoryTable: () => vendorQuoteHistoryTable,
  vendorRatesTable: () => vendorRatesTable,
  vendorResponsesTable: () => vendorResponsesTable,
  viStatusEnum: () => viStatusEnum,
  vmfActivityLogTable: () => vmfActivityLogTable,
  vqStatusEnum: () => vqStatusEnum,
  waAiIntakeLogTable: () => waAiIntakeLogTable,
  waIncomingMessagesTable: () => waIncomingMessagesTable,
  waOtpCodesTable: () => waOtpCodesTable,
  waTemplateConfigsTable: () => waTemplateConfigsTable,
  warehouseRacksTable: () => warehouseRacksTable,
  warehouseTypeEnum: () => warehouseTypeEnum,
  warehousesTable: () => warehousesTable,
  whDamageLinesTable: () => whDamageLinesTable,
  whDamageReportsTable: () => whDamageReportsTable,
  whDamageStatusEnum: () => whDamageStatusEnum,
  whDamageTypeEnum: () => whDamageTypeEnum,
  whMovementTypeEnum: () => whMovementTypeEnum,
  whMovementsTable: () => whMovementsTable,
  whOpnameLinesTable: () => whOpnameLinesTable,
  whOpnamesTable: () => whOpnamesTable,
  whReturnLinesTable: () => whReturnLinesTable,
  whReturnStatusEnum: () => whReturnStatusEnum,
  whReturnTypeEnum: () => whReturnTypeEnum,
  whReturnsTable: () => whReturnsTable,
  whStockTable: () => whStockTable,
  whTransferLinesTable: () => whTransferLinesTable,
  whTransferStatusEnum: () => whTransferStatusEnum,
  whTransfersTable: () => whTransfersTable
});
var init_schema = __esm({
  "../../lib/db/src/schema/index.ts"() {
    "use strict";
    init_appConfig();
    init_aiReview();
    init_companies();
    init_users();
    init_auth();
    init_products();
    init_orders();
    init_suppliers();
    init_stocks();
    init_shipments();
    init_transactions();
    init_customers();
    init_salesDocuments();
    init_purchaseDocuments();
    init_payments();
    init_accounting();
    init_correspondences();
    init_freightShipments();
    init_freightAttachments();
    init_shipmentStages();
    init_apiResponseTimes();
    init_expenses();
    init_emailCorrespondences();
    init_freightCustomsDocs();
    init_portalCustomers();
    init_logisticOrders();
    init_vendorRates();
    init_drivers();
    init_driverJobs();
    init_aiChat();
    init_waAiIntakeLog();
    init_portalProductOrders();
    init_quotationReplyLogs();
    init_holding();
    init_waIncomingMessages();
    init_quoteRequests();
    init_mediaAssets();
    init_warehouse();
    init_inventory();
    init_thaiTea();
    init_purchaseWorkflow();
    init_freightAuditLog();
    init_customRoles();
    init_orgStructure();
    init_approvalRules();
    init_productBom();
    init_notificationLogs();
    init_shortLinks();
    init_onboarding();
    init_waOtpCodes();
    init_rfqVendorLinks();
    init_vendorMiniForm();
    init_customerQuoteFlow();
    init_vendorPerformance();
    init_driverLocations();
    init_podOcrResults();
    init_internalTasks();
    init_marginRules();
    init_activityLogs();
    init_adminActionLinks();
    init_vendorFulfillmentLinks();
    init_orderFulfillment();
    init_trustedDevices();
    init_accounting();
    init_auditReports();
    init_waTemplateConfigs();
    init_storageAuditLog();
    init_intelligenceAlerts();
    init_intelligenceAlertSettings();
    init_orderStageLogs();
    init_aiGovernance();
    init_productTemplates();
    init_serviceTemplates();
    init_purchaseMiniForm();
    init_rbac();
    init_orderStatusHistory();
    init_orderAuditLogs();
    init_vendorQuoteHistory();
    init_customerApprovalHistory();
    init_exceptions();
    init_cashAdvances();
    init_vendorInstallments();
    init_bankLoans();
    init_fixedAssets();
    init_expenseApprovals();
    init_productMedia();
    init_vendorCatalogEngine();
    init_logisticVendorFulfillments();
    init_airFreight();
    init_oceanFreight();
    init_freightMasterData();
    init_ppjkOrders();
    init_ppjkPhase2();
    init_customerServiceRequests();
    init_servicePackages();
    init_portalCustomerProfiles();
    init_customerVerificationDocuments();
    init_logisticsRateCards();
    init_logisticsServiceRates();
    init_logisticsSurcharges();
    init_sportExpenses();
    init_bankMutationImports();
    init_bankReconciliation();
    init_fleetIntelligence();
    init_systemErrorLogs();
    init_btkiTariff();
    init_approvalMatrix();
    init_portalQuickQuotes();
    init_portalCompanyMembers();
    init_mktRfqs();
    init_mktRfqLines();
    init_mktRfqApprovals();
    init_mktDualWriteLog();
    init_mktVendorQuotes();
    init_mktVendorQuoteLines();
    init_mktPurchaseOrders();
    init_mktRfqGuestClaims();
    init_mktCompanySettings();
    init_mktNotificationQueue();
    init_mktFeaturedProduct();
    init_mktPurchaseOrderLines();
    init_mktPoShipments();
    init_mktPoShipmentItems();
    init_mktPoShipmentEvents();
    init_mktPoGoodsReceipts();
    init_mktPoGoodsReceiptItems();
    init_mktApPreparations();
    init_mktPaymentExecutionAttempts();
    init_mktAccountingHandoffs();
    init_mktReconciliationLinks();
    init_adminNotifications();
    init_vendorNotifications();
    init_taxAudit();
    init_tokenAccessLog();
    init_orderLinks();
    init_payroll();
    init_coaProposals();
  }
});

// ../../lib/db/src/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
function isTestEnvironment() {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true" || process.env.VITEST_WORKER_ID !== void 0 || process.env.VITEST_POOL_ID !== void 0;
}
function resolveConnectionString() {
  if (IS_TEST) {
    const testUrl = process.env.TEST_DATABASE_URL ?? process.env.STAGING_DATABASE_URL;
    if (!testUrl) {
      throw new Error(
        "[db] Test database is not configured. Set TEST_DATABASE_URL or STAGING_DATABASE_URL; the test pool will not fall back to DEV, PROD, DATABASE_URL, or Helium/Replit."
      );
    }
    let parsed;
    try {
      parsed = new URL(testUrl);
    } catch {
      throw new Error("[db] TEST_DATABASE_URL/STAGING_DATABASE_URL is not a valid URL.");
    }
    const host = parsed.hostname.toLowerCase();
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || host.includes("helium") || host.includes("replit") || host === "localhost" || host === "127.0.0.1" || host === "::1") {
      throw new Error(
        "[db] Test target rejected. It must be an isolated PostgreSQL database, not Helium/Replit/local DB."
      );
    }
    if (!host.endsWith(".supabase.co") && !host.endsWith(".supabase.com")) {
      throw new Error("[db] Test target rejected. It must be an isolated Supabase database.");
    }
    const projectRef = testUrl.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i)?.[1] ?? testUrl.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1] ?? null;
    const reservedRefs = /* @__PURE__ */ new Set([
      "nzdweipzckfszczzqtuw",
      process.env.SUPABASE_DEV_PROJECT_REF ?? "xssrfshdrtdfupgqwfdw"
    ]);
    if (projectRef && reservedRefs.has(projectRef)) {
      throw new Error("[db] Test target rejected. It points to a reserved DEV/PROD Supabase project.");
    }
    const masked = testUrl.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
    console.log(`[db] env=test \u2192 ${masked}`);
    return testUrl;
  }
  const isProd = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  const candidates = isProd ? [
    process.env.SUPABASE_DATABASE_URL,
    process.env.DATABASE_URL,
    process.env.SUPABASE_PG_URL
  ] : [
    process.env.SUPABASE_DATABASE_URL_DEV,
    process.env.SUPABASE_DATABASE_URL,
    process.env.DATABASE_URL
  ];
  for (const url of candidates) {
    if (url && /^postgres(?:ql)?:\/\//i.test(url)) {
      const label = isProd ? "production" : "development";
      const masked = url.replace(/\/\/[^@]+@/, "//***@").split("?")[0];
      console.log(`[db] env=${label} \u2192 ${masked}`);
      return url;
    }
  }
  throw new Error(
    isProd ? "No valid PostgreSQL connection string found. Set SUPABASE_DATABASE_URL." : "No valid PostgreSQL connection string found. Set SUPABASE_MIGRATION_URL or SUPABASE_DATABASE_URL_DEV (or SUPABASE_DATABASE_URL for shared-DB mode)."
  );
}
function isEcbError(err) {
  const msg = err?.message ?? "";
  const cause = err?.cause?.message ?? "";
  return msg.includes("ECIRCUITBREAKER") || cause.includes("ECIRCUITBREAKER");
}
function setEcbBlock(source, originalErr) {
  const now = Date.now();
  if (now >= ecbBlockedUntil) {
    ecbBlockedUntil = now + ECB_PAUSE_MS;
    const resume = new Date(ecbBlockedUntil).toISOString();
    const openedAt = new Date(now).toISOString();
    const rawMsg = originalErr?.cause?.message || originalErr?.message || "(tidak ada detail)";
    ecbLastTrigger = { source, message: rawMsg, openedAt };
    console.warn(
      `[db pool] ECIRCUITBREAKER dari '${source}' \u2014 blokir koneksi baru sampai ${resume}`,
      { rawMsg }
    );
  }
}
function makeEcbError() {
  const remaining = Math.ceil((ecbBlockedUntil - Date.now()) / 1e3);
  return Object.assign(
    new Error(
      `(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked (local cooldown ${remaining}s)`
    ),
    { code: "ECIRCUITBREAKER_LOCAL" }
  );
}
var Pool, IS_TEST, connectionString, isLocalConn, isProdEnv, isTestEnv, PG_POOL_MAX, PG_IDLE_TIMEOUT_MS, PG_CONNECTION_TIMEOUT_MS, pool, ECB_PAUSE_MS, ecbBlockedUntil, ecbLastTrigger, _origConnect, CB_FILE, db;
var init_src = __esm({
  async "../../lib/db/src/index.ts"() {
    "use strict";
    init_schema();
    init_schema();
    ({ Pool } = pg);
    IS_TEST = isTestEnvironment();
    connectionString = resolveConnectionString();
    isLocalConn = /localhost|127\.0\.0\.1|helium/.test(connectionString);
    isProdEnv = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
    isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
    PG_POOL_MAX = process.env.PG_POOL_MAX ? Math.max(1, parseInt(process.env.PG_POOL_MAX)) : isProdEnv ? 2 : isTestEnv ? 3 : 8;
    PG_IDLE_TIMEOUT_MS = process.env.PG_IDLE_TIMEOUT_MS ? parseInt(process.env.PG_IDLE_TIMEOUT_MS) : isTestEnv ? 1e3 : 3e4;
    PG_CONNECTION_TIMEOUT_MS = process.env.PG_CONNECTION_TIMEOUT_MS ? parseInt(process.env.PG_CONNECTION_TIMEOUT_MS) : 8e3;
    if (!IS_TEST) {
      console.log(
        `[db] pool config \u2014 max=${PG_POOL_MAX}, connTimeout=${PG_CONNECTION_TIMEOUT_MS}ms, idleTimeout=${PG_IDLE_TIMEOUT_MS}ms`
      );
    }
    pool = new Pool({
      connectionString,
      ssl: isLocalConn ? false : { rejectUnauthorized: false },
      max: PG_POOL_MAX,
      min: 0,
      idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS,
      keepAlive: !isTestEnv,
      keepAliveInitialDelayMillis: 1e4,
      // In test mode: allow the process to exit when all pool clients are idle.
      // In production: keep the pool alive (allowExitOnIdle: false) so the server
      // is not killed between requests during quiet periods.
      allowExitOnIdle: isTestEnv,
      // Ensure search_path is always set — pgBouncer in transaction mode may drop it.
      // lock_timeout prevents startup DDL migrations from hanging forever when a
      // previous killed instance left an open lock on the same table.
      options: "-c search_path=public -c lock_timeout=15000"
    });
    if (!isLocalConn) {
      pool.on("connect", (client) => {
        client.query("SET search_path = public; SET lock_timeout = '20s'").catch(() => {
        });
      });
    }
    ECB_PAUSE_MS = isProdEnv ? 5 * 60 * 1e3 : 55 * 1e3;
    ecbBlockedUntil = 0;
    ecbLastTrigger = null;
    _origConnect = pool.connect.bind(pool);
    pool.connect = function connect(...args) {
      if (Date.now() < ecbBlockedUntil) {
        const ecbErr = makeEcbError();
        const lastArg2 = args[args.length - 1];
        if (typeof lastArg2 === "function") {
          const cb = lastArg2;
          process.nextTick(() => cb(ecbErr));
          return void 0;
        }
        return Promise.reject(ecbErr);
      }
      const lastArg = args[args.length - 1];
      if (typeof lastArg === "function") {
        const origCb = lastArg;
        const newArgs = [...args.slice(0, -1), function wrappedCb(err, client, done) {
          if (err && isEcbError(err)) setEcbBlock("pool.connect-cb", err);
          return origCb(err, client, done);
        }];
        return _origConnect.apply(pool, newArgs);
      }
      const result = _origConnect.apply(pool, args);
      if (result && typeof result.catch === "function") {
        return result.catch((err) => {
          if (isEcbError(err)) setEcbBlock("pool.connect-promise", err);
          throw err;
        });
      }
      return result;
    };
    pool.on("error", (err) => {
      if (isEcbError(err)) {
        setEcbBlock("pool idle error", err);
      } else {
        console.error("[pg pool] Idle client error (non-fatal):", err.message);
      }
    });
    CB_FILE = "/tmp/db-startup-cb.json";
    await (async function startupProbe() {
      if (isTestEnv) return;
      try {
        let skipProbe = false;
        try {
          const fs = await import("node:fs");
          if (fs.existsSync(CB_FILE)) {
            const raw = fs.readFileSync(CB_FILE, "utf-8");
            const saved = JSON.parse(raw);
            if (Date.now() < saved.blockedUntil) {
              const remaining = Math.ceil((saved.blockedUntil - Date.now()) / 1e3);
              console.warn(
                `[db startup probe] Skipping probe \u2014 file CB aktif (${remaining}s tersisa). Pesan sebelumnya: ${saved.message.slice(0, 80)}`
              );
              setEcbBlock("startup-probe-file-cb", { message: saved.message });
              skipProbe = true;
            } else {
              fs.unlinkSync(CB_FILE);
            }
          }
        } catch {
        }
        if (skipProbe) return;
        const tempPool = new Pool({
          connectionString,
          ssl: isLocalConn ? false : { rejectUnauthorized: false },
          max: 1,
          connectionTimeoutMillis: 4e3
        });
        try {
          await tempPool.query("SELECT 1");
          console.log("[db startup probe] pgBouncer OK \u2014 DB siap, tidak ada pre-existing throttle");
          try {
            const fs = await import("node:fs");
            if (fs.existsSync(CB_FILE)) fs.unlinkSync(CB_FILE);
          } catch {
          }
        } catch (err) {
          const msg = String(err?.message ?? "");
          const isPgBouncerThrottle = msg.includes("ECIRCUITBREAKER") || msg.includes("too many authentication failures");
          if (isPgBouncerThrottle) {
            setEcbBlock("startup-probe", err);
            console.warn(
              "[db startup probe] pgBouncer throttle saat startup \u2014 CB lokal diset (" + msg.slice(0, 80) + "). Top-level DB calls ditolak lokal selama " + Math.round(ECB_PAUSE_MS / 1e3) + "s."
            );
            try {
              const fs = await import("node:fs");
              fs.writeFileSync(CB_FILE, JSON.stringify({
                blockedUntil: Date.now() + ECB_PAUSE_MS,
                message: msg
              }));
            } catch {
            }
          } else {
            console.warn("[db startup probe] DB tidak tersedia saat startup:", msg.slice(0, 120));
          }
        } finally {
          tempPool.end().catch(() => {
          });
        }
      } catch {
      }
    })();
    db = drizzle(pool, { schema: schema_exports });
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-helpers.js
var require_err_helpers = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-helpers.js"(exports, module) {
    "use strict";
    var isErrorLike = (err) => {
      return err && typeof err.message === "string";
    };
    var getErrorCause = (err) => {
      if (!err) return;
      const cause = err.cause;
      if (typeof cause === "function") {
        const causeResult = err.cause();
        return isErrorLike(causeResult) ? causeResult : void 0;
      } else {
        return isErrorLike(cause) ? cause : void 0;
      }
    };
    var _stackWithCauses = (err, seen) => {
      if (!isErrorLike(err)) return "";
      const stack = err.stack || "";
      if (seen.has(err)) {
        return stack + "\ncauses have become circular...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        return stack + "\ncaused by: " + _stackWithCauses(cause, seen);
      } else {
        return stack;
      }
    };
    var stackWithCauses = (err) => _stackWithCauses(err, /* @__PURE__ */ new Set());
    var _messageWithCauses = (err, seen, skip) => {
      if (!isErrorLike(err)) return "";
      const message = skip ? "" : err.message || "";
      if (seen.has(err)) {
        return message + ": ...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        const skipIfVErrorStyleCause = typeof err.cause === "function";
        return message + (skipIfVErrorStyleCause ? "" : ": ") + _messageWithCauses(cause, seen, skipIfVErrorStyleCause);
      } else {
        return message;
      }
    };
    var messageWithCauses = (err) => _messageWithCauses(err, /* @__PURE__ */ new Set());
    module.exports = {
      isErrorLike,
      getErrorCause,
      stackWithCauses,
      messageWithCauses
    };
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-proto.js
var require_err_proto = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-proto.js"(exports, module) {
    "use strict";
    var seen = /* @__PURE__ */ Symbol("circular-ref-tag");
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-err-ref");
    var pinoErrProto = Object.create({}, {
      type: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      message: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      stack: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      aggregateErrors: {
        enumerable: true,
        writable: true,
        value: void 0
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoErrProto, rawSymbol, {
      writable: true,
      value: {}
    });
    module.exports = {
      pinoErrProto,
      pinoErrorSymbols: {
        seen,
        rawSymbol
      }
    };
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err.js
var require_err = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err.js"(exports, module) {
    "use strict";
    module.exports = errSerializer;
    var { messageWithCauses, stackWithCauses, isErrorLike } = require_err_helpers();
    var { pinoErrProto, pinoErrorSymbols } = require_err_proto();
    var { seen } = pinoErrorSymbols;
    var { toString } = Object.prototype;
    function errSerializer(err) {
      if (!isErrorLike(err)) {
        return err;
      }
      err[seen] = void 0;
      const _err = Object.create(pinoErrProto);
      _err.type = toString.call(err.constructor) === "[object Function]" ? err.constructor.name : err.name;
      _err.message = messageWithCauses(err);
      _err.stack = stackWithCauses(err);
      if (Array.isArray(err.errors)) {
        _err.aggregateErrors = err.errors.map((err2) => errSerializer(err2));
      }
      for (const key in err) {
        if (_err[key] === void 0) {
          const val = err[key];
          if (isErrorLike(val)) {
            if (key !== "cause" && !Object.prototype.hasOwnProperty.call(val, seen)) {
              _err[key] = errSerializer(val);
            }
          } else {
            _err[key] = val;
          }
        }
      }
      delete err[seen];
      _err.raw = err;
      return _err;
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-with-cause.js
var require_err_with_cause = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/err-with-cause.js"(exports, module) {
    "use strict";
    module.exports = errWithCauseSerializer;
    var { isErrorLike } = require_err_helpers();
    var { pinoErrProto, pinoErrorSymbols } = require_err_proto();
    var { seen } = pinoErrorSymbols;
    var { toString } = Object.prototype;
    function errWithCauseSerializer(err) {
      if (!isErrorLike(err)) {
        return err;
      }
      err[seen] = void 0;
      const _err = Object.create(pinoErrProto);
      _err.type = toString.call(err.constructor) === "[object Function]" ? err.constructor.name : err.name;
      _err.message = err.message;
      _err.stack = err.stack;
      if (Array.isArray(err.errors)) {
        _err.aggregateErrors = err.errors.map((err2) => errWithCauseSerializer(err2));
      }
      if (isErrorLike(err.cause) && !Object.prototype.hasOwnProperty.call(err.cause, seen)) {
        _err.cause = errWithCauseSerializer(err.cause);
      }
      for (const key in err) {
        if (_err[key] === void 0) {
          const val = err[key];
          if (isErrorLike(val)) {
            if (!Object.prototype.hasOwnProperty.call(val, seen)) {
              _err[key] = errWithCauseSerializer(val);
            }
          } else {
            _err[key] = val;
          }
        }
      }
      delete err[seen];
      _err.raw = err;
      return _err;
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/req.js
var require_req = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/req.js"(exports, module) {
    "use strict";
    module.exports = {
      mapHttpRequest,
      reqSerializer
    };
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-req-ref");
    var pinoReqProto = Object.create({}, {
      id: {
        enumerable: true,
        writable: true,
        value: ""
      },
      method: {
        enumerable: true,
        writable: true,
        value: ""
      },
      url: {
        enumerable: true,
        writable: true,
        value: ""
      },
      query: {
        enumerable: true,
        writable: true,
        value: ""
      },
      params: {
        enumerable: true,
        writable: true,
        value: ""
      },
      headers: {
        enumerable: true,
        writable: true,
        value: {}
      },
      remoteAddress: {
        enumerable: true,
        writable: true,
        value: ""
      },
      remotePort: {
        enumerable: true,
        writable: true,
        value: ""
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoReqProto, rawSymbol, {
      writable: true,
      value: {}
    });
    function reqSerializer(req) {
      const connection = req.info || req.socket;
      const _req = Object.create(pinoReqProto);
      _req.id = typeof req.id === "function" ? req.id() : req.id || (req.info ? req.info.id : void 0);
      _req.method = req.method;
      if (req.originalUrl) {
        _req.url = req.originalUrl;
      } else {
        const path = req.path;
        _req.url = typeof path === "string" ? path : req.url ? req.url.path || req.url : void 0;
      }
      if (req.query) {
        _req.query = req.query;
      }
      if (req.params) {
        _req.params = req.params;
      }
      _req.headers = req.headers;
      _req.remoteAddress = connection && connection.remoteAddress;
      _req.remotePort = connection && connection.remotePort;
      _req.raw = req.raw || req;
      return _req;
    }
    function mapHttpRequest(req) {
      return {
        req: reqSerializer(req)
      };
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/res.js
var require_res = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/lib/res.js"(exports, module) {
    "use strict";
    module.exports = {
      mapHttpResponse,
      resSerializer
    };
    var rawSymbol = /* @__PURE__ */ Symbol("pino-raw-res-ref");
    var pinoResProto = Object.create({}, {
      statusCode: {
        enumerable: true,
        writable: true,
        value: 0
      },
      headers: {
        enumerable: true,
        writable: true,
        value: ""
      },
      raw: {
        enumerable: false,
        get: function() {
          return this[rawSymbol];
        },
        set: function(val) {
          this[rawSymbol] = val;
        }
      }
    });
    Object.defineProperty(pinoResProto, rawSymbol, {
      writable: true,
      value: {}
    });
    function resSerializer(res) {
      const _res = Object.create(pinoResProto);
      _res.statusCode = res.headersSent ? res.statusCode : null;
      _res.headers = res.getHeaders ? res.getHeaders() : res._headers;
      _res.raw = res;
      return _res;
    }
    function mapHttpResponse(res) {
      return {
        res: resSerializer(res)
      };
    }
  }
});

// ../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/index.js
var require_pino_std_serializers = __commonJS({
  "../../node_modules/.pnpm/pino-std-serializers@7.1.0/node_modules/pino-std-serializers/index.js"(exports, module) {
    "use strict";
    var errSerializer = require_err();
    var errWithCauseSerializer = require_err_with_cause();
    var reqSerializers = require_req();
    var resSerializers = require_res();
    module.exports = {
      err: errSerializer,
      errWithCause: errWithCauseSerializer,
      mapHttpRequest: reqSerializers.mapHttpRequest,
      mapHttpResponse: resSerializers.mapHttpResponse,
      req: reqSerializers.reqSerializer,
      res: resSerializers.resSerializer,
      wrapErrorSerializer: function wrapErrorSerializer(customSerializer) {
        if (customSerializer === errSerializer) return customSerializer;
        return function wrapErrSerializer(err) {
          return customSerializer(errSerializer(err));
        };
      },
      wrapRequestSerializer: function wrapRequestSerializer(customSerializer) {
        if (customSerializer === reqSerializers.reqSerializer) return customSerializer;
        return function wrappedReqSerializer(req) {
          return customSerializer(reqSerializers.reqSerializer(req));
        };
      },
      wrapResponseSerializer: function wrapResponseSerializer(customSerializer) {
        if (customSerializer === resSerializers.resSerializer) return customSerializer;
        return function wrappedResSerializer(res) {
          return customSerializer(resSerializers.resSerializer(res));
        };
      }
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/caller.js
var require_caller = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/caller.js"(exports, module) {
    "use strict";
    function noOpPrepareStackTrace(_, stack) {
      return stack;
    }
    module.exports = function getCallers() {
      const originalPrepare = Error.prepareStackTrace;
      Error.prepareStackTrace = noOpPrepareStackTrace;
      const stack = new Error().stack;
      Error.prepareStackTrace = originalPrepare;
      if (!Array.isArray(stack)) {
        return void 0;
      }
      const entries = stack.slice(2);
      const fileNames = [];
      for (const entry of entries) {
        if (!entry) {
          continue;
        }
        fileNames.push(entry.getFileName());
      }
      return fileNames;
    };
  }
});

// ../../node_modules/.pnpm/@pinojs+redact@0.4.0/node_modules/@pinojs/redact/index.js
var require_redact = __commonJS({
  "../../node_modules/.pnpm/@pinojs+redact@0.4.0/node_modules/@pinojs/redact/index.js"(exports, module) {
    "use strict";
    function deepClone(obj) {
      if (obj === null || typeof obj !== "object") {
        return obj;
      }
      if (obj instanceof Date) {
        return new Date(obj.getTime());
      }
      if (obj instanceof Array) {
        const cloned = [];
        for (let i = 0; i < obj.length; i++) {
          cloned[i] = deepClone(obj[i]);
        }
        return cloned;
      }
      if (typeof obj === "object") {
        const cloned = Object.create(Object.getPrototypeOf(obj));
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
          }
        }
        return cloned;
      }
      return obj;
    }
    function parsePath(path) {
      const parts = [];
      let current = "";
      let inBrackets = false;
      let inQuotes = false;
      let quoteChar = "";
      for (let i = 0; i < path.length; i++) {
        const char = path[i];
        if (!inBrackets && char === ".") {
          if (current) {
            parts.push(current);
            current = "";
          }
        } else if (char === "[") {
          if (current) {
            parts.push(current);
            current = "";
          }
          inBrackets = true;
        } else if (char === "]" && inBrackets) {
          parts.push(current);
          current = "";
          inBrackets = false;
          inQuotes = false;
        } else if ((char === '"' || char === "'") && inBrackets) {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          } else {
            current += char;
          }
        } else {
          current += char;
        }
      }
      if (current) {
        parts.push(current);
      }
      return parts;
    }
    function setValue(obj, parts, value) {
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof current !== "object" || current === null || !(key in current)) {
          return false;
        }
        if (typeof current[key] !== "object" || current[key] === null) {
          return false;
        }
        current = current[key];
      }
      const lastKey = parts[parts.length - 1];
      if (lastKey === "*") {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            current[i] = value;
          }
        } else if (typeof current === "object" && current !== null) {
          for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
              current[key] = value;
            }
          }
        }
      } else {
        if (typeof current === "object" && current !== null && lastKey in current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
          current[lastKey] = value;
        }
      }
      return true;
    }
    function removeKey(obj, parts) {
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (typeof current !== "object" || current === null || !(key in current)) {
          return false;
        }
        if (typeof current[key] !== "object" || current[key] === null) {
          return false;
        }
        current = current[key];
      }
      const lastKey = parts[parts.length - 1];
      if (lastKey === "*") {
        if (Array.isArray(current)) {
          for (let i = 0; i < current.length; i++) {
            current[i] = void 0;
          }
        } else if (typeof current === "object" && current !== null) {
          for (const key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
              delete current[key];
            }
          }
        }
      } else {
        if (typeof current === "object" && current !== null && lastKey in current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
          delete current[lastKey];
        }
      }
      return true;
    }
    var PATH_NOT_FOUND = /* @__PURE__ */ Symbol("PATH_NOT_FOUND");
    function getValueIfExists(obj, parts) {
      let current = obj;
      for (const part of parts) {
        if (current === null || current === void 0) {
          return PATH_NOT_FOUND;
        }
        if (typeof current !== "object" || current === null) {
          return PATH_NOT_FOUND;
        }
        if (!(part in current)) {
          return PATH_NOT_FOUND;
        }
        current = current[part];
      }
      return current;
    }
    function getValue(obj, parts) {
      let current = obj;
      for (const part of parts) {
        if (current === null || current === void 0) {
          return void 0;
        }
        if (typeof current !== "object" || current === null) {
          return void 0;
        }
        current = current[part];
      }
      return current;
    }
    function redactPaths(obj, paths, censor, remove = false) {
      for (const path of paths) {
        const parts = parsePath(path);
        if (parts.includes("*")) {
          redactWildcardPath(obj, parts, censor, path, remove);
        } else {
          if (remove) {
            removeKey(obj, parts);
          } else {
            const value = getValueIfExists(obj, parts);
            if (value === PATH_NOT_FOUND) {
              continue;
            }
            const actualCensor = typeof censor === "function" ? censor(value, parts) : censor;
            setValue(obj, parts, actualCensor);
          }
        }
      }
    }
    function redactWildcardPath(obj, parts, censor, originalPath, remove = false) {
      const wildcardIndex = parts.indexOf("*");
      if (wildcardIndex === parts.length - 1) {
        const parentParts = parts.slice(0, -1);
        let current = obj;
        for (const part of parentParts) {
          if (current === null || current === void 0) return;
          if (typeof current !== "object" || current === null) return;
          current = current[part];
        }
        if (Array.isArray(current)) {
          if (remove) {
            for (let i = 0; i < current.length; i++) {
              current[i] = void 0;
            }
          } else {
            for (let i = 0; i < current.length; i++) {
              const indexPath = [...parentParts, i.toString()];
              const actualCensor = typeof censor === "function" ? censor(current[i], indexPath) : censor;
              current[i] = actualCensor;
            }
          }
        } else if (typeof current === "object" && current !== null) {
          if (remove) {
            const keysToDelete = [];
            for (const key in current) {
              if (Object.prototype.hasOwnProperty.call(current, key)) {
                keysToDelete.push(key);
              }
            }
            for (const key of keysToDelete) {
              delete current[key];
            }
          } else {
            for (const key in current) {
              const keyPath = [...parentParts, key];
              const actualCensor = typeof censor === "function" ? censor(current[key], keyPath) : censor;
              current[key] = actualCensor;
            }
          }
        }
      } else {
        redactIntermediateWildcard(obj, parts, censor, wildcardIndex, originalPath, remove);
      }
    }
    function redactIntermediateWildcard(obj, parts, censor, wildcardIndex, originalPath, remove = false) {
      const beforeWildcard = parts.slice(0, wildcardIndex);
      const afterWildcard = parts.slice(wildcardIndex + 1);
      const pathArray = [];
      function traverse(current, pathLength) {
        if (pathLength === beforeWildcard.length) {
          if (Array.isArray(current)) {
            for (let i = 0; i < current.length; i++) {
              pathArray[pathLength] = i.toString();
              traverse(current[i], pathLength + 1);
            }
          } else if (typeof current === "object" && current !== null) {
            for (const key in current) {
              pathArray[pathLength] = key;
              traverse(current[key], pathLength + 1);
            }
          }
        } else if (pathLength < beforeWildcard.length) {
          const nextKey = beforeWildcard[pathLength];
          if (current && typeof current === "object" && current !== null && nextKey in current) {
            pathArray[pathLength] = nextKey;
            traverse(current[nextKey], pathLength + 1);
          }
        } else {
          if (afterWildcard.includes("*")) {
            const wrappedCensor = typeof censor === "function" ? (value, path) => {
              const fullPath = [...pathArray.slice(0, pathLength), ...path];
              return censor(value, fullPath);
            } : censor;
            redactWildcardPath(current, afterWildcard, wrappedCensor, originalPath, remove);
          } else {
            if (remove) {
              removeKey(current, afterWildcard);
            } else {
              const actualCensor = typeof censor === "function" ? censor(getValue(current, afterWildcard), [...pathArray.slice(0, pathLength), ...afterWildcard]) : censor;
              setValue(current, afterWildcard, actualCensor);
            }
          }
        }
      }
      if (beforeWildcard.length === 0) {
        traverse(obj, 0);
      } else {
        let current = obj;
        for (let i = 0; i < beforeWildcard.length; i++) {
          const part = beforeWildcard[i];
          if (current === null || current === void 0) return;
          if (typeof current !== "object" || current === null) return;
          current = current[part];
          pathArray[i] = part;
        }
        if (current !== null && current !== void 0) {
          traverse(current, beforeWildcard.length);
        }
      }
    }
    function buildPathStructure(pathsToClone) {
      if (pathsToClone.length === 0) {
        return null;
      }
      const pathStructure = /* @__PURE__ */ new Map();
      for (const path of pathsToClone) {
        const parts = parsePath(path);
        let current = pathStructure;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (!current.has(part)) {
            current.set(part, /* @__PURE__ */ new Map());
          }
          current = current.get(part);
        }
      }
      return pathStructure;
    }
    function selectiveClone(obj, pathStructure) {
      if (!pathStructure) {
        return obj;
      }
      function cloneSelectively(source, pathMap, depth = 0) {
        if (!pathMap || pathMap.size === 0) {
          return source;
        }
        if (source === null || typeof source !== "object") {
          return source;
        }
        if (source instanceof Date) {
          return new Date(source.getTime());
        }
        if (Array.isArray(source)) {
          const cloned2 = [];
          for (let i = 0; i < source.length; i++) {
            const indexStr = i.toString();
            if (pathMap.has(indexStr) || pathMap.has("*")) {
              cloned2[i] = cloneSelectively(source[i], pathMap.get(indexStr) || pathMap.get("*"));
            } else {
              cloned2[i] = source[i];
            }
          }
          return cloned2;
        }
        const cloned = Object.create(Object.getPrototypeOf(source));
        for (const key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            if (pathMap.has(key) || pathMap.has("*")) {
              cloned[key] = cloneSelectively(source[key], pathMap.get(key) || pathMap.get("*"));
            } else {
              cloned[key] = source[key];
            }
          }
        }
        return cloned;
      }
      return cloneSelectively(obj, pathStructure);
    }
    function validatePath(path) {
      if (typeof path !== "string") {
        throw new Error("Paths must be (non-empty) strings");
      }
      if (path === "") {
        throw new Error("Invalid redaction path ()");
      }
      if (path.includes("..")) {
        throw new Error(`Invalid redaction path (${path})`);
      }
      if (path.includes(",")) {
        throw new Error(`Invalid redaction path (${path})`);
      }
      let bracketCount = 0;
      let inQuotes = false;
      let quoteChar = "";
      for (let i = 0; i < path.length; i++) {
        const char = path[i];
        if ((char === '"' || char === "'") && bracketCount > 0) {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          } else if (char === quoteChar) {
            inQuotes = false;
            quoteChar = "";
          }
        } else if (char === "[" && !inQuotes) {
          bracketCount++;
        } else if (char === "]" && !inQuotes) {
          bracketCount--;
          if (bracketCount < 0) {
            throw new Error(`Invalid redaction path (${path})`);
          }
        }
      }
      if (bracketCount !== 0) {
        throw new Error(`Invalid redaction path (${path})`);
      }
    }
    function validatePaths(paths) {
      if (!Array.isArray(paths)) {
        throw new TypeError("paths must be an array");
      }
      for (const path of paths) {
        validatePath(path);
      }
    }
    function slowRedact(options = {}) {
      const {
        paths = [],
        censor = "[REDACTED]",
        serialize = JSON.stringify,
        strict = true,
        remove = false
      } = options;
      validatePaths(paths);
      const pathStructure = buildPathStructure(paths);
      return function redact(obj) {
        if (strict && (obj === null || typeof obj !== "object")) {
          if (obj === null || obj === void 0) {
            return serialize ? serialize(obj) : obj;
          }
          if (typeof obj !== "object") {
            return serialize ? serialize(obj) : obj;
          }
        }
        const cloned = selectiveClone(obj, pathStructure);
        const original = obj;
        let actualCensor = censor;
        if (typeof censor === "function") {
          actualCensor = censor;
        }
        redactPaths(cloned, paths, actualCensor, remove);
        if (serialize === false) {
          cloned.restore = function() {
            return deepClone(original);
          };
          return cloned;
        }
        if (typeof serialize === "function") {
          return serialize(cloned);
        }
        return JSON.stringify(cloned);
      };
    }
    module.exports = slowRedact;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/symbols.js
var require_symbols = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/symbols.js"(exports, module) {
    "use strict";
    var setLevelSym = /* @__PURE__ */ Symbol("pino.setLevel");
    var getLevelSym = /* @__PURE__ */ Symbol("pino.getLevel");
    var levelValSym = /* @__PURE__ */ Symbol("pino.levelVal");
    var levelCompSym = /* @__PURE__ */ Symbol("pino.levelComp");
    var useLevelLabelsSym = /* @__PURE__ */ Symbol("pino.useLevelLabels");
    var useOnlyCustomLevelsSym = /* @__PURE__ */ Symbol("pino.useOnlyCustomLevels");
    var mixinSym = /* @__PURE__ */ Symbol("pino.mixin");
    var lsCacheSym = /* @__PURE__ */ Symbol("pino.lsCache");
    var chindingsSym = /* @__PURE__ */ Symbol("pino.chindings");
    var asJsonSym = /* @__PURE__ */ Symbol("pino.asJson");
    var writeSym = /* @__PURE__ */ Symbol("pino.write");
    var redactFmtSym = /* @__PURE__ */ Symbol("pino.redactFmt");
    var timeSym = /* @__PURE__ */ Symbol("pino.time");
    var timeSliceIndexSym = /* @__PURE__ */ Symbol("pino.timeSliceIndex");
    var streamSym = /* @__PURE__ */ Symbol("pino.stream");
    var stringifySym = /* @__PURE__ */ Symbol("pino.stringify");
    var stringifySafeSym = /* @__PURE__ */ Symbol("pino.stringifySafe");
    var stringifiersSym = /* @__PURE__ */ Symbol("pino.stringifiers");
    var endSym = /* @__PURE__ */ Symbol("pino.end");
    var formatOptsSym = /* @__PURE__ */ Symbol("pino.formatOpts");
    var messageKeySym = /* @__PURE__ */ Symbol("pino.messageKey");
    var errorKeySym = /* @__PURE__ */ Symbol("pino.errorKey");
    var nestedKeySym = /* @__PURE__ */ Symbol("pino.nestedKey");
    var nestedKeyStrSym = /* @__PURE__ */ Symbol("pino.nestedKeyStr");
    var mixinMergeStrategySym = /* @__PURE__ */ Symbol("pino.mixinMergeStrategy");
    var msgPrefixSym = /* @__PURE__ */ Symbol("pino.msgPrefix");
    var wildcardFirstSym = /* @__PURE__ */ Symbol("pino.wildcardFirst");
    var serializersSym = /* @__PURE__ */ Symbol.for("pino.serializers");
    var formattersSym = /* @__PURE__ */ Symbol.for("pino.formatters");
    var hooksSym = /* @__PURE__ */ Symbol.for("pino.hooks");
    var needsMetadataGsym = /* @__PURE__ */ Symbol.for("pino.metadata");
    module.exports = {
      setLevelSym,
      getLevelSym,
      levelValSym,
      levelCompSym,
      useLevelLabelsSym,
      mixinSym,
      lsCacheSym,
      chindingsSym,
      asJsonSym,
      writeSym,
      serializersSym,
      redactFmtSym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      stringifySym,
      stringifySafeSym,
      stringifiersSym,
      endSym,
      formatOptsSym,
      messageKeySym,
      errorKeySym,
      nestedKeySym,
      wildcardFirstSym,
      needsMetadataGsym,
      useOnlyCustomLevelsSym,
      formattersSym,
      hooksSym,
      nestedKeyStrSym,
      mixinMergeStrategySym,
      msgPrefixSym
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/redaction.js
var require_redaction = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/redaction.js"(exports, module) {
    "use strict";
    var Redact = require_redact();
    var { redactFmtSym, wildcardFirstSym } = require_symbols();
    var rx = /[^.[\]]+|\[([^[\]]*?)\]/g;
    var CENSOR = "[Redacted]";
    var strict = false;
    function redaction(opts, serialize) {
      const { paths, censor, remove } = handle(opts);
      const shape = paths.reduce((o, str) => {
        rx.lastIndex = 0;
        const first = rx.exec(str);
        const next = rx.exec(str);
        let ns = first[1] !== void 0 ? first[1].replace(/^(?:"|'|`)(.*)(?:"|'|`)$/, "$1") : first[0];
        if (ns === "*") {
          ns = wildcardFirstSym;
        }
        if (next === null) {
          o[ns] = null;
          return o;
        }
        if (o[ns] === null) {
          return o;
        }
        const { index: index81 } = next;
        const nextPath = `${str.substr(index81, str.length - 1)}`;
        o[ns] = o[ns] || [];
        if (ns !== wildcardFirstSym && o[ns].length === 0) {
          o[ns].push(...o[wildcardFirstSym] || []);
        }
        if (ns === wildcardFirstSym) {
          Object.keys(o).forEach(function(k) {
            if (o[k]) {
              o[k].push(nextPath);
            }
          });
        }
        o[ns].push(nextPath);
        return o;
      }, {});
      const result = {
        [redactFmtSym]: Redact({ paths, censor, serialize, strict, remove })
      };
      const topCensor = (...args) => {
        return typeof censor === "function" ? serialize(censor(...args)) : serialize(censor);
      };
      return [...Object.keys(shape), ...Object.getOwnPropertySymbols(shape)].reduce((o, k) => {
        if (shape[k] === null) {
          o[k] = (value) => topCensor(value, [k]);
        } else {
          const wrappedCensor = typeof censor === "function" ? (value, path) => {
            return censor(value, [k, ...path]);
          } : censor;
          o[k] = Redact({
            paths: shape[k],
            censor: wrappedCensor,
            serialize,
            strict,
            remove
          });
        }
        return o;
      }, result);
    }
    function handle(opts) {
      if (Array.isArray(opts)) {
        opts = { paths: opts, censor: CENSOR };
        return opts;
      }
      let { paths, censor = CENSOR, remove } = opts;
      if (Array.isArray(paths) === false) {
        throw Error("pino \u2013 redact must contain an array of strings");
      }
      if (remove === true) censor = void 0;
      return { paths, censor, remove };
    }
    module.exports = redaction;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/time.js
var require_time = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/time.js"(exports, module) {
    "use strict";
    var nullTime = () => "";
    var epochTime = () => `,"time":${Date.now()}`;
    var unixTime = () => `,"time":${Math.round(Date.now() / 1e3)}`;
    var isoTime = () => `,"time":"${new Date(Date.now()).toISOString()}"`;
    var NS_PER_MS = 1000000n;
    var NS_PER_SEC = 1000000000n;
    var startWallTimeNs = BigInt(Date.now()) * NS_PER_MS;
    var startHrTime = process.hrtime.bigint();
    var isoTimeNano = () => {
      const elapsedNs = process.hrtime.bigint() - startHrTime;
      const currentTimeNs = startWallTimeNs + elapsedNs;
      const secondsSinceEpoch = currentTimeNs / NS_PER_SEC;
      const nanosWithinSecond = currentTimeNs % NS_PER_SEC;
      const msSinceEpoch = Number(secondsSinceEpoch * 1000n + nanosWithinSecond / 1000000n);
      const date23 = new Date(msSinceEpoch);
      const year = date23.getUTCFullYear();
      const month = (date23.getUTCMonth() + 1).toString().padStart(2, "0");
      const day = date23.getUTCDate().toString().padStart(2, "0");
      const hours = date23.getUTCHours().toString().padStart(2, "0");
      const minutes = date23.getUTCMinutes().toString().padStart(2, "0");
      const seconds = date23.getUTCSeconds().toString().padStart(2, "0");
      return `,"time":"${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${nanosWithinSecond.toString().padStart(9, "0")}Z"`;
    };
    module.exports = { nullTime, epochTime, unixTime, isoTime, isoTimeNano };
  }
});

// ../../node_modules/.pnpm/quick-format-unescaped@4.0.4/node_modules/quick-format-unescaped/index.js
var require_quick_format_unescaped = __commonJS({
  "../../node_modules/.pnpm/quick-format-unescaped@4.0.4/node_modules/quick-format-unescaped/index.js"(exports, module) {
    "use strict";
    function tryStringify(o) {
      try {
        return JSON.stringify(o);
      } catch (e) {
        return '"[Circular]"';
      }
    }
    module.exports = format;
    function format(f, args, opts) {
      var ss = opts && opts.stringify || tryStringify;
      var offset = 1;
      if (typeof f === "object" && f !== null) {
        var len = args.length + offset;
        if (len === 1) return f;
        var objects = new Array(len);
        objects[0] = ss(f);
        for (var index81 = 1; index81 < len; index81++) {
          objects[index81] = ss(args[index81]);
        }
        return objects.join(" ");
      }
      if (typeof f !== "string") {
        return f;
      }
      var argLen = args.length;
      if (argLen === 0) return f;
      var str = "";
      var a = 1 - offset;
      var lastPos = -1;
      var flen = f && f.length || 0;
      for (var i = 0; i < flen; ) {
        if (f.charCodeAt(i) === 37 && i + 1 < flen) {
          lastPos = lastPos > -1 ? lastPos : 0;
          switch (f.charCodeAt(i + 1)) {
            case 100:
            // 'd'
            case 102:
              if (a >= argLen)
                break;
              if (args[a] == null) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += Number(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 105:
              if (a >= argLen)
                break;
              if (args[a] == null) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += Math.floor(Number(args[a]));
              lastPos = i + 2;
              i++;
              break;
            case 79:
            // 'O'
            case 111:
            // 'o'
            case 106:
              if (a >= argLen)
                break;
              if (args[a] === void 0) break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              var type = typeof args[a];
              if (type === "string") {
                str += "'" + args[a] + "'";
                lastPos = i + 2;
                i++;
                break;
              }
              if (type === "function") {
                str += args[a].name || "<anonymous>";
                lastPos = i + 2;
                i++;
                break;
              }
              str += ss(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 115:
              if (a >= argLen)
                break;
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += String(args[a]);
              lastPos = i + 2;
              i++;
              break;
            case 37:
              if (lastPos < i)
                str += f.slice(lastPos, i);
              str += "%";
              lastPos = i + 2;
              i++;
              a--;
              break;
          }
          ++a;
        }
        ++i;
      }
      if (lastPos === -1)
        return f;
      else if (lastPos < flen) {
        str += f.slice(lastPos);
      }
      return str;
    }
  }
});

// ../../node_modules/.pnpm/atomic-sleep@1.0.0/node_modules/atomic-sleep/index.js
var require_atomic_sleep = __commonJS({
  "../../node_modules/.pnpm/atomic-sleep@1.0.0/node_modules/atomic-sleep/index.js"(exports, module) {
    "use strict";
    if (typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined") {
      let sleep = function(ms) {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
          if (typeof ms !== "number" && typeof ms !== "bigint") {
            throw TypeError("sleep: ms must be a number");
          }
          throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
        }
        Atomics.wait(nil, 0, 0, Number(ms));
      };
      const nil = new Int32Array(new SharedArrayBuffer(4));
      module.exports = sleep;
    } else {
      let sleep = function(ms) {
        const valid = ms > 0 && ms < Infinity;
        if (valid === false) {
          if (typeof ms !== "number" && typeof ms !== "bigint") {
            throw TypeError("sleep: ms must be a number");
          }
          throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
        }
        const target = Date.now() + Number(ms);
        while (target > Date.now()) {
        }
      };
      module.exports = sleep;
    }
  }
});

// ../../node_modules/.pnpm/sonic-boom@4.2.1/node_modules/sonic-boom/index.js
var require_sonic_boom = __commonJS({
  "../../node_modules/.pnpm/sonic-boom@4.2.1/node_modules/sonic-boom/index.js"(exports, module) {
    "use strict";
    var fs = __require("fs");
    var EventEmitter2 = __require("events");
    var inherits = __require("util").inherits;
    var path = __require("path");
    var sleep = require_atomic_sleep();
    var assert = __require("assert");
    var BUSY_WRITE_TIMEOUT = 100;
    var kEmptyBuffer = Buffer.allocUnsafe(0);
    var MAX_WRITE = 16 * 1024;
    var kContentModeBuffer = "buffer";
    var kContentModeUtf8 = "utf8";
    var [major, minor] = (process.versions.node || "0.0").split(".").map(Number);
    var kCopyBuffer = major >= 22 && minor >= 7;
    function openFile(file, sonic) {
      sonic._opening = true;
      sonic._writing = true;
      sonic._asyncDrainScheduled = false;
      function fileOpened(err, fd) {
        if (err) {
          sonic._reopening = false;
          sonic._writing = false;
          sonic._opening = false;
          if (sonic.sync) {
            process.nextTick(() => {
              if (sonic.listenerCount("error") > 0) {
                sonic.emit("error", err);
              }
            });
          } else {
            sonic.emit("error", err);
          }
          return;
        }
        const reopening = sonic._reopening;
        sonic.fd = fd;
        sonic.file = file;
        sonic._reopening = false;
        sonic._opening = false;
        sonic._writing = false;
        if (sonic.sync) {
          process.nextTick(() => sonic.emit("ready"));
        } else {
          sonic.emit("ready");
        }
        if (sonic.destroyed) {
          return;
        }
        if (!sonic._writing && sonic._len > sonic.minLength || sonic._flushPending) {
          sonic._actualWrite();
        } else if (reopening) {
          process.nextTick(() => sonic.emit("drain"));
        }
      }
      const flags = sonic.append ? "a" : "w";
      const mode = sonic.mode;
      if (sonic.sync) {
        try {
          if (sonic.mkdir) fs.mkdirSync(path.dirname(file), { recursive: true });
          const fd = fs.openSync(file, flags, mode);
          fileOpened(null, fd);
        } catch (err) {
          fileOpened(err);
          throw err;
        }
      } else if (sonic.mkdir) {
        fs.mkdir(path.dirname(file), { recursive: true }, (err) => {
          if (err) return fileOpened(err);
          fs.open(file, flags, mode, fileOpened);
        });
      } else {
        fs.open(file, flags, mode, fileOpened);
      }
    }
    function SonicBoom(opts) {
      if (!(this instanceof SonicBoom)) {
        return new SonicBoom(opts);
      }
      let { fd, dest, minLength, maxLength, maxWrite, periodicFlush, sync, append = true, mkdir, retryEAGAIN, fsync, contentMode, mode } = opts || {};
      fd = fd || dest;
      this._len = 0;
      this.fd = -1;
      this._bufs = [];
      this._lens = [];
      this._writing = false;
      this._ending = false;
      this._reopening = false;
      this._asyncDrainScheduled = false;
      this._flushPending = false;
      this._hwm = Math.max(minLength || 0, 16387);
      this.file = null;
      this.destroyed = false;
      this.minLength = minLength || 0;
      this.maxLength = maxLength || 0;
      this.maxWrite = maxWrite || MAX_WRITE;
      this._periodicFlush = periodicFlush || 0;
      this._periodicFlushTimer = void 0;
      this.sync = sync || false;
      this.writable = true;
      this._fsync = fsync || false;
      this.append = append || false;
      this.mode = mode;
      this.retryEAGAIN = retryEAGAIN || (() => true);
      this.mkdir = mkdir || false;
      let fsWriteSync;
      let fsWrite;
      if (contentMode === kContentModeBuffer) {
        this._writingBuf = kEmptyBuffer;
        this.write = writeBuffer;
        this.flush = flushBuffer;
        this.flushSync = flushBufferSync;
        this._actualWrite = actualWriteBuffer;
        fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf);
        fsWrite = () => fs.write(this.fd, this._writingBuf, this.release);
      } else if (contentMode === void 0 || contentMode === kContentModeUtf8) {
        this._writingBuf = "";
        this.write = write;
        this.flush = flush;
        this.flushSync = flushSync;
        this._actualWrite = actualWrite;
        fsWriteSync = () => {
          if (Buffer.isBuffer(this._writingBuf)) {
            return fs.writeSync(this.fd, this._writingBuf);
          }
          return fs.writeSync(this.fd, this._writingBuf, "utf8");
        };
        fsWrite = () => {
          if (Buffer.isBuffer(this._writingBuf)) {
            return fs.write(this.fd, this._writingBuf, this.release);
          }
          return fs.write(this.fd, this._writingBuf, "utf8", this.release);
        };
      } else {
        throw new Error(`SonicBoom supports "${kContentModeUtf8}" and "${kContentModeBuffer}", but passed ${contentMode}`);
      }
      if (typeof fd === "number") {
        this.fd = fd;
        process.nextTick(() => this.emit("ready"));
      } else if (typeof fd === "string") {
        openFile(fd, this);
      } else {
        throw new Error("SonicBoom supports only file descriptors and files");
      }
      if (this.minLength >= this.maxWrite) {
        throw new Error(`minLength should be smaller than maxWrite (${this.maxWrite})`);
      }
      this.release = (err, n) => {
        if (err) {
          if ((err.code === "EAGAIN" || err.code === "EBUSY") && this.retryEAGAIN(err, this._writingBuf.length, this._len - this._writingBuf.length)) {
            if (this.sync) {
              try {
                sleep(BUSY_WRITE_TIMEOUT);
                this.release(void 0, 0);
              } catch (err2) {
                this.release(err2);
              }
            } else {
              setTimeout(fsWrite, BUSY_WRITE_TIMEOUT);
            }
          } else {
            this._writing = false;
            this.emit("error", err);
          }
          return;
        }
        this.emit("write", n);
        const releasedBufObj = releaseWritingBuf(this._writingBuf, this._len, n);
        this._len = releasedBufObj.len;
        this._writingBuf = releasedBufObj.writingBuf;
        if (this._writingBuf.length) {
          if (!this.sync) {
            fsWrite();
            return;
          }
          try {
            do {
              const n2 = fsWriteSync();
              const releasedBufObj2 = releaseWritingBuf(this._writingBuf, this._len, n2);
              this._len = releasedBufObj2.len;
              this._writingBuf = releasedBufObj2.writingBuf;
            } while (this._writingBuf.length);
          } catch (err2) {
            this.release(err2);
            return;
          }
        }
        if (this._fsync) {
          fs.fsyncSync(this.fd);
        }
        const len = this._len;
        if (this._reopening) {
          this._writing = false;
          this._reopening = false;
          this.reopen();
        } else if (len > this.minLength) {
          this._actualWrite();
        } else if (this._ending) {
          if (len > 0) {
            this._actualWrite();
          } else {
            this._writing = false;
            actualClose(this);
          }
        } else {
          this._writing = false;
          if (this.sync) {
            if (!this._asyncDrainScheduled) {
              this._asyncDrainScheduled = true;
              process.nextTick(emitDrain, this);
            }
          } else {
            this.emit("drain");
          }
        }
      };
      this.on("newListener", function(name) {
        if (name === "drain") {
          this._asyncDrainScheduled = false;
        }
      });
      if (this._periodicFlush !== 0) {
        this._periodicFlushTimer = setInterval(() => this.flush(null), this._periodicFlush);
        this._periodicFlushTimer.unref();
      }
    }
    function releaseWritingBuf(writingBuf, len, n) {
      if (typeof writingBuf === "string") {
        writingBuf = Buffer.from(writingBuf);
      }
      len = Math.max(len - n, 0);
      writingBuf = writingBuf.subarray(n);
      return { writingBuf, len };
    }
    function emitDrain(sonic) {
      const hasListeners = sonic.listenerCount("drain") > 0;
      if (!hasListeners) return;
      sonic._asyncDrainScheduled = false;
      sonic.emit("drain");
    }
    inherits(SonicBoom, EventEmitter2);
    function mergeBuf(bufs, len) {
      if (bufs.length === 0) {
        return kEmptyBuffer;
      }
      if (bufs.length === 1) {
        return bufs[0];
      }
      return Buffer.concat(bufs, len);
    }
    function write(data) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      data = "" + data;
      const dataLen = Buffer.byteLength(data);
      const len = this._len + dataLen;
      const bufs = this._bufs;
      if (this.maxLength && len > this.maxLength) {
        this.emit("drop", data);
        return this._len < this._hwm;
      }
      if (bufs.length === 0 || Buffer.byteLength(bufs[bufs.length - 1]) + dataLen > this.maxWrite) {
        bufs.push(data);
      } else {
        bufs[bufs.length - 1] += data;
      }
      this._len = len;
      if (!this._writing && this._len >= this.minLength) {
        this._actualWrite();
      }
      return this._len < this._hwm;
    }
    function writeBuffer(data) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      const len = this._len + data.length;
      const bufs = this._bufs;
      const lens = this._lens;
      if (this.maxLength && len > this.maxLength) {
        this.emit("drop", data);
        return this._len < this._hwm;
      }
      if (bufs.length === 0 || lens[lens.length - 1] + data.length > this.maxWrite) {
        bufs.push([data]);
        lens.push(data.length);
      } else {
        bufs[bufs.length - 1].push(data);
        lens[lens.length - 1] += data.length;
      }
      this._len = len;
      if (!this._writing && this._len >= this.minLength) {
        this._actualWrite();
      }
      return this._len < this._hwm;
    }
    function callFlushCallbackOnDrain(cb) {
      this._flushPending = true;
      const onDrain = () => {
        if (!this._fsync) {
          try {
            fs.fsync(this.fd, (err) => {
              this._flushPending = false;
              cb(err);
            });
          } catch (err) {
            cb(err);
          }
        } else {
          this._flushPending = false;
          cb();
        }
        this.off("error", onError);
      };
      const onError = (err) => {
        this._flushPending = false;
        cb(err);
        this.off("drain", onDrain);
      };
      this.once("drain", onDrain);
      this.once("error", onError);
    }
    function flush(cb) {
      if (cb != null && typeof cb !== "function") {
        throw new Error("flush cb must be a function");
      }
      if (this.destroyed) {
        const error = new Error("SonicBoom destroyed");
        if (cb) {
          cb(error);
          return;
        }
        throw error;
      }
      if (this.minLength <= 0) {
        cb?.();
        return;
      }
      if (cb) {
        callFlushCallbackOnDrain.call(this, cb);
      }
      if (this._writing) {
        return;
      }
      if (this._bufs.length === 0) {
        this._bufs.push("");
      }
      this._actualWrite();
    }
    function flushBuffer(cb) {
      if (cb != null && typeof cb !== "function") {
        throw new Error("flush cb must be a function");
      }
      if (this.destroyed) {
        const error = new Error("SonicBoom destroyed");
        if (cb) {
          cb(error);
          return;
        }
        throw error;
      }
      if (this.minLength <= 0) {
        cb?.();
        return;
      }
      if (cb) {
        callFlushCallbackOnDrain.call(this, cb);
      }
      if (this._writing) {
        return;
      }
      if (this._bufs.length === 0) {
        this._bufs.push([]);
        this._lens.push(0);
      }
      this._actualWrite();
    }
    SonicBoom.prototype.reopen = function(file) {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this._opening) {
        this.once("ready", () => {
          this.reopen(file);
        });
        return;
      }
      if (this._ending) {
        return;
      }
      if (!this.file) {
        throw new Error("Unable to reopen a file descriptor, you must pass a file to SonicBoom");
      }
      if (file) {
        this.file = file;
      }
      this._reopening = true;
      if (this._writing) {
        return;
      }
      const fd = this.fd;
      this.once("ready", () => {
        if (fd !== this.fd) {
          fs.close(fd, (err) => {
            if (err) {
              return this.emit("error", err);
            }
          });
        }
      });
      openFile(this.file, this);
    };
    SonicBoom.prototype.end = function() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this._opening) {
        this.once("ready", () => {
          this.end();
        });
        return;
      }
      if (this._ending) {
        return;
      }
      this._ending = true;
      if (this._writing) {
        return;
      }
      if (this._len > 0 && this.fd >= 0) {
        this._actualWrite();
      } else {
        actualClose(this);
      }
    };
    function flushSync() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this.fd < 0) {
        throw new Error("sonic boom is not ready yet");
      }
      if (!this._writing && this._writingBuf.length > 0) {
        this._bufs.unshift(this._writingBuf);
        this._writingBuf = "";
      }
      let buf = "";
      while (this._bufs.length || buf.length) {
        if (buf.length <= 0) {
          buf = this._bufs[0];
        }
        try {
          const n = Buffer.isBuffer(buf) ? fs.writeSync(this.fd, buf) : fs.writeSync(this.fd, buf, "utf8");
          const releasedBufObj = releaseWritingBuf(buf, this._len, n);
          buf = releasedBufObj.writingBuf;
          this._len = releasedBufObj.len;
          if (buf.length <= 0) {
            this._bufs.shift();
          }
        } catch (err) {
          const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
          if (shouldRetry && !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
            throw err;
          }
          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
      try {
        fs.fsyncSync(this.fd);
      } catch {
      }
    }
    function flushBufferSync() {
      if (this.destroyed) {
        throw new Error("SonicBoom destroyed");
      }
      if (this.fd < 0) {
        throw new Error("sonic boom is not ready yet");
      }
      if (!this._writing && this._writingBuf.length > 0) {
        this._bufs.unshift([this._writingBuf]);
        this._writingBuf = kEmptyBuffer;
      }
      let buf = kEmptyBuffer;
      while (this._bufs.length || buf.length) {
        if (buf.length <= 0) {
          buf = mergeBuf(this._bufs[0], this._lens[0]);
        }
        try {
          const n = fs.writeSync(this.fd, buf);
          buf = buf.subarray(n);
          this._len = Math.max(this._len - n, 0);
          if (buf.length <= 0) {
            this._bufs.shift();
            this._lens.shift();
          }
        } catch (err) {
          const shouldRetry = err.code === "EAGAIN" || err.code === "EBUSY";
          if (shouldRetry && !this.retryEAGAIN(err, buf.length, this._len - buf.length)) {
            throw err;
          }
          sleep(BUSY_WRITE_TIMEOUT);
        }
      }
    }
    SonicBoom.prototype.destroy = function() {
      if (this.destroyed) {
        return;
      }
      actualClose(this);
    };
    function actualWrite() {
      const release = this.release;
      this._writing = true;
      this._writingBuf = this._writingBuf.length ? this._writingBuf : this._bufs.shift() || "";
      if (this.sync) {
        try {
          const written = Buffer.isBuffer(this._writingBuf) ? fs.writeSync(this.fd, this._writingBuf) : fs.writeSync(this.fd, this._writingBuf, "utf8");
          release(null, written);
        } catch (err) {
          release(err);
        }
      } else {
        fs.write(this.fd, this._writingBuf, release);
      }
    }
    function actualWriteBuffer() {
      const release = this.release;
      this._writing = true;
      this._writingBuf = this._writingBuf.length ? this._writingBuf : mergeBuf(this._bufs.shift(), this._lens.shift());
      if (this.sync) {
        try {
          const written = fs.writeSync(this.fd, this._writingBuf);
          release(null, written);
        } catch (err) {
          release(err);
        }
      } else {
        if (kCopyBuffer) {
          this._writingBuf = Buffer.from(this._writingBuf);
        }
        fs.write(this.fd, this._writingBuf, release);
      }
    }
    function actualClose(sonic) {
      if (sonic.fd === -1) {
        sonic.once("ready", actualClose.bind(null, sonic));
        return;
      }
      if (sonic._periodicFlushTimer !== void 0) {
        clearInterval(sonic._periodicFlushTimer);
      }
      sonic.destroyed = true;
      sonic._bufs = [];
      sonic._lens = [];
      assert(typeof sonic.fd === "number", `sonic.fd must be a number, got ${typeof sonic.fd}`);
      try {
        fs.fsync(sonic.fd, closeWrapped);
      } catch {
      }
      function closeWrapped() {
        if (sonic.fd !== 1 && sonic.fd !== 2) {
          fs.close(sonic.fd, done);
        } else {
          done();
        }
      }
      function done(err) {
        if (err) {
          sonic.emit("error", err);
          return;
        }
        if (sonic._ending && !sonic._writing) {
          sonic.emit("finish");
        }
        sonic.emit("close");
      }
    }
    SonicBoom.SonicBoom = SonicBoom;
    SonicBoom.default = SonicBoom;
    module.exports = SonicBoom;
  }
});

// ../../node_modules/.pnpm/on-exit-leak-free@2.1.2/node_modules/on-exit-leak-free/index.js
var require_on_exit_leak_free = __commonJS({
  "../../node_modules/.pnpm/on-exit-leak-free@2.1.2/node_modules/on-exit-leak-free/index.js"(exports, module) {
    "use strict";
    var refs = {
      exit: [],
      beforeExit: []
    };
    var functions = {
      exit: onExit,
      beforeExit: onBeforeExit
    };
    var registry;
    function ensureRegistry() {
      if (registry === void 0) {
        registry = new FinalizationRegistry(clear);
      }
    }
    function install(event) {
      if (refs[event].length > 0) {
        return;
      }
      process.on(event, functions[event]);
    }
    function uninstall(event) {
      if (refs[event].length > 0) {
        return;
      }
      process.removeListener(event, functions[event]);
      if (refs.exit.length === 0 && refs.beforeExit.length === 0) {
        registry = void 0;
      }
    }
    function onExit() {
      callRefs("exit");
    }
    function onBeforeExit() {
      callRefs("beforeExit");
    }
    function callRefs(event) {
      for (const ref of refs[event]) {
        const obj = ref.deref();
        const fn = ref.fn;
        if (obj !== void 0) {
          fn(obj, event);
        }
      }
      refs[event] = [];
    }
    function clear(ref) {
      for (const event of ["exit", "beforeExit"]) {
        const index81 = refs[event].indexOf(ref);
        refs[event].splice(index81, index81 + 1);
        uninstall(event);
      }
    }
    function _register(event, obj, fn) {
      if (obj === void 0) {
        throw new Error("the object can't be undefined");
      }
      install(event);
      const ref = new WeakRef(obj);
      ref.fn = fn;
      ensureRegistry();
      registry.register(obj, ref);
      refs[event].push(ref);
    }
    function register(obj, fn) {
      _register("exit", obj, fn);
    }
    function registerBeforeExit(obj, fn) {
      _register("beforeExit", obj, fn);
    }
    function unregister(obj) {
      if (registry === void 0) {
        return;
      }
      registry.unregister(obj);
      for (const event of ["exit", "beforeExit"]) {
        refs[event] = refs[event].filter((ref) => {
          const _obj = ref.deref();
          return _obj && _obj !== obj;
        });
        uninstall(event);
      }
    }
    module.exports = {
      register,
      registerBeforeExit,
      unregister
    };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/package.json
var require_package = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/package.json"(exports, module) {
    module.exports = {
      name: "thread-stream",
      version: "3.1.0",
      description: "A streaming way to send data to a Node.js Worker Thread",
      main: "index.js",
      types: "index.d.ts",
      dependencies: {
        "real-require": "^0.2.0"
      },
      devDependencies: {
        "@types/node": "^20.1.0",
        "@types/tap": "^15.0.0",
        "@yao-pkg/pkg": "^5.11.5",
        desm: "^1.3.0",
        fastbench: "^1.0.1",
        husky: "^9.0.6",
        "pino-elasticsearch": "^8.0.0",
        "sonic-boom": "^4.0.1",
        standard: "^17.0.0",
        tap: "^16.2.0",
        "ts-node": "^10.8.0",
        typescript: "^5.3.2",
        "why-is-node-running": "^2.2.2"
      },
      scripts: {
        build: "tsc --noEmit",
        test: 'standard && npm run build && npm run transpile && tap "test/**/*.test.*js" && tap --ts test/*.test.*ts',
        "test:ci": "standard && npm run transpile && npm run test:ci:js && npm run test:ci:ts",
        "test:ci:js": 'tap --no-check-coverage --timeout=120 --coverage-report=lcovonly "test/**/*.test.*js"',
        "test:ci:ts": 'tap --ts --no-check-coverage --coverage-report=lcovonly "test/**/*.test.*ts"',
        "test:yarn": 'npm run transpile && tap "test/**/*.test.js" --no-check-coverage',
        transpile: "sh ./test/ts/transpile.sh",
        prepare: "husky install"
      },
      standard: {
        ignore: [
          "test/ts/**/*",
          "test/syntax-error.mjs"
        ]
      },
      repository: {
        type: "git",
        url: "git+https://github.com/mcollina/thread-stream.git"
      },
      keywords: [
        "worker",
        "thread",
        "threads",
        "stream"
      ],
      author: "Matteo Collina <hello@matteocollina.com>",
      license: "MIT",
      bugs: {
        url: "https://github.com/mcollina/thread-stream/issues"
      },
      homepage: "https://github.com/mcollina/thread-stream#readme"
    };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/wait.js
var require_wait = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/wait.js"(exports, module) {
    "use strict";
    var MAX_TIMEOUT = 1e3;
    function wait(state, index81, expected, timeout, done) {
      const max = Date.now() + timeout;
      let current = Atomics.load(state, index81);
      if (current === expected) {
        done(null, "ok");
        return;
      }
      let prior = current;
      const check = (backoff) => {
        if (Date.now() > max) {
          done(null, "timed-out");
        } else {
          setTimeout(() => {
            prior = current;
            current = Atomics.load(state, index81);
            if (current === prior) {
              check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
            } else {
              if (current === expected) done(null, "ok");
              else done(null, "not-equal");
            }
          }, backoff);
        }
      };
      check(1);
    }
    function waitDiff(state, index81, expected, timeout, done) {
      const max = Date.now() + timeout;
      let current = Atomics.load(state, index81);
      if (current !== expected) {
        done(null, "ok");
        return;
      }
      const check = (backoff) => {
        if (Date.now() > max) {
          done(null, "timed-out");
        } else {
          setTimeout(() => {
            current = Atomics.load(state, index81);
            if (current !== expected) {
              done(null, "ok");
            } else {
              check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
            }
          }, backoff);
        }
      };
      check(1);
    }
    module.exports = { wait, waitDiff };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/indexes.js
var require_indexes = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/lib/indexes.js"(exports, module) {
    "use strict";
    var WRITE_INDEX = 4;
    var READ_INDEX = 8;
    module.exports = {
      WRITE_INDEX,
      READ_INDEX
    };
  }
});

// ../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/index.js
var require_thread_stream = __commonJS({
  "../../node_modules/.pnpm/thread-stream@3.1.0/node_modules/thread-stream/index.js"(exports, module) {
    "use strict";
    var { version } = require_package();
    var { EventEmitter: EventEmitter2 } = __require("events");
    var { Worker } = __require("worker_threads");
    var { join } = __require("path");
    var { pathToFileURL } = __require("url");
    var { wait } = require_wait();
    var {
      WRITE_INDEX,
      READ_INDEX
    } = require_indexes();
    var buffer = __require("buffer");
    var assert = __require("assert");
    var kImpl = /* @__PURE__ */ Symbol("kImpl");
    var MAX_STRING = buffer.constants.MAX_STRING_LENGTH;
    var FakeWeakRef = class {
      constructor(value) {
        this._value = value;
      }
      deref() {
        return this._value;
      }
    };
    var FakeFinalizationRegistry = class {
      register() {
      }
      unregister() {
      }
    };
    var FinalizationRegistry2 = process.env.NODE_V8_COVERAGE ? FakeFinalizationRegistry : global.FinalizationRegistry || FakeFinalizationRegistry;
    var WeakRef2 = process.env.NODE_V8_COVERAGE ? FakeWeakRef : global.WeakRef || FakeWeakRef;
    var registry = new FinalizationRegistry2((worker) => {
      if (worker.exited) {
        return;
      }
      worker.terminate();
    });
    function createWorker(stream, opts) {
      const { filename, workerData } = opts;
      const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
      const toExecute = bundlerOverrides["thread-stream-worker"] || join(__dirname, "lib", "worker.js");
      const worker = new Worker(toExecute, {
        ...opts.workerOpts,
        trackUnmanagedFds: false,
        workerData: {
          filename: filename.indexOf("file://") === 0 ? filename : pathToFileURL(filename).href,
          dataBuf: stream[kImpl].dataBuf,
          stateBuf: stream[kImpl].stateBuf,
          workerData: {
            $context: {
              threadStreamVersion: version
            },
            ...workerData
          }
        }
      });
      worker.stream = new FakeWeakRef(stream);
      worker.on("message", onWorkerMessage);
      worker.on("exit", onWorkerExit);
      registry.register(stream, worker);
      return worker;
    }
    function drain(stream) {
      assert(!stream[kImpl].sync);
      if (stream[kImpl].needDrain) {
        stream[kImpl].needDrain = false;
        stream.emit("drain");
      }
    }
    function nextFlush(stream) {
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let leftover = stream[kImpl].data.length - writeIndex;
      if (leftover > 0) {
        if (stream[kImpl].buf.length === 0) {
          stream[kImpl].flushing = false;
          if (stream[kImpl].ending) {
            end(stream);
          } else if (stream[kImpl].needDrain) {
            process.nextTick(drain, stream);
          }
          return;
        }
        let toWrite = stream[kImpl].buf.slice(0, leftover);
        let toWriteBytes = Buffer.byteLength(toWrite);
        if (toWriteBytes <= leftover) {
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, nextFlush.bind(null, stream));
        } else {
          stream.flush(() => {
            if (stream.destroyed) {
              return;
            }
            Atomics.store(stream[kImpl].state, READ_INDEX, 0);
            Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
            while (toWriteBytes > stream[kImpl].data.length) {
              leftover = leftover / 2;
              toWrite = stream[kImpl].buf.slice(0, leftover);
              toWriteBytes = Buffer.byteLength(toWrite);
            }
            stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
            write(stream, toWrite, nextFlush.bind(null, stream));
          });
        }
      } else if (leftover === 0) {
        if (writeIndex === 0 && stream[kImpl].buf.length === 0) {
          return;
        }
        stream.flush(() => {
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          nextFlush(stream);
        });
      } else {
        destroy(stream, new Error("overwritten"));
      }
    }
    function onWorkerMessage(msg) {
      const stream = this.stream.deref();
      if (stream === void 0) {
        this.exited = true;
        this.terminate();
        return;
      }
      switch (msg.code) {
        case "READY":
          this.stream = new WeakRef2(stream);
          stream.flush(() => {
            stream[kImpl].ready = true;
            stream.emit("ready");
          });
          break;
        case "ERROR":
          destroy(stream, msg.err);
          break;
        case "EVENT":
          if (Array.isArray(msg.args)) {
            stream.emit(msg.name, ...msg.args);
          } else {
            stream.emit(msg.name, msg.args);
          }
          break;
        case "WARNING":
          process.emitWarning(msg.err);
          break;
        default:
          destroy(stream, new Error("this should not happen: " + msg.code));
      }
    }
    function onWorkerExit(code) {
      const stream = this.stream.deref();
      if (stream === void 0) {
        return;
      }
      registry.unregister(stream);
      stream.worker.exited = true;
      stream.worker.off("exit", onWorkerExit);
      destroy(stream, code !== 0 ? new Error("the worker thread exited") : null);
    }
    var ThreadStream = class extends EventEmitter2 {
      constructor(opts = {}) {
        super();
        if (opts.bufferSize < 4) {
          throw new Error("bufferSize must at least fit a 4-byte utf-8 char");
        }
        this[kImpl] = {};
        this[kImpl].stateBuf = new SharedArrayBuffer(128);
        this[kImpl].state = new Int32Array(this[kImpl].stateBuf);
        this[kImpl].dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024);
        this[kImpl].data = Buffer.from(this[kImpl].dataBuf);
        this[kImpl].sync = opts.sync || false;
        this[kImpl].ending = false;
        this[kImpl].ended = false;
        this[kImpl].needDrain = false;
        this[kImpl].destroyed = false;
        this[kImpl].flushing = false;
        this[kImpl].ready = false;
        this[kImpl].finished = false;
        this[kImpl].errored = null;
        this[kImpl].closed = false;
        this[kImpl].buf = "";
        this.worker = createWorker(this, opts);
        this.on("message", (message, transferList) => {
          this.worker.postMessage(message, transferList);
        });
      }
      write(data) {
        if (this[kImpl].destroyed) {
          error(this, new Error("the worker has exited"));
          return false;
        }
        if (this[kImpl].ending) {
          error(this, new Error("the worker is ending"));
          return false;
        }
        if (this[kImpl].flushing && this[kImpl].buf.length + data.length >= MAX_STRING) {
          try {
            writeSync(this);
            this[kImpl].flushing = true;
          } catch (err) {
            destroy(this, err);
            return false;
          }
        }
        this[kImpl].buf += data;
        if (this[kImpl].sync) {
          try {
            writeSync(this);
            return true;
          } catch (err) {
            destroy(this, err);
            return false;
          }
        }
        if (!this[kImpl].flushing) {
          this[kImpl].flushing = true;
          setImmediate(nextFlush, this);
        }
        this[kImpl].needDrain = this[kImpl].data.length - this[kImpl].buf.length - Atomics.load(this[kImpl].state, WRITE_INDEX) <= 0;
        return !this[kImpl].needDrain;
      }
      end() {
        if (this[kImpl].destroyed) {
          return;
        }
        this[kImpl].ending = true;
        end(this);
      }
      flush(cb) {
        if (this[kImpl].destroyed) {
          if (typeof cb === "function") {
            process.nextTick(cb, new Error("the worker has exited"));
          }
          return;
        }
        const writeIndex = Atomics.load(this[kImpl].state, WRITE_INDEX);
        wait(this[kImpl].state, READ_INDEX, writeIndex, Infinity, (err, res) => {
          if (err) {
            destroy(this, err);
            process.nextTick(cb, err);
            return;
          }
          if (res === "not-equal") {
            this.flush(cb);
            return;
          }
          process.nextTick(cb);
        });
      }
      flushSync() {
        if (this[kImpl].destroyed) {
          return;
        }
        writeSync(this);
        flushSync(this);
      }
      unref() {
        this.worker.unref();
      }
      ref() {
        this.worker.ref();
      }
      get ready() {
        return this[kImpl].ready;
      }
      get destroyed() {
        return this[kImpl].destroyed;
      }
      get closed() {
        return this[kImpl].closed;
      }
      get writable() {
        return !this[kImpl].destroyed && !this[kImpl].ending;
      }
      get writableEnded() {
        return this[kImpl].ending;
      }
      get writableFinished() {
        return this[kImpl].finished;
      }
      get writableNeedDrain() {
        return this[kImpl].needDrain;
      }
      get writableObjectMode() {
        return false;
      }
      get writableErrored() {
        return this[kImpl].errored;
      }
    };
    function error(stream, err) {
      setImmediate(() => {
        stream.emit("error", err);
      });
    }
    function destroy(stream, err) {
      if (stream[kImpl].destroyed) {
        return;
      }
      stream[kImpl].destroyed = true;
      if (err) {
        stream[kImpl].errored = err;
        error(stream, err);
      }
      if (!stream.worker.exited) {
        stream.worker.terminate().catch(() => {
        }).then(() => {
          stream[kImpl].closed = true;
          stream.emit("close");
        });
      } else {
        setImmediate(() => {
          stream[kImpl].closed = true;
          stream.emit("close");
        });
      }
    }
    function write(stream, data, cb) {
      const current = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      const length = Buffer.byteLength(data);
      stream[kImpl].data.write(data, current);
      Atomics.store(stream[kImpl].state, WRITE_INDEX, current + length);
      Atomics.notify(stream[kImpl].state, WRITE_INDEX);
      cb();
      return true;
    }
    function end(stream) {
      if (stream[kImpl].ended || !stream[kImpl].ending || stream[kImpl].flushing) {
        return;
      }
      stream[kImpl].ended = true;
      try {
        stream.flushSync();
        let readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        Atomics.store(stream[kImpl].state, WRITE_INDEX, -1);
        Atomics.notify(stream[kImpl].state, WRITE_INDEX);
        let spins = 0;
        while (readIndex !== -1) {
          Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
          readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
          if (readIndex === -2) {
            destroy(stream, new Error("end() failed"));
            return;
          }
          if (++spins === 10) {
            destroy(stream, new Error("end() took too long (10s)"));
            return;
          }
        }
        process.nextTick(() => {
          stream[kImpl].finished = true;
          stream.emit("finish");
        });
      } catch (err) {
        destroy(stream, err);
      }
    }
    function writeSync(stream) {
      const cb = () => {
        if (stream[kImpl].ending) {
          end(stream);
        } else if (stream[kImpl].needDrain) {
          process.nextTick(drain, stream);
        }
      };
      stream[kImpl].flushing = false;
      while (stream[kImpl].buf.length !== 0) {
        const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
        let leftover = stream[kImpl].data.length - writeIndex;
        if (leftover === 0) {
          flushSync(stream);
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          continue;
        } else if (leftover < 0) {
          throw new Error("overwritten");
        }
        let toWrite = stream[kImpl].buf.slice(0, leftover);
        let toWriteBytes = Buffer.byteLength(toWrite);
        if (toWriteBytes <= leftover) {
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, cb);
        } else {
          flushSync(stream);
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          while (toWriteBytes > stream[kImpl].buf.length) {
            leftover = leftover / 2;
            toWrite = stream[kImpl].buf.slice(0, leftover);
            toWriteBytes = Buffer.byteLength(toWrite);
          }
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write(stream, toWrite, cb);
        }
      }
    }
    function flushSync(stream) {
      if (stream[kImpl].flushing) {
        throw new Error("unable to flush while flushing");
      }
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let spins = 0;
      while (true) {
        const readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        if (readIndex === -2) {
          throw Error("_flushSync failed");
        }
        if (readIndex !== writeIndex) {
          Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
        } else {
          break;
        }
        if (++spins === 10) {
          throw new Error("_flushSync took too long (10s)");
        }
      }
    }
    module.exports = ThreadStream;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/transport.js
var require_transport = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/transport.js"(exports, module) {
    "use strict";
    var { createRequire } = __require("module");
    var getCallers = require_caller();
    var { join, isAbsolute, sep } = __require("node:path");
    var sleep = require_atomic_sleep();
    var onExit = require_on_exit_leak_free();
    var ThreadStream = require_thread_stream();
    function setupOnExit(stream) {
      onExit.register(stream, autoEnd);
      onExit.registerBeforeExit(stream, flush);
      stream.on("close", function() {
        onExit.unregister(stream);
      });
    }
    function buildStream(filename, workerData, workerOpts, sync) {
      const stream = new ThreadStream({
        filename,
        workerData,
        workerOpts,
        sync
      });
      stream.on("ready", onReady);
      stream.on("close", function() {
        process.removeListener("exit", onExit2);
      });
      process.on("exit", onExit2);
      function onReady() {
        process.removeListener("exit", onExit2);
        stream.unref();
        if (workerOpts.autoEnd !== false) {
          setupOnExit(stream);
        }
      }
      function onExit2() {
        if (stream.closed) {
          return;
        }
        stream.flushSync();
        sleep(100);
        stream.end();
      }
      return stream;
    }
    function autoEnd(stream) {
      stream.ref();
      stream.flushSync();
      stream.end();
      stream.once("close", function() {
        stream.unref();
      });
    }
    function flush(stream) {
      stream.flushSync();
    }
    function transport(fullOptions) {
      const { pipeline, targets, levels, dedupe, worker = {}, caller = getCallers(), sync = false } = fullOptions;
      const options = {
        ...fullOptions.options
      };
      const callers = typeof caller === "string" ? [caller] : caller;
      const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
      let target = fullOptions.target;
      if (target && targets) {
        throw new Error("only one of target or targets can be specified");
      }
      if (targets) {
        target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
        options.targets = targets.filter((dest) => dest.target).map((dest) => {
          return {
            ...dest,
            target: fixTarget(dest.target)
          };
        });
        options.pipelines = targets.filter((dest) => dest.pipeline).map((dest) => {
          return dest.pipeline.map((t) => {
            return {
              ...t,
              level: dest.level,
              // duplicate the pipeline `level` property defined in the upper level
              target: fixTarget(t.target)
            };
          });
        });
      } else if (pipeline) {
        target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
        options.pipelines = [pipeline.map((dest) => {
          return {
            ...dest,
            target: fixTarget(dest.target)
          };
        })];
      }
      if (levels) {
        options.levels = levels;
      }
      if (dedupe) {
        options.dedupe = dedupe;
      }
      options.pinoWillSendConfig = true;
      return buildStream(fixTarget(target), options, worker, sync);
      function fixTarget(origin) {
        origin = bundlerOverrides[origin] || origin;
        if (isAbsolute(origin) || origin.indexOf("file://") === 0) {
          return origin;
        }
        if (origin === "pino/file") {
          return join(__dirname, "..", "file.js");
        }
        let fixTarget2;
        for (const filePath of callers) {
          try {
            const context = filePath === "node:repl" ? process.cwd() + sep : filePath;
            fixTarget2 = createRequire(context).resolve(origin);
            break;
          } catch (err) {
            continue;
          }
        }
        if (!fixTarget2) {
          throw new Error(`unable to determine transport target for "${origin}"`);
        }
        return fixTarget2;
      }
    }
    module.exports = transport;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/tools.js
var require_tools = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/tools.js"(exports, module) {
    "use strict";
    var diagChan = __require("node:diagnostics_channel");
    var format = require_quick_format_unescaped();
    var { mapHttpRequest, mapHttpResponse } = require_pino_std_serializers();
    var SonicBoom = require_sonic_boom();
    var onExit = require_on_exit_leak_free();
    var {
      lsCacheSym,
      chindingsSym,
      writeSym,
      serializersSym,
      formatOptsSym,
      endSym,
      stringifiersSym,
      stringifySym,
      stringifySafeSym,
      wildcardFirstSym,
      nestedKeySym,
      formattersSym,
      messageKeySym,
      errorKeySym,
      nestedKeyStrSym,
      msgPrefixSym
    } = require_symbols();
    var { isMainThread } = __require("worker_threads");
    var transport = require_transport();
    var asJsonChan;
    if (typeof diagChan.tracingChannel === "function") {
      asJsonChan = diagChan.tracingChannel("pino_asJson");
    } else {
      asJsonChan = {
        hasSubscribers: false,
        traceSync(fn, store, thisArg, ...args) {
          return fn.call(thisArg, ...args);
        }
      };
    }
    function noop() {
    }
    function genLog(level, hook) {
      if (!hook) return LOG;
      return function hookWrappedLog(...args) {
        hook.call(this, args, LOG, level);
      };
      function LOG(o, ...n) {
        if (typeof o === "object") {
          let msg = o;
          if (o !== null) {
            if (o.method && o.headers && o.socket) {
              o = mapHttpRequest(o);
            } else if (typeof o.setHeader === "function") {
              o = mapHttpResponse(o);
            }
          }
          let formatParams;
          if (msg === null && n.length === 0) {
            formatParams = [null];
          } else {
            msg = n.shift();
            formatParams = n;
          }
          if (typeof this[msgPrefixSym] === "string" && msg !== void 0 && msg !== null) {
            msg = this[msgPrefixSym] + msg;
          }
          this[writeSym](o, format(msg, formatParams, this[formatOptsSym]), level);
        } else {
          let msg = o === void 0 ? n.shift() : o;
          if (typeof this[msgPrefixSym] === "string" && msg !== void 0 && msg !== null) {
            msg = this[msgPrefixSym] + msg;
          }
          this[writeSym](null, format(msg, n, this[formatOptsSym]), level);
        }
      }
    }
    function asString(str) {
      let result = "";
      let last = 0;
      let found = false;
      let point = 255;
      const l = str.length;
      if (l > 100) {
        return JSON.stringify(str);
      }
      for (var i = 0; i < l && point >= 32; i++) {
        point = str.charCodeAt(i);
        if (point === 34 || point === 92) {
          result += str.slice(last, i) + "\\";
          last = i;
          found = true;
        }
      }
      if (!found) {
        result = str;
      } else {
        result += str.slice(last);
      }
      return point < 32 ? JSON.stringify(str) : '"' + result + '"';
    }
    function asJson(obj, msg, num, time) {
      if (asJsonChan.hasSubscribers === false) {
        return _asJson.call(this, obj, msg, num, time);
      }
      const store = { instance: this, arguments };
      return asJsonChan.traceSync(_asJson, store, this, obj, msg, num, time);
    }
    function _asJson(obj, msg, num, time) {
      const stringify2 = this[stringifySym];
      const stringifySafe = this[stringifySafeSym];
      const stringifiers = this[stringifiersSym];
      const end = this[endSym];
      const chindings = this[chindingsSym];
      const serializers = this[serializersSym];
      const formatters = this[formattersSym];
      const messageKey = this[messageKeySym];
      const errorKey = this[errorKeySym];
      let data = this[lsCacheSym][num] + time;
      data = data + chindings;
      let value;
      if (formatters.log) {
        obj = formatters.log(obj);
      }
      const wildcardStringifier = stringifiers[wildcardFirstSym];
      let propStr = "";
      for (const key in obj) {
        value = obj[key];
        if (Object.prototype.hasOwnProperty.call(obj, key) && value !== void 0) {
          if (serializers[key]) {
            value = serializers[key](value);
          } else if (key === errorKey && serializers.err) {
            value = serializers.err(value);
          }
          const stringifier = stringifiers[key] || wildcardStringifier;
          switch (typeof value) {
            case "undefined":
            case "function":
              continue;
            case "number":
              if (Number.isFinite(value) === false) {
                value = null;
              }
            // this case explicitly falls through to the next one
            case "boolean":
              if (stringifier) value = stringifier(value);
              break;
            case "string":
              value = (stringifier || asString)(value);
              break;
            default:
              value = (stringifier || stringify2)(value, stringifySafe);
          }
          if (value === void 0) continue;
          const strKey = asString(key);
          propStr += "," + strKey + ":" + value;
        }
      }
      let msgStr = "";
      if (msg !== void 0) {
        value = serializers[messageKey] ? serializers[messageKey](msg) : msg;
        const stringifier = stringifiers[messageKey] || wildcardStringifier;
        switch (typeof value) {
          case "function":
            break;
          case "number":
            if (Number.isFinite(value) === false) {
              value = null;
            }
          // this case explicitly falls through to the next one
          case "boolean":
            if (stringifier) value = stringifier(value);
            msgStr = ',"' + messageKey + '":' + value;
            break;
          case "string":
            value = (stringifier || asString)(value);
            msgStr = ',"' + messageKey + '":' + value;
            break;
          default:
            value = (stringifier || stringify2)(value, stringifySafe);
            msgStr = ',"' + messageKey + '":' + value;
        }
      }
      if (this[nestedKeySym] && propStr) {
        return data + this[nestedKeyStrSym] + propStr.slice(1) + "}" + msgStr + end;
      } else {
        return data + propStr + msgStr + end;
      }
    }
    function asChindings(instance, bindings) {
      let value;
      let data = instance[chindingsSym];
      const stringify2 = instance[stringifySym];
      const stringifySafe = instance[stringifySafeSym];
      const stringifiers = instance[stringifiersSym];
      const wildcardStringifier = stringifiers[wildcardFirstSym];
      const serializers = instance[serializersSym];
      const formatter = instance[formattersSym].bindings;
      bindings = formatter(bindings);
      for (const key in bindings) {
        value = bindings[key];
        const valid = (key.length < 5 || key !== "level" && key !== "serializers" && key !== "formatters" && key !== "customLevels") && bindings.hasOwnProperty(key) && value !== void 0;
        if (valid === true) {
          value = serializers[key] ? serializers[key](value) : value;
          value = (stringifiers[key] || wildcardStringifier || stringify2)(value, stringifySafe);
          if (value === void 0) continue;
          data += ',"' + key + '":' + value;
        }
      }
      return data;
    }
    function hasBeenTampered(stream) {
      return stream.write !== stream.constructor.prototype.write;
    }
    function buildSafeSonicBoom(opts) {
      const stream = new SonicBoom(opts);
      stream.on("error", filterBrokenPipe);
      if (!opts.sync && isMainThread) {
        onExit.register(stream, autoEnd);
        stream.on("close", function() {
          onExit.unregister(stream);
        });
      }
      return stream;
      function filterBrokenPipe(err) {
        if (err.code === "EPIPE") {
          stream.write = noop;
          stream.end = noop;
          stream.flushSync = noop;
          stream.destroy = noop;
          return;
        }
        stream.removeListener("error", filterBrokenPipe);
        stream.emit("error", err);
      }
    }
    function autoEnd(stream, eventName) {
      if (stream.destroyed) {
        return;
      }
      if (eventName === "beforeExit") {
        stream.flush();
        stream.on("drain", function() {
          stream.end();
        });
      } else {
        stream.flushSync();
      }
    }
    function createArgsNormalizer(defaultOptions) {
      return function normalizeArgs(instance, caller, opts = {}, stream) {
        if (typeof opts === "string") {
          stream = buildSafeSonicBoom({ dest: opts });
          opts = {};
        } else if (typeof stream === "string") {
          if (opts && opts.transport) {
            throw Error("only one of option.transport or stream can be specified");
          }
          stream = buildSafeSonicBoom({ dest: stream });
        } else if (opts instanceof SonicBoom || opts.writable || opts._writableState) {
          stream = opts;
          opts = {};
        } else if (opts.transport) {
          if (opts.transport instanceof SonicBoom || opts.transport.writable || opts.transport._writableState) {
            throw Error("option.transport do not allow stream, please pass to option directly. e.g. pino(transport)");
          }
          if (opts.transport.targets && opts.transport.targets.length && opts.formatters && typeof opts.formatters.level === "function") {
            throw Error("option.transport.targets do not allow custom level formatters");
          }
          let customLevels;
          if (opts.customLevels) {
            customLevels = opts.useOnlyCustomLevels ? opts.customLevels : Object.assign({}, opts.levels, opts.customLevels);
          }
          stream = transport({ caller, ...opts.transport, levels: customLevels });
        }
        opts = Object.assign({}, defaultOptions, opts);
        opts.serializers = Object.assign({}, defaultOptions.serializers, opts.serializers);
        opts.formatters = Object.assign({}, defaultOptions.formatters, opts.formatters);
        if (opts.prettyPrint) {
          throw new Error("prettyPrint option is no longer supported, see the pino-pretty package (https://github.com/pinojs/pino-pretty)");
        }
        const { enabled, onChild } = opts;
        if (enabled === false) opts.level = "silent";
        if (!onChild) opts.onChild = noop;
        if (!stream) {
          if (!hasBeenTampered(process.stdout)) {
            stream = buildSafeSonicBoom({ fd: process.stdout.fd || 1 });
          } else {
            stream = process.stdout;
          }
        }
        return { opts, stream };
      };
    }
    function stringify(obj, stringifySafeFn) {
      try {
        return JSON.stringify(obj);
      } catch (_) {
        try {
          const stringify2 = stringifySafeFn || this[stringifySafeSym];
          return stringify2(obj);
        } catch (_2) {
          return '"[unable to serialize, circular reference is too complex to analyze]"';
        }
      }
    }
    function buildFormatters(level, bindings, log) {
      return {
        level,
        bindings,
        log
      };
    }
    function normalizeDestFileDescriptor(destination) {
      const fd = Number(destination);
      if (typeof destination === "string" && Number.isFinite(fd)) {
        return fd;
      }
      if (destination === void 0) {
        return 1;
      }
      return destination;
    }
    module.exports = {
      noop,
      buildSafeSonicBoom,
      asChindings,
      asJson,
      genLog,
      createArgsNormalizer,
      stringify,
      buildFormatters,
      normalizeDestFileDescriptor
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/constants.js"(exports, module) {
    var DEFAULT_LEVELS = {
      trace: 10,
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      fatal: 60
    };
    var SORTING_ORDER = {
      ASC: "ASC",
      DESC: "DESC"
    };
    module.exports = {
      DEFAULT_LEVELS,
      SORTING_ORDER
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/levels.js
var require_levels = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/levels.js"(exports, module) {
    "use strict";
    var {
      lsCacheSym,
      levelValSym,
      useOnlyCustomLevelsSym,
      streamSym,
      formattersSym,
      hooksSym,
      levelCompSym
    } = require_symbols();
    var { noop, genLog } = require_tools();
    var { DEFAULT_LEVELS, SORTING_ORDER } = require_constants();
    var levelMethods = {
      fatal: (hook) => {
        const logFatal = genLog(DEFAULT_LEVELS.fatal, hook);
        return function(...args) {
          const stream = this[streamSym];
          logFatal.call(this, ...args);
          if (typeof stream.flushSync === "function") {
            try {
              stream.flushSync();
            } catch (e) {
            }
          }
        };
      },
      error: (hook) => genLog(DEFAULT_LEVELS.error, hook),
      warn: (hook) => genLog(DEFAULT_LEVELS.warn, hook),
      info: (hook) => genLog(DEFAULT_LEVELS.info, hook),
      debug: (hook) => genLog(DEFAULT_LEVELS.debug, hook),
      trace: (hook) => genLog(DEFAULT_LEVELS.trace, hook)
    };
    var nums = Object.keys(DEFAULT_LEVELS).reduce((o, k) => {
      o[DEFAULT_LEVELS[k]] = k;
      return o;
    }, {});
    var initialLsCache = Object.keys(nums).reduce((o, k) => {
      o[k] = '{"level":' + Number(k);
      return o;
    }, {});
    function genLsCache(instance) {
      const formatter = instance[formattersSym].level;
      const { labels } = instance.levels;
      const cache = {};
      for (const label in labels) {
        const level = formatter(labels[label], Number(label));
        cache[label] = JSON.stringify(level).slice(0, -1);
      }
      instance[lsCacheSym] = cache;
      return instance;
    }
    function isStandardLevel(level, useOnlyCustomLevels) {
      if (useOnlyCustomLevels) {
        return false;
      }
      switch (level) {
        case "fatal":
        case "error":
        case "warn":
        case "info":
        case "debug":
        case "trace":
          return true;
        default:
          return false;
      }
    }
    function setLevel(level) {
      const { labels, values } = this.levels;
      if (typeof level === "number") {
        if (labels[level] === void 0) throw Error("unknown level value" + level);
        level = labels[level];
      }
      if (values[level] === void 0) throw Error("unknown level " + level);
      const preLevelVal = this[levelValSym];
      const levelVal = this[levelValSym] = values[level];
      const useOnlyCustomLevelsVal = this[useOnlyCustomLevelsSym];
      const levelComparison = this[levelCompSym];
      const hook = this[hooksSym].logMethod;
      for (const key in values) {
        if (levelComparison(values[key], levelVal) === false) {
          this[key] = noop;
          continue;
        }
        this[key] = isStandardLevel(key, useOnlyCustomLevelsVal) ? levelMethods[key](hook) : genLog(values[key], hook);
      }
      this.emit(
        "level-change",
        level,
        levelVal,
        labels[preLevelVal],
        preLevelVal,
        this
      );
    }
    function getLevel(level) {
      const { levels, levelVal } = this;
      return levels && levels.labels ? levels.labels[levelVal] : "";
    }
    function isLevelEnabled(logLevel) {
      const { values } = this.levels;
      const logLevelVal = values[logLevel];
      return logLevelVal !== void 0 && this[levelCompSym](logLevelVal, this[levelValSym]);
    }
    function compareLevel(direction, current, expected) {
      if (direction === SORTING_ORDER.DESC) {
        return current <= expected;
      }
      return current >= expected;
    }
    function genLevelComparison(levelComparison) {
      if (typeof levelComparison === "string") {
        return compareLevel.bind(null, levelComparison);
      }
      return levelComparison;
    }
    function mappings(customLevels = null, useOnlyCustomLevels = false) {
      const customNums = customLevels ? Object.keys(customLevels).reduce((o, k) => {
        o[customLevels[k]] = k;
        return o;
      }, {}) : null;
      const labels = Object.assign(
        Object.create(Object.prototype, { Infinity: { value: "silent" } }),
        useOnlyCustomLevels ? null : nums,
        customNums
      );
      const values = Object.assign(
        Object.create(Object.prototype, { silent: { value: Infinity } }),
        useOnlyCustomLevels ? null : DEFAULT_LEVELS,
        customLevels
      );
      return { labels, values };
    }
    function assertDefaultLevelFound(defaultLevel, customLevels, useOnlyCustomLevels) {
      if (typeof defaultLevel === "number") {
        const values = [].concat(
          Object.keys(customLevels || {}).map((key) => customLevels[key]),
          useOnlyCustomLevels ? [] : Object.keys(nums).map((level) => +level),
          Infinity
        );
        if (!values.includes(defaultLevel)) {
          throw Error(`default level:${defaultLevel} must be included in custom levels`);
        }
        return;
      }
      const labels = Object.assign(
        Object.create(Object.prototype, { silent: { value: Infinity } }),
        useOnlyCustomLevels ? null : DEFAULT_LEVELS,
        customLevels
      );
      if (!(defaultLevel in labels)) {
        throw Error(`default level:${defaultLevel} must be included in custom levels`);
      }
    }
    function assertNoLevelCollisions(levels, customLevels) {
      const { labels, values } = levels;
      for (const k in customLevels) {
        if (k in values) {
          throw Error("levels cannot be overridden");
        }
        if (customLevels[k] in labels) {
          throw Error("pre-existing level values cannot be used for new levels");
        }
      }
    }
    function assertLevelComparison(levelComparison) {
      if (typeof levelComparison === "function") {
        return;
      }
      if (typeof levelComparison === "string" && Object.values(SORTING_ORDER).includes(levelComparison)) {
        return;
      }
      throw new Error('Levels comparison should be one of "ASC", "DESC" or "function" type');
    }
    module.exports = {
      initialLsCache,
      genLsCache,
      levelMethods,
      getLevel,
      setLevel,
      isLevelEnabled,
      mappings,
      assertNoLevelCollisions,
      assertDefaultLevelFound,
      genLevelComparison,
      assertLevelComparison
    };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/meta.js
var require_meta = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/meta.js"(exports, module) {
    "use strict";
    module.exports = { version: "9.14.0" };
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/proto.js
var require_proto = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/proto.js"(exports, module) {
    "use strict";
    var { EventEmitter: EventEmitter2 } = __require("node:events");
    var {
      lsCacheSym,
      levelValSym,
      setLevelSym,
      getLevelSym,
      chindingsSym,
      parsedChindingsSym,
      mixinSym,
      asJsonSym,
      writeSym,
      mixinMergeStrategySym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      serializersSym,
      formattersSym,
      errorKeySym,
      messageKeySym,
      useOnlyCustomLevelsSym,
      needsMetadataGsym,
      redactFmtSym,
      stringifySym,
      formatOptsSym,
      stringifiersSym,
      msgPrefixSym,
      hooksSym
    } = require_symbols();
    var {
      getLevel,
      setLevel,
      isLevelEnabled,
      mappings,
      initialLsCache,
      genLsCache,
      assertNoLevelCollisions
    } = require_levels();
    var {
      asChindings,
      asJson,
      buildFormatters,
      stringify,
      noop
    } = require_tools();
    var {
      version
    } = require_meta();
    var redaction = require_redaction();
    var constructor = class Pino {
    };
    var prototype = {
      constructor,
      child,
      bindings,
      setBindings,
      flush,
      isLevelEnabled,
      version,
      get level() {
        return this[getLevelSym]();
      },
      set level(lvl) {
        this[setLevelSym](lvl);
      },
      get levelVal() {
        return this[levelValSym];
      },
      set levelVal(n) {
        throw Error("levelVal is read-only");
      },
      get msgPrefix() {
        return this[msgPrefixSym];
      },
      get [Symbol.toStringTag]() {
        return "Pino";
      },
      [lsCacheSym]: initialLsCache,
      [writeSym]: write,
      [asJsonSym]: asJson,
      [getLevelSym]: getLevel,
      [setLevelSym]: setLevel
    };
    Object.setPrototypeOf(prototype, EventEmitter2.prototype);
    module.exports = function() {
      return Object.create(prototype);
    };
    var resetChildingsFormatter = (bindings2) => bindings2;
    function child(bindings2, options) {
      if (!bindings2) {
        throw Error("missing bindings for child Pino");
      }
      const serializers = this[serializersSym];
      const formatters = this[formattersSym];
      const instance = Object.create(this);
      if (options == null) {
        if (instance[formattersSym].bindings !== resetChildingsFormatter) {
          instance[formattersSym] = buildFormatters(
            formatters.level,
            resetChildingsFormatter,
            formatters.log
          );
        }
        instance[chindingsSym] = asChindings(instance, bindings2);
        instance[setLevelSym](this.level);
        if (this.onChild !== noop) {
          this.onChild(instance);
        }
        return instance;
      }
      if (options.hasOwnProperty("serializers") === true) {
        instance[serializersSym] = /* @__PURE__ */ Object.create(null);
        for (const k in serializers) {
          instance[serializersSym][k] = serializers[k];
        }
        const parentSymbols = Object.getOwnPropertySymbols(serializers);
        for (var i = 0; i < parentSymbols.length; i++) {
          const ks = parentSymbols[i];
          instance[serializersSym][ks] = serializers[ks];
        }
        for (const bk in options.serializers) {
          instance[serializersSym][bk] = options.serializers[bk];
        }
        const bindingsSymbols = Object.getOwnPropertySymbols(options.serializers);
        for (var bi = 0; bi < bindingsSymbols.length; bi++) {
          const bks = bindingsSymbols[bi];
          instance[serializersSym][bks] = options.serializers[bks];
        }
      } else instance[serializersSym] = serializers;
      if (options.hasOwnProperty("formatters")) {
        const { level, bindings: chindings, log } = options.formatters;
        instance[formattersSym] = buildFormatters(
          level || formatters.level,
          chindings || resetChildingsFormatter,
          log || formatters.log
        );
      } else {
        instance[formattersSym] = buildFormatters(
          formatters.level,
          resetChildingsFormatter,
          formatters.log
        );
      }
      if (options.hasOwnProperty("customLevels") === true) {
        assertNoLevelCollisions(this.levels, options.customLevels);
        instance.levels = mappings(options.customLevels, instance[useOnlyCustomLevelsSym]);
        genLsCache(instance);
      }
      if (typeof options.redact === "object" && options.redact !== null || Array.isArray(options.redact)) {
        instance.redact = options.redact;
        const stringifiers = redaction(instance.redact, stringify);
        const formatOpts = { stringify: stringifiers[redactFmtSym] };
        instance[stringifySym] = stringify;
        instance[stringifiersSym] = stringifiers;
        instance[formatOptsSym] = formatOpts;
      }
      if (typeof options.msgPrefix === "string") {
        instance[msgPrefixSym] = (this[msgPrefixSym] || "") + options.msgPrefix;
      }
      instance[chindingsSym] = asChindings(instance, bindings2);
      const childLevel = options.level || this.level;
      instance[setLevelSym](childLevel);
      this.onChild(instance);
      return instance;
    }
    function bindings() {
      const chindings = this[chindingsSym];
      const chindingsJson = `{${chindings.substr(1)}}`;
      const bindingsFromJson = JSON.parse(chindingsJson);
      delete bindingsFromJson.pid;
      delete bindingsFromJson.hostname;
      return bindingsFromJson;
    }
    function setBindings(newBindings) {
      const chindings = asChindings(this, newBindings);
      this[chindingsSym] = chindings;
      delete this[parsedChindingsSym];
    }
    function defaultMixinMergeStrategy(mergeObject, mixinObject) {
      return Object.assign(mixinObject, mergeObject);
    }
    function write(_obj, msg, num) {
      const t = this[timeSym]();
      const mixin = this[mixinSym];
      const errorKey = this[errorKeySym];
      const messageKey = this[messageKeySym];
      const mixinMergeStrategy = this[mixinMergeStrategySym] || defaultMixinMergeStrategy;
      let obj;
      const streamWriteHook = this[hooksSym].streamWrite;
      if (_obj === void 0 || _obj === null) {
        obj = {};
      } else if (_obj instanceof Error) {
        obj = { [errorKey]: _obj };
        if (msg === void 0) {
          msg = _obj.message;
        }
      } else {
        obj = _obj;
        if (msg === void 0 && _obj[messageKey] === void 0 && _obj[errorKey]) {
          msg = _obj[errorKey].message;
        }
      }
      if (mixin) {
        obj = mixinMergeStrategy(obj, mixin(obj, num, this));
      }
      const s = this[asJsonSym](obj, msg, num, t);
      const stream = this[streamSym];
      if (stream[needsMetadataGsym] === true) {
        stream.lastLevel = num;
        stream.lastObj = obj;
        stream.lastMsg = msg;
        stream.lastTime = t.slice(this[timeSliceIndexSym]);
        stream.lastLogger = this;
      }
      stream.write(streamWriteHook ? streamWriteHook(s) : s);
    }
    function flush(cb) {
      if (cb != null && typeof cb !== "function") {
        throw Error("callback must be a function");
      }
      const stream = this[streamSym];
      if (typeof stream.flush === "function") {
        stream.flush(cb || noop);
      } else if (cb) cb();
    }
  }
});

// ../../node_modules/.pnpm/safe-stable-stringify@2.5.0/node_modules/safe-stable-stringify/index.js
var require_safe_stable_stringify = __commonJS({
  "../../node_modules/.pnpm/safe-stable-stringify@2.5.0/node_modules/safe-stable-stringify/index.js"(exports, module) {
    "use strict";
    var { hasOwnProperty } = Object.prototype;
    var stringify = configure();
    stringify.configure = configure;
    stringify.stringify = stringify;
    stringify.default = stringify;
    exports.stringify = stringify;
    exports.configure = configure;
    module.exports = stringify;
    var strEscapeSequencesRegExp = /[\u0000-\u001f\u0022\u005c\ud800-\udfff]/;
    function strEscape(str) {
      if (str.length < 5e3 && !strEscapeSequencesRegExp.test(str)) {
        return `"${str}"`;
      }
      return JSON.stringify(str);
    }
    function sort(array, comparator) {
      if (array.length > 200 || comparator) {
        return array.sort(comparator);
      }
      for (let i = 1; i < array.length; i++) {
        const currentValue = array[i];
        let position = i;
        while (position !== 0 && array[position - 1] > currentValue) {
          array[position] = array[position - 1];
          position--;
        }
        array[position] = currentValue;
      }
      return array;
    }
    var typedArrayPrototypeGetSymbolToStringTag = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(
        Object.getPrototypeOf(
          new Int8Array()
        )
      ),
      Symbol.toStringTag
    ).get;
    function isTypedArrayWithEntries(value) {
      return typedArrayPrototypeGetSymbolToStringTag.call(value) !== void 0 && value.length !== 0;
    }
    function stringifyTypedArray(array, separator, maximumBreadth) {
      if (array.length < maximumBreadth) {
        maximumBreadth = array.length;
      }
      const whitespace = separator === "," ? "" : " ";
      let res = `"0":${whitespace}${array[0]}`;
      for (let i = 1; i < maximumBreadth; i++) {
        res += `${separator}"${i}":${whitespace}${array[i]}`;
      }
      return res;
    }
    function getCircularValueOption(options) {
      if (hasOwnProperty.call(options, "circularValue")) {
        const circularValue = options.circularValue;
        if (typeof circularValue === "string") {
          return `"${circularValue}"`;
        }
        if (circularValue == null) {
          return circularValue;
        }
        if (circularValue === Error || circularValue === TypeError) {
          return {
            toString() {
              throw new TypeError("Converting circular structure to JSON");
            }
          };
        }
        throw new TypeError('The "circularValue" argument must be of type string or the value null or undefined');
      }
      return '"[Circular]"';
    }
    function getDeterministicOption(options) {
      let value;
      if (hasOwnProperty.call(options, "deterministic")) {
        value = options.deterministic;
        if (typeof value !== "boolean" && typeof value !== "function") {
          throw new TypeError('The "deterministic" argument must be of type boolean or comparator function');
        }
      }
      return value === void 0 ? true : value;
    }
    function getBooleanOption(options, key) {
      let value;
      if (hasOwnProperty.call(options, key)) {
        value = options[key];
        if (typeof value !== "boolean") {
          throw new TypeError(`The "${key}" argument must be of type boolean`);
        }
      }
      return value === void 0 ? true : value;
    }
    function getPositiveIntegerOption(options, key) {
      let value;
      if (hasOwnProperty.call(options, key)) {
        value = options[key];
        if (typeof value !== "number") {
          throw new TypeError(`The "${key}" argument must be of type number`);
        }
        if (!Number.isInteger(value)) {
          throw new TypeError(`The "${key}" argument must be an integer`);
        }
        if (value < 1) {
          throw new RangeError(`The "${key}" argument must be >= 1`);
        }
      }
      return value === void 0 ? Infinity : value;
    }
    function getItemCount(number) {
      if (number === 1) {
        return "1 item";
      }
      return `${number} items`;
    }
    function getUniqueReplacerSet(replacerArray) {
      const replacerSet = /* @__PURE__ */ new Set();
      for (const value of replacerArray) {
        if (typeof value === "string" || typeof value === "number") {
          replacerSet.add(String(value));
        }
      }
      return replacerSet;
    }
    function getStrictOption(options) {
      if (hasOwnProperty.call(options, "strict")) {
        const value = options.strict;
        if (typeof value !== "boolean") {
          throw new TypeError('The "strict" argument must be of type boolean');
        }
        if (value) {
          return (value2) => {
            let message = `Object can not safely be stringified. Received type ${typeof value2}`;
            if (typeof value2 !== "function") message += ` (${value2.toString()})`;
            throw new Error(message);
          };
        }
      }
    }
    function configure(options) {
      options = { ...options };
      const fail = getStrictOption(options);
      if (fail) {
        if (options.bigint === void 0) {
          options.bigint = false;
        }
        if (!("circularValue" in options)) {
          options.circularValue = Error;
        }
      }
      const circularValue = getCircularValueOption(options);
      const bigint2 = getBooleanOption(options, "bigint");
      const deterministic = getDeterministicOption(options);
      const comparator = typeof deterministic === "function" ? deterministic : void 0;
      const maximumDepth = getPositiveIntegerOption(options, "maximumDepth");
      const maximumBreadth = getPositiveIntegerOption(options, "maximumBreadth");
      function stringifyFnReplacer(key, parent, stack, replacer, spacer, indentation) {
        let value = parent[key];
        if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
          value = value.toJSON(key);
        }
        value = replacer.call(parent, key, value);
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            let res = "";
            let join = ",";
            const originalIndentation = indentation;
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              if (spacer !== "") {
                indentation += spacer;
                res += `
${indentation}`;
                join = `,
${indentation}`;
              }
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += join;
              }
              const tmp = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              if (spacer !== "") {
                res += `
${originalIndentation}`;
              }
              stack.pop();
              return `[${res}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            let whitespace = "";
            let separator = "";
            if (spacer !== "") {
              indentation += spacer;
              join = `,
${indentation}`;
              whitespace = " ";
            }
            const maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (deterministic && !isTypedArrayWithEntries(value)) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifyFnReplacer(key2, value, stack, replacer, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
                separator = join;
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...":${whitespace}"${getItemCount(removedKeys)} not stringified"`;
              separator = join;
            }
            if (spacer !== "" && separator.length > 1) {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint2) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifyArrayReplacer(key, value, stack, replacer, spacer, indentation) {
        if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
          value = value.toJSON(key);
        }
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            const originalIndentation = indentation;
            let res = "";
            let join = ",";
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              if (spacer !== "") {
                indentation += spacer;
                res += `
${indentation}`;
                join = `,
${indentation}`;
              }
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += join;
              }
              const tmp = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              if (spacer !== "") {
                res += `
${originalIndentation}`;
              }
              stack.pop();
              return `[${res}]`;
            }
            stack.push(value);
            let whitespace = "";
            if (spacer !== "") {
              indentation += spacer;
              join = `,
${indentation}`;
              whitespace = " ";
            }
            let separator = "";
            for (const key2 of replacer) {
              const tmp = stringifyArrayReplacer(key2, value[key2], stack, replacer, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
                separator = join;
              }
            }
            if (spacer !== "" && separator.length > 1) {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint2) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifyIndent(key, value, stack, spacer, indentation) {
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (typeof value.toJSON === "function") {
              value = value.toJSON(key);
              if (typeof value !== "object") {
                return stringifyIndent(key, value, stack, spacer, indentation);
              }
              if (value === null) {
                return "null";
              }
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            const originalIndentation = indentation;
            if (Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              indentation += spacer;
              let res2 = `
${indentation}`;
              const join2 = `,
${indentation}`;
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifyIndent(String(i), value[i], stack, spacer, indentation);
                res2 += tmp2 !== void 0 ? tmp2 : "null";
                res2 += join2;
              }
              const tmp = stringifyIndent(String(i), value[i], stack, spacer, indentation);
              res2 += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res2 += `${join2}"... ${getItemCount(removedKeys)} not stringified"`;
              }
              res2 += `
${originalIndentation}`;
              stack.pop();
              return `[${res2}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            indentation += spacer;
            const join = `,
${indentation}`;
            let res = "";
            let separator = "";
            let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (isTypedArrayWithEntries(value)) {
              res += stringifyTypedArray(value, join, maximumBreadth);
              keys = keys.slice(value.length);
              maximumPropertiesToStringify -= value.length;
              separator = join;
            }
            if (deterministic) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifyIndent(key2, value[key2], stack, spacer, indentation);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}: ${tmp}`;
                separator = join;
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...": "${getItemCount(removedKeys)} not stringified"`;
              separator = join;
            }
            if (separator !== "") {
              res = `
${indentation}${res}
${originalIndentation}`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint2) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringifySimple(key, value, stack) {
        switch (typeof value) {
          case "string":
            return strEscape(value);
          case "object": {
            if (value === null) {
              return "null";
            }
            if (typeof value.toJSON === "function") {
              value = value.toJSON(key);
              if (typeof value !== "object") {
                return stringifySimple(key, value, stack);
              }
              if (value === null) {
                return "null";
              }
            }
            if (stack.indexOf(value) !== -1) {
              return circularValue;
            }
            let res = "";
            const hasLength = value.length !== void 0;
            if (hasLength && Array.isArray(value)) {
              if (value.length === 0) {
                return "[]";
              }
              if (maximumDepth < stack.length + 1) {
                return '"[Array]"';
              }
              stack.push(value);
              const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
              let i = 0;
              for (; i < maximumValuesToStringify - 1; i++) {
                const tmp2 = stringifySimple(String(i), value[i], stack);
                res += tmp2 !== void 0 ? tmp2 : "null";
                res += ",";
              }
              const tmp = stringifySimple(String(i), value[i], stack);
              res += tmp !== void 0 ? tmp : "null";
              if (value.length - 1 > maximumBreadth) {
                const removedKeys = value.length - maximumBreadth - 1;
                res += `,"... ${getItemCount(removedKeys)} not stringified"`;
              }
              stack.pop();
              return `[${res}]`;
            }
            let keys = Object.keys(value);
            const keyLength = keys.length;
            if (keyLength === 0) {
              return "{}";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Object]"';
            }
            let separator = "";
            let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
            if (hasLength && isTypedArrayWithEntries(value)) {
              res += stringifyTypedArray(value, ",", maximumBreadth);
              keys = keys.slice(value.length);
              maximumPropertiesToStringify -= value.length;
              separator = ",";
            }
            if (deterministic) {
              keys = sort(keys, comparator);
            }
            stack.push(value);
            for (let i = 0; i < maximumPropertiesToStringify; i++) {
              const key2 = keys[i];
              const tmp = stringifySimple(key2, value[key2], stack);
              if (tmp !== void 0) {
                res += `${separator}${strEscape(key2)}:${tmp}`;
                separator = ",";
              }
            }
            if (keyLength > maximumBreadth) {
              const removedKeys = keyLength - maximumBreadth;
              res += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`;
            }
            stack.pop();
            return `{${res}}`;
          }
          case "number":
            return isFinite(value) ? String(value) : fail ? fail(value) : "null";
          case "boolean":
            return value === true ? "true" : "false";
          case "undefined":
            return void 0;
          case "bigint":
            if (bigint2) {
              return String(value);
            }
          // fallthrough
          default:
            return fail ? fail(value) : void 0;
        }
      }
      function stringify2(value, replacer, space) {
        if (arguments.length > 1) {
          let spacer = "";
          if (typeof space === "number") {
            spacer = " ".repeat(Math.min(space, 10));
          } else if (typeof space === "string") {
            spacer = space.slice(0, 10);
          }
          if (replacer != null) {
            if (typeof replacer === "function") {
              return stringifyFnReplacer("", { "": value }, [], replacer, spacer, "");
            }
            if (Array.isArray(replacer)) {
              return stringifyArrayReplacer("", value, [], getUniqueReplacerSet(replacer), spacer, "");
            }
          }
          if (spacer.length !== 0) {
            return stringifyIndent("", value, [], spacer, "");
          }
        }
        return stringifySimple("", value, []);
      }
      return stringify2;
    }
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/multistream.js
var require_multistream = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/lib/multistream.js"(exports, module) {
    "use strict";
    var metadata = /* @__PURE__ */ Symbol.for("pino.metadata");
    var { DEFAULT_LEVELS } = require_constants();
    var DEFAULT_INFO_LEVEL = DEFAULT_LEVELS.info;
    function multistream(streamsArray, opts) {
      streamsArray = streamsArray || [];
      opts = opts || { dedupe: false };
      const streamLevels = Object.create(DEFAULT_LEVELS);
      streamLevels.silent = Infinity;
      if (opts.levels && typeof opts.levels === "object") {
        Object.keys(opts.levels).forEach((i) => {
          streamLevels[i] = opts.levels[i];
        });
      }
      const res = {
        write,
        add,
        remove,
        emit,
        flushSync,
        end,
        minLevel: 0,
        lastId: 0,
        streams: [],
        clone,
        [metadata]: true,
        streamLevels
      };
      if (Array.isArray(streamsArray)) {
        streamsArray.forEach(add, res);
      } else {
        add.call(res, streamsArray);
      }
      streamsArray = null;
      return res;
      function write(data) {
        let dest;
        const level = this.lastLevel;
        const { streams } = this;
        let recordedLevel = 0;
        let stream;
        for (let i = initLoopVar(streams.length, opts.dedupe); checkLoopVar(i, streams.length, opts.dedupe); i = adjustLoopVar(i, opts.dedupe)) {
          dest = streams[i];
          if (dest.level <= level) {
            if (recordedLevel !== 0 && recordedLevel !== dest.level) {
              break;
            }
            stream = dest.stream;
            if (stream[metadata]) {
              const { lastTime, lastMsg, lastObj, lastLogger } = this;
              stream.lastLevel = level;
              stream.lastTime = lastTime;
              stream.lastMsg = lastMsg;
              stream.lastObj = lastObj;
              stream.lastLogger = lastLogger;
            }
            stream.write(data);
            if (opts.dedupe) {
              recordedLevel = dest.level;
            }
          } else if (!opts.dedupe) {
            break;
          }
        }
      }
      function emit(...args) {
        for (const { stream } of this.streams) {
          if (typeof stream.emit === "function") {
            stream.emit(...args);
          }
        }
      }
      function flushSync() {
        for (const { stream } of this.streams) {
          if (typeof stream.flushSync === "function") {
            stream.flushSync();
          }
        }
      }
      function add(dest) {
        if (!dest) {
          return res;
        }
        const isStream = typeof dest.write === "function" || dest.stream;
        const stream_ = dest.write ? dest : dest.stream;
        if (!isStream) {
          throw Error("stream object needs to implement either StreamEntry or DestinationStream interface");
        }
        const { streams, streamLevels: streamLevels2 } = this;
        let level;
        if (typeof dest.levelVal === "number") {
          level = dest.levelVal;
        } else if (typeof dest.level === "string") {
          level = streamLevels2[dest.level];
        } else if (typeof dest.level === "number") {
          level = dest.level;
        } else {
          level = DEFAULT_INFO_LEVEL;
        }
        const dest_ = {
          stream: stream_,
          level,
          levelVal: void 0,
          id: ++res.lastId
        };
        streams.unshift(dest_);
        streams.sort(compareByLevel);
        this.minLevel = streams[0].level;
        return res;
      }
      function remove(id) {
        const { streams } = this;
        const index81 = streams.findIndex((s) => s.id === id);
        if (index81 >= 0) {
          streams.splice(index81, 1);
          streams.sort(compareByLevel);
          this.minLevel = streams.length > 0 ? streams[0].level : -1;
        }
        return res;
      }
      function end() {
        for (const { stream } of this.streams) {
          if (typeof stream.flushSync === "function") {
            stream.flushSync();
          }
          stream.end();
        }
      }
      function clone(level) {
        const streams = new Array(this.streams.length);
        for (let i = 0; i < streams.length; i++) {
          streams[i] = {
            level,
            stream: this.streams[i].stream
          };
        }
        return {
          write,
          add,
          remove,
          minLevel: level,
          streams,
          clone,
          emit,
          flushSync,
          [metadata]: true
        };
      }
    }
    function compareByLevel(a, b) {
      return a.level - b.level;
    }
    function initLoopVar(length, dedupe) {
      return dedupe ? length - 1 : 0;
    }
    function adjustLoopVar(i, dedupe) {
      return dedupe ? i - 1 : i + 1;
    }
    function checkLoopVar(i, length, dedupe) {
      return dedupe ? i >= 0 : i < length;
    }
    module.exports = multistream;
  }
});

// ../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/pino.js
var require_pino = __commonJS({
  "../../node_modules/.pnpm/pino@9.14.0/node_modules/pino/pino.js"(exports, module) {
    "use strict";
    var os = __require("node:os");
    var stdSerializers = require_pino_std_serializers();
    var caller = require_caller();
    var redaction = require_redaction();
    var time = require_time();
    var proto = require_proto();
    var symbols = require_symbols();
    var { configure } = require_safe_stable_stringify();
    var { assertDefaultLevelFound, mappings, genLsCache, genLevelComparison, assertLevelComparison } = require_levels();
    var { DEFAULT_LEVELS, SORTING_ORDER } = require_constants();
    var {
      createArgsNormalizer,
      asChindings,
      buildSafeSonicBoom,
      buildFormatters,
      stringify,
      normalizeDestFileDescriptor,
      noop
    } = require_tools();
    var { version } = require_meta();
    var {
      chindingsSym,
      redactFmtSym,
      serializersSym,
      timeSym,
      timeSliceIndexSym,
      streamSym,
      stringifySym,
      stringifySafeSym,
      stringifiersSym,
      setLevelSym,
      endSym,
      formatOptsSym,
      messageKeySym,
      errorKeySym,
      nestedKeySym,
      mixinSym,
      levelCompSym,
      useOnlyCustomLevelsSym,
      formattersSym,
      hooksSym,
      nestedKeyStrSym,
      mixinMergeStrategySym,
      msgPrefixSym
    } = symbols;
    var { epochTime, nullTime } = time;
    var { pid } = process;
    var hostname = os.hostname();
    var defaultErrorSerializer = stdSerializers.err;
    var defaultOptions = {
      level: "info",
      levelComparison: SORTING_ORDER.ASC,
      levels: DEFAULT_LEVELS,
      messageKey: "msg",
      errorKey: "err",
      nestedKey: null,
      enabled: true,
      base: { pid, hostname },
      serializers: Object.assign(/* @__PURE__ */ Object.create(null), {
        err: defaultErrorSerializer
      }),
      formatters: Object.assign(/* @__PURE__ */ Object.create(null), {
        bindings(bindings) {
          return bindings;
        },
        level(label, number) {
          return { level: number };
        }
      }),
      hooks: {
        logMethod: void 0,
        streamWrite: void 0
      },
      timestamp: epochTime,
      name: void 0,
      redact: null,
      customLevels: null,
      useOnlyCustomLevels: false,
      depthLimit: 5,
      edgeLimit: 100
    };
    var normalize = createArgsNormalizer(defaultOptions);
    var serializers = Object.assign(/* @__PURE__ */ Object.create(null), stdSerializers);
    function pino2(...args) {
      const instance = {};
      const { opts, stream } = normalize(instance, caller(), ...args);
      if (opts.level && typeof opts.level === "string" && DEFAULT_LEVELS[opts.level.toLowerCase()] !== void 0) opts.level = opts.level.toLowerCase();
      const {
        redact,
        crlf,
        serializers: serializers2,
        timestamp: timestamp137,
        messageKey,
        errorKey,
        nestedKey,
        base,
        name,
        level,
        customLevels,
        levelComparison,
        mixin,
        mixinMergeStrategy,
        useOnlyCustomLevels,
        formatters,
        hooks,
        depthLimit,
        edgeLimit,
        onChild,
        msgPrefix
      } = opts;
      const stringifySafe = configure({
        maximumDepth: depthLimit,
        maximumBreadth: edgeLimit
      });
      const allFormatters = buildFormatters(
        formatters.level,
        formatters.bindings,
        formatters.log
      );
      const stringifyFn = stringify.bind({
        [stringifySafeSym]: stringifySafe
      });
      const stringifiers = redact ? redaction(redact, stringifyFn) : {};
      const formatOpts = redact ? { stringify: stringifiers[redactFmtSym] } : { stringify: stringifyFn };
      const end = "}" + (crlf ? "\r\n" : "\n");
      const coreChindings = asChindings.bind(null, {
        [chindingsSym]: "",
        [serializersSym]: serializers2,
        [stringifiersSym]: stringifiers,
        [stringifySym]: stringify,
        [stringifySafeSym]: stringifySafe,
        [formattersSym]: allFormatters
      });
      let chindings = "";
      if (base !== null) {
        if (name === void 0) {
          chindings = coreChindings(base);
        } else {
          chindings = coreChindings(Object.assign({}, base, { name }));
        }
      }
      const time2 = timestamp137 instanceof Function ? timestamp137 : timestamp137 ? epochTime : nullTime;
      const timeSliceIndex = time2().indexOf(":") + 1;
      if (useOnlyCustomLevels && !customLevels) throw Error("customLevels is required if useOnlyCustomLevels is set true");
      if (mixin && typeof mixin !== "function") throw Error(`Unknown mixin type "${typeof mixin}" - expected "function"`);
      if (msgPrefix && typeof msgPrefix !== "string") throw Error(`Unknown msgPrefix type "${typeof msgPrefix}" - expected "string"`);
      assertDefaultLevelFound(level, customLevels, useOnlyCustomLevels);
      const levels = mappings(customLevels, useOnlyCustomLevels);
      if (typeof stream.emit === "function") {
        stream.emit("message", { code: "PINO_CONFIG", config: { levels, messageKey, errorKey } });
      }
      assertLevelComparison(levelComparison);
      const levelCompFunc = genLevelComparison(levelComparison);
      Object.assign(instance, {
        levels,
        [levelCompSym]: levelCompFunc,
        [useOnlyCustomLevelsSym]: useOnlyCustomLevels,
        [streamSym]: stream,
        [timeSym]: time2,
        [timeSliceIndexSym]: timeSliceIndex,
        [stringifySym]: stringify,
        [stringifySafeSym]: stringifySafe,
        [stringifiersSym]: stringifiers,
        [endSym]: end,
        [formatOptsSym]: formatOpts,
        [messageKeySym]: messageKey,
        [errorKeySym]: errorKey,
        [nestedKeySym]: nestedKey,
        // protect against injection
        [nestedKeyStrSym]: nestedKey ? `,${JSON.stringify(nestedKey)}:{` : "",
        [serializersSym]: serializers2,
        [mixinSym]: mixin,
        [mixinMergeStrategySym]: mixinMergeStrategy,
        [chindingsSym]: chindings,
        [formattersSym]: allFormatters,
        [hooksSym]: hooks,
        silent: noop,
        onChild,
        [msgPrefixSym]: msgPrefix
      });
      Object.setPrototypeOf(instance, proto());
      genLsCache(instance);
      instance[setLevelSym](level);
      return instance;
    }
    module.exports = pino2;
    module.exports.destination = (dest = process.stdout.fd) => {
      if (typeof dest === "object") {
        dest.dest = normalizeDestFileDescriptor(dest.dest || process.stdout.fd);
        return buildSafeSonicBoom(dest);
      } else {
        return buildSafeSonicBoom({ dest: normalizeDestFileDescriptor(dest), minLength: 0 });
      }
    };
    module.exports.transport = require_transport();
    module.exports.multistream = require_multistream();
    module.exports.levels = mappings();
    module.exports.stdSerializers = serializers;
    module.exports.stdTimeFunctions = Object.assign({}, time);
    module.exports.symbols = symbols;
    module.exports.version = version;
    module.exports.default = pino2;
    module.exports.pino = pino2;
  }
});

// src/lib/isTestEnvironment.ts
function isTestEnvironment2() {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true" || process.env.VITEST_WORKER_ID !== void 0 || process.env.VITEST_POOL_ID !== void 0;
}
var init_isTestEnvironment = __esm({
  "src/lib/isTestEnvironment.ts"() {
    "use strict";
  }
});

// src/lib/logger.ts
var import_pino, isProduction, logger;
var init_logger = __esm({
  "src/lib/logger.ts"() {
    "use strict";
    import_pino = __toESM(require_pino(), 1);
    init_isTestEnvironment();
    isProduction = process.env.NODE_ENV === "production";
    logger = (0, import_pino.default)(
      isTestEnvironment2() ? { level: "silent" } : {
        level: process.env.LOG_LEVEL ?? "info",
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']"
        ],
        ...isProduction || isTestEnvironment2() ? {} : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true }
          }
        }
      }
    );
  }
});

// src/lib/workerHeartbeat.ts
function registerHeartbeat(name, intervalMs) {
  const existing = _registry.get(name);
  if (existing) {
    existing.intervalMs = intervalMs;
    return;
  }
  _registry.set(name, {
    name,
    intervalMs,
    registeredAt: Date.now(),
    startedAt: null,
    lastBeat: null,
    totalBeats: 0
  });
}
function beat(name) {
  const entry = _registry.get(name);
  if (!entry) return;
  const now = Date.now();
  if (entry.startedAt === null) entry.startedAt = now;
  entry.lastBeat = now;
  entry.totalBeats++;
}
var _registry;
var init_workerHeartbeat = __esm({
  "src/lib/workerHeartbeat.ts"() {
    "use strict";
    _registry = /* @__PURE__ */ new Map();
  }
});

// src/lib/events/financialEventBus.ts
var financialEventBus_exports = {};
__export(financialEventBus_exports, {
  FINANCIAL_EVENTS: () => FINANCIAL_EVENTS,
  emitJournalCreated: () => emitJournalCreated,
  emitJournalVoided: () => emitJournalVoided,
  emitMatchApproved: () => emitMatchApproved,
  emitMatchCreated: () => emitMatchCreated,
  emitMutationImported: () => emitMutationImported,
  financialEventBus: () => financialEventBus
});
import { EventEmitter } from "node:events";
import { sql as sql5 } from "drizzle-orm";
async function ensureTable() {
  if (_tableMigrated) return;
  _tableMigrated = true;
  await db.execute(sql5`
    CREATE TABLE IF NOT EXISTS financial_events (
      id          BIGSERIAL PRIMARY KEY,
      event_type  TEXT NOT NULL,
      company_id  INTEGER,
      source_type TEXT,
      source_id   TEXT,
      entry_id    INTEGER,
      mutation_id INTEGER,
      amount      NUMERIC(14,2),
      actor       TEXT,
      ref         TEXT,
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {
  });
  await db.execute(sql5`
    CREATE INDEX IF NOT EXISTS fe_event_type_idx ON financial_events(event_type)
  `).catch(() => {
  });
  await db.execute(sql5`
    CREATE INDEX IF NOT EXISTS fe_created_idx ON financial_events(created_at)
  `).catch(() => {
  });
  await db.execute(sql5`
    CREATE INDEX IF NOT EXISTS fe_entry_idx ON financial_events(entry_id) WHERE entry_id IS NOT NULL
  `).catch(() => {
  });
}
async function persistEvent(payload) {
  await ensureTable();
  await db.execute(sql5`
    INSERT INTO financial_events
      (event_type, company_id, source_type, source_id, entry_id, mutation_id, amount, actor, ref, meta)
    VALUES (
      ${payload.eventType},
      ${payload.companyId ?? null},
      ${payload.sourceType ?? null},
      ${payload.sourceId != null ? String(payload.sourceId) : null},
      ${payload.entryId ?? null},
      ${payload.mutationId ?? null},
      ${payload.amount ?? null},
      ${payload.actor ?? null},
      ${payload.ref ?? null},
      ${payload.meta ? JSON.stringify(payload.meta) : null}
    )
  `).catch((e) => {
    logger.warn({ e, eventType: payload.eventType }, "[financialEventBus] persistEvent failed (non-fatal)");
  });
}
function emitMutationImported(opts) {
  financialEventBus.emit("MUTATION_IMPORTED", {
    eventType: "MUTATION_IMPORTED",
    mutationId: opts.mutationId,
    companyId: opts.companyId,
    amount: opts.amount,
    ref: opts.ref,
    actor: opts.actor
  });
}
function emitMatchCreated(opts) {
  financialEventBus.emit("MATCH_CREATED", {
    eventType: "MATCH_CREATED",
    mutationId: opts.mutationId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    actor: opts.actor,
    companyId: opts.companyId
  });
}
function emitMatchApproved(opts) {
  financialEventBus.emit("MATCH_APPROVED", {
    eventType: "MATCH_APPROVED",
    mutationId: opts.mutationId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    actor: opts.actor,
    companyId: opts.companyId
  });
}
function emitJournalCreated(opts) {
  financialEventBus.emit("JOURNAL_CREATED", {
    eventType: "JOURNAL_CREATED",
    entryId: opts.entryId,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    amount: opts.amount,
    actor: opts.actor,
    ref: opts.ref,
    companyId: opts.companyId,
    mutationId: opts.mutationId
  });
}
function emitJournalVoided(opts) {
  financialEventBus.emit("JOURNAL_VOIDED", {
    eventType: "JOURNAL_VOIDED",
    entryId: opts.entryId,
    sourceId: opts.voidEntryId,
    actor: opts.actor,
    companyId: opts.companyId,
    meta: { voidEntryId: opts.voidEntryId, reason: opts.reason }
  });
}
var FINANCIAL_EVENTS, _tableMigrated, FinancialEventBus, financialEventBus;
var init_financialEventBus = __esm({
  async "src/lib/events/financialEventBus.ts"() {
    "use strict";
    await init_src();
    init_logger();
    FINANCIAL_EVENTS = {
      MUTATION_IMPORTED: "MUTATION_IMPORTED",
      MATCH_CREATED: "MATCH_CREATED",
      MATCH_APPROVED: "MATCH_APPROVED",
      JOURNAL_CREATED: "JOURNAL_CREATED",
      JOURNAL_VOIDED: "JOURNAL_VOIDED"
    };
    _tableMigrated = false;
    FinancialEventBus = class extends EventEmitter {
      emit(event, payload) {
        void persistEvent(payload).catch(() => {
        });
        logger.info(
          { eventType: event, sourceType: payload.sourceType, sourceId: payload.sourceId, entryId: payload.entryId },
          `[FinancialEventBus] ${event}`
        );
        return super.emit(event, payload);
      }
    };
    financialEventBus = new FinancialEventBus();
    financialEventBus.setMaxListeners(50);
  }
});

// src/lib/accounting/outboxProcessor.ts
var outboxProcessor_exports = {};
__export(outboxProcessor_exports, {
  startOutboxProcessor: () => startOutboxProcessor,
  writeToOutbox: () => writeToOutbox
});
import { sql as sql6 } from "drizzle-orm";
async function ensureOutboxTable() {
  if (_migrated) return;
  _migrated = true;
  await db.execute(sql6`
    CREATE TABLE IF NOT EXISTS financial_outbox_events (
      id           BIGSERIAL PRIMARY KEY,
      event_type   TEXT NOT NULL,
      payload      JSONB NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      entry_id     INTEGER,
      company_id   INTEGER,
      attempt      INTEGER NOT NULL DEFAULT 0,
      last_error   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `).catch(() => {
  });
  await db.execute(sql6`
    CREATE INDEX IF NOT EXISTS foe_status_idx ON financial_outbox_events(status) WHERE status = 'pending'
  `).catch(() => {
  });
  await db.execute(sql6`
    CREATE INDEX IF NOT EXISTS foe_created_idx ON financial_outbox_events(created_at)
  `).catch(() => {
  });
  await db.execute(sql6`
    CREATE INDEX IF NOT EXISTS foe_entry_idx ON financial_outbox_events(entry_id) WHERE entry_id IS NOT NULL
  `).catch(() => {
  });
}
async function writeToOutbox(payload) {
  await ensureOutboxTable();
  await db.execute(sql6`
    INSERT INTO financial_outbox_events
      (event_type, payload, entry_id, company_id)
    VALUES (
      ${payload.eventType},
      ${JSON.stringify(payload)},
      ${payload.entryId ?? null},
      ${payload.companyId ?? null}
    )
  `).catch((e) => {
    logger.warn({ e, eventType: payload.eventType }, "[outbox] writeToOutbox failed (non-fatal)");
  });
}
async function processOutboxBatch() {
  await ensureOutboxTable();
  const { rows } = await db.execute(sql6`
    SELECT id, event_type, payload, entry_id, company_id, attempt
    FROM financial_outbox_events
    WHERE status = 'pending'
      AND attempt < ${MAX_ATTEMPTS}
    ORDER BY created_at ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `).catch(() => ({ rows: [] }));
  if (!rows.length) return 0;
  let processed = 0;
  for (const row of rows) {
    const id = Number(row["id"]);
    const payload = typeof row["payload"] === "string" ? JSON.parse(row["payload"]) : row["payload"];
    try {
      await db.execute(sql6`
        UPDATE financial_outbox_events
        SET status = 'processing', attempt = attempt + 1
        WHERE id = ${id} AND status = 'pending'
      `).catch(() => {
      });
      await db.execute(sql6`
        INSERT INTO financial_events
          (event_type, company_id, source_type, source_id, entry_id, mutation_id, amount, actor, ref, meta)
        VALUES (
          ${payload.eventType},
          ${payload.companyId ?? null},
          ${payload.sourceType ?? null},
          ${payload.sourceId ?? null},
          ${payload.entryId ?? null},
          ${payload.mutationId ?? null},
          ${payload.amount ?? null},
          ${payload.actor ?? null},
          ${null},
          ${payload.meta ? JSON.stringify(payload.meta) : null}
        )
        ON CONFLICT DO NOTHING
      `).catch(() => {
      });
      const eventType = payload.eventType;
      if (eventType === "JOURNAL_CREATED" || eventType === "JOURNAL_VOIDED") {
        init_financialEventBus().then(() => financialEventBus_exports).then(({ emitJournalCreated: emitJournalCreated2, emitJournalVoided: emitJournalVoided2 }) => {
          if (eventType === "JOURNAL_CREATED" && payload.entryId) {
            emitJournalCreated2({
              entryId: payload.entryId,
              sourceType: payload.sourceType ?? null,
              sourceId: payload.sourceId ?? null,
              amount: payload.amount ?? null,
              actor: payload.actor ?? null,
              companyId: payload.companyId ?? null
            });
          }
        }).catch(() => {
        });
      }
      await db.execute(sql6`
        UPDATE financial_outbox_events
        SET status = 'done', processed_at = NOW()
        WHERE id = ${id}
      `).catch(() => {
      });
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ id, eventType: payload.eventType, err: msg }, "[outbox] processOutboxBatch: event failed");
      await db.execute(sql6`
        UPDATE financial_outbox_events
        SET status = 'pending', last_error = ${msg}
        WHERE id = ${id}
      `).catch(() => {
      });
    }
  }
  if (processed > 0) {
    logger.info({ processed, total: rows.length }, "[outbox] Batch processed");
  }
  return processed;
}
async function deadLetterCleanup() {
  await db.execute(sql6`
    UPDATE financial_outbox_events
    SET status = 'failed'
    WHERE status IN ('pending', 'processing')
      AND attempt >= ${MAX_ATTEMPTS}
      AND created_at < NOW() - INTERVAL '1 hour'
  `).catch(() => {
  });
}
function startOutboxProcessor() {
  registerHeartbeat("financial-outbox-processor", POLL_INTERVAL_MS);
  setInterval(() => {
    beat("financial-outbox-processor");
    processOutboxBatch().catch((e) => {
      logger.warn({ e }, "[outbox] processOutboxBatch tick failed (non-fatal)");
    });
  }, POLL_INTERVAL_MS);
  setInterval(() => {
    deadLetterCleanup().catch(() => {
    });
  }, CLEANUP_INTERVAL_MS);
  setTimeout(() => {
    beat("financial-outbox-processor");
    processOutboxBatch().catch(() => {
    });
  }, 5e3);
  logger.info(
    { pollIntervalSec: POLL_INTERVAL_MS / 1e3 },
    "[outbox] Outbox processor started"
  );
}
var _migrated, MAX_ATTEMPTS, BATCH_SIZE, POLL_INTERVAL_MS, CLEANUP_INTERVAL_MS;
var init_outboxProcessor = __esm({
  async "src/lib/accounting/outboxProcessor.ts"() {
    "use strict";
    await init_src();
    init_logger();
    init_workerHeartbeat();
    _migrated = false;
    MAX_ATTEMPTS = 5;
    BATCH_SIZE = 50;
    POLL_INTERVAL_MS = 1e4;
    CLEANUP_INTERVAL_MS = 60 * 60 * 1e3;
  }
});

// src/lib/jobs/paymentAccountingOutboxClassification.ts
function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}
function classifyPaymentAccountingOutbox(evidence) {
  const status = normalized(evidence.status);
  const rowText = normalized(evidence.rowText);
  const isFailureState = ["failed", "error", "dead_letter", "dead-letter"].includes(status);
  const isPaymentAccountingIncomplete = rowText.includes("payment_accounting_incomplete");
  if (!isFailureState || !isPaymentAccountingIncomplete) {
    return "IGNORE";
  }
  if (evidence.explicitlyResolved === true || evidence.hasPostedPaymentJournal) {
    return "RECOVERED";
  }
  return "ACTIVE_FAILURE";
}
var init_paymentAccountingOutboxClassification = __esm({
  "src/lib/jobs/paymentAccountingOutboxClassification.ts"() {
    "use strict";
  }
});

// src/lib/jobs/ledgerConsistencyCheck.ts
var ledgerConsistencyCheck_exports = {};
__export(ledgerConsistencyCheck_exports, {
  runLedgerConsistencyCheck: () => runLedgerConsistencyCheck,
  scheduleSpotCheck: () => scheduleSpotCheck,
  startLedgerConsistencyWorker: () => startLedgerConsistencyWorker
});
import { sql as sql7 } from "drizzle-orm";
async function ensureAlertsTable() {
  if (_migrated2) return;
  _migrated2 = true;
  await db.execute(sql7`
    CREATE TABLE IF NOT EXISTS ledger_consistency_alerts (
      id           BIGSERIAL PRIMARY KEY,
      alert_type   TEXT NOT NULL,
      severity     TEXT NOT NULL DEFAULT 'HIGH',
      description  TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      company_id   INTEGER,
      resolved     BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_at  TIMESTAMPTZ,
      resolved_by  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {
  });
  await db.execute(sql7`
    CREATE INDEX IF NOT EXISTS lca_alert_type_idx ON ledger_consistency_alerts(alert_type)
  `).catch(() => {
  });
  await db.execute(sql7`
    CREATE INDEX IF NOT EXISTS lca_resolved_idx ON ledger_consistency_alerts(resolved) WHERE resolved = FALSE
  `).catch(() => {
  });
  await db.execute(sql7`
    CREATE INDEX IF NOT EXISTS lca_created_idx ON ledger_consistency_alerts(created_at)
  `).catch(() => {
  });
}
async function writeAlert(opts) {
  await db.execute(sql7`
    INSERT INTO ledger_consistency_alerts
      (alert_type, severity, description, entity_type, entity_id, company_id)
    VALUES (
      ${opts.alertType},
      ${opts.severity},
      ${opts.description},
      ${opts.entityType ?? null},
      ${opts.entityId != null ? String(opts.entityId) : null},
      ${opts.companyId ?? null}
    )
    ON CONFLICT DO NOTHING
  `).catch((e) => {
    logger.warn({ e }, "[ledgerConsistencyCheck] writeAlert failed (non-fatal)");
  });
}
async function checkOrphanPayments() {
  const { rows } = await db.execute(sql7`
    SELECT ap.id, ap.company_id, ap.source_type, ap.source_doc_id, ap.amount
    FROM accounting_payments ap
    WHERE ap.entry_id IS NULL
      AND ap.created_at < NOW() - INTERVAL '10 minutes'
    ORDER BY ap.created_at DESC
    LIMIT 50
  `);
  let found = 0;
  for (const row of rows) {
    found++;
    const desc = `accounting_payment #${row["id"]} (${row["source_type"]}/${row["source_doc_id"]}) tidak memiliki accounting_entry`;
    logger.warn({ paymentId: row["id"], sourceType: row["source_type"] }, `[LedgerConsistency] ORPHAN_PAYMENT \u2014 ${desc}`);
    await writeAlert({
      alertType: "ORPHAN_PAYMENT",
      severity: "HIGH",
      description: desc,
      entityType: "accounting_payment",
      entityId: String(row["id"]),
      companyId: row["company_id"] ? Number(row["company_id"]) : null
    });
  }
  return found;
}
async function checkOrphanEntries() {
  const { rows } = await db.execute(sql7`
    SELECT ae.id, ae.company_id, ae.source, ae.source_id, ae.entry_number
    FROM accounting_entries ae
    WHERE ae.status = 'posted'
      AND ae.created_at < NOW() - INTERVAL '10 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entry_lines ael WHERE ael.entry_id = ae.id
      )
    ORDER BY ae.created_at DESC
    LIMIT 50
  `);
  let found = 0;
  for (const row of rows) {
    found++;
    const desc = `accounting_entry #${row["id"]} (${row["entry_number"]}) status=posted tapi tidak memiliki entry_lines`;
    logger.warn({ entryId: row["id"], entryNumber: row["entry_number"] }, `[LedgerConsistency] ORPHAN_ENTRY \u2014 ${desc}`);
    await writeAlert({
      alertType: "ORPHAN_ENTRY",
      severity: "HIGH",
      description: desc,
      entityType: "accounting_entry",
      entityId: String(row["id"]),
      companyId: row["company_id"] ? Number(row["company_id"]) : null
    });
  }
  return found;
}
async function checkDuplicateJournals() {
  const { rows } = await db.execute(sql7`
    SELECT source, source_id, company_id, COUNT(*) AS cnt, SUM(total_debit::numeric) AS total
    FROM accounting_entries
    WHERE status = 'posted'
      AND source IS NOT NULL
      AND source_id IS NOT NULL
      AND source NOT IN ('manual', 'reversal', 'manual_payment', 'manual_journal')
    GROUP BY source, source_id, company_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 30
  `);
  let found = 0;
  for (const row of rows) {
    found++;
    const desc = `Jurnal duplikat terdeteksi: source=${row["source"]} source_id=${row["source_id"]} company_id=${row["company_id"]} \u2014 ditemukan ${row["cnt"]} entri (total debit: ${row["total"]})`;
    logger.warn({ source: row["source"], sourceId: row["source_id"], cnt: row["cnt"] }, `[LedgerConsistency] DUPLICATE_JOURNAL \u2014 ${desc}`);
    await writeAlert({
      alertType: "DUPLICATE_JOURNAL",
      severity: "CRITICAL",
      description: desc,
      entityType: "accounting_entry",
      entityId: `${row["source"]}/${row["source_id"]}`,
      companyId: row["company_id"] ? Number(row["company_id"]) : null
    });
  }
  return found;
}
async function checkOrphanMutations() {
  const { rows } = await db.execute(sql7`
    SELECT bm.id, bm.company_id, bm.amount, bm.description, bm.approved_at
    FROM bank_mutations bm
    WHERE bm.status = 'approved'
      AND bm.journal_id IS NULL
      AND bm.approved_at < NOW() - INTERVAL '30 minutes'
    ORDER BY bm.approved_at DESC
    LIMIT 30
  `).catch(() => ({ rows: [] }));
  let found = 0;
  for (const row of rows) {
    found++;
    const desc = `bank_mutation #${row["id"]} status=approved tapi tidak punya journal_id`;
    logger.warn({ mutationId: row["id"] }, `[LedgerConsistency] ORPHAN_MUTATION \u2014 ${desc}`);
    await writeAlert({
      alertType: "ORPHAN_MUTATION",
      severity: "HIGH",
      description: desc,
      entityType: "bank_mutation",
      entityId: String(row["id"]),
      companyId: row["company_id"] ? Number(row["company_id"]) : null
    });
  }
  return found;
}
function asJsonObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}
function firstJsonValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return null;
}
function outboxPaymentId(row) {
  const direct = firstJsonValue(row, [
    "payment_id",
    "sport_payment_id",
    "canonical_payment_id",
    "source_payment_id"
  ]);
  const directId = Number(direct);
  if (Number.isSafeInteger(directId) && directId > 0) return directId;
  for (const key of ["payload", "event", "data", "details"]) {
    const nested = asJsonObject(row[key]);
    const nestedId = Number(firstJsonValue(nested, [
      "payment_id",
      "sport_payment_id",
      "canonical_payment_id",
      "source_payment_id"
    ]));
    if (Number.isSafeInteger(nestedId) && nestedId > 0) return nestedId;
  }
  return null;
}
function outboxRowId(row, fallback) {
  const value = firstJsonValue(row, ["id", "outbox_id", "event_id"]);
  return value == null || value === "" ? String(fallback) : String(value);
}
async function paymentHasPostedJournal(paymentId) {
  try {
    const result = await db.execute(sql7`
      SELECT EXISTS (
        SELECT 1
        FROM sport_center.accounting_journals
        WHERE payment_id = ${paymentId}
          AND journal_type = 'payment_confirmed'
          AND status = 'posted'
          AND is_reversal = FALSE
      ) AS recovered
    `);
    return result.rows[0]?.["recovered"] === true;
  } catch {
    return false;
  }
}
async function writeOutboxClassificationAlert(classification, outboxId, paymentId) {
  const isRecovered = classification === "RECOVERED";
  const alertType = isRecovered ? "PAYMENT_ACCOUNTING_RECOVERED" : "PAYMENT_ACCOUNTING_INCOMPLETE";
  const severity = isRecovered ? "LOW" : "HIGH";
  const description = isRecovered ? `Outbox failure ${outboxId} is stale: canonical payment${paymentId == null ? "" : ` #${paymentId}`} now has a posted payment_confirmed journal.` : `Outbox failure ${outboxId} remains active: canonical payment${paymentId == null ? "" : ` #${paymentId}`} has no posted payment_confirmed journal.`;
  await db.execute(sql7`
    INSERT INTO ledger_consistency_alerts
      (alert_type, severity, description, entity_type, entity_id, resolved, resolved_at, resolved_by)
    SELECT
      ${alertType},
      ${severity},
      ${description},
      'payment_accounting_outbox',
      ${outboxId},
      ${isRecovered},
      CASE WHEN ${isRecovered} THEN NOW() ELSE NULL END,
      CASE WHEN ${isRecovered} THEN 'ledger-consistency-check' ELSE NULL END
    WHERE NOT EXISTS (
      SELECT 1
      FROM ledger_consistency_alerts
      WHERE alert_type = ${alertType}
        AND entity_type = 'payment_accounting_outbox'
        AND entity_id = ${outboxId}
        AND created_at > NOW() - INTERVAL '1 day'
    )
  `).catch((e) => {
    logger.warn({ e, outboxId, classification }, "[LedgerConsistency] outbox alert write failed (non-fatal)");
  });
  if (isRecovered) {
    await db.execute(sql7`
      UPDATE ledger_consistency_alerts
      SET resolved = TRUE,
          resolved_at = COALESCE(resolved_at, NOW()),
          resolved_by = COALESCE(resolved_by, 'ledger-consistency-check')
      WHERE alert_type = 'PAYMENT_ACCOUNTING_INCOMPLETE'
        AND entity_type = 'payment_accounting_outbox'
        AND entity_id = ${outboxId}
        AND resolved = FALSE
    `).catch((e) => {
      logger.warn({ e, outboxId }, "[LedgerConsistency] stale outbox alert resolution failed (non-fatal)");
    });
  }
}
async function readPaymentAccountingOutboxRows() {
  for (const relation of ["sport_center.payment_accounting_outbox", "public.payment_accounting_outbox"]) {
    try {
      const result = await db.execute(sql7.raw(`
        SELECT to_jsonb(outbox) AS row_json
        FROM ${relation} AS outbox
        LIMIT 100
      `));
      return result.rows.map((row) => asJsonObject(row["row_json"]));
    } catch {
    }
  }
  return [];
}
async function checkPaymentAccountingOutbox() {
  const outboxRows = await readPaymentAccountingOutboxRows();
  let recovered = 0;
  let active = 0;
  for (const [index81, row] of outboxRows.entries()) {
    const paymentId = outboxPaymentId(row);
    const postedJournal = paymentId == null ? false : await paymentHasPostedJournal(paymentId);
    const classification = classifyPaymentAccountingOutbox({
      status: firstJsonValue(row, ["status", "state"]),
      rowText: JSON.stringify(row),
      hasPostedPaymentJournal: postedJournal,
      explicitlyResolved: firstJsonValue(row, ["resolved", "recovered"]) === true
    });
    if (classification === "IGNORE") continue;
    const outboxId = outboxRowId(row, index81 + 1);
    await writeOutboxClassificationAlert(classification, outboxId, paymentId);
    if (classification === "RECOVERED") recovered++;
    if (classification === "ACTIVE_FAILURE") active++;
  }
  return { recovered, active };
}
function scheduleSpotCheck(entryId) {
  setTimeout(() => {
    runSpotCheck(entryId).catch((e) => {
      logger.warn({ e, entryId }, "[LedgerConsistency] spotCheck failed (non-fatal)");
    });
  }, 50);
}
async function runSpotCheck(entryId) {
  await ensureAlertsTable();
  const { rows: lineRows2 } = await db.execute(sql7`
    SELECT COUNT(*)::int AS cnt FROM accounting_entry_lines WHERE entry_id = ${entryId}
  `).catch(() => ({ rows: [] }));
  const lineCount = Number(lineRows2[0]?.["cnt"] ?? 0);
  if (lineCount === 0) {
    const desc = `[SPOT] accounting_entry #${entryId} baru dibuat tapi tidak memiliki entry_lines`;
    logger.warn({ entryId }, `[LedgerConsistency] ORPHAN_ENTRY (spot) \u2014 ${desc}`);
    await writeAlert({ alertType: "ORPHAN_ENTRY", severity: "HIGH", description: desc, entityType: "accounting_entry", entityId: String(entryId) });
    return;
  }
  const { rows: balRows } = await db.execute(sql7`
    SELECT
      SUM(debit::numeric) AS total_debit,
      SUM(credit::numeric) AS total_credit
    FROM accounting_entry_lines
    WHERE entry_id = ${entryId}
  `).catch(() => ({ rows: [] }));
  if (balRows.length > 0) {
    const td = Number(balRows[0]?.["total_debit"] ?? 0);
    const tc = Number(balRows[0]?.["total_credit"] ?? 0);
    const diff = Math.abs(td - tc);
    if (diff > 0.01) {
      const desc = `[SPOT] accounting_entry #${entryId}: lines tidak balance \u2014 debit ${td.toFixed(2)} \u2260 credit ${tc.toFixed(2)} (selisih: ${diff.toFixed(2)})`;
      logger.warn({ entryId, td, tc, diff }, `[LedgerConsistency] UNBALANCED_ENTRY (spot) \u2014 ${desc}`);
      await writeAlert({ alertType: "UNBALANCED_ENTRY", severity: "CRITICAL", description: desc, entityType: "accounting_entry", entityId: String(entryId) });
    }
  }
}
async function runLedgerConsistencyCheck() {
  await ensureAlertsTable();
  const [orphanPayments, orphanEntries, duplicates, orphanMutations, outbox] = await Promise.all([
    checkOrphanPayments().catch(() => 0),
    checkOrphanEntries().catch(() => 0),
    checkDuplicateJournals().catch(() => 0),
    checkOrphanMutations().catch(() => 0),
    checkPaymentAccountingOutbox().catch(() => ({ recovered: 0, active: 0 }))
  ]);
  const total = orphanPayments + orphanEntries + duplicates + orphanMutations + outbox.active;
  if (total > 0) {
    logger.warn(
      {
        orphanPayments,
        orphanEntries,
        duplicates,
        orphanMutations,
        recoveredOutboxFailures: outbox.recovered,
        activeOutboxFailures: outbox.active,
        total
      },
      "[LedgerConsistencyCheck] \u26A0 Inkonsistensi terdeteksi \u2014 lihat ledger_consistency_alerts"
    );
  } else {
    logger.info(
      { recoveredOutboxFailures: outbox.recovered },
      "[LedgerConsistencyCheck] \u2713 Semua pemeriksaan lulus \u2014 tidak ada inkonsistensi aktif"
    );
  }
  return {
    orphanPayments,
    orphanEntries,
    duplicates,
    orphanMutations,
    recoveredOutboxFailures: outbox.recovered,
    activeOutboxFailures: outbox.active
  };
}
function startLedgerConsistencyWorker() {
  setTimeout(() => {
    runLedgerConsistencyCheck().catch((e) => {
      logger.warn({ e }, "[LedgerConsistencyCheck] Initial run failed (non-fatal)");
    });
  }, INITIAL_DELAY_MS);
  setInterval(() => {
    runLedgerConsistencyCheck().catch((e) => {
      logger.warn({ e }, "[LedgerConsistencyCheck] Scheduled run failed (non-fatal)");
    });
  }, CHECK_INTERVAL_MS);
  logger.info(
    { intervalHours: CHECK_INTERVAL_MS / 36e5, initialDelayMin: INITIAL_DELAY_MS / 6e4 },
    "[LedgerConsistencyCheck] Worker started"
  );
}
var _migrated2, CHECK_INTERVAL_MS, INITIAL_DELAY_MS;
var init_ledgerConsistencyCheck = __esm({
  async "src/lib/jobs/ledgerConsistencyCheck.ts"() {
    "use strict";
    await init_src();
    init_logger();
    init_paymentAccountingOutboxClassification();
    _migrated2 = false;
    CHECK_INTERVAL_MS = 4 * 60 * 60 * 1e3;
    INITIAL_DELAY_MS = 5 * 60 * 1e3;
  }
});

// src/lib/errorContainment.ts
var errorContainment_exports = {};
__export(errorContainment_exports, {
  containError: () => containError,
  getUnresolvedErrors: () => getUnresolvedErrors,
  queueIntegrityError: () => queueIntegrityError,
  resolveIntegrityError: () => resolveIntegrityError
});
import { sql as sql8 } from "drizzle-orm";
async function queueIntegrityError(opts) {
  try {
    const ctx = opts.context ? `'${JSON.stringify(opts.context).replace(/'/g, "''")}'::jsonb` : "NULL";
    await db.execute(sql8.raw(`
      INSERT INTO integrity_audit_queue
        (company_id, classification, module, error_code, message, context, entity_type, entity_id)
      VALUES (
        ${opts.companyId ?? "NULL"},
        '${opts.classification}',
        '${opts.module.replace(/'/g, "''")}',
        ${opts.errorCode ? `'${opts.errorCode.replace(/'/g, "''")}'` : "NULL"},
        '${opts.message.replace(/'/g, "''")}',
        ${ctx},
        ${opts.entityType ? `'${opts.entityType.replace(/'/g, "''")}'` : "NULL"},
        ${opts.entityId ? `'${opts.entityId.replace(/'/g, "''")}'` : "NULL"}
      )
    `));
  } catch (err) {
    logger.warn({ err, opts }, "[error-containment] queueIntegrityError gagal (non-fatal)");
  }
}
async function containError(fn, opts) {
  try {
    return await fn();
  } catch (err) {
    const message = `[${opts.operation}] ${err?.message ?? String(err)}`;
    logger.error({ err, module: opts.module, operation: opts.operation }, message);
    await queueIntegrityError({
      ...opts,
      message,
      context: { ...opts.context ?? {}, stack: err?.stack?.slice(0, 500) }
    });
    return opts.fallback;
  }
}
async function resolveIntegrityError(id, resolvedBy, notes) {
  try {
    await db.execute(sql8.raw(`
      UPDATE integrity_audit_queue
      SET resolved = TRUE,
          resolved_at = NOW(),
          resolved_by = '${resolvedBy.replace(/'/g, "''")}',
          resolution_notes = ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"},
          updated_at = NOW()
      WHERE id = ${id} AND resolved = FALSE
    `));
    return true;
  } catch (err) {
    logger.warn({ err, id }, "[error-containment] resolveIntegrityError gagal");
    return false;
  }
}
async function getUnresolvedErrors(opts) {
  try {
    const conditions = ["resolved = FALSE"];
    if (opts.companyId) conditions.push(`company_id = ${opts.companyId}`);
    if (opts.classification) conditions.push(`classification = '${opts.classification}'`);
    if (opts.module) conditions.push(`module = '${opts.module.replace(/'/g, "''")}'`);
    const limit = opts.limit ?? 100;
    const { rows } = await db.execute(sql8.raw(`
      SELECT * FROM integrity_audit_queue
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE classification WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT ${limit}
    `));
    return rows;
  } catch (err) {
    logger.warn({ err }, "[error-containment] getUnresolvedErrors gagal");
    return [];
  }
}
var init_errorContainment = __esm({
  async "src/lib/errorContainment.ts"() {
    "use strict";
    await init_src();
    init_logger();
  }
});

// src/lib/ledgerImmutability.ts
var ledgerImmutability_exports = {};
__export(ledgerImmutability_exports, {
  REVENUE_IMMUTABLE_FIELDS: () => REVENUE_IMMUTABLE_FIELDS,
  checkEntryLocked: () => checkEntryLocked,
  checkRevenueFieldLock: () => checkRevenueFieldLock,
  lockAccountingEntry: () => lockAccountingEntry,
  lockAllPostedEntries: () => lockAllPostedEntries,
  reportImmutabilityViolation: () => reportImmutabilityViolation
});
import { sql as sql9 } from "drizzle-orm";
async function lockAccountingEntry(entryId, lockedBy = "SYSTEM", client = db) {
  try {
    await client.execute(sql9.raw(`
      UPDATE accounting_entries
      SET is_locked = TRUE, locked_at = NOW(), locked_by = '${lockedBy.replace(/'/g, "''")}'
      WHERE id = ${entryId} AND is_locked = FALSE
    `));
  } catch (err) {
    logger.warn({ err, entryId }, "[ledger-immutability] lockAccountingEntry failed (non-fatal)");
  }
}
async function checkEntryLocked(entryId) {
  try {
    const { rows } = await db.execute(sql9.raw(`
      SELECT is_locked, locked_at, locked_by, status, source, entry_number
      FROM accounting_entries
      WHERE id = ${entryId}
      LIMIT 1
    `));
    if (!rows.length) {
      return { locked: false };
    }
    const row = rows[0];
    if (row.is_locked) {
      return {
        locked: true,
        lockedAt: row.locked_at,
        lockedBy: row.locked_by,
        message: `Jurnal ${row.entry_number ?? entryId} sudah LOCKED (dikunci pada ${row.locked_at ?? "??"} oleh ${row.locked_by ?? "SYSTEM"}). Gunakan /entries/:id/reverse untuk koreksi.`
      };
    }
    return { locked: false };
  } catch (err) {
    logger.error({ err, entryId }, "[ledger-immutability] checkEntryLocked DB error \u2014 defaulting to LOCKED (fail-closed)");
    return {
      locked: true,
      message: `Tidak dapat memverifikasi status lock untuk entri #${entryId}. Akses ditolak sebagai tindakan pencegahan (fail-closed). Coba lagi atau hubungi administrator.`
    };
  }
}
async function lockAllPostedEntries(companyId, periodBefore) {
  try {
    const periodClause = periodBefore ? `AND date < '${periodBefore}'` : "";
    const { rowCount } = await db.execute(sql9.raw(`
      UPDATE accounting_entries
      SET is_locked = TRUE, locked_at = NOW(), locked_by = 'PERIOD_CLOSE'
      WHERE company_id = ${companyId}
        AND status = 'posted'
        AND is_locked = FALSE
        ${periodClause}
    `));
    const count = rowCount ?? 0;
    logger.info({ companyId, periodBefore, count }, "[ledger-immutability] bulk lock selesai");
    return count;
  } catch (err) {
    logger.warn({ err, companyId }, "[ledger-immutability] lockAllPostedEntries error");
    return 0;
  }
}
function checkRevenueFieldLock(entryStatus, attemptedFields) {
  if (entryStatus !== "POSTED") {
    return { blocked: false, blockedFields: [] };
  }
  const blocked = attemptedFields.filter(
    (f) => REVENUE_IMMUTABLE_FIELDS.includes(f)
  );
  if (blocked.length === 0) {
    return { blocked: false, blockedFields: [] };
  }
  return {
    blocked: true,
    blockedFields: blocked,
    message: `Revenue entry sudah POSTED \u2014 field [${blocked.join(", ")}] tidak bisa diedit. Buat reversal entry untuk koreksi.`
  };
}
async function reportImmutabilityViolation(opts) {
  await queueIntegrityError({
    companyId: opts.companyId ?? null,
    classification: "HIGH",
    module: "accounting",
    errorCode: "IMMUTABILITY_VIOLATION",
    message: `Percobaan ${opts.attemptedAction} pada entry ID ${opts.entryId} yang sudah LOCKED`,
    context: { entryId: opts.entryId, attemptedAction: opts.attemptedAction, actor: opts.actor },
    entityType: "accounting_entry",
    entityId: String(opts.entryId)
  });
}
var REVENUE_IMMUTABLE_FIELDS;
var init_ledgerImmutability = __esm({
  async "src/lib/ledgerImmutability.ts"() {
    "use strict";
    await init_src();
    init_logger();
    await init_errorContainment();
    REVENUE_IMMUTABLE_FIELDS = [
      "revenue_company_id",
      "collecting_company_id",
      "coa_debit",
      "coa_credit",
      "amount",
      "erp_category"
    ];
  }
});

// src/lib/accounting/historicalDuplicateReversal.ts
await init_src();
import { sql as sql11 } from "drizzle-orm";

// src/lib/accounting.ts
await init_src();
import { eq as eq2, sql as sql10 } from "drizzle-orm";
import { createHash } from "crypto";

// src/lib/accountingSeed.ts
await init_src();
init_logger();
import { eq, isNotNull, sql as sql4 } from "drizzle-orm";
var ENUM_PATCHES = [
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'closing_entry'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'reversal'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation_void'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'fund_transfer'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'cogs_delivery'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'logistic_vendor_cost'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_payment'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_reversal'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking_reversal'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_qris_mdr'`
];
var _enumPatchApplied = false;
async function applyAccountingEnumPatches() {
  if (_enumPatchApplied) return;
  for (const q of ENUM_PATCHES) {
    try {
      await db.execute(sql4.raw(q));
    } catch {
    }
  }
  _enumPatchApplied = true;
  logger.info("accounting_entry_source enum patches applied");
}

// src/lib/accounting.ts
init_logger();

// src/lib/currencyTolerance.ts
var CURRENCY_DECIMAL_PLACES = {
  IDR: 0,
  // Rupiah — tidak ada desimal praktis
  JPY: 0,
  // Yen Jepang
  KRW: 0,
  // Won Korea
  VND: 0,
  // Dong Vietnam
  CLP: 0,
  // Peso Chili
  HUF: 0,
  // Forint Hungaria
  TWD: 0,
  // Dolar Taiwan (rounded to 0 in most FX)
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SGD: 2,
  MYR: 2,
  CNY: 2,
  HKD: 2,
  THB: 2,
  PHP: 2,
  INR: 2,
  SAR: 2,
  AED: 2,
  CAD: 2,
  CHF: 2,
  NZD: 2,
  BHD: 3,
  // Dinar Bahrain — 3 desimal
  KWD: 3,
  // Dinar Kuwait
  OMR: 3
};
function getCurrencyTolerance(currency) {
  const code = (currency ?? "IDR").toUpperCase().trim();
  const dec = CURRENCY_DECIMAL_PLACES[code] ?? 2;
  if (dec === 0) return 1;
  if (dec === 2) return 0.01;
  if (dec === 3) return 1e-3;
  return Math.pow(10, -dec);
}
function validateMultiCurrencyBalance(lines) {
  const groups = {};
  let baseDr = 0;
  let baseCr = 0;
  let hasAllRates = true;
  for (const line of lines) {
    const ccy = (line.currency ?? "IDR").toUpperCase().trim();
    const dr = Number(line.debit) || 0;
    const cr = Number(line.credit) || 0;
    const rate = Number(line.exchangeRate ?? 1) || 1;
    if (!groups[ccy]) groups[ccy] = { dr: 0, cr: 0 };
    groups[ccy].dr += dr;
    groups[ccy].cr += cr;
    if (line.exchangeRate == null) {
      if (ccy !== "IDR") hasAllRates = false;
      baseDr += ccy === "IDR" ? dr : 0;
      baseCr += ccy === "IDR" ? cr : 0;
    } else {
      baseDr += dr * rate;
      baseCr += cr * rate;
    }
  }
  const perCurrency = {};
  let allGroupsBalanced = true;
  const detailParts = [];
  for (const [ccy, { dr, cr }] of Object.entries(groups)) {
    const tolerance = getCurrencyTolerance(ccy);
    const imbalance = Math.abs(dr - cr);
    const balanced3 = imbalance <= tolerance;
    perCurrency[ccy] = { dr: round4(dr), cr: round4(cr), imbalance: round4(imbalance), balanced: balanced3, tolerance };
    if (!balanced3) {
      allGroupsBalanced = false;
      detailParts.push(`${ccy}: DR=${round4(dr)} CR=${round4(cr)} imbalance=${round4(imbalance)} (tolerance=${tolerance})`);
    }
  }
  const baseTolerance = getCurrencyTolerance("IDR");
  const baseImbalance = Math.abs(baseDr - baseCr);
  const baseBalanced = hasAllRates ? baseImbalance <= baseTolerance : null;
  const imbalanceBase = round4(baseImbalance);
  if (baseBalanced === false) {
    detailParts.push(`BASE(IDR): DR=${round4(baseDr)} CR=${round4(baseCr)} imbalance=${imbalanceBase}`);
  }
  const balanced2 = allGroupsBalanced && baseBalanced !== false;
  const detail = balanced2 ? `OK (${Object.keys(groups).join(", ")})` : `UNBALANCED \u2014 ${detailParts.join("; ")}`;
  return { balanced: balanced2, imbalanceBase, perCurrency, allGroupsBalanced, baseBalanced, detail };
}
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

// src/lib/accounting.ts
function requireAccountingCompanyId(companyId) {
  if (!Number.isInteger(companyId) || companyId == null || companyId <= 0) {
    throw new Error("Company context is required for accounting operations");
  }
  return companyId;
}
async function postLedgerEvent(opts) {
  const client = opts.client ?? db;
  try {
    await client.execute(sql10`
      INSERT INTO ledger_events
        (company_id, event_type, period, entry_id, ledger_entry_id, actor, payload)
      VALUES
        (${opts.companyId}, ${opts.eventType}, ${opts.period},
         ${opts.entryId ?? null}, ${opts.ledgerEntryId ? String(opts.ledgerEntryId) : null},
         ${opts.actor ?? null}, ${opts.payload ? JSON.stringify(opts.payload) : null}::jsonb)
    `);
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType, period: opts.period }, "[ledgerEvent] non-fatal");
  }
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
async function _nextEntryNumber(client, journalCode, source, companyId) {
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  const prefix = source === "manual" || !source ? "JE" : journalCode;
  const cid = companyId ?? 0;
  try {
    const result = await client.execute(sql10`
      INSERT INTO journal_sequences (journal_prefix, company_id, year, next_seq)
      VALUES (${prefix}, ${cid}, ${year}, 2)
      ON CONFLICT (journal_prefix, company_id, year)
      DO UPDATE SET next_seq = journal_sequences.next_seq + 1
      RETURNING (next_seq - 1)::int AS claimed_seq
    `);
    const row = result.rows?.[0] ?? (Array.isArray(result) ? result[0] : null);
    const seq = Number(row?.["claimed_seq"] ?? 1).toString().padStart(6, "0");
    return `${prefix}/${year}/${seq}`;
  } catch (seqErr) {
    logger.warn({ seqErr, prefix, cid, year }, "_nextEntryNumber: fallback to MAX-based sequence");
    const pattern = `${prefix}/${year}/%`;
    const [{ maxSeq }] = await db.select({ maxSeq: sql10`COALESCE(MAX(CAST(SPLIT_PART(entry_number, '/', 3) AS int)), 0)` }).from(accountingEntriesTable).where(sql10`entry_number LIKE ${pattern} AND SPLIT_PART(entry_number, '/', 3) ~ '^[0-9]+$'`);
    const seq = (Number(maxSeq) + 1).toString().padStart(6, "0");
    return `${prefix}/${year}/${seq}`;
  }
}
async function _postEntryCore(client, input, journalCode, initialStatus = "posted") {
  if (input.lines.length === 0) {
    throw new Error("Journal entry must have at least one line");
  }
  const source = input.source ?? "manual";
  const sourceId = input.sourceId ?? null;
  if (source !== "manual" && sourceId !== null) {
    const companyFilter = input.companyId != null ? sql10` AND ${accountingEntriesTable.companyId} = ${input.companyId}` : sql10``;
    const existing = await client.select().from(accountingEntriesTable).where(
      sql10`${accountingEntriesTable.source} = ${source} AND ${accountingEntriesTable.sourceId} = ${sourceId}${companyFilter}`
    ).limit(1);
    if (existing[0]) {
      logger.info(`[accounting] Skipping duplicate auto-post source=${source} sourceId=${sourceId} companyId=${input.companyId}`);
      return existing[0];
    }
  }
  const PERIOD_LOCK_EXEMPT_SOURCES = /* @__PURE__ */ new Set([
    "closing_entry",
    "reversal",
    "bank_reconciliation_void"
  ]);
  if (input.companyId && input.date && !PERIOD_LOCK_EXEMPT_SOURCES.has(source)) {
    try {
      const d = input.date;
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const { rows: periodRows } = await client.execute(sql10`
        SELECT is_closed, override_allowed
        FROM financial_periods
        WHERE company_id = ${input.companyId}
          AND year  = ${year}
          AND month = ${month}
        LIMIT 1
      `);
      const period = periodRows[0];
      if (period?.["is_closed"] && !period?.["override_allowed"]) {
        const periodStr = `${year}-${String(month).padStart(2, "0")}`;
        throw new Error(`PERIOD_CLOSED: Fiscal period ${periodStr} sudah ditutup. Gunakan reversal entry di period baru.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("PERIOD_CLOSED:")) throw err;
      logger.warn({ err }, "[_postEntryCore] Period lock check failed (non-fatal on DB error) \u2014 proceeding");
    }
  }
  const balanceResult = validateMultiCurrencyBalance(input.lines);
  if (!balanceResult.balanced) {
    throw new Error(
      `Journal entry not balanced: ${balanceResult.detail}`
    );
  }
  const totalDebit = round2(input.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
  const totalCredit = round2(input.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  const entryNumber = await _nextEntryNumber(client, journalCode, input.source, input.companyId);
  const dateStr = input.date.toISOString().split("T")[0];
  const entryValues = {
    journalId: input.journalId,
    date: dateStr,
    ref: input.ref ?? null,
    description: input.description ?? null,
    paymentMethod: input.paymentMethod ?? null,
    paymentProvider: input.paymentProvider ?? null,
    // Always insert as 'draft' first so trg_block_lines_mutation allows line inserts.
    // After lines are inserted, we'll UPDATE to initialStatus (draft→posted is allowed).
    status: "draft",
    source,
    sourceId,
    sourceEventId: input.sourceEventId ?? null,
    sourceModule: input.sourceModule ?? null,
    totalDebit: String(totalDebit),
    totalCredit: String(totalCredit),
    createdById: input.createdById ?? null,
    companyId: requireAccountingCompanyId(input.companyId),
    costCenterId: input.costCenterId ?? null,
    facilityId: input.facilityId ?? null,
    expenseCategory: input.expenseCategory ?? null
  };
  let entry;
  let currentEntryNumber = entryNumber;
  let enumPatchedOnce = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    let inserted;
    try {
      inserted = await client.insert(accountingEntriesTable).values({ entryNumber: currentEntryNumber, ...entryValues }).onConflictDoNothing().returning();
    } catch (insertErr) {
      const cause = insertErr?.cause ?? {};
      const pgCode = String(cause["code"] ?? "");
      const pgMsg = String(cause["message"] ?? (insertErr instanceof Error ? insertErr.message : ""));
      const pgDetail = String(cause["detail"] ?? "");
      const pgConstr = String(cause["constraint"] ?? "");
      const pgColumn = String(cause["column"] ?? "");
      const pgTable137 = String(cause["table"] ?? "");
      logger.error({
        pgCode,
        pgMsg,
        pgDetail,
        pgConstr,
        pgColumn,
        pgTable: pgTable137,
        source,
        sourceId,
        entryNumber: currentEntryNumber,
        attempt
      }, "_postEntryCore INSERT failed \u2014 full PG error");
      if (pgCode === "22P02" && !enumPatchedOnce) {
        enumPatchedOnce = true;
        logger.warn({ source, pgCode }, "_postEntryCore: enum value missing \u2014 applying enum patches and retrying");
        await applyAccountingEnumPatches();
        inserted = await client.insert(accountingEntriesTable).values({ entryNumber: currentEntryNumber, ...entryValues }).onConflictDoNothing().returning();
      } else if (pgCode === "P0001" || pgMsg.includes("PERIOD_LOCKED")) {
        const periodMatch = pgMsg.match(/PERIOD_LOCKED[^:]*:\s*(.*)/);
        const periodDetail = periodMatch?.[1] ?? pgMsg;
        throw new Error(`PERIOD_CLOSED: Jurnal tidak bisa diposting karena periode keuangan sudah ditutup. ${periodDetail}`);
      } else if (pgCode === "25P02") {
        throw new Error("JOURNAL_TX_ABORTED: Transaksi jurnal dibatalkan karena ada operasi sebelumnya yang gagal.");
      } else if (pgCode === "23503") {
        throw new Error(`JOURNAL_FK_VIOLATION: Referensi tidak valid pada jurnal (${pgConstr || pgColumn || "foreign key"}). Periksa akun, jurnal, dan perusahaan yang dipilih.`);
      } else if (pgCode === "23502") {
        throw new Error(`JOURNAL_NULL_VIOLATION: Kolom wajib tidak terisi pada insert jurnal (${pgColumn}). Periksa konfigurasi akuntansi.`);
      } else {
        throw insertErr;
      }
    }
    entry = inserted[0];
    if (entry) break;
    if (source !== "manual" && sourceId !== null) {
      const companyFilter = input.companyId != null ? sql10` AND ${accountingEntriesTable.companyId} = ${input.companyId}` : sql10``;
      const [existing] = await client.select().from(accountingEntriesTable).where(
        sql10`${accountingEntriesTable.source} = ${source} AND ${accountingEntriesTable.sourceId} = ${sourceId}${companyFilter}`
      ).limit(1);
      if (existing) {
        logger.info(`[accounting] Entry already inserted by concurrent call source=${source} sourceId=${sourceId} companyId=${input.companyId}`);
        return existing;
      }
    }
    if (attempt < 4) {
      currentEntryNumber = await _nextEntryNumber(
        client,
        journalCode,
        input.source,
        input.companyId
      );
      logger.warn({ attempt: attempt + 1, newNum: currentEntryNumber }, "postEntry: entry_number conflict, retrying with new number");
    }
  }
  if (!entry) {
    throw new Error(`Failed to create journal entry after retries (last tried: ${currentEntryNumber})`);
  }
  await client.insert(accountingEntryLinesTable).values(
    input.lines.map((l) => ({
      entryId: entry.id,
      accountId: l.accountId,
      description: l.description ?? null,
      debit: String(round2(Number(l.debit) || 0)),
      credit: String(round2(Number(l.credit) || 0))
    }))
  );
  if (initialStatus !== "draft") {
    await client.update(accountingEntriesTable).set({ status: initialStatus }).where(eq2(accountingEntriesTable.id, entry.id));
    entry = { ...entry, status: initialStatus };
  }
  const entryPeriod = input.date.toISOString().slice(0, 7);
  const eventType = source === "reversal" ? "REVERSE" : "POST";
  await postLedgerEvent({
    companyId: requireAccountingCompanyId(input.companyId),
    eventType,
    period: entryPeriod,
    entryId: entry.id,
    actor: input.createdById ?? null,
    payload: {
      entryNumber: entry.entryNumber,
      source,
      sourceId,
      totalDebit: Number(entry.totalDebit),
      totalCredit: Number(entry.totalCredit)
    }
    // client intentionally omitted → uses global db, never poisons caller's tx
  });
  const previousEntryId = source === "reversal" && typeof sourceId === "number" ? sourceId : null;
  const checksumPayload = JSON.stringify({
    entryNumber: entry.entryNumber,
    source,
    sourceId,
    totalDebit,
    totalCredit,
    companyId: requireAccountingCompanyId(input.companyId),
    date: dateStr
  });
  const checksumHash = createHash("sha256").update(checksumPayload).digest("hex");
  void db.execute(sql10`
    UPDATE accounting_entries
    SET checksum_hash     = ${checksumHash},
        previous_entry_id = ${previousEntryId}
    WHERE id = ${entry.id}
  `).catch(() => {
  });
  void init_outboxProcessor().then(() => outboxProcessor_exports).then(({ writeToOutbox: writeToOutbox2 }) => writeToOutbox2({
    eventType: source === "reversal" ? "JOURNAL_VOIDED" : "JOURNAL_CREATED",
    entryId: entry.id,
    sourceType: source,
    sourceId: sourceId != null ? String(sourceId) : null,
    amount: totalDebit,
    actor: input.createdById ?? null,
    companyId: input.companyId ?? null
  })).catch(() => {
  });
  void init_ledgerConsistencyCheck().then(() => ledgerConsistencyCheck_exports).then(({ scheduleSpotCheck: scheduleSpotCheck2 }) => scheduleSpotCheck2(entry.id)).catch(() => {
  });
  return entry;
}
var GOVERNANCE_MANUAL_SOURCES = /* @__PURE__ */ new Set(["manual", "manual_payment", "manual_bank", "manual_cash", "manual_journal"]);
var GOVERNANCE_EXEMPT_SOURCES = /* @__PURE__ */ new Set([
  "reversal",
  "bank_reconciliation",
  "bank_reconciliation_void",
  "closing_entry",
  // digunakan oleh closeFinancialPeriod()
  "governance_approval"
  // digunakan oleh financeGovernance approve route
]);
async function postEntry(input, journalCode) {
  if (GOVERNANCE_MANUAL_SOURCES.has(input.source ?? "") && !GOVERNANCE_EXEMPT_SOURCES.has(input.source ?? "")) {
    Promise.all([
      init_errorContainment().then(() => errorContainment_exports).then(({ queueIntegrityError: queueIntegrityError2 }) => queueIntegrityError2({
        companyId: requireAccountingCompanyId(input.companyId),
        classification: "HIGH",
        module: "accounting_governance",
        errorCode: "DIRECT_POST_BYPASS",
        message: `Manual source '${input.source}' called postEntry directly, bypassing governance draft\u2192approval workflow. Route: use safeAccountingPost or createDraftEntry.`,
        context: { source: input.source, journalCode, createdById: input.createdById ?? "SYSTEM" },
        entityType: "accounting_entry",
        entityId: null
      }).catch(() => {
      }))
    ]).catch(() => {
    });
  }
  const entry = await _postEntryCore(db, input, journalCode);
  init_ledgerImmutability().then(() => ledgerImmutability_exports).then(({ lockAccountingEntry: lockAccountingEntry2 }) => {
    lockAccountingEntry2(entry.id, input.createdById ?? "SYSTEM").catch(() => {
    });
  }).catch(() => {
  });
  return entry;
}

// src/lib/accounting/historicalDuplicateReversal.ts
init_logger();
var EPSILON = 0.01;
var closeEnough = (a, b) => Math.abs(a - b) <= EPSILON;
var balanced = (debit, credit) => closeEnough(debit, credit);
function validateHistoricalDuplicateEvidence(evidence) {
  const reasons = [];
  const { legacy, canonical } = evidence;
  if (legacy.id === canonical.id) reasons.push("legacy and canonical entries must differ");
  if (legacy.companyId !== canonical.companyId) reasons.push("company_id mismatch");
  if (legacy.status !== "posted") reasons.push("legacy entry is not posted");
  if (canonical.status !== "posted") reasons.push("canonical entry is not posted");
  if (legacy.source !== "sport_center_booking") reasons.push("legacy source mismatch");
  if (canonical.source !== "sport_center_payment") reasons.push("canonical source mismatch");
  if (legacy.voidEntryId != null) reasons.push("legacy already has void_entry_id");
  if (legacy.isVoided) reasons.push("legacy is_voided is true");
  if (legacy.isReversed) reasons.push("legacy is_reversed is true");
  if (evidence.existingReversalCount !== 0) reasons.push("historical duplicate reversal already exists");
  if (!balanced(legacy.totalDebit, legacy.totalCredit)) reasons.push("legacy entry is unbalanced");
  if (!balanced(canonical.totalDebit, canonical.totalCredit)) reasons.push("canonical entry is unbalanced");
  if (!closeEnough(legacy.totalDebit, canonical.totalDebit)) reasons.push("total debit mismatch");
  if (!closeEnough(legacy.totalCredit, canonical.totalCredit)) reasons.push("total credit mismatch");
  if (!legacy.ref || !canonical.sportBookingOrderNumber || legacy.ref !== canonical.sportBookingOrderNumber) {
    reasons.push("legacy ref does not match canonical sport booking order_number");
  }
  if (canonical.sourcePaymentId == null || canonical.sportPaymentId !== canonical.sourcePaymentId || canonical.sportBookingId == null || canonical.sportBookingRowId !== canonical.sportBookingId) {
    reasons.push("canonical payment identity chain mismatch");
  }
  if (canonical.paymentSourceDocId != null && canonical.paymentSourceDocId !== canonical.sourcePaymentId) {
    reasons.push("canonical accounting payment identity mismatch");
  }
  if (canonical.paymentSourceType != null && canonical.paymentSourceType !== "sport_center") {
    reasons.push("canonical accounting payment source mismatch");
  }
  if (canonical.paymentSourceType != null && canonical.paymentStatus !== "posted") {
    reasons.push("canonical accounting payment is not posted");
  }
  if (canonical.sportPaymentStatus !== "confirmed") reasons.push("canonical sport payment is not confirmed");
  if (canonical.paymentAmount != null && !closeEnough(canonical.paymentAmount, canonical.totalDebit)) {
    reasons.push("canonical accounting payment amount mismatch");
  }
  const legacyDebit = evidence.legacyLines.find((line) => line.debit > EPSILON);
  const canonicalDebit = evidence.canonicalLines.find((line) => line.debit > EPSILON);
  if (!legacyDebit || !canonicalDebit) {
    reasons.push("missing bank debit line");
  } else {
    if (legacyDebit.accountId !== canonicalDebit.accountId) reasons.push("bank debit account mismatch");
    if (!closeEnough(legacyDebit.debit, canonicalDebit.debit)) reasons.push("bank debit amount mismatch");
  }
  return { safe: reasons.length === 0, reasons };
}
var VERIFIED_HISTORICAL_DUPLICATE_PAIRS = [
  [14593, 28585],
  [14594, 28587],
  [20966, 28601],
  [20967, 28602],
  [28382, 28688],
  [28383, 28689],
  [28384, 28690]
];
async function reverseVerifiedHistoricalDuplicateBatch(input) {
  const preflight = [];
  for (const [legacyEntryId, canonicalEntryId] of VERIFIED_HISTORICAL_DUPLICATE_PAIRS) {
    const result = await reverseHistoricalDuplicate({
      legacyEntryId,
      canonicalEntryId,
      actor: input.actor,
      reason: input.reason,
      validateOnly: true
    });
    preflight.push(result);
    if (!result.ok) return { ok: false, preflight, applied: [] };
  }
  const applied = [];
  for (const [legacyEntryId, canonicalEntryId] of VERIFIED_HISTORICAL_DUPLICATE_PAIRS) {
    const result = await reverseHistoricalDuplicate({
      legacyEntryId,
      canonicalEntryId,
      actor: input.actor,
      reason: input.reason
    });
    applied.push(result);
    if (!result.ok) return { ok: false, preflight, applied };
  }
  return { ok: true, preflight, applied };
}
function numeric73(value) {
  return Number(value ?? 0);
}
function lineRows(rows) {
  return rows.map((row) => ({
    accountId: numeric73(row.account_id),
    debit: numeric73(row.debit),
    credit: numeric73(row.credit)
  }));
}
async function reverseHistoricalDuplicate(input) {
  const legacyResult = await db.execute(sql11`
    SELECT id, company_id, status::text AS status, source::text AS source, source_id,
           ref, total_debit, total_credit, void_entry_id,
           COALESCE(is_voided, false) AS is_voided,
           COALESCE(is_reversed, false) AS is_reversed,
           journal_id, date
    FROM accounting_entries
    WHERE id = ${input.legacyEntryId}
    LIMIT 1
  `);
  const canonicalResult = await db.execute(sql11`
    SELECT ae.id, ae.company_id, ae.status::text AS status, ae.source::text AS source,
           ae.source_payment_id, ae.total_debit, ae.total_credit,
           ap.source_type AS payment_source_type, ap.source_doc_id AS payment_source_doc_id,
           ap.status::text AS payment_status, ap.amount AS payment_amount,
           sp.id AS sport_payment_id, sp.status::text AS sport_payment_status,
           sp.booking_id AS sport_booking_id, sb.id AS sport_booking_row_id,
           sb.order_number AS sport_booking_order_number,
           ae.journal_id, ae.date
    FROM accounting_entries ae
    LEFT JOIN accounting_payments ap
      ON ap.entry_id = ae.id
      OR (ap.source_type = 'sport_center' AND ap.source_doc_id = ae.source_payment_id)
    LEFT JOIN sport_center.sport_payments sp ON sp.id = ae.source_payment_id
    LEFT JOIN sport_center.sport_bookings sb ON sb.id = sp.booking_id
    WHERE ae.id = ${input.canonicalEntryId}
    LIMIT 1
  `);
  if (!legacyResult.rows.length || !canonicalResult.rows.length) {
    return { ok: false, code: "NOT_FOUND", error: "legacy or canonical entry not found" };
  }
  const legacyRow = legacyResult.rows[0];
  const canonicalRow = canonicalResult.rows[0];
  const reversalResult = await db.execute(sql11`
    SELECT COUNT(*)::int AS count
    FROM accounting_entries
    WHERE source::text = 'historical_duplicate_reversal'
      AND source_id = ${input.legacyEntryId}
  `);
  const [legacyLinesResult, canonicalLinesResult] = await Promise.all([
    db.execute(sql11`SELECT account_id, debit, credit FROM accounting_entry_lines WHERE entry_id = ${input.legacyEntryId}`),
    db.execute(sql11`SELECT account_id, debit, credit FROM accounting_entry_lines WHERE entry_id = ${input.canonicalEntryId}`)
  ]);
  const evidence = {
    legacy: {
      id: numeric73(legacyRow.id),
      companyId: numeric73(legacyRow.company_id),
      status: String(legacyRow.status),
      source: String(legacyRow.source),
      sourceId: legacyRow.source_id == null ? null : numeric73(legacyRow.source_id),
      ref: legacyRow.ref == null ? null : String(legacyRow.ref),
      totalDebit: numeric73(legacyRow.total_debit),
      totalCredit: numeric73(legacyRow.total_credit),
      voidEntryId: legacyRow.void_entry_id == null ? null : numeric73(legacyRow.void_entry_id),
      isVoided: Boolean(legacyRow.is_voided),
      isReversed: Boolean(legacyRow.is_reversed)
    },
    canonical: {
      id: numeric73(canonicalRow.id),
      companyId: numeric73(canonicalRow.company_id),
      status: String(canonicalRow.status),
      source: String(canonicalRow.source),
      sourcePaymentId: canonicalRow.source_payment_id == null ? null : numeric73(canonicalRow.source_payment_id),
      totalDebit: numeric73(canonicalRow.total_debit),
      totalCredit: numeric73(canonicalRow.total_credit),
      paymentSourceType: canonicalRow.payment_source_type == null ? null : String(canonicalRow.payment_source_type),
      paymentSourceDocId: canonicalRow.payment_source_doc_id == null ? null : numeric73(canonicalRow.payment_source_doc_id),
      paymentStatus: canonicalRow.payment_status == null ? null : String(canonicalRow.payment_status),
      paymentAmount: canonicalRow.payment_amount == null ? null : numeric73(canonicalRow.payment_amount),
      sportPaymentId: canonicalRow.sport_payment_id == null ? null : numeric73(canonicalRow.sport_payment_id),
      sportPaymentStatus: canonicalRow.sport_payment_status == null ? null : String(canonicalRow.sport_payment_status),
      sportBookingId: canonicalRow.sport_booking_id == null ? null : numeric73(canonicalRow.sport_booking_id),
      sportBookingRowId: canonicalRow.sport_booking_row_id == null ? null : numeric73(canonicalRow.sport_booking_row_id),
      sportBookingOrderNumber: canonicalRow.sport_booking_order_number == null ? null : String(canonicalRow.sport_booking_order_number)
    },
    legacyLines: lineRows(legacyLinesResult.rows),
    canonicalLines: lineRows(canonicalLinesResult.rows),
    existingReversalCount: numeric73(reversalResult.rows[0]?.count)
  };
  const validation = validateHistoricalDuplicateEvidence(evidence);
  if (!validation.safe) {
    return { ok: false, code: "NOT_SAFE", error: validation.reasons.join("; ") };
  }
  if (input.validateOnly) return { ok: true };
  const reversalLines = evidence.legacyLines.map((line) => ({
    accountId: line.accountId,
    debit: line.credit,
    credit: line.debit,
    description: `[HISTORICAL DUPLICATE REVERSAL] ${input.reason}`
  }));
  const journalId = numeric73(legacyRow.journal_id);
  let reversal;
  try {
    reversal = await postEntry({
      journalId,
      date: /* @__PURE__ */ new Date(),
      ref: evidence.legacy.ref,
      description: input.reason,
      source: "historical_duplicate_reversal",
      sourceId: evidence.legacy.id,
      createdById: input.actor,
      companyId: evidence.legacy.companyId,
      lines: reversalLines
    }, "JNL");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  await db.execute(sql11`
    UPDATE accounting_entries
    SET status = 'voided',
        void_entry_id = ${reversal.id},
        void_reason = ${input.reason},
        updated_at = NOW()
    WHERE id = ${input.legacyEntryId}
      AND status::text = 'posted'
      AND void_entry_id IS NULL
  `);
  logger.info(
    { legacyEntryId: input.legacyEntryId, canonicalEntryId: input.canonicalEntryId, reversalEntryId: reversal.id },
    "[reverseHistoricalDuplicate] historical duplicate reversed"
  );
  return { ok: true, reversalEntryId: reversal.id };
}
export {
  VERIFIED_HISTORICAL_DUPLICATE_PAIRS,
  reverseHistoricalDuplicate,
  reverseVerifiedHistoricalDuplicateBatch,
  validateHistoricalDuplicateEvidence
};
