// ============================================================
// packages/types/financial.ts
// Tipos compartilhados — Modulo Financeiro
// ============================================================

// ─── Enums (mirror Prisma) ──────────────────────────────────

export const AccountType = {
  CHECKING: "CHECKING",
  SAVINGS: "SAVINGS",
  CASH: "CASH",
  PAYMENT: "PAYMENT",
  CREDIT_CARD: "CREDIT_CARD",
  INVESTMENT: "INVESTMENT",
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const PayableStatus = {
  ABERTA: "ABERTA",
  PARCIAL: "PARCIAL",
  PAGA: "PAGA",
  VENCIDA: "VENCIDA",
  CANCELADA: "CANCELADA",
} as const;
export type PayableStatus = (typeof PayableStatus)[keyof typeof PayableStatus];

export const ReceivableStatus = {
  ABERTA: "ABERTA",
  PARCIAL: "PARCIAL",
  RECEBIDA: "RECEBIDA",
  VENCIDA: "VENCIDA",
  CANCELADA: "CANCELADA",
} as const;
export type ReceivableStatus = (typeof ReceivableStatus)[keyof typeof ReceivableStatus];

export const InstallmentStatus = {
  PENDENTE: "PENDENTE",
  PAGA: "PAGA",
  VENCIDA: "VENCIDA",
  CANCELADA: "CANCELADA",
} as const;
export type InstallmentStatus = (typeof InstallmentStatus)[keyof typeof InstallmentStatus];

export const PaymentMethod = {
  DINHEIRO: "DINHEIRO",
  PIX: "PIX",
  BOLETO: "BOLETO",
  TRANSFERENCIA: "TRANSFERENCIA",
  CARTAO_CREDITO: "CARTAO_CREDITO",
  CARTAO_DEBITO: "CARTAO_DEBITO",
  CHEQUE: "CHEQUE",
  DEBITO_AUTOMATICO: "DEBITO_AUTOMATICO",
  OUTRO: "OUTRO",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const TransactionType = {
  CREDIT: "CREDIT",
  DEBIT: "DEBIT",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const ReconciliationMatchType = {
  AUTO_EXACT: "AUTO_EXACT",
  AUTO_FUZZY: "AUTO_FUZZY",
  AUTO_PARTIAL: "AUTO_PARTIAL",
  MANUAL: "MANUAL",
  IGNORED: "IGNORED",
} as const;
export type ReconciliationMatchType = (typeof ReconciliationMatchType)[keyof typeof ReconciliationMatchType];

export const ReconciliationConfidence = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
} as const;
export type ReconciliationConfidence = (typeof ReconciliationConfidence)[keyof typeof ReconciliationConfidence];

export const CardBrand = {
  VISA: "VISA",
  MASTERCARD: "MASTERCARD",
  ELO: "ELO",
  AMEX: "AMEX",
  HIPERCARD: "HIPERCARD",
  DINERS: "DINERS",
  DISCOVER: "DISCOVER",
  OUTROS: "OUTROS",
} as const;
export type CardBrand = (typeof CardBrand)[keyof typeof CardBrand];

export const CardTransactionType = {
  CREDITO: "CREDITO",
  DEBITO: "DEBITO",
  VOUCHER: "VOUCHER",
} as const;
export type CardTransactionType = (typeof CardTransactionType)[keyof typeof CardTransactionType];

export const CardSaleStatus = {
  PENDENTE: "PENDENTE",
  LIQUIDADA: "LIQUIDADA",
  CANCELADA: "CANCELADA",
  CHARGEBACK: "CHARGEBACK",
  ANTECIPADA: "ANTECIPADA",
} as const;
export type CardSaleStatus = (typeof CardSaleStatus)[keyof typeof CardSaleStatus];

export const BankStatementSource = {
  OFX_IMPORT: "OFX_IMPORT",
  API_INTER: "API_INTER",
  API_OTHER: "API_OTHER",
  MANUAL: "MANUAL",
} as const;
export type BankStatementSource = (typeof BankStatementSource)[keyof typeof BankStatementSource];

export const RecurrenceFrequency = {
  WEEKLY: "WEEKLY",
  BIWEEKLY: "BIWEEKLY",
  MONTHLY: "MONTHLY",
  BIMONTHLY: "BIMONTHLY",
  QUARTERLY: "QUARTERLY",
  SEMIANNUAL: "SEMIANNUAL",
  YEARLY: "YEARLY",
} as const;
export type RecurrenceFrequency = (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency];

// ─── Entities ───────────────────────────────────────────────

export interface Account {
  id: string;
  companyId: string;
  name: string;
  type: AccountType;
  bankCode: string | null;
  bankName: string | null;
  agency: string | null;
  agencyDigit: string | null;
  accountNumber: string | null;
  accountDigit: string | null;
  pixKey: string | null;
  pixKeyType: string | null;
  currentBalance: number;
  lastSyncAt: string | null;
  provider: string | null;
  providerConfig: Record<string, unknown>;
  isApiEnabled: boolean;
  certExpiresAt: string | null;
  acquirerPV: string | null;
  acquirerProvider: string | null;
  isDefault: boolean;
  isActive: boolean;
  color: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Lightweight DTO for list views */
export interface AccountListItem {
  id: string;
  name: string;
  type: AccountType;
  bankCode: string | null;
  bankName: string | null;
  agency: string | null;
  accountNumber: string | null;
  pixKey: string | null;
  currentBalance: number;
  isDefault: boolean;
  isActive: boolean;
  isApiEnabled: boolean;
  color: string | null;
  lastSyncAt: string | null;
  certExpiresAt: string | null;
}

export interface AccountPayable {
  id: string;
  companyId: string;
  vhsysId: number | null;
  supplierId: string | null;
  supplierName: string | null;
  description: string;
  documentNumber: string | null;
  notes: string | null;
  amount: number;
  paidAmount: number;
  status: PayableStatus;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  paymentMethod: PaymentMethod | null;
  accountId: string | null;
  recurrence: RecurrenceFrequency | null;
  recurrenceEndDate: string | null;
  recurrenceParentId: string | null;
  referenceId: string | null;
  referenceType: string | null;
  customFields: Record<string, unknown>;
  tags: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  installments?: Installment[];
}

/** Lightweight DTO for list views */
export interface PayableListItem {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  description: string;
  documentNumber: string | null;
  amount: number;
  paidAmount: number;
  status: PayableStatus;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  categoryId: string | null;
  categoryName: string | null;
  costCenterId: string | null;
  paymentMethod: PaymentMethod | null;
  accountId: string | null;
  installments: InstallmentListItem[];
  tags: string[];
}

export interface AccountReceivable {
  id: string;
  companyId: string;
  vhsysId: number | null;
  customerId: string | null;
  customerName: string | null;
  serviceOrderId: string | null;
  description: string;
  documentNumber: string | null;
  notes: string | null;
  amount: number;
  receivedAmount: number;
  status: ReceivableStatus;
  issueDate: string;
  dueDate: string;
  receivedAt: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  paymentMethod: PaymentMethod | null;
  accountId: string | null;
  boletoUrl: string | null;
  boletoBarcode: string | null;
  boletoDigitLine: string | null;
  boletoExternalId: string | null;
  pixCode: string | null;
  pixTxId: string | null;
  recurrence: RecurrenceFrequency | null;
  recurrenceEndDate: string | null;
  recurrenceParentId: string | null;
  referenceId: string | null;
  referenceType: string | null;
  customFields: Record<string, unknown>;
  tags: string[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  installments?: Installment[];
}

/** Lightweight DTO for list views */
export interface ReceivableListItem {
  id: string;
  customerId: string | null;
  customerName: string | null;
  serviceOrderId: string | null;
  description: string;
  documentNumber: string | null;
  amount: number;
  receivedAmount: number;
  status: ReceivableStatus;
  issueDate: string;
  dueDate: string;
  receivedAt: string | null;
  categoryId: string | null;
  categoryName: string | null;
  paymentMethod: PaymentMethod | null;
  boletoUrl: string | null;
  pixCode: string | null;
  installments: InstallmentListItem[];
  tags: string[];
}

export interface Installment {
  id: string;
  companyId: string;
  parentType: "PAYABLE" | "RECEIVABLE";
  payableId: string | null;
  receivableId: string | null;
  number: number;
  amount: number;
  dueDate: string;
  paidAmount: number | null;
  paidAt: string | null;
  status: InstallmentStatus;
  paymentMethod: PaymentMethod | null;
  transactionId: string | null;
  boletoUrl: string | null;
  boletoExternalId: string | null;
  pixCode: string | null;
  pixTxId: string | null;
  bankSlipId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight DTO for list views */
export interface InstallmentListItem {
  id: string;
  number: number;
  amount: number;
  dueDate: string;
  paidAmount: number | null;
  paidAt: string | null;
  status: InstallmentStatus;
  paymentMethod: PaymentMethod | null;
  boletoUrl: string | null;
  pixCode: string | null;
}

export interface Transaction {
  id: string;
  companyId: string;
  accountId: string;
  type: TransactionType;
  amount: number;
  description: string;
  date: string;
  balanceAfter: number | null;
  bankRef: string | null;
  bankDescription: string | null;
  isReconciled: boolean;
  reconciledAt: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  referenceId: string | null;
  referenceType: string | null;
  notes: string | null;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankStatement {
  id: string;
  companyId: string;
  accountId: string;
  source: BankStatementSource;
  fileName: string | null;
  periodStart: string;
  periodEnd: string;
  totalEntries: number;
  reconciledCount: number;
  importedAt: string;
  importedBy: string | null;
  isFullyReconciled: boolean;
  rawData: Record<string, unknown> | null;
}

export interface BankStatementEntry {
  id: string;
  companyId: string;
  statementId: string;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  bankRef: string | null;
  isReconciled: boolean;
  transactionId: string | null;
  reconciledAt: string | null;
  memo: string | null;
  rawData: Record<string, unknown> | null;
}

export interface Reconciliation {
  id: string;
  companyId: string;
  transactionId: string | null;
  installmentId: string | null;
  statementEntryId: string | null;
  cardSaleId: string | null;
  matchType: ReconciliationMatchType;
  confidence: ReconciliationConfidence;
  amountDifference: number;
  dateDifference: number;
  notes: string | null;
  reconciledBy: string | null;
  reconciledAt: string;
}

export interface ReconciliationSuggestion {
  statementEntryId: string;
  entryDate: string;
  entryAmount: number;
  entryDescription: string;
  installmentId: string;
  installmentNumber: number;
  installmentAmount: number;
  installmentDueDate: string;
  parentDescription: string;
  matchType: ReconciliationMatchType;
  confidence: ReconciliationConfidence;
  dateDifference: number;
}

export interface CardSale {
  id: string;
  companyId: string;
  accountId: string | null;
  acquirerProvider: string;
  acquirerPV: string | null;
  nsu: string | null;
  authorizationCode: string | null;
  cv: string | null;
  brand: CardBrand;
  transactionType: CardTransactionType;
  installments: number;
  grossAmount: number;
  feePercent: number | null;
  feeAmount: number;
  netAmount: number;
  anticipationFee: number;
  saleDate: string;
  expectedDate: string | null;
  receivedDate: string | null;
  status: CardSaleStatus;
  isReconciled: boolean;
  transactionId: string | null;
  rawData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight DTO for list views */
export interface CardSaleListItem {
  id: string;
  brand: CardBrand;
  transactionType: CardTransactionType;
  installments: number;
  grossAmount: number;
  feePercent: number | null;
  feeAmount: number;
  netAmount: number;
  saleDate: string;
  expectedDate: string | null;
  receivedDate: string | null;
  status: CardSaleStatus;
  nsu: string | null;
  isReconciled: boolean;
}

// ─── Reports ────────────────────────────────────────────────

export interface CashFlowPeriod {
  period: string;
  startDate: string;
  endDate: string;
  realizedIn: number;
  realizedOut: number;
  realizedBalance: number;
  projectedIn: number;
  projectedOut: number;
  projectedBalance: number;
  totalIn: number;
  totalOut: number;
  totalBalance: number;
}

export interface CategoryAmount {
  categoryId: string | null;
  categoryName: string;
  amount: number;
  percentage: number;
}

export interface DREReport {
  period: { startDate: string; endDate: string };
  revenue: { total: number; byCategory: CategoryAmount[] };
  expenses: { total: number; byCategory: CategoryAmount[] };
  cardFees: number;
  grossProfit: number;
  netProfit: number;
  margin: number;
}

export interface DashboardSummary {
  totalBalance: number;
  accountBalances: { accountId: string; name: string; balance: number; color: string | null }[];
  overduePayables: { count: number; total: number };
  overdueReceivables: { count: number; total: number };
  upcomingPayables: { count: number; total: number };
  upcomingReceivables: { count: number; total: number };
  cashFlowChart: CashFlowPeriod[];
}
