import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/api/client';
import { createMeAccountApi } from '@/api/endpoints';
import { formatCurrency, formatThaiDate } from '@/utils/format';
import { COLORS, SPACING, RADIUS, FONT_SIZE } from '@/constants/theme';

const meApi = createMeAccountApi(api);

interface Bill {
  id: string;
  number: string;
  description: string;
  net_payable: number;
  due_date: string;
  supplier?: { name: string };
}

/**
 * One-tap approve/reject for Bills pending approval — designed for the "approve
 * on the go" use case described in the roadmap (approve purchase orders in 1 click).
 */
export default function ApprovalScreen() {
  const qc = useQueryClient();

  const { data: bills = [], isLoading } = useQuery<Bill[]>({
    queryKey: ['pending-bills'],
    queryFn: async () => (await meApi.ap.bills({ status: 'pending_approval' })).data,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approved' | 'rejected' }) =>
      meApi.ap.approveBill(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-bills'] }),
    onError: () => Alert.alert('ผิดพลาด', 'ไม่สามารถดำเนินการได้'),
  });

  function confirmAction(bill: Bill, action: 'approved' | 'rejected') {
    Alert.alert(
      action === 'approved' ? 'ยืนยันการอนุมัติ' : 'ยืนยันการปฏิเสธ',
      `${bill.number} — ${formatCurrency(bill.net_payable)}`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: action === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ',
          style: action === 'approved' ? 'default' : 'destructive',
          onPress: () => approveMutation.mutate({ id: bill.id, action }),
        },
      ]
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>รออนุมัติ</Text>
        <Text style={styles.subtitle}>{bills.length} รายการ</Text>
      </View>

      {bills.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>ไม่มีรายการรออนุมัติ</Text>
        </View>
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardNumber}>{item.number}</Text>
                <Text style={styles.cardAmount}>{formatCurrency(item.net_payable)}</Text>
              </View>
              <Text style={styles.cardDesc}>{item.description}</Text>
              <View style={styles.cardMeta}>
                <Text style={styles.cardMetaText}>{item.supplier?.name || '—'}</Text>
                <Text style={styles.cardMetaText}>ครบกำหนด {formatThaiDate(item.due_date)}</Text>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => confirmAction(item, 'rejected')}
                  disabled={approveMutation.isPending}
                >
                  <Text style={styles.rejectBtnText}>ปฏิเสธ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => confirmAction(item, 'approved')}
                  disabled={approveMutation.isPending}
                >
                  <Text style={styles.approveBtnText}>✓ อนุมัติ</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { fontSize: FONT_SIZE.xl, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: FONT_SIZE.sm, color: COLORS.textDim, marginTop: 2 },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: COLORS.textDim, fontSize: FONT_SIZE.md },
  list: { padding: SPACING.lg, gap: SPACING.md },
  card: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  cardNumber: { color: COLORS.accentLight, fontWeight: '700', fontSize: FONT_SIZE.sm },
  cardAmount: { color: COLORS.purple, fontWeight: '800', fontSize: FONT_SIZE.md },
  cardDesc: { color: COLORS.text, fontSize: FONT_SIZE.sm, marginBottom: SPACING.sm },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md },
  cardMetaText: { color: COLORS.textDim, fontSize: FONT_SIZE.xs },
  actionRow: { flexDirection: 'row', gap: SPACING.sm },
  actionBtn: { flex: 1, borderRadius: RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center', borderWidth: 1 },
  rejectBtn: { backgroundColor: '#FF6B6B12', borderColor: '#FF6B6B40' },
  rejectBtnText: { color: COLORS.red, fontWeight: '700', fontSize: FONT_SIZE.sm },
  approveBtn: { backgroundColor: '#43E97B15', borderColor: '#43E97B40' },
  approveBtnText: { color: COLORS.green, fontWeight: '700', fontSize: FONT_SIZE.sm },
});
