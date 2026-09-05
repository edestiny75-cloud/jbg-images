-- CreateEnum
CREATE TYPE "batch_status" AS ENUM ('draft', 'planned', 'picking', 'packed', 'shipped');

-- CreateEnum
CREATE TYPE "order_kind" AS ENUM ('fba', 'wholesale', 'quick', 'pick');

-- CreateEnum
CREATE TYPE "resolve_status" AS ENUM ('asin', 'aliased', 'matched', 'needs_confirm', 'unmapped');

-- CreateEnum
CREATE TYPE "box_status" AS ENUM ('pending', 'picking', 'packed', 'shipped');

-- CreateEnum
CREATE TYPE "label_status" AS ENUM ('none', 'queued', 'printed');

-- CreateEnum
CREATE TYPE "print_job_status" AS ENUM ('queued', 'claimed', 'done', 'error');

-- CreateEnum
CREATE TYPE "print_job_type" AS ENUM ('fiery', 'fnsku');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'manager', 'packer');

-- CreateTable
CREATE TABLE "products" (
    "sku" TEXT NOT NULL,
    "title" TEXT,
    "line" TEXT,
    "size" TEXT,
    "thumb_url" TEXT,
    "pdf_path" TEXT,
    "pdf12x18_path" TEXT,
    "fnsku_path" TEXT,
    "fnsku_code" TEXT,
    "asin" TEXT,
    "sheets_per_unit" INTEGER,
    "meta" TEXT,
    "sort_order" INTEGER,

    CONSTRAINT "products_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "box_cap_oz" DOUBLE PRECISION NOT NULL,
    "box_stack_in" DOUBLE PRECISION,
    "weights" JSONB,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_aliases" (
    "list_sku" TEXT NOT NULL,
    "product_sku" TEXT,

    CONSTRAINT "sku_aliases_pkey" PRIMARY KEY ("list_sku")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "shipment_no" INTEGER,
    "name" TEXT,
    "source_filename" TEXT,
    "status" "batch_status" NOT NULL DEFAULT 'planned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "order_kind" NOT NULL DEFAULT 'fba',
    "needs_labels" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "asin" TEXT,
    "title" TEXT,
    "requested_qty" INTEGER NOT NULL,
    "list_sku" TEXT NOT NULL,
    "resolved_product_sku" TEXT,
    "size" TEXT,
    "resolve_status" "resolve_status",
    "notes" TEXT,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boxes" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "box_no" INTEGER NOT NULL,
    "size" TEXT NOT NULL,
    "weight_oz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit_count" INTEGER NOT NULL DEFAULT 0,
    "status" "box_status" NOT NULL DEFAULT 'pending',
    "carton" TEXT,
    "thick_in" DOUBLE PRECISION,

    CONSTRAINT "boxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "box_items" (
    "id" SERIAL NOT NULL,
    "box_id" INTEGER NOT NULL,
    "product_sku" TEXT NOT NULL,
    "asin" TEXT,
    "title" TEXT,
    "qty" INTEGER NOT NULL,
    "actual_qty" INTEGER NOT NULL,
    "picked" BOOLEAN NOT NULL DEFAULT false,
    "label_status" "label_status" NOT NULL DEFAULT 'none',
    "thumb_url" TEXT,
    "fnsku_path" TEXT,

    CONSTRAINT "box_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER,
    "product_sku" TEXT,
    "file_path" TEXT,
    "size" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "type" "print_job_type" DEFAULT 'fiery',
    "status" "print_job_status" NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error_message" TEXT,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "pin_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'packer',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("provider","provider_account_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("session_token")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "product_lines" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "panels" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "steps" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "product_sku" TEXT NOT NULL,
    "wholesale" DECIMAL(10,2),
    "cost" DECIMAL(10,2),
    "cost_bulk" DECIMAL(10,2),
    "msrp" DECIMAL(10,2),
    "map" DECIMAL(10,2),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("product_sku")
);

-- CreateTable
CREATE TABLE "product_overrides" (
    "product_sku" TEXT NOT NULL,
    "weight_oz" DOUBLE PRECISION,
    "ship_weight_oz" DOUBLE PRECISION,
    "size" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_overrides_pkey" PRIMARY KEY ("product_sku")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customer" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" SERIAL NOT NULL,
    "quote_id" TEXT NOT NULL,
    "product_sku" TEXT NOT NULL,
    "title" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_line_idx" ON "products"("line");

-- CreateIndex
CREATE INDEX "products_asin_idx" ON "products"("asin");

-- CreateIndex
CREATE INDEX "sku_aliases_product_sku_idx" ON "sku_aliases"("product_sku");

-- CreateIndex
CREATE INDEX "batches_created_at_idx" ON "batches"("created_at");

-- CreateIndex
CREATE INDEX "batches_status_idx" ON "batches"("status");

-- CreateIndex
CREATE INDEX "batch_items_batch_id_idx" ON "batch_items"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_items_batch_id_line_no_key" ON "batch_items"("batch_id", "line_no");

-- CreateIndex
CREATE INDEX "boxes_batch_id_status_idx" ON "boxes"("batch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "boxes_batch_id_box_no_key" ON "boxes"("batch_id", "box_no");

-- CreateIndex
CREATE INDEX "box_items_box_id_idx" ON "box_items"("box_id");

-- CreateIndex
CREATE INDEX "box_items_product_sku_idx" ON "box_items"("product_sku");

-- CreateIndex
CREATE INDEX "print_jobs_status_type_created_at_idx" ON "print_jobs"("status", "type", "created_at");

-- CreateIndex
CREATE INDEX "print_jobs_batch_id_idx" ON "print_jobs"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_name_key" ON "users"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_number_key" ON "quotes"("number");

-- CreateIndex
CREATE INDEX "quotes_created_at_idx" ON "quotes"("created_at");

-- CreateIndex
CREATE INDEX "quote_lines_quote_id_idx" ON "quote_lines"("quote_id");

-- AddForeignKey
ALTER TABLE "sku_aliases" ADD CONSTRAINT "sku_aliases_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "box_items" ADD CONSTRAINT "box_items_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "boxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_overrides" ADD CONSTRAINT "product_overrides_product_sku_fkey" FOREIGN KEY ("product_sku") REFERENCES "products"("sku") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
