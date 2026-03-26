// ═══════════════ OS STATUS ═══════════════

export const OS_STATUS_LABELS: Record<string, string> = {
  ABERTA: 'Aberta',
  TRIAGEM: 'Triagem',
  ORCAMENTO: 'Orçamento',
  AGUARDANDO_APROVACAO: 'Aguardando Aprovação',
  EM_EXECUCAO: 'Em Execução',
  AGUARDANDO_PECA: 'Aguardando Peça',
  FINALIZADA: 'Finalizada',
  AGUARDANDO_RETIRADA: 'Aguardando Retirada',
  ENTREGUE: 'Entregue',
  FECHADA: 'Fechada',
  CANCELADA: 'Cancelada',
}

export const OS_STATUS_COLORS: Record<string, string> = {
  ABERTA: '#3B82F6',
  TRIAGEM: '#8B5CF6',
  ORCAMENTO: '#F59E0B',
  AGUARDANDO_APROVACAO: '#F97316',
  EM_EXECUCAO: '#10B981',
  AGUARDANDO_PECA: '#EF4444',
  FINALIZADA: '#06B6D4',
  AGUARDANDO_RETIRADA: '#14B8A6',
  ENTREGUE: '#6B7280',
  FECHADA: '#374151',
  CANCELADA: '#DC2626',
}

// ═══════════════ PRIORITIES ═══════════════

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: '#6B7280',
  MEDIUM: '#3B82F6',
  HIGH: '#F97316',
  URGENT: '#EF4444',
}

// ═══════════════ ROLES ═══════════════

export const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Acesso total ao sistema', isSystem: true },
  { name: 'Atendente', description: 'Balcão — OS, Clientes, Estoque (consulta)', isSystem: true },
  { name: 'Técnico', description: 'OS (diagnóstico/status), Estoque (consulta)', isSystem: true },
  { name: 'Motorista', description: 'Rota, Entregas, App mobile', isSystem: true },
  { name: 'Financeiro', description: 'Financeiro, NF, Relatórios', isSystem: true },
] as const

// ═══════════════ PERMISSIONS ═══════════════

export const MODULES = [
  { code: 'core', name: 'Sistema', icon: 'Settings' },
  { code: 'os', name: 'Ordens de Serviço', icon: 'Wrench' },
  { code: 'customers', name: 'Clientes', icon: 'Users' },
  { code: 'products', name: 'Produtos', icon: 'Package' },
  { code: 'stock', name: 'Estoque', icon: 'Warehouse' },
  { code: 'finance', name: 'Financeiro', icon: 'DollarSign' },
  { code: 'fiscal', name: 'Notas Fiscais', icon: 'FileText' },
  { code: 'reports', name: 'Relatórios', icon: 'BarChart3' },
] as const

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'print'] as const

// ═══════════════ FIELD TYPES ═══════════════

export const FIELD_TYPES = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Seleção' },
  { value: 'boolean', label: 'Sim/Não' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'file', label: 'Arquivo' },
] as const

// ═══════════════ STOCK ═══════════════

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  ADJUSTMENT: 'Ajuste',
  RESERVATION: 'Reserva',
  RELEASE: 'Liberação',
}

export const MOVEMENT_REASON_LABELS: Record<string, string> = {
  PURCHASE: 'Compra',
  SALE: 'Venda',
  OS: 'Ordem de Serviço',
  MANUAL: 'Manual',
  ADJUSTMENT: 'Ajuste de inventário',
  RETURN: 'Devolução',
}

// ═══════════════ FINANCIAL ═══════════════

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  CREDIT_CARD: 'Cartão de Crédito',
  DEBIT_CARD: 'Cartão de Débito',
  PIX: 'Pix',
  BOLETO: 'Boleto',
  TRANSFER: 'Transferência',
  CHECK: 'Cheque',
}

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  PARTIAL: 'Parcial',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
}

// ═══════════════ FISCAL ═══════════════

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  NFE: 'NF-e',
  NFCE: 'NFC-e',
  NFSE: 'NFS-e',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PROCESSING: 'Processando',
  AUTHORIZED: 'Autorizada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  CORRECTION: 'Com Correção',
}

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6B7280',
  PROCESSING: '#F59E0B',
  AUTHORIZED: '#10B981',
  REJECTED: '#EF4444',
  CANCELLED: '#374151',
  CORRECTION: '#8B5CF6',
}
