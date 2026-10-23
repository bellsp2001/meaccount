import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useMutation } from '@tanstack/react-query';
import api from '@/api/client';
import { createMeAccountApi } from '@/api/endpoints';
import { formatCurrency } from '@/utils/format';
import { COLORS, SPACING, RADIUS, FONT_SIZE } from '@/constants/theme';

const meApi = createMeAccountApi(api);

/**
 * Scans a receipt with the device camera (or picks from the gallery), uploads it to
 * the already-tested `/api/v1/ap/ai/ocr-receipt` endpoint, and shows the AI-extracted
 * fields for the user to confirm before creating a Bill.
 */
export default function ReceiptScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing] = useState<CameraType>('back');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const ocrMutation = useMutation({
    mutationFn: async (uri: string) => {
      const formData = new FormData();
      formData.append('file', {
        uri,
        name: 'receipt.jpg',
        type: 'image/jpeg',
      } as any);
      const { data } = await meApi.ap.ocrReceipt(formData);
      return data;
    },
    onError: () => {
      Alert.alert('ผิดพลาด', 'ไม่สามารถอ่านใบเสร็จได้ กรุณาลองใหม่');
    },
  });

  async function takePhoto() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
    if (photo) {
      setPhotoUri(photo.uri);
      setShowCamera(false);
      ocrMutation.mutate(photo.uri);
    }
  }

  async function pickFromGallery() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      ocrMutation.mutate(result.assets[0].uri);
    }
  }

  function reset() {
    setPhotoUri(null);
    ocrMutation.reset();
  }

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (showCamera) {
    if (!permission.granted) {
      return (
        <View style={styles.centerContent}>
          <Text style={styles.permissionText}>ต้องการสิทธิ์เข้าถึงกล้องเพื่อสแกนใบเสร็จ</Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>อนุญาตการใช้กล้อง</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
          <View style={styles.cameraOverlay}>
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>วางใบเสร็จให้อยู่ในกรอบ</Text>
          </View>
          <View style={styles.cameraControls}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCamera(false)}>
              <Text style={styles.cancelButtonText}>ยกเลิก</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureButton} onPress={takePhoto}>
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
            <View style={{ width: 70 }} />
          </View>
        </CameraView>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>📄 สแกนใบเสร็จ</Text>
      <Text style={styles.subtitle}>ถ่ายรูปหรือเลือกจากคลังภาพ ระบบ AI จะอ่านข้อมูลให้อัตโนมัติ</Text>

      {!photoUri && (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionCard} onPress={() => setShowCamera(true)}>
            <Text style={styles.actionIcon}>📷</Text>
            <Text style={styles.actionLabel}>ถ่ายรูป</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={pickFromGallery}>
            <Text style={styles.actionIcon}>🖼️</Text>
            <Text style={styles.actionLabel}>เลือกจากคลังภาพ</Text>
          </TouchableOpacity>
        </View>
      )}

      {photoUri && (
        <View style={styles.previewSection}>
          <Image source={{ uri: photoUri }} style={styles.previewImage} />

          {ocrMutation.isPending && (
            <View style={styles.processingRow}>
              <ActivityIndicator color={COLORS.accent} />
              <Text style={styles.processingText}>AI กำลังอ่านข้อมูล...</Text>
            </View>
          )}

          {ocrMutation.data && (
            <View style={styles.resultCard}>
              <Text style={styles.resultHeader}>
                ✓ อ่านสำเร็จ (ความมั่นใจ {Math.round((ocrMutation.data.confidence || 0) * 100)}%)
              </Text>
              {ocrMutation.data.supplier_name && (
                <ResultRow label="ผู้ขาย" value={ocrMutation.data.supplier_name} />
              )}
              {ocrMutation.data.date && <ResultRow label="วันที่" value={ocrMutation.data.date} />}
              {ocrMutation.data.total != null && (
                <ResultRow label="ยอดรวม" value={formatCurrency(ocrMutation.data.total)} highlight />
              )}
            </View>
          )}

          <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
            <Text style={styles.secondaryButtonText}>สแกนใหม่</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function ResultRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={[styles.resultValue, highlight && styles.resultValueHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg },
  centerContent: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  title: { fontSize: FONT_SIZE.xl, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: FONT_SIZE.sm, color: COLORS.textDim, marginBottom: SPACING.xl },
  actionRow: { flexDirection: 'row', gap: SPACING.md },
  actionCard: {
    flex: 1, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.lg, padding: SPACING.xl, alignItems: 'center', gap: SPACING.sm,
  },
  actionIcon: { fontSize: 32 },
  actionLabel: { fontSize: FONT_SIZE.sm, color: COLORS.textMuted, fontWeight: '600' },
  previewSection: { gap: SPACING.lg },
  previewImage: { width: '100%', height: 280, borderRadius: RADIUS.lg, backgroundColor: COLORS.card },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, justifyContent: 'center' },
  processingText: { color: COLORS.accent, fontSize: FONT_SIZE.sm },
  resultCard: { backgroundColor: '#00D4AA08', borderWidth: 1, borderColor: '#00D4AA25', borderRadius: RADIUS.lg, padding: SPACING.lg },
  resultHeader: { color: COLORS.accent, fontWeight: '700', fontSize: FONT_SIZE.sm, marginBottom: SPACING.md },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1A2A1A' },
  resultLabel: { color: COLORS.textDim, fontSize: FONT_SIZE.sm },
  resultValue: { color: COLORS.text, fontSize: FONT_SIZE.sm, fontWeight: '600' },
  resultValueHighlight: { color: COLORS.green, fontSize: FONT_SIZE.md, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', padding: SPACING.md },
  secondaryButtonText: { color: COLORS.accentLight, fontSize: FONT_SIZE.sm, fontWeight: '600' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: '85%', height: '55%', borderWidth: 2, borderColor: COLORS.accent, borderRadius: RADIUS.lg },
  scanHint: { color: '#fff', marginTop: SPACING.lg, fontSize: FONT_SIZE.sm, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full },
  cameraControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xxxl },
  cancelButton: { width: 70 },
  cancelButtonText: { color: '#fff', fontSize: FONT_SIZE.sm },
  captureButton: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  captureButtonInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  permissionText: { color: COLORS.textMuted, textAlign: 'center', marginBottom: SPACING.lg },
  button: { backgroundColor: COLORS.accent, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.md },
  buttonText: { color: COLORS.bg, fontWeight: '700' },
});
