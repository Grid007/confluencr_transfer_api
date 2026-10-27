CREATE TYPE "public"."transaction_type" AS ENUM('credit', 'debit');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"balance" numeric(19, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT date_trunc('milliseconds', now()) NOT NULL,
	CONSTRAINT "accounts_name_length" CHECK (char_length("accounts"."name") between 1 and 100),
	CONSTRAINT "accounts_balance_non_negative" CHECK ("accounts"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_account_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"amount" numeric(19, 2) NOT NULL,
	"description" text,
	"reference_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transfers_source_reference_uq" UNIQUE("source_account_id","reference_id"),
	CONSTRAINT "transfers_distinct_accounts" CHECK ("transfers"."source_account_id" <> "transfers"."destination_account_id"),
	CONSTRAINT "transfers_amount_positive" CHECK ("transfers"."amount" > 0),
	CONSTRAINT "transfers_reference_length" CHECK (char_length("transfers"."reference_id") between 1 and 128),
	CONSTRAINT "transfers_description_length" CHECK ("transfers"."description" is null or char_length("transfers"."description") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "transactions_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" numeric(19, 2) NOT NULL,
	"description" text,
	"reference_id" text NOT NULL,
	"balance_after" numeric(19, 2) NOT NULL,
	"transfer_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transactions_account_reference_uq" UNIQUE("account_id","reference_id"),
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0),
	CONSTRAINT "transactions_balance_after_non_negative" CHECK ("transactions"."balance_after" >= 0),
	CONSTRAINT "transactions_reference_length" CHECK (char_length("transactions"."reference_id") between 1 and 128),
	CONSTRAINT "transactions_description_length" CHECK ("transactions"."description" is null or char_length("transactions"."description") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_account_created_idx" ON "transactions" USING btree ("account_id","created_at" DESC,"seq" DESC);--> statement-breakpoint
CREATE INDEX "transactions_account_type_created_idx" ON "transactions" USING btree ("account_id","type","created_at" DESC,"seq" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_transfer_leg_uq" ON "transactions" USING btree ("transfer_id","type") WHERE "transactions"."transfer_id" is not null;