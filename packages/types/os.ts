// ============================================================
// packages/types/os.ts
// Tipos compartilhados — Modulo OS (Ordens de Servico)
// ============================================================

// ─── Enums ──────────────────────────────────────────────────

export type PersonType = "PF" | "PJ";
export type CustomerType = "CLIENTE" | "FORNECEDOR" | "AMBOS";
export type CustomerSource = "MANUAL" | "MIGRATION" | "WEBHOOK" | "API" | "IMPORT";

export type OSPriorityType = "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";
export type OSTypeEnum = "BALCAO" | "COLETA" | "ENTREGA" | "COLETA_ENTREGA";
export type OSItemTypeEnum = "PECA" | "SERVICO" | "MAO_DE_OBRA";
export type PhotoStageEnum = "RECEPCAO" | "DIAGNOSTICO" | "EXECUCAO" | "ENTREGA";
export type QuoteStatusEnum = "RASCUNHO" | "ENVIADO" | "APROVADO" | "RECUSADO" | "EXPIRADO";

// ─── Customer ───────────────────────────────────────────────

export interface CustomerAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
}

export interface CustomerListItem {
  id: string;
  personType: PersonType;
  customerType: CustomerType;
  legalName: string;
  tradeName: string | null;
  documentNumber: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  addressCity: string | null;
  addressState: string | null;
  totalOsCount: number;
  lastOsAt: string | null;
  createdAt: string;
}

export interface CustomerDetail extends CustomerListItem {
  vhsysId: number | null;
  documentCpf: string | null;
  documentCnpj: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;
  address: CustomerAddress;
  billingAddress: CustomerAddress;
  contactName: string | null;
  phoneSecondary: string | null;
  emailSecondary: string | null;
  avatarUrl: string | null;
  notes: string | null;
  tags: string[];
  source: CustomerSource;
  customFields: Record<string, unknown>;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface CustomerSearchResult {
  id: string;
  legalName: string;
  tradeName: string | null;
  documentNumber: string;
  mobile: string | null;
  email: string | null;
}

// ─── Service Order ──────────────────────────────────────────

export interface OSStatus {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  order: number;
  isFinal: boolean;
  isDefault: boolean;
  transitions: string[];
}

export interface OSListItem {
  id: string;
  osNumber: number;
  customer: { id: string; legalName: string; mobile: string | null };
  status: OSStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  priority: OSPriorityType;
  osType: OSTypeEnum;
  equipment: string | null;
  equipmentType: string | null;
  totalAmount: number;
  estimatedDelivery: string | null;
  isOverdue: boolean;
  createdAt: string;
}

export interface OSDetail extends OSListItem {
  vhsysId: number | null;
  equipmentBrand: string | null;
  equipmentModel: string | null;
  equipmentSerial: string | null;
  pageCountIn: number | null;
  pageCountOut: number | null;
  reportedIssue: string | null;
  receptionNotes: string | null;
  technicalReport: string | null;
  internalNotes: string | null;
  referenceCode: string | null;
  actualDelivery: string | null;
  warrantyUntil: string | null;
  isWarrantyReturn: boolean;
  collectionAddress: string | null;
  deliveryAddress: string | null;
  totalParts: number;
  totalLabor: number;
  totalDiscount: number;
  signatureUrl: string | null;
  customFields: Record<string, unknown>;
  source: string;
  items: OSItemDetail[];
  photos: OSPhotoDetail[];
  latestQuote: QuoteListItem | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface OSItemDetail {
  id: string;
  itemType: OSItemTypeEnum;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  stockDeducted: boolean;
  stockReserved: boolean;
}

export interface OSPhotoDetail {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  stage: PhotoStageEnum;
  caption: string | null;
  uploadedBy: string;
  createdAt: string;
}

export interface OSHistoryEntry {
  id: string;
  fromStatus: OSStatus | null;
  toStatus: OSStatus;
  changedBy: string;
  changedByName: string;
  notes: string | null;
  createdAt: string;
}

// ─── Quote ──────────────────────────────────────────────────

export interface QuoteListItem {
  id: string;
  quoteNumber: number;
  serviceOrderId: string;
  osNumber: number;
  status: QuoteStatusEnum;
  totalParts: number;
  totalLabor: number;
  totalDiscount: number;
  totalAmount: number;
  validUntil: string | null;
  sentAt: string | null;
  sentVia: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface QuoteDetail extends QuoteListItem {
  approvalToken: string;
  executionDays: number | null;
  warrantyDays: number | null;
  pdfUrl: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  items: OSItemDetail[];
  serviceOrder: {
    id: string;
    osNumber: number;
    equipment: string | null;
    customer: { id: string; legalName: string; mobile: string | null; email: string | null };
  };
}

export interface PublicQuoteView {
  companyName: string;
  companyLogo: string | null;
  quoteNumber: number;
  osNumber: number;
  customerName: string;
  equipment: string | null;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  totalAmount: number;
  validUntil: string | null;
  executionDays: number | null;
  warrantyDays: number | null;
  notes: string | null;
  termsAndConditions: string | null;
  status: QuoteStatusEnum;
}

// ─── Kanban / Dashboard ─────────────────────────────────────

export interface OSKanbanColumn {
  status: OSStatus;
  items: OSListItem[];
  total: number;
}

export interface OSDashboardStats {
  totalOpen: number;
  totalClosed: number;
  totalOverdue: number;
  avgResolutionDays: number;
  byStatus: { status: string; color: string; count: number }[];
  byTechnician: { name: string; count: number }[];
  byPriority: { priority: OSPriorityType; count: number }[];
  openedPerWeek: { week: string; count: number }[];
  closedPerWeek: { week: string; count: number }[];
}

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
}
