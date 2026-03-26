// ============================================================
// packages/types/core.ts
// Tipos compartilhados — Core Module
// ============================================================

// ─── Enums ──────────────────────────────────────────────────

export type FieldType = "text" | "number" | "date" | "select" | "boolean" | "textarea" | "file";

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export" | "print";

export type PrintTemplateType = "os" | "quote" | "receipt" | "invoice" | "label";

export type MessageTrigger =
  | "os_created"
  | "os_approved"
  | "os_ready"
  | "os_delivered"
  | "quote_sent"
  | "quote_approved"
  | "payment_received"
  | "payment_overdue";

export type MessageChannel = "whatsapp" | "email" | "sms";

export type SettingType = "string" | "number" | "boolean" | "json";

export type WidgetType = "counter" | "chart" | "list" | "calendar";

export type SortOrder = "asc" | "desc";

// ─── Entities ───────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  settings: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  companyId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  roleId: string;
  isActive: boolean;
  lastLoginAt: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  role?: Role;
}

export interface Role {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  rolePermissions?: RolePermission[];
}

export interface Permission {
  id: string;
  module: string;
  action: PermissionAction;
  description: string | null;
  createdAt: string;
}

export interface RolePermission {
  id: string;
  companyId: string;
  roleId: string;
  permissionId: string;
  granted: boolean;
  permission?: Permission;
}

export interface CustomField {
  id: string;
  companyId: string;
  module: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: FieldType;
  required: boolean;
  options: string[] | null;
  defaultVal: string | null;
  order: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FieldLabel {
  id: string;
  companyId: string;
  module: string;
  fieldKey: string;
  customLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleStatus {
  id: string;
  companyId: string;
  module: string;
  name: string;
  color: string;
  icon: string | null;
  order: number;
  isFinal: boolean;
  isDefault: boolean;
  transitions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PrintTemplate {
  id: string;
  companyId: string;
  type: PrintTemplateType;
  name: string;
  htmlTemplate: string;
  cssOverride: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplate {
  id: string;
  companyId: string;
  trigger: MessageTrigger;
  channel: MessageChannel;
  name: string;
  subject: string | null;
  template: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  companyId: string;
  module: string;
  name: string;
  parentId: string | null;
  order: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Category[];
}

export interface Setting {
  id: string;
  companyId: string;
  key: string;
  value: string;
  type: SettingType;
  group: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleRegistryItem {
  id: string;
  code: string;
  name: string;
  icon: string;
  description: string | null;
  version: string;
  route: string;
  isActive: boolean;
  order: number;
}

export interface CompanyModule {
  id: string;
  companyId: string;
  moduleId: string;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  module?: ModuleRegistryItem;
}

export interface AuditLog {
  id: string;
  companyId: string;
  userId: string;
  module: string;
  action: string;
  entityId: string | null;
  entityType: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user?: Pick<UserProfile, "id" | "name" | "email">;
}

export interface DashboardWidget {
  id: string;
  companyId: string;
  userId: string;
  widgetKey: string;
  title: string;
  type: WidgetType;
  config: Record<string, unknown>;
  position: { x: number; y: number; w: number; h: number };
  isVisible: boolean;
}

export interface ApiKey {
  id: string;
  companyId: string;
  name: string;
  key: string;
  permissions: string[];
  rateLimit: number;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface Webhook {
  id: string;
  companyId: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
  failCount: number;
  createdAt: string;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  response: string | null;
  success: boolean;
  createdAt: string;
}

// ─── Auth Types ─────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  profile: UserProfile;
  permissions: Array<{ module: string; action: string }>;
  company: Company;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RegisterResponse {
  user: AuthUser;
  company: Company;
}

// ─── API Response Types ─────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
}
