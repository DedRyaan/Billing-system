/**
 * packages/db-types — Database type contract for the GST Billing System backend.
 *
 * ⚠ generated-pending-regen — STATICALLY AUTHORED from supabase/migrations
 * 0001–0011 (Plan 01-10). The canonical generator requires a linked live
 * project, which did not exist at authoring time (SUPABASE_ACCESS_TOKEN /
 * SUPABASE_PROJECT_ID absent; `supabase db push` [BLOCKING] gate pending).
 *
 * REGENERATE (replaces this file verbatim) after the first successful push:
 *
 *   supabase link --project-ref $SUPABASE_PROJECT_ID
 *   supabase gen types typescript --linked > packages/db-types/index.ts
 *
 * Fidelity notes vs real typegen output:
 * - Trigger-returning functions (returns trigger) are PostgREST-invisible and
 *   are omitted, matching current CLI behaviour.
 * - Version-specific blocks (__InternalSupabase.PostgrestVersion, Relationships)
 *   are omitted; they carry no consumer value and vary per CLI release.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          id: number
          occurred_at: string
          actor_id: string | null
          actor_type: string
          action: string
          target_table: string | null
          target_id: string | null
          business_id: string | null
          before_val: Json | null
          after_val: Json | null
        }
        Insert: {
          occurred_at?: string
          actor_id?: string | null
          actor_type?: string
          action: string
          target_table?: string | null
          target_id?: string | null
          business_id?: string | null
          before_val?: Json | null
          after_val?: Json | null
        }
        Update: {
          occurred_at?: string | null
          actor_id?: string | null
          actor_type?: string | null
          action?: string | null
          target_table?: string | null
          target_id?: string | null
          business_id?: string | null
          before_val?: Json | null
          after_val?: Json | null
        }
        Relationships: []
      }
      businesses: {
        Row: {
          id: string
          legal_name: string
          trade_name: string | null
          gstin: string
          number_format: string
          prefix: string | null
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          legal_name: string
          trade_name?: string | null
          gstin: string
          number_format?: string
          prefix?: string | null
          archived_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          legal_name?: string
          trade_name?: string | null
          gstin?: string
          number_format?: string
          prefix?: string | null
          archived_at?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      business_members: {
        Row: {
          business_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          business_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          business_id?: string
          user_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'business_members_business_id_fkey'
            columns: ['business_id']
            isOneToOne: false
            referencedRelation: 'businesses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'business_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      catalog_items: {
        Row: {
          id: string
          business_id: string
          name: string
          hsn_sac: string | null
          gst_rate: number
          unit: string
          price: number
          stock_qty: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          hsn_sac?: string | null
          gst_rate: number
          unit?: string
          price: number
          stock_qty?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          hsn_sac?: string | null
          gst_rate?: number
          unit?: string
          price?: number
          stock_qty?: number
          is_active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'catalog_items_business_id_fkey'
            columns: ['business_id']
            isOneToOne: false
            referencedRelation: 'businesses'
            referencedColumns: ['id']
          },
        ]
      }
      customers: {
        Row: {
          id: string
          business_id: string
          name: string
          state: string | null
          address: Json | null
          phone: string | null
          gstin: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          state?: string | null
          address?: Json | null
          phone?: string | null
          gstin?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          state?: string | null
          address?: Json | null
          phone?: string | null
          gstin?: string | null
          is_active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'customers_business_id_fkey'
            columns: ['business_id']
            isOneToOne: false
            referencedRelation: 'businesses'
            referencedColumns: ['id']
          },
        ]
      }
      invoice_counters: {
        Row: {
          business_id: string
          fy: string
          series_type: string
          last_number: number
          prefix_locked: string | null
        }
        Insert: {
          business_id: string
          fy: string
          series_type?: string
          last_number?: number
          prefix_locked?: string | null
        }
        Update: {
          business_id?: string
          fy?: string
          series_type?: string
          last_number?: number
          prefix_locked?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'invoice_counters_business_id_fkey'
            columns: ['business_id']
            isOneToOne: false
            referencedRelation: 'businesses'
            referencedColumns: ['id']
          },
        ]
      }
      invoice_lines: {
        Row: {
          id: string
          invoice_id: string
          position: number
          description: string
          hsn_sac: string | null
          quantity: number
          unit_price_catalog: number | null
          unit_price_charged: number
          discount_pct: number
          gst_rate: number
          taxable_value: number
          cgst_amount: number
          sgst_amount: number
          igst_amount: number
        }
        Insert: {
          id?: string
          invoice_id: string
          position?: number
          description: string
          hsn_sac?: string | null
          quantity?: number
          unit_price_catalog?: number | null
          unit_price_charged: number
          discount_pct?: number
          gst_rate: number
          taxable_value?: number
          cgst_amount?: number
          sgst_amount?: number
          igst_amount?: number
        }
        Update: {
          id?: string
          invoice_id?: string
          position?: number
          description?: string
          hsn_sac?: string | null
          quantity?: number
          unit_price_catalog?: number | null
          unit_price_charged?: number
          discount_pct?: number
          gst_rate?: number
          taxable_value?: number
          cgst_amount?: number
          sgst_amount?: number
          igst_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: 'invoice_lines_invoice_id_fkey'
            columns: ['invoice_id']
            isOneToOne: false
            referencedRelation: 'invoices'
            referencedColumns: ['id']
          },
        ]
      }
      invoices: {
        Row: {
          id: string
          business_id: string
          fy: string
          status: Database['public']['Enums']['invoice_status']
          seq: number | null
          issued_at: string | null
          issued_by: string | null
          voided_at: string | null
          voided_by: string | null
          void_reason: string | null
          customer_name: string | null
          customer_gstin: string | null
          customer_address: Json | null
          supply_type: string | null
          reverse_charge: boolean
          registration_type: string | null
          subtotal_amount: number
          tax_amount: number
          total_amount: number
          round_off_amount: number
          credit_note_of: string | null
          credit_note_issued_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          paid_amount: number
          payment_status: string
        }
        Insert: {
          id?: string
          business_id: string
          fy: string
          status?: Database['public']['Enums']['invoice_status']
          seq?: number | null
          issued_at?: string | null
          issued_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          customer_name?: string | null
          customer_gstin?: string | null
          customer_address?: Json | null
          supply_type?: string | null
          reverse_charge?: boolean
          registration_type?: string | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
          round_off_amount?: number
          credit_note_of?: string | null
          credit_note_issued_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          paid_amount?: number
          payment_status?: string
        }
        Update: {
          id?: string
          business_id?: string
          fy?: string
          status?: Database['public']['Enums']['invoice_status'] | null
          seq?: number | null
          issued_at?: string | null
          issued_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          void_reason?: string | null
          customer_name?: string | null
          customer_gstin?: string | null
          customer_address?: Json | null
          supply_type?: string | null
          reverse_charge?: boolean | null
          registration_type?: string | null
          subtotal_amount?: number
          tax_amount?: number
          total_amount?: number
          round_off_amount?: number
          credit_note_of?: string | null
          credit_note_issued_at?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          paid_amount?: number
          payment_status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'invoices_business_id_fkey'
            columns: ['business_id']
            isOneToOne: false
            referencedRelation: 'businesses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invoices_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invoices_issued_by_fkey'
            columns: ['issued_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invoices_voided_by_fkey'
            columns: ['voided_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      login_attempts: {
        Row: {
          id: number
          email: string
          user_id: string | null
          success: boolean
          attempted_at: string
        }
        Insert: {
          email: string
          user_id?: string | null
          success: boolean
          attempted_at?: string
        }
        Update: {
          email?: string
          user_id?: string | null
          success?: boolean
          attempted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'login_attempts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      payments: {
        Row: {
          id: string
          invoice_id: string
          business_id: string
          amount: number
          method: string | null
          note: string | null
          recorded_by: string | null
          operation_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          invoice_id: string
          business_id: string
          amount: number
          method?: string | null
          note?: string | null
          recorded_by?: string | null
          operation_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          invoice_id?: string
          business_id?: string
          amount?: number
          method?: string | null
          note?: string | null
          recorded_by?: string | null
          operation_id?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'payments_business_id_fkey'
            columns: ['business_id']
            isOneToOne: false
            referencedRelation: 'businesses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payments_invoice_scope_fk'
            columns: ['invoice_id', 'business_id']
            isOneToOne: false
            referencedRelation: 'invoices'
            referencedColumns: ['id', 'business_id']
          },
          {
            foreignKeyName: 'payments_recorded_by_fkey'
            columns: ['recorded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          role: string
          is_active: boolean
          must_change_password: boolean
          locked_at: string | null
          pending_transfer_to: string | null
          transfer_initiated_at: string | null
          created_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role?: string
          is_active?: boolean
          must_change_password?: boolean
          locked_at?: string | null
          pending_transfer_to?: string | null
          transfer_initiated_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: string | null
          is_active?: boolean | null
          must_change_password?: boolean | null
          locked_at?: string | null
          pending_transfer_to?: string | null
          transfer_initiated_at?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'pending_transfer_to_fkey'
            columns: ['pending_transfer_to']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      setup_code: {
        Row: {
          id: number
          code_hash: string
          created_at: string
          rotated_at: string | null
        }
        Insert: {
          id?: number
          code_hash: string
          created_at?: string
          rotated_at?: string | null
        }
        Update: {
          id?: number
          code_hash?: string
          created_at?: string | null
          rotated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_invites: {
        Args: Record<string, never>
        Returns: {
          user_id: string
          email: string
          invited_at: string
          created_at: string
        }[]
      }
      allocate_next_number: {
        Args: { p_business_id: string; p_fy: string; p_series: string }
        Returns: number
      }
      archive_business: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      can_access_business: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      clear_must_change_password: {
        Args: Record<string, never>
        Returns: undefined
      }
      confirm_super_admin_transfer: {
        Args: Record<string, never>
        Returns: undefined
      }
      count_consecutive_failures: {
        Args: { p_email: string }
        Returns: number
      }
      create_business: {
        Args: {
          p_legal_name: string
          p_gstin: string
          p_trade_name?: string | null
          p_number_format?: string
          p_prefix?: string | null
        }
        Returns: string
      }
      current_user_role: {
        Args: Record<string, never>
        Returns: string
      }
      deactivate_staff_account: {
        Args: { p_target: string }
        Returns: undefined
      }
      format_document_number: {
        Args: { p_business_id: string; p_fy: string; p_series: string }
        Returns: string
      }
      get_setup_code_digest: {
        Args: Record<string, never>
        Returns: string
      }
      health_check: {
        Args: Record<string, never>
        Returns: string
      }
      initiate_super_admin_transfer: {
        Args: { p_target: string }
        Returns: undefined
      }
      mark_must_change_password: {
        Args: { p_target: string }
        Returns: undefined
      }
      reactivate_staff_account: {
        Args: { p_target: string }
        Returns: undefined
      }
      record_login_attempt: {
        Args: { p_email: string; p_user_id: string | null; p_success: boolean }
        Returns: number
      }
      restore_business: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      rotate_setup_code_digest: {
        Args: { p_new_code: string }
        Returns: undefined
      }
      seed_setup_code_digest: {
        Args: { p_new_code: string }
        Returns: boolean
      }
      set_locked_at: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      unlock_account_profile: {
        Args: { p_target: string }
        Returns: undefined
      }
      write_audit: {
        Args: {
          p_action: string
          p_target_table: string | null
          p_target_id: string | null
          p_business_id: string | null
          p_before: Json | null
          p_after: Json | null
        }
        Returns: undefined
      }
    }
    Enums: {
      invoice_status: 'draft' | 'issued' | 'voided'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, 'public'>]

export type Tables<
  TableName extends keyof PublicSchema['Tables'],
  SchemaName extends keyof Database = Extract<keyof Database, 'public'>,
> = (SchemaName extends keyof Database ? Database[SchemaName] : never)['Tables'] extends {
  [key in TableName]: { Row: infer R }
}
  ? R
  : never

export type TablesInsert<
  TableName extends keyof PublicSchema['Tables'],
  SchemaName extends keyof Database = Extract<keyof Database, 'public'>,
> = (SchemaName extends keyof Database ? Database[SchemaName] : never)['Tables'] extends {
  [key in TableName]: { Insert: infer I }
}
  ? I
  : never

export type TablesUpdate<
  TableName extends keyof PublicSchema['Tables'],
  SchemaName extends keyof Database = Extract<keyof Database, 'public'>,
> = (SchemaName extends keyof Database ? Database[SchemaName] : never)['Tables'] extends {
  [key in TableName]: { Update: infer U }
}
  ? U
  : never

export type Enums<
  EnumName extends keyof PublicSchema['Enums'],
  SchemaName extends keyof Database = Extract<keyof Database, 'public'>,
> = (SchemaName extends keyof Database ? Database[SchemaName] : never)['Enums'] extends {
  [key in EnumName]: infer E
}
  ? E
  : never

export type Functions<
  FunctionName extends keyof PublicSchema['Functions'],
  SchemaName extends keyof Database = Extract<keyof Database, 'public'>,
> = (SchemaName extends keyof Database ? Database[SchemaName] : never)['Functions'] extends {
  [key in FunctionName]: { Args: infer A; Returns: infer R }
}
  ? { Args: A; Returns: R }
  : never
