-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "settings" JSONB DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_url" TEXT,
    "role_id" TEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "preferences" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN DEFAULT false,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "granted" BOOLEAN DEFAULT true,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN DEFAULT false,
    "options" JSONB,
    "default_value" TEXT,
    "order" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_labels" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "custom_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_statuses" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#6B7280',
    "icon" TEXT,
    "order" INTEGER DEFAULT 0,
    "is_final" BOOLEAN DEFAULT false,
    "is_default" BOOLEAN DEFAULT false,
    "transitions" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_templates" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "html_template" TEXT NOT NULL,
    "css_override" TEXT,
    "is_default" BOOLEAN DEFAULT false,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" TEXT DEFAULT 'string',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_registry" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "version" TEXT DEFAULT '1.0.0',
    "is_active" BOOLEAN DEFAULT true,
    "order" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_modules" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "company_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "widget_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB DEFAULT '{}',
    "position" JSONB DEFAULT '{}',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "permissions" JSONB DEFAULT '[]',
    "rate_limit" INTEGER DEFAULT 100,
    "is_active" BOOLEAN DEFAULT true,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" JSONB DEFAULT '[]',
    "secret" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "last_triggered_at" TIMESTAMPTZ(6),
    "fail_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "person_type" TEXT NOT NULL DEFAULT 'FISICA',
    "customer_type" TEXT NOT NULL DEFAULT 'CLIENTE',
    "document_number" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "address_street" TEXT,
    "address_number" TEXT,
    "address_complement" TEXT,
    "address_neighborhood" TEXT,
    "address_city" TEXT,
    "address_state" TEXT,
    "address_zip" TEXT,
    "state_registration" TEXT,
    "city_registration" TEXT,
    "notes" TEXT,
    "custom_data" JSONB DEFAULT '{}',
    "total_os" INTEGER DEFAULT 0,
    "last_os_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "os_number" INTEGER NOT NULL,
    "customer_id" TEXT NOT NULL,
    "technician_id" TEXT,
    "status_id" TEXT NOT NULL,
    "priority" TEXT DEFAULT 'MEDIUM',
    "os_type" TEXT DEFAULT 'BALCAO',
    "os_location" TEXT,
    "equipment_type" TEXT NOT NULL,
    "equipment_brand" TEXT,
    "equipment_model" TEXT,
    "serial_number" TEXT,
    "reference" TEXT,
    "reported_issue" TEXT NOT NULL,
    "diagnosis" TEXT,
    "reception_notes" TEXT,
    "internal_notes" TEXT,
    "estimated_cost" INTEGER DEFAULT 0,
    "approved_cost" INTEGER DEFAULT 0,
    "total_parts" INTEGER DEFAULT 0,
    "total_services" INTEGER DEFAULT 0,
    "total_cost" INTEGER DEFAULT 0,
    "warranty_until" TIMESTAMPTZ(6),
    "is_warranty" BOOLEAN DEFAULT false,
    "warranty_os_id" TEXT,
    "estimated_delivery" TIMESTAMPTZ(6),
    "actual_delivery" TIMESTAMPTZ(6),
    "payment_method" TEXT,
    "custom_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_items" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL DEFAULT 'PECA',
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "total_price" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "service_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_history" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "from_status_id" TEXT,
    "to_status_id" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_order_photos" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT DEFAULT 'before',
    "uploaded_by" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "quote_number" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT DEFAULT 'DRAFT',
    "total_amount" INTEGER DEFAULT 0,
    "valid_until" TIMESTAMPTZ(6),
    "approval_token" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "quote_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER DEFAULT 0,
    "total_price" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "barcode" TEXT,
    "internal_code" TEXT,
    "category_id" TEXT,
    "brand" TEXT,
    "unit" TEXT DEFAULT 'UN',
    "cost_price" INTEGER DEFAULT 0,
    "sale_price" INTEGER DEFAULT 0,
    "ncm" TEXT,
    "cfop" TEXT,
    "cst" TEXT,
    "weight" DECIMAL,
    "photo_url" TEXT,
    "current_stock" INTEGER DEFAULT 0,
    "reserved_stock" INTEGER DEFAULT 0,
    "min_stock" INTEGER DEFAULT 0,
    "max_stock" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "custom_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "reorder_point" INTEGER,
    "supplier_id" TEXT,
    "location" TEXT,
    "last_purchase_date" DATE,
    "avg_cost" INTEGER DEFAULT 0,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reference_id" TEXT,
    "notes" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_entries" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "supplier_id" TEXT,
    "entry_number" INTEGER,
    "status" TEXT DEFAULT 'RECEBIDA',
    "invoice_ref" TEXT,
    "total_cost" INTEGER DEFAULT 0,
    "shipping_cost" INTEGER DEFAULT 0,
    "discount" INTEGER DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_entry_items" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "purchase_entry_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL DEFAULT 0,
    "total_cost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_entry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "status" TEXT DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" TEXT NOT NULL DEFAULT 'CHECKING',
    "bank_name" TEXT,
    "agency" TEXT,
    "account_number" TEXT,
    "initial_balance" INTEGER DEFAULT 0,
    "current_balance" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "provider_config" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_payable" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "supplier_id" TEXT,
    "category_id" TEXT,
    "cost_center_id" TEXT,
    "description" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "paid_amount" INTEGER DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" TEXT DEFAULT 'PENDENTE',
    "payment_method" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts_receivable" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "customer_id" TEXT,
    "service_order_id" TEXT,
    "category_id" TEXT,
    "description" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "received_amount" INTEGER DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" TEXT DEFAULT 'PENDENTE',
    "payment_method" TEXT,
    "boleto_url" TEXT,
    "pix_code" TEXT,
    "notes" TEXT,
    "installment_count" INTEGER DEFAULT 1,
    "card_fee_total" INTEGER DEFAULT 0,
    "net_amount" INTEGER,
    "anticipated_at" TIMESTAMPTZ(6),
    "anticipation_fee" INTEGER DEFAULT 0,
    "anticipated_amount" INTEGER,
    "group_id" TEXT,
    "grouped_into_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "parent_type" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_amount" INTEGER DEFAULT 0,
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "status" TEXT DEFAULT 'PENDENTE',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "bank_ref" TEXT,
    "reconciled" BOOLEAN DEFAULT false,
    "transaction_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_configs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "provider" TEXT DEFAULT 'focus_nfe',
    "api_key" TEXT,
    "environment" TEXT DEFAULT 'homologacao',
    "certificate_path" TEXT,
    "certificate_password" TEXT,
    "settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "vhsys_id" TEXT,
    "invoice_type" TEXT NOT NULL,
    "invoice_number" INTEGER,
    "series" TEXT DEFAULT '1',
    "access_key" TEXT,
    "customer_id" TEXT,
    "service_order_id" TEXT,
    "status" TEXT DEFAULT 'DRAFT',
    "provider_ref" TEXT,
    "provider_name" TEXT,
    "xml_url" TEXT,
    "danfe_url" TEXT,
    "total_amount" INTEGER DEFAULT 0,
    "tax_amount" INTEGER DEFAULT 0,
    "issued_at" TIMESTAMPTZ(6),
    "authorized_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "nfe_tipo" TEXT,
    "nfe_referenced_keys" JSONB DEFAULT '[]',
    "payment_method_nfe" TEXT DEFAULT '99',
    "payment_indicator" INTEGER DEFAULT 1,
    "cancelled_at" TIMESTAMPTZ(6),
    "source_chave" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT,
    "service_code" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "total_price" INTEGER NOT NULL DEFAULT 0,
    "ncm" TEXT,
    "cfop" TEXT,
    "cst" TEXT,
    "taxes" JSONB DEFAULT '{}',
    "unidade" TEXT DEFAULT 'UN',
    "codigo_produto_fiscal" TEXT,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_logs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "action" TEXT NOT NULL,
    "request" JSONB,
    "response" JSONB,
    "status_code" INTEGER,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT DEFAULT 'ABERTO',
    "priority" TEXT DEFAULT 'NORMAL',
    "category" TEXT,
    "source" TEXT DEFAULT 'INTERNO',
    "customer_id" TEXT,
    "service_order_id" TEXT,
    "assigned_to" TEXT,
    "created_by" TEXT,
    "created_by_type" TEXT DEFAULT 'FUNCIONARIO',
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sender_type" TEXT DEFAULT 'FUNCIONARIO',
    "sender_id" TEXT,
    "sender_name" TEXT,
    "is_internal" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_access" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email_verified" BOOLEAN DEFAULT false,
    "verify_token" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'geral',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" TEXT DEFAULT 'NORMAL',
    "created_by" TEXT,
    "author_name" TEXT,
    "pinned" BOOLEAN DEFAULT false,
    "require_read" BOOLEAN DEFAULT false,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfe_events" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT,
    "event_type" TEXT NOT NULL,
    "seq_number" INTEGER NOT NULL DEFAULT 1,
    "protocol" TEXT,
    "description" TEXT,
    "request_data" JSONB,
    "response_data" JSONB,
    "status" TEXT DEFAULT 'PROCESSING',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfe_recebidas" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "chave_nfe" TEXT NOT NULL,
    "numero" INTEGER,
    "serie" TEXT,
    "cnpj_emitente" TEXT,
    "nome_emitente" TEXT,
    "valor_total" INTEGER NOT NULL DEFAULT 0,
    "data_emissao" TIMESTAMPTZ(6),
    "situacao" TEXT DEFAULT 'pendente',
    "manifestacao" TEXT,
    "xml_data" JSONB,
    "items_data" JSONB,
    "imported" BOOLEAN DEFAULT false,
    "purchase_entry_id" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_recebidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfe_series" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "serie" TEXT NOT NULL DEFAULT '1',
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_routes" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "driver_id" TEXT,
    "date" DATE NOT NULL,
    "status" TEXT DEFAULT 'PLANNED',
    "total_stops" INTEGER DEFAULT 0,
    "completed_stops" INTEGER DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_stops" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "os_id" TEXT,
    "type" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT DEFAULT 'PENDING',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "address" TEXT NOT NULL,
    "address_complement" TEXT,
    "lat" DECIMAL(10,8),
    "lng" DECIMAL(11,8),
    "scheduled_window_start" TIME(6),
    "scheduled_window_end" TIME(6),
    "arrived_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "signature_url" TEXT,
    "photo_urls" JSONB DEFAULT '[]',
    "notes" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_logs" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "intent" TEXT,
    "confidence" DECIMAL(5,4),
    "message_in" TEXT,
    "message_out" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT DEFAULT 'bot',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatbot_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "avg_delivery_days" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "number" TEXT,
    "status" TEXT DEFAULT 'DRAFT',
    "nfe_key" TEXT,
    "total" INTEGER DEFAULT 0,
    "expected_delivery" DATE,
    "received_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "purchase_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "number" TEXT,
    "description" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "monthly_value" INTEGER DEFAULT 0,
    "billing_day" INTEGER DEFAULT 1,
    "visit_frequency" TEXT DEFAULT 'MONTHLY',
    "max_visits_per_period" INTEGER,
    "status" TEXT DEFAULT 'ACTIVE',
    "auto_renew" BOOLEAN DEFAULT false,
    "renewal_alert_days" INTEGER DEFAULT 30,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_equipment" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "contract_id" TEXT NOT NULL,
    "equipment_type" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serial_number" TEXT,
    "location" TEXT,
    "last_maintenance" DATE,
    "next_maintenance" DATE,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_visits" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "os_id" TEXT,
    "visit_date" DATE,
    "type" TEXT DEFAULT 'PREVENTIVE',
    "status" TEXT DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nps_surveys" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "service_order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nps_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_table" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "equipment_type" TEXT,
    "brand" TEXT,
    "model_pattern" TEXT,
    "service_description" TEXT,
    "default_price" INTEGER DEFAULT 0,
    "estimated_time_minutes" INTEGER,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_table_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "idx_user_profiles_company" ON "user_profiles"("company_id");

