// ============================================================
// packages/types/fiscal.ts
// Tipos compartilhados — Modulo Fiscal (NF-e / NFS-e / NFC-e)
// ============================================================

// ─── Enums ──────────────────────────────────────────────────

export type FiscalProvider = "FOCUS_NFE" | "NFE_IO";
export type FiscalEnvironment = "HOMOLOGACAO" | "PRODUCAO";
export type InvoiceType = "NFE" | "NFCE" | "NFSE";

export type InvoiceStatus =
  | "DRAFT"
  | "PROCESSING"
  | "AUTHORIZED"
  | "REJECTED"
  | "CANCELLED"
  | "INUTILIZADA"
  | "CORRECTION_LETTER"
  | "ERROR";

// ─── FiscalConfig ───────────────────────────────────────────

export interface FiscalConfig {
  id: string;
  companyId: string;
  provider: FiscalProvider;
  environment: FiscalEnvironment;
  apiKey: string;
  apiSecret: string | null;
  certificateA1Url: string | null;
  certificatePassword: string | null;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  regimeTributario: string;
  codigoMunicipio: string | null;
  uf: string | null;
  serieNfe: number;
  cfopPadrao: string;
  naturezaOperacao: string;
  serieNfse: number;
  codigoServicoPadrao: string | null;
  aliquotaIssPadrao: number | null;
  webhookSecret: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Invoice ────────────────────────────────────────────────

export interface Invoice {
  id: string;
  companyId: string;
  type: InvoiceType;
  number: number | null;
  series: number;
  accessKey: string | null;
  customerId: string | null;
  serviceOrderId: string | null;
  saleId: string | null;
  receivableId: string | null;
  status: InvoiceStatus;
  rejectionReason: string | null;
  providerName: FiscalProvider;
  providerRef: string | null;
  totalAmount: number;
  taxAmount: number;
  discountAmount: number;
  nature: string | null;
  authProtocol: string | null;
  paymentMethod: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  issuedAt: string | null;
  authorizedAt: string | null;
  emailSentAt: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  vhsysId: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItem[];
  customer?: { id: string; name: string; cpfCnpj: string | null } | null;
  cancellation?: InvoiceCancellation | null;
  corrections?: InvoiceCorrection[];
}

/** Lightweight variant for table/list views */
export interface InvoiceListItem {
  id: string;
  type: InvoiceType;
  number: number | null;
  series: number;
  accessKey: string | null;
  customerId: string | null;
  customerName: string | null;
  status: InvoiceStatus;
  totalAmount: number;
  issuedAt: string | null;
  authorizedAt: string | null;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  itemNumber: number;
  productId: string | null;
  serviceCode: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount: number;
  ncm: string | null;
  cfop: string;
  cst: string | null;
  origin: string;
  taxes: InvoiceItemTaxes;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItemTaxes {
  icms?: { base: number; aliquota: number; valor: number };
  pis?: { situacao: string; base: number; aliquota: number; valor: number };
  cofins?: { situacao: string; base: number; aliquota: number; valor: number };
  ipi?: { situacao: string; base: number; aliquota: number; valor: number };
  iss?: { aliquota: number; valor: number; retido?: boolean };
}

export interface InvoiceCancellation {
  id: string;
  invoiceId: string;
  reason: string;
  protocol: string | null;
  cancelledAt: string;
  requestedAt: string;
  requestedBy: string | null;
  createdAt: string;
}

export interface InvoiceCorrection {
  id: string;
  invoiceId: string;
  sequenceNumber: number;
  correctionText: string;
  protocol: string | null;
  authorizedAt: string | null;
  requestedBy: string | null;
  createdAt: string;
}

export interface FiscalLog {
  id: string;
  companyId: string;
  invoiceId: string | null;
  action: string;
  direction: "outbound" | "inbound";
  requestUrl: string | null;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown> | null;
  statusCode: number | null;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

// ─── API Input Types ────────────────────────────────────────

export interface CreateNFeDraftInput {
  customerId: string;
  nature?: string;
  items: CreateInvoiceItemInput[];
  paymentMethod?: string;
  notes?: string;
}

export interface CreateNFSeDraftInput {
  customerId: string;
  serviceOrderId?: string;
  items: CreateNFSeItemInput[];
  notes?: string;
}

export interface CreateInvoiceItemInput {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  cfop: string;
  ncm?: string;
  cst?: string;
  unit?: string;
}

export interface CreateNFSeItemInput {
  description: string;
  serviceCode?: string;
  quantity: number;
  unitPrice: number;
  issAliquota?: number;
  issRetido?: boolean;
}

export interface CancelInvoiceInput {
  reason: string;
}

export interface CorrectionInput {
  correctionText: string;
}

export interface InutilizacaoInput {
  series: number;
  startNumber: number;
  endNumber: number;
  justification: string;
}

export interface FiscalConfigInput {
  provider: FiscalProvider;
  environment: FiscalEnvironment;
  apiKey: string;
  apiSecret?: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  codigoMunicipio?: string;
  uf?: string;
  serieNfe?: number;
  cfopPadrao?: string;
  naturezaOperacao?: string;
  serieNfse?: number;
  codigoServicoPadrao?: string;
  aliquotaIssPadrao?: number;
}

// ─── Dashboard ──────────────────────────────────────────────

export interface FiscalDashboard {
  summary: {
    authorized: number;
    cancelled: number;
    rejected: number;
    processing: number;
    drafts: number;
  };
  period: {
    year: number;
    month?: number;
    byType: Record<InvoiceType, { count: number; total: number }>;
  };
  chart: Array<{ month: string; count: number; total: number }>;
}
