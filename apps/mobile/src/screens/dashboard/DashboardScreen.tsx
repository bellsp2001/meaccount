import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { createMeAccountApi, KPIResponse } from '@/api/endpoints';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/utils/format';
import { COLORS, SPACING, RADIUS, FONT_SIZE } from '@/constants/theme';

const meApi = createMeAccountApi(api);

function KPICard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.kpiCard, { borderTopColor: color }]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);

  const { data: kpi, isLoading, refetch, isRefetching } = useQuery<KPIResponse>({
    queryKey: ['mobile-kpi'],
    queryFn: async () => (await meApi.dashboard.kpi()).data,
    refetchInterval: 60_000,
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.accent} />}
    >
      <View style={styles.welcomeBanner}>
        <Text style={styles.welcomeText}>สวัสดี, {user?.full_name?.split(' ')[0]} 👋</Text>
        <Text style={styles.welcomeDate}>
          {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
      </View>

      {isLoading || !kpi ? (
        <Text style={styles.loadingText}>กำลังโหลด...</Text>
      ) : (
        <View style={styles.grid}>
          <KPICard label="รายได้เดือนนี้" value={formatCurrency(kpi.revenue.amount, { compact: true })} color={COLORS.accent} />
          <KPICard label="ค่าใช้จ่าย" value={formatCurrency(kpi.expense.amount, { compact: true })} color={COLORS.purple} />
          <KPICard label="กำไรขั้นต้น" value={formatCurrency(kpi.gross_profit.amount, { compact: true })} color={kpi.gross_profit.amount >= 0 ? COLORS.green : COLORS.red} />
          <KPICard label="เงินสด/ธนาคาร" value={formatCurrency(kpi.cash_balance.amount, { compact: true })} color={COLORS.accentLight} />
          <KPICard label="ลูกหนี้ค้างชำระ" value={formatCurrency(kpi.ar_outstanding.amount, { compact: true })} color={COLORS.orange} />
          <KPICard label="เจ้าหนี้ค้างจ่าย" value={formatCurrency(kpi.ap_outstanding.amount, { compact: true })} color={COLORS.pink} />
        </View>
      )}

      {kpi && (kpi.pending_approvals > 0 || kpi.overdue_invoices > 0) && (
        <View style={styles.alertRow}>
          {kpi.pending_approvals > 0 && (
            <View style={styles.alertPill}>
              <Text style={styles.alertPillText}>📋 รออนุมัติ {kpi.pending_approvals} รายการ</Text>
            </View>
          )}
          {kpi.overdue_invoices > 0 && (
            <View style={[styles.alertPill, { backgroundColor: '#FF6B6B15', borderColor: '#FF6B6B40' }]}>
              <Text style={[styles.alertPillText, { color: COLORS.red }]}>⚠ เกินกำหนด {kpi.overdue_invoices} ฉบับ</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxxl },
  welcomeBanner: {
    backgroundColor: '#00D4AA12', borderWidth: 1, borderColor: '#00D4AA25', borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.lg,
  },
  welcomeText: { fontSize: FONT_SIZE.xl, fontWeight: '800', color: COLORS.text },
  welcomeDate: { fontSize: FONT_SIZE.sm, color: COLORS.textDim, marginTop: 4 },
  loadingText: { color: COLORS.textDim, textAlign: 'center', marginTop: SPACING.xxxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md, justifyContent: 'space-between' },
  kpiCard: {
    width: '48%', backgroundColor: COLORS.card, borderTopWidth: 3, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.md,
  },
  kpiLabel: { fontSize: FONT_SIZE.xs, color: COLORS.textDim, marginBottom: 6 },
  kpiValue: { fontSize: FONT_SIZE.lg, fontWeight: '800' },
  alertRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  alertPill: {
    backgroundColor: '#4FACFE15', borderWidth: 1, borderColor: '#4FACFE40',
    borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  alertPillText: { fontSize: FONT_SIZE.xs, fontWeight: '700', color: COLORS.accentLight },
});
