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
import CustomersPage from '@/pages/ar/CustomersPage'
import InvoicePage from '@/pages/ar/InvoicePage'
import SalesDocPage from '@/pages/ar/SalesDocPage'
import TaxInvoicesPage from '@/pages/ar/TaxInvoicesPage'
import ReceiptsPage from '@/pages/ar/ReceiptsPage'
import SalesReportPage from '@/pages/ar/SalesReportPage'
import BillPage from '@/pages/ap/BillPage'
import SuppliersPage from '@/pages/ap/SuppliersPage'
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
          <Route path="/ar/quotations"    element={<RoleGuard roles={AR_ROLES}><SalesDocPage docType="quotation" /></RoleGuard>} />
          <Route path="/ar/orders"        element={<RoleGuard roles={AR_ROLES}><SalesDocPage docType="sales_order" /></RoleGuard>} />
          <Route path="/ar/deposits"      element={<RoleGuard roles={AR_ROLES}><SalesDocPage docType="deposit" /></RoleGuard>} />
          <Route path="/ar/tax-invoices"  element={<RoleGuard roles={AR_ROLES}><TaxInvoicesPage /></RoleGuard>} />
          <Route path="/ar/receipts"      element={<RoleGuard roles={AR_ROLES}><ReceiptsPage /></RoleGuard>} />
          <Route path="/ar/reports"       element={<RoleGuard roles={AR_ROLES}><SalesReportPage /></RoleGuard>} />
          <Route path="/ar/customers"     element={<RoleGuard roles={AR_ROLES}><CustomersPage /></RoleGuard>} />
          <Route path="/ar/books"         element={<RoleGuard roles={ACC}><DocumentBooksPage key="income" side="income" /></RoleGuard>} />
          {/* AP */}
          <Route path="/ap"               element={<RoleGuard roles={AR_ROLES}><BillPage /></RoleGuard>} />
          <Route path="/ap/suppliers"     element={<RoleGuard roles={AR_ROLES}><SuppliersPage /></RoleGuard>} />
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
          <Route path="/ar/aging"         element={<RoleGuard roles={AR_ROLES}><AgingReportPage /></RoleGuard>} />
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
