import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import { useMe } from '@/hooks/useAuth'
import { Spinner } from '@/components/ui/Spinner'
import { AppLayout } from '@/components/layout/AppLayout'
import LoginPage from '@/pages/auth/LoginPage'
import DashboardPage from '@/pages/dashboard/DashboardPage'
import AIChatPage from '@/pages/dashboard/AIChatPage'
import UsersPage from '@/pages/users/UsersPage'
import ChartOfAccountsPage from '@/pages/gl/ChartOfAccountsPage'
import JournalPage from '@/pages/gl/JournalPage'
import TaxTypesPage from '@/pages/gl/TaxTypesPage'
import DocumentBooksPage from '@/pages/books/DocumentBooksPage'
import ContactsPage from '@/pages/contacts/ContactsPage'
import ContactGroupsPage from '@/pages/contacts/ContactGroupsPage'
import InvoicePage from '@/pages/ar/InvoicePage'
import TradeDocPage from '@/pages/trade/TradeDocPage'
import PurchaseTaxInvoicesPage from '@/pages/ap/PurchaseTaxInvoicesPage'
import PaymentVouchersPage from '@/pages/ap/PaymentVouchersPage'
import ExpenseReportPage from '@/pages/ap/ExpenseReportPage'
import { TrialBalancePage, GeneralLedgerPage } from '@/pages/reports/LedgerReportPage'
import TaxInvoicesPage from '@/pages/ar/TaxInvoicesPage'
import ReceiptsPage from '@/pages/ar/ReceiptsPage'
import SalesReportPage from '@/pages/ar/SalesReportPage'
import BillPage from '@/pages/ap/BillPage'
import ProductsPage from '@/pages/inventory/ProductsPage'
import StockMovementsPage from '@/pages/inventory/StockMovementsPage'
import EmployeesPage from '@/pages/payroll/EmployeesPage'
import PayrollRunPage from '@/pages/payroll/PayrollRunPage'
import VATReturnPage from '@/pages/tax/VATReturnPage'
import WHTCertificatesPage from '@/pages/tax/WHTCertificatesPage'
import FinancialStatementsPage from '@/pages/reports/FinancialStatementsPage'
import AuditDashboardPage from '@/pages/audit/AuditDashboardPage'
import CompaniesPage from '@/pages/company/CompaniesPage'
import ConsolidatedPage from '@/pages/company/ConsolidatedPage'
import POSTerminalPage from '@/pages/pos/POSTerminalPage'
import MyLeavePage from '@/pages/leave/MyLeavePage'
import LeaveApprovalsPage from '@/pages/leave/LeaveApprovalsPage'
import TeamCalendarPage from '@/pages/leave/TeamCalendarPage'
import DocTemplateEditorPage from '@/pages/doctemplate/DocTemplateEditorPage'
import ReportBuilderPage from '@/pages/reports/ReportBuilderPage'
import NLReportPage from '@/pages/reports/NLReportPage'
import AgingReportPage from '@/pages/ar/AgingReportPage'
import RiskDashboardPage from '@/pages/fraud/RiskDashboardPage'
import PredictiveAnalyticsPage from '@/pages/analytics/PredictiveAnalyticsPage'
import DocumentCenterPage from '@/pages/documents/DocumentCenterPage'
import ThreeWayMatchPage from '@/pages/documents/ThreeWayMatchPage'
import APIKeysPage from '@/pages/developer/APIKeysPage'
import IntegrationsPage from '@/pages/developer/IntegrationsPage'
import PromptProfilesPage from '@/pages/ai-ops/PromptProfilesPage'
import ABTestingPage from '@/pages/ai-ops/ABTestingPage'
import ComplianceDashboardPage from '@/pages/security/ComplianceDashboardPage'
import DataRequestsPage from '@/pages/security/DataRequestsPage'
import GoLiveReadinessPage from '@/pages/ops/GoLiveReadinessPage'
import type { UserRole } from '@/types'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  const { isLoading } = useMe()
  if (isLoading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <Spinner size={32} />
    </div>
  )
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RoleGuard({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user || !roles.includes(user.role as UserRole)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function Soon({ name }: { name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 16 }}>
      <span style={{ fontSize: 48 }}>🚧</span>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{name}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-muted)' }}>โมดูลนี้จะพร้อมใช้งานใน Sprint ถัดไป</p>
    </div>
  )
}

