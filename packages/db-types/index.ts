export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          after_val: Json | null
          before_val: Json | null
          business_id: string | null
          id: number
          occurred_at: string
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          after_val?: Json | null
          before_val?: Json | null
          business_id?: string | null
          id?: never
          occurred_at?: string
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          after_val?: Json | null
          before_val?: Json | null
          business_id?: string | null
          id?: never
          occurred_at?: string
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: []
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          archived_at: string | null
          created_at: string
          gstin: string
          id: string
          legal_name: string
          number_format: string
          prefix: string | null
          trade_name: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          gstin: string
          id?: string
          legal_name: string
          number_format?: string
          prefix?: string | null
          trade_name?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          gstin?: string
          id?: string
          legal_name?: string
          number_format?: string
          prefix?: string | null
          trade_name?: string | null
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          business_id: string
          created_at: string
          gst_rate: number
          hsn_sac: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          stock_qty: number
          unit: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          gst_rate: number
          hsn_sac?: string | null
          id?: string
          is_active?: boolean
          name: string
          price: number
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          gst_rate?: number
          hsn_sac?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: Json | null
          business_id: string
          created_at: string
          gstin: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: Json | null
          business_id: string
          created_at?: string
          gstin?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: Json | null
          business_id?: string
          created_at?: string
          gstin?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          business_id: string
          fy: string
          last_number: number
          prefix_locked: string | null
          series_type: string
        }
        Insert: {
          business_id: string
          fy: string
          last_number?: number
          prefix_locked?: string | null
          series_type?: string
        }
        Update: {
          business_id?: string
          fy?: string
          last_number?: number
          prefix_locked?: string | null
          series_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          cgst_amount: number
          description: string
          discount_pct: number
          gst_rate: number
          hsn_sac: string | null
          id: string
          igst_amount: number
          invoice_id: string
          position: number
          quantity: number
          sgst_amount: number
          taxable_value: number
          unit_price_catalog: number | null
          unit_price_charged: number
        }
        Insert: {
          cgst_amount?: number
          description: string
          discount_pct?: number
          gst_rate: number
          hsn_sac?: string | null
          id?: string
          igst_amount?: number
          invoice_id: string
          position?: number
          quantity?: number
          sgst_amount?: number
          taxable_value?: number
          unit_price_catalog?: number | null
          unit_price_charged: number
        }
        Update: {
          cgst_amount?: number
          description?: string
          discount_pct?: number
          gst_rate?: number
          hsn_sac?: string | null
          id?: string
          igst_amount?: number
          invoice_id?: string
          position?: number
          quantity?: number
          sgst_amount?: number
          taxable_value?: number
          unit_price_catalog?: number | null
          unit_price_charged?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          credit_note_issued_at: string | null
          credit_note_of: string | null
          customer_address: Json | null
          customer_gstin: string | null
          customer_name: string | null
          fy: string
          id: string
          issued_at: string | null
          issued_by: string | null
          paid_amount: number
          payment_status: string
          registration_type: string | null
          reverse_charge: boolean
          round_off_amount: number
          seq: number | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_amount: number
          supply_type: string | null
          tax_amount: number
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          credit_note_issued_at?: string | null
          credit_note_of?: string | null
          customer_address?: Json | null
          customer_gstin?: string | null
          customer_name?: string | null
          fy: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          paid_amount?: number
          payment_status?: string
          registration_type?: string | null
          reverse_charge?: boolean
          round_off_amount?: number
          seq?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_amount?: number
          supply_type?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          credit_note_issued_at?: string | null
          credit_note_of?: string | null
          customer_address?: Json | null
          customer_gstin?: string | null
          customer_name?: string | null
          fy?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          paid_amount?: number
          payment_status?: string
          registration_type?: string | null
          reverse_charge?: boolean
          round_off_amount?: number
          seq?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_amount?: number
          supply_type?: string | null
          tax_amount?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: number
          success: boolean
          user_id: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: never
          success: boolean
          user_id?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: never
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "login_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          invoice_id: string
          method: string | null
          note: string | null
          operation_id: string | null
          recorded_by: string | null
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          id?: string
          invoice_id: string
          method?: string | null
          note?: string | null
          operation_id?: string | null
          recorded_by?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          method?: string | null
          note?: string | null
          operation_id?: string | null
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_scope_fk"
            columns: ["invoice_id", "business_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          locked_at: string | null
          must_change_password: boolean
          pending_transfer_to: string | null
          role: string
          transfer_initiated_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          locked_at?: string | null
          must_change_password?: boolean
          pending_transfer_to?: string | null
          role?: string
          transfer_initiated_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          locked_at?: string | null
          must_change_password?: boolean
          pending_transfer_to?: string | null
          role?: string
          transfer_initiated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_pending_transfer_to_fkey"
            columns: ["pending_transfer_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_code: {
        Row: {
          code_hash: string
          created_at: string
          id: number
          rotated_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: number
          rotated_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: number
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
        Args: never
        Returns: {
          created_at: string
          email: string
          invited_at: string
          user_id: string
        }[]
      }
      allocate_next_number: {
        Args: { p_business_id: string; p_fy: string; p_series: string }
        Returns: number
      }
      archive_business: { Args: { p_business_id: string }; Returns: undefined }
      can_access_business: { Args: { p_business_id: string }; Returns: boolean }
      clear_must_change_password: { Args: never; Returns: undefined }
      confirm_super_admin_transfer: { Args: never; Returns: undefined }
      count_consecutive_failures: { Args: { p_email: string }; Returns: number }
      create_business: {
        Args: {
          p_gstin: string
          p_legal_name: string
          p_number_format?: string
          p_prefix?: string
          p_trade_name?: string
        }
        Returns: string
      }
      current_user_role: { Args: never; Returns: string }
      deactivate_staff_account: {
        Args: { p_target: string }
        Returns: undefined
      }
      format_document_number: {
        Args: { p_business_id: string; p_fy: string; p_series: string }
        Returns: string
      }
      get_setup_code_digest: { Args: never; Returns: string }
      health_check: { Args: never; Returns: string }
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
        Args: { p_email: string; p_success: boolean; p_user_id: string }
        Returns: number
      }
      restore_business: { Args: { p_business_id: string }; Returns: undefined }
      rotate_setup_code_digest: {
        Args: { p_new_code: string }
        Returns: undefined
      }
      seed_setup_code_digest: { Args: { p_new_code: string }; Returns: boolean }
      set_locked_at: { Args: { p_user_id: string }; Returns: undefined }
      unlock_account_profile: { Args: { p_target: string }; Returns: undefined }
      write_audit: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_business_id: string
          p_target_id: string
          p_target_table: string
        }
        Returns: undefined
      }
    }
    Enums: {
      invoice_status: "draft" | "issued" | "voided"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invoice_status: ["draft", "issued", "voided"],
    },
  },
} as const
