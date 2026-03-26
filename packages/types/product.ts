// ============================================================
// packages/types/product.ts
// Tipos compartilhados — Modulo Estoque (Produtos e Movimentacoes)
// ============================================================

// ─── Enums ──────────────────────────────────────────────────

export type StockMovementType = "ENTRY" | "EXIT" | "ADJUSTMENT";

export type StockMovementReason =
  | "PURCHASE"
  | "SALE"
  | "OS_RESERVE"
  | "OS_DEDUCT"
  | "OS_RELEASE"
  | "MANUAL_ENTRY"
  | "MANUAL_EXIT"
  | "ADJUSTMENT"
  | "RETURN_SUPPLIER"
  | "RETURN_CUSTOMER"
  | "INITIAL";

export type PurchaseEntryStatus = "RASCUNHO" | "PENDENTE" | "RECEBIDA" | "CANCELADA";

export type StockAlertType = "BELOW_MIN" | "ABOVE_MAX" | "EXPIRING" | "OUT_OF_STOCK";
export type StockAlertStatus = "PENDING" | "ACKNOWLEDGED" | "RESOLVED";

// ─── Product ────────────────────────────────────────────────

export interface Product {
  id: string;
  companyId: string;
  vhsysId: number | null;
  name: string;
  description: string | null;
  barcode: string | null;
  internalCode: string | null;
  categoryId: string | null;
  brand: string | null;
  unit: string;
  costPrice: number;
  salePrice: number;
  markupPercent: number | null;
  ncm: string | null;
  cfop: string | null;
  cst: string | null;
  origin: string | null;
  weight: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  photoUrl: string | null;
  photos: string[];
  technicalSheet: string | null;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  minStock: number | null;
  maxStock: number | null;
  expiresAt: string | null;
  locationId: string | null;
  locationName: string | null;
  isActive: boolean;
  tags: string[];
  customFields: Record<string, unknown>;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  category?: { id: string; name: string } | null;
}

export interface ProductListItem {
  id: string;
  name: string;
  barcode: string | null;
  internalCode: string | null;
  brand: string | null;
  unit: string;
  costPrice: number;
  salePrice: number;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  minStock: number | null;
  photoUrl: string | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
}

export interface ProductCreateInput {
  name: string;
  description?: string;
  barcode?: string;
  internalCode?: string;
  categoryId?: string;
  brand?: string;
  unit?: string;
  costPrice?: number;
  salePrice?: number;
  markupPercent?: number;
  ncm?: string;
  cfop?: string;
  cst?: string;
  origin?: string;
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
  photoUrl?: string;
  photos?: string[];
  technicalSheet?: string;
  minStock?: number;
  maxStock?: number;
  expiresAt?: string;
  locationName?: string;
  isActive?: boolean;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export interface ProductUpdateInput extends Partial<ProductCreateInput> {}

export interface ProductSearchParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  brand?: string;
  isActive?: string;
  belowMin?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

// ─── Stock Movement ─────────────────────────────────────────

export interface StockMovement {
  id: string;
  companyId: string;
  productId: string;
  type: StockMovementType;
  reason: StockMovementReason;
  quantity: number;
  costAtTime: number | null;
  referenceId: string | null;
  referenceType: string | null;
  stockAfter: number;
  reservedAfter: number | null;
  notes: string | null;
  userId: string;
  createdAt: string;
  product?: { id: string; name: string; barcode: string | null };
}

export interface StockMovementCreateInput {
  productId: string;
  type: "ENTRY" | "EXIT";
  reason: "MANUAL_ENTRY" | "MANUAL_EXIT" | "RETURN_CUSTOMER" | "RETURN_SUPPLIER";
  quantity: number;
  notes?: string;
}

export interface StockAdjustInput {
  productId: string;
  newStock: number;
  notes?: string;
}

// ─── Purchase Entry ─────────────────────────────────────────

export interface PurchaseEntry {
  id: string;
  companyId: string;
  entryNumber: number;
  supplierId: string;
  status: PurchaseEntryStatus;
  invoiceNumber: string | null;
  invoiceKey: string | null;
  invoiceUrl: string | null;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  totalItems: number;
  shippingCost: number;
  otherCosts: number;
  totalDiscount: number;
  totalCost: number;
  notes: string | null;
  customFields: Record<string, unknown>;
  createdBy: string | null;
  updatedBy: string | null;
  receivedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  supplier?: { id: string; name: string };
  items?: PurchaseEntryItem[];
}

export interface PurchaseEntryItem {
  id: string;
  companyId: string;
  purchaseEntryId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  discount: number;
  totalCost: number;
  quantityReceived: number | null;
  stockMovementId: string | null;
  product?: { id: string; name: string; barcode: string | null };
}

export interface PurchaseEntryCreateInput {
  supplierId: string;
  invoiceNumber?: string;
  invoiceKey?: string;
  orderedAt?: string;
  expectedAt?: string;
  shippingCost?: number;
  otherCosts?: number;
  totalDiscount?: number;
  notes?: string;
  items: PurchaseEntryItemInput[];
}

export interface PurchaseEntryItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
  discount?: number;
}

// ─── Stock Alert ────────────────────────────────────────────

export interface StockAlert {
  id: string;
  companyId: string;
  productId: string;
  type: StockAlertType;
  status: StockAlertStatus;
  currentValue: number;
  thresholdValue: number | null;
  message: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  product?: { id: string; name: string; photoUrl: string | null };
}

// ─── Stock Dashboard ────────────────────────────────────────

export interface StockDashboard {
  totalProducts: number;
  activeProducts: number;
  totalStockValue: number;
  totalCostValue: number;
  belowMinCount: number;
  outOfStockCount: number;
  pendingAlerts: number;
  movementsToday: number;
  pendingPurchases: number;
}