-- CreateIndex
CREATE INDEX "idx_user_profiles_email" ON "user_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_id_company_id_key" ON "user_profiles"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_name_key" ON "roles"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_module_action_key" ON "permissions"("module", "action");

-- CreateIndex
CREATE INDEX "idx_role_permissions_company" ON "role_permissions"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "idx_custom_fields_module" ON "custom_fields"("company_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_company_id_module_field_name_key" ON "custom_fields"("company_id", "module", "field_name");

-- CreateIndex
CREATE UNIQUE INDEX "field_labels_company_id_module_field_key_key" ON "field_labels"("company_id", "module", "field_key");

-- CreateIndex
CREATE UNIQUE INDEX "module_statuses_company_id_module_name_key" ON "module_statuses"("company_id", "module", "name");

-- CreateIndex
CREATE UNIQUE INDEX "settings_company_id_key_key" ON "settings"("company_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "module_registry_code_key" ON "module_registry"("code");

-- CreateIndex
CREATE UNIQUE INDEX "company_modules_company_id_module_id_key" ON "company_modules"("company_id", "module_id");

-- CreateIndex
CREATE INDEX "idx_audit_logs_company" ON "audit_logs"("company_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "idx_customers_company" ON "customers"("company_id");

-- CreateIndex
CREATE INDEX "idx_customers_document" ON "customers"("document_number");

-- CreateIndex
CREATE UNIQUE INDEX "customers_company_id_vhsys_id_key" ON "customers"("company_id", "vhsys_id");

-- CreateIndex
CREATE INDEX "idx_os_company" ON "service_orders"("company_id");

-- CreateIndex
CREATE INDEX "idx_os_customer" ON "service_orders"("customer_id");

-- CreateIndex
CREATE INDEX "idx_os_status" ON "service_orders"("status_id");

-- CreateIndex
CREATE INDEX "idx_os_technician" ON "service_orders"("technician_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_company_id_os_number_key" ON "service_orders"("company_id", "os_number");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_approval_token_key" ON "quotes"("approval_token");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_company_id_quote_number_key" ON "quotes"("company_id", "quote_number");

-- CreateIndex
CREATE INDEX "idx_products_barcode" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "idx_products_company" ON "products"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_configs_company_id_key" ON "fiscal_configs"("company_id");

-- CreateIndex
CREATE INDEX "idx_invoices_access_key" ON "invoices"("access_key");

-- CreateIndex
CREATE INDEX "idx_invoices_company" ON "invoices"("company_id");

-- CreateIndex
CREATE INDEX "idx_tickets_company" ON "tickets"("company_id");

-- CreateIndex
CREATE INDEX "idx_ticket_messages_ticket" ON "ticket_messages"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_access_company_id_customer_id_key" ON "customer_access"("company_id", "customer_id");

-- CreateIndex
CREATE INDEX "idx_chat_company_channel" ON "chat_messages"("company_id", "channel");

-- CreateIndex
CREATE INDEX "idx_announcements_company" ON "announcements"("company_id");

-- CreateIndex
CREATE INDEX "idx_announcement_reads_user" ON "announcement_reads"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_announcement_id_user_id_key" ON "announcement_reads"("announcement_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_nfe_events_company" ON "nfe_events"("company_id");

-- CreateIndex
CREATE INDEX "idx_nfe_events_invoice" ON "nfe_events"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_nfe_recebidas_company" ON "nfe_recebidas"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "nfe_recebidas_company_id_chave_nfe_key" ON "nfe_recebidas"("company_id", "chave_nfe");

-- CreateIndex
CREATE UNIQUE INDEX "nfe_series_company_id_serie_key" ON "nfe_series"("company_id", "serie");

-- CreateIndex
CREATE INDEX "idx_routes_date" ON "logistics_routes"("date");

-- CreateIndex
CREATE INDEX "idx_routes_driver" ON "logistics_routes"("driver_id");

-- CreateIndex
CREATE INDEX "idx_routes_company" ON "logistics_routes"("company_id");

-- CreateIndex
CREATE INDEX "idx_stops_route" ON "logistics_stops"("route_id");

-- CreateIndex
CREATE INDEX "idx_stops_os" ON "logistics_stops"("os_id");

-- CreateIndex
CREATE INDEX "idx_chatbot_logs_company_date" ON "chatbot_logs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_suppliers_company" ON "suppliers"("company_id");

-- CreateIndex
CREATE INDEX "idx_contracts_company" ON "contracts"("company_id");

-- CreateIndex
CREATE INDEX "idx_contracts_customer" ON "contracts"("customer_id");

-- CreateIndex
CREATE INDEX "idx_contracts_status" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "idx_contract_equip" ON "contract_equipment"("contract_id");

-- CreateIndex
CREATE INDEX "idx_contract_visits" ON "contract_visits"("contract_id");

-- CreateIndex
CREATE INDEX "idx_nps_surveys_company" ON "nps_surveys"("company_id");

-- CreateIndex
CREATE INDEX "idx_nps_surveys_os" ON "nps_surveys"("service_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "nps_surveys_service_order_id_customer_id_key" ON "nps_surveys"("service_order_id", "customer_id");

-- CreateIndex
CREATE INDEX "idx_price_table_company" ON "price_table"("company_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "field_labels" ADD CONSTRAINT "field_labels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "module_statuses" ADD CONSTRAINT "module_statuses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "module_registry"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_warranty_os_id_fkey" FOREIGN KEY ("warranty_os_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "module_statuses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "user_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_order_items" ADD CONSTRAINT "service_order_items_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_order_history" ADD CONSTRAINT "service_order_history_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "module_statuses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_order_history" ADD CONSTRAINT "service_order_history_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_order_history" ADD CONSTRAINT "service_order_history_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "module_statuses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "service_order_photos" ADD CONSTRAINT "service_order_photos_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_entries" ADD CONSTRAINT "purchase_entries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_entry_items" ADD CONSTRAINT "purchase_entry_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_entry_items" ADD CONSTRAINT "purchase_entry_items_purchase_entry_id_fkey" FOREIGN KEY ("purchase_entry_id") REFERENCES "purchase_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_centers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fiscal_configs" ADD CONSTRAINT "fiscal_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fiscal_logs" ADD CONSTRAINT "fiscal_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_access" ADD CONSTRAINT "customer_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "customer_access" ADD CONSTRAINT "customer_access_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "nfe_events" ADD CONSTRAINT "nfe_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "logistics_routes" ADD CONSTRAINT "logistics_routes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "user_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_stops" ADD CONSTRAINT "logistics_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "logistics_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbot_logs" ADD CONSTRAINT "chatbot_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contract_equipment" ADD CONSTRAINT "contract_equipment_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contract_visits" ADD CONSTRAINT "contract_visits_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_service_order_id_fkey" FOREIGN KEY ("service_order_id") REFERENCES "service_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "price_table" ADD CONSTRAINT "price_table_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