const ACC: UserRole[] = ['admin', 'accountant']
const AR_ROLES: UserRole[] = ['admin', 'accountant', 'cashier']
const INV_ROLES: UserRole[] = ['admin', 'inventory', 'accountant']
const REPORT_ROLES: UserRole[] = ['admin', 'accountant', 'manager', 'auditor']

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route path="/dashboard"        element={<DashboardPage />} />
          <Route path="/ai-chat"          element={<AIChatPage />} />
          <Route path="/users"            element={<RoleGuard roles={['admin']}><UsersPage /></RoleGuard>} />
          {/* GL */}
          <Route path="/gl"               element={<RoleGuard roles={ACC}><ChartOfAccountsPage /></RoleGuard>} />
          <Route path="/gl/journal"       element={<RoleGuard roles={ACC}><JournalPage /></RoleGuard>} />
          <Route path="/gl/tax-types"     element={<RoleGuard roles={ACC}><TaxTypesPage /></RoleGuard>} />
          {/* AR */}
          <Route path="/ar"               element={<RoleGuard roles={AR_ROLES}><InvoicePage /></RoleGuard>} />
          {/* key per route: the same page component serves several document types */}
          <Route path="/ar/quotations"    element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="s-qt" side="sales" docType="quotation" /></RoleGuard>} />
          <Route path="/ar/orders"        element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="s-so" side="sales" docType="sales_order" /></RoleGuard>} />
          <Route path="/ar/deposits"      element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="s-dep" side="sales" docType="deposit" /></RoleGuard>} />
          <Route path="/ar/credit-notes"  element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="s-cn" side="sales" docType="credit_note" /></RoleGuard>} />
          <Route path="/ar/debit-notes"   element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="s-dn" side="sales" docType="debit_note" /></RoleGuard>} />
          <Route path="/ar/tax-invoices"  element={<RoleGuard roles={AR_ROLES}><TaxInvoicesPage /></RoleGuard>} />
          <Route path="/ar/receipts"      element={<RoleGuard roles={AR_ROLES}><ReceiptsPage /></RoleGuard>} />
          {/* Contacts — customers and suppliers are roles of one contact; the old list paths redirect */}
          <Route path="/contacts"           element={<RoleGuard roles={AR_ROLES}><ContactsPage key="all" /></RoleGuard>} />
          <Route path="/contacts/customers" element={<RoleGuard roles={AR_ROLES}><ContactsPage key="customer" role="customer" /></RoleGuard>} />
          <Route path="/contacts/suppliers" element={<RoleGuard roles={AR_ROLES}><ContactsPage key="supplier" role="supplier" /></RoleGuard>} />
          <Route path="/contacts/groups"    element={<RoleGuard roles={AR_ROLES}><ContactGroupsPage /></RoleGuard>} />
          <Route path="/ar/customers" element={<Navigate to="/contacts/customers" replace />} />
          <Route path="/ap/suppliers" element={<Navigate to="/contacts/suppliers" replace />} />
          <Route path="/ar/books"         element={<RoleGuard roles={ACC}><DocumentBooksPage key="income" side="income" /></RoleGuard>} />
          {/* AP */}
          <Route path="/ap"               element={<RoleGuard roles={AR_ROLES}><BillPage /></RoleGuard>} />
          <Route path="/ap/rfq"           element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="p-rfq" side="purchase" docType="rfq" /></RoleGuard>} />
          <Route path="/ap/orders"        element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="p-po" side="purchase" docType="purchase_order" /></RoleGuard>} />
          <Route path="/ap/deposits"      element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="p-dep" side="purchase" docType="deposit" /></RoleGuard>} />
          <Route path="/ap/credit-notes"  element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="p-cn" side="purchase" docType="credit_note" /></RoleGuard>} />
          <Route path="/ap/debit-notes"   element={<RoleGuard roles={AR_ROLES}><TradeDocPage key="p-dn" side="purchase" docType="debit_note" /></RoleGuard>} />
          <Route path="/ap/tax-invoices"  element={<RoleGuard roles={AR_ROLES}><PurchaseTaxInvoicesPage /></RoleGuard>} />
          <Route path="/ap/payments"      element={<RoleGuard roles={AR_ROLES}><PaymentVouchersPage /></RoleGuard>} />
          <Route path="/ap/books"         element={<RoleGuard roles={ACC}><DocumentBooksPage key="expense" side="expense" /></RoleGuard>} />
          {/* Inventory — W13-14 */}
          <Route path="/inventory"           element={<RoleGuard roles={INV_ROLES}><ProductsPage /></RoleGuard>} />
          <Route path="/inventory/movements" element={<RoleGuard roles={INV_ROLES}><StockMovementsPage /></RoleGuard>} />
          {/* Phase 2 remaining */}
          <Route path="/payroll"           element={<RoleGuard roles={ACC}><PayrollRunPage /></RoleGuard>} />
          <Route path="/payroll/employees" element={<RoleGuard roles={ACC}><EmployeesPage /></RoleGuard>} />
          <Route path="/tax"      element={<RoleGuard roles={ACC}><VATReturnPage /></RoleGuard>} />
          <Route path="/tax/wht"  element={<RoleGuard roles={ACC}><WHTCertificatesPage /></RoleGuard>} />
          <Route path="/reports"  element={<RoleGuard roles={['admin','accountant','manager','auditor']}><FinancialStatementsPage /></RoleGuard>} />
          <Route path="/audit"    element={<RoleGuard roles={['admin','manager','auditor']}><AuditDashboardPage /></RoleGuard>} />
          <Route path="/fraud"    element={<RoleGuard roles={['admin','manager','auditor']}><RiskDashboardPage /></RoleGuard>} />
          <Route path="/analytics" element={<RoleGuard roles={['admin','accountant','manager']}><PredictiveAnalyticsPage /></RoleGuard>} />
          {/* Reports — sales/expense reports live under /reports; the old AR paths redirect */}
          <Route path="/reports/trial-balance" element={<RoleGuard roles={REPORT_ROLES}><TrialBalancePage /></RoleGuard>} />
          <Route path="/reports/ledger"        element={<RoleGuard roles={REPORT_ROLES}><GeneralLedgerPage /></RoleGuard>} />
          <Route path="/reports/sales"         element={<RoleGuard roles={AR_ROLES}><SalesReportPage /></RoleGuard>} />
          <Route path="/reports/ar-aging"      element={<RoleGuard roles={AR_ROLES}><AgingReportPage key="ar" side="receivable" /></RoleGuard>} />
          <Route path="/reports/expenses"      element={<RoleGuard roles={AR_ROLES}><ExpenseReportPage /></RoleGuard>} />
          <Route path="/reports/ap-aging"      element={<RoleGuard roles={AR_ROLES}><AgingReportPage key="ap" side="payable" /></RoleGuard>} />
          <Route path="/ar/reports" element={<Navigate to="/reports/sales" replace />} />
          <Route path="/ar/aging"   element={<Navigate to="/reports/ar-aging" replace />} />
          <Route path="/documents"       element={<RoleGuard roles={AR_ROLES}><DocumentCenterPage /></RoleGuard>} />
          <Route path="/documents/match" element={<RoleGuard roles={AR_ROLES}><ThreeWayMatchPage /></RoleGuard>} />
          <Route path="/developer/keys"         element={<RoleGuard roles={['admin']}><APIKeysPage /></RoleGuard>} />
          <Route path="/developer/integrations" element={<RoleGuard roles={ACC}><IntegrationsPage /></RoleGuard>} />
          <Route path="/ai-ops/profiles"   element={<RoleGuard roles={['admin']}><PromptProfilesPage /></RoleGuard>} />
          <Route path="/ai-ops/ab-testing" element={<RoleGuard roles={ACC}><ABTestingPage /></RoleGuard>} />
          <Route path="/security/compliance" element={<RoleGuard roles={['admin']}><ComplianceDashboardPage /></RoleGuard>} />
          <Route path="/security/dsr"        element={<RoleGuard roles={['admin']}><DataRequestsPage /></RoleGuard>} />
          <Route path="/ops/readiness"       element={<RoleGuard roles={['admin']}><GoLiveReadinessPage /></RoleGuard>} />
          <Route path="/companies"             element={<RoleGuard roles={['admin']}><CompaniesPage /></RoleGuard>} />
          <Route path="/companies/consolidated" element={<RoleGuard roles={ACC}><ConsolidatedPage /></RoleGuard>} />
          <Route path="/pos" element={<RoleGuard roles={['admin','cashier','accountant']}><POSTerminalPage /></RoleGuard>} />
          <Route path="/leave/my"         element={<MyLeavePage />} />
          <Route path="/leave/approvals" element={<RoleGuard roles={['admin','manager']}><LeaveApprovalsPage /></RoleGuard>} />
          <Route path="/leave/calendar"  element={<TeamCalendarPage />} />
          <Route path="/doc-templates" element={<RoleGuard roles={['admin']}><DocTemplateEditorPage /></RoleGuard>} />
          <Route path="/reports/builder" element={<RoleGuard roles={['admin','accountant','manager','auditor']}><ReportBuilderPage /></RoleGuard>} />
          <Route path="/reports/ask"     element={<RoleGuard roles={['admin','accountant','manager']}><NLReportPage /></RoleGuard>} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
