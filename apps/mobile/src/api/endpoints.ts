/**
 * Typed wrappers over the MeAccount REST API. Every path here maps 1:1 to a route
 * that already exists and is covered by the backend's pytest suite (apps/api/tests/),
 * so the "contract" (path, method, request/response shape) is verified server-side.
 * This file just needs to call the right path with the right shape.
 */
import type { AxiosInstance } from 'axios';

// ── Types ─────────────────────────────────────────────────────
export interface LoginRequest { email: string; password: string }
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: UserProfile;
}
export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'accountant' | 'cashier' | 'inventory' | 'manager' | 'auditor';
  is_active: boolean;
}

export interface KPIResponse {
  revenue: { amount: number; change_pct?: number; period: string };
  expense: { amount: number; change_pct?: number; period: string };
  gross_profit: { amount: number; period: string };
  cash_balance: { amount: number };
  ar_outstanding: { amount: number; overdue: number };
  ap_outstanding: { amount: number; overdue: number };
  pending_approvals: number;
  overdue_invoices: number;
}

export interface ChatV2Request { conversation_id?: string | null; message: string }
export interface ChatV2Response {
  conversation_id: string;
  message_id: string;
  role: string;
  content: string;
  sources: { title: string; source?: string }[];
  sql_query?: string | null;
}


export interface OCRInvoiceResponse {
  customer_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number | null;
  items: { description: string; amount: number }[];
  confidence: number;
}

// ── API factory — takes the axios instance so it's easy to inject a mock in tests ──
export function createMeAccountApi(client: AxiosInstance) {
  return {
    auth: {
      login: (payload: LoginRequest) =>
        client.post<TokenResponse>('/api/v1/auth/login', payload),
      me: () => client.get<UserProfile>('/api/v1/auth/me'),
      logout: () => client.post('/api/v1/auth/logout'),
    },

    dashboard: {
      kpi: () => client.get<KPIResponse>('/api/v1/dashboard/kpi'),
      alerts: () => client.get('/api/v1/dashboard/alerts'),
    },

    chat: {
      sendMessage: (payload: ChatV2Request) =>
        client.post<ChatV2Response>('/api/v1/chat-v2/message', payload),
      conversations: () => client.get('/api/v1/chat-v2/conversations'),
    },

    ar: {
      invoices: (params?: { status?: string }) =>
        client.get('/api/v1/ar/invoices', { params }),
      customers: () => client.get('/api/v1/ar/customers'),
      ocrInvoice: (formData: FormData) =>
        client.post<OCRInvoiceResponse>('/api/v1/ar/ocr/invoice', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }),
      agingReport: () => client.get('/api/v1/ar/reports/aging'),
    },

    ap: {
      bills: (params?: { status?: string }) => client.get('/api/v1/ap/bills', { params }),
      suppliers: () => client.get('/api/v1/ap/suppliers'),
      approveBill: (billId: string, action: 'approved' | 'rejected', comment?: string) =>
        client.post(`/api/v1/ap/bills/${billId}/approve`, { action, comment }),
      ocrReceipt: (formData: FormData) =>
        client.post('/api/v1/ap/ai/ocr-receipt', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }),
    },

    inventory: {
      products: (params?: { low_stock_only?: boolean }) =>
        client.get('/api/v1/inventory/products', { params }),
      forecast: (productId: string) =>
        client.get(`/api/v1/inventory/ai/forecast/${productId}`),
    },
  };
}

export type MeAccountApi = ReturnType<typeof createMeAccountApi>;
