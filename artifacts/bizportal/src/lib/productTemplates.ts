// Re-export shim — actual templates & types live in @workspace/product-templates
// (shared between bizportal, customer-portal, and api-server so the engine
// has a single source of truth and backend re-validation always matches).
export type {
  CustomField,
  CustomFieldType,
  RequiredDocument,
  ChecklistItem,
  ConditionalRule,
  ValidationRule,
  ProductTemplate,
  UploadedDocumentRef,
  DynamicFormValues,
  ProductTemplateOverride,
} from "@workspace/product-templates";

export {
  // Alias to preserve existing imports (import { getTemplate } from "@/lib/productTemplates")
  getInCodeTemplate as getTemplate,
  getAllInCodeTemplates as getAllTemplates,
  resolveTemplate,
  resolveAllTemplates,
  listInCodeCategories,
  inCodeTemplates as templates,
  FALLBACK_CATEGORY,
  CATEGORY_LABELS,
  validateTemplatePayload,
  isFieldVisible,
} from "@workspace/product-templates";
