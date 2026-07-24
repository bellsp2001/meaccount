import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';
import api from '@/api/client';
import { createMeAccountApi } from '@/api/endpoints';
import { useAuthStore } from '@/store/authStore';
import { isValidEmail } from '@/utils/validation';
import { COLORS, SPACING, RADIUS, FONT_SIZE } from '@/constants/theme';

const meApi = createMeAccountApi(api);

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const emailValid = isValidEmail(email);
  const canSubmit = emailValid && password.length > 0;

  const loginMutation = useMutation({
    mutationFn: async () => {
      const { data } = await meApi.auth.login({ email, password });
      return data;
    },
    onSuccess: async (data) => {
      await setUser(data.user, data.access_token, data.refresh_token);
    },
  });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoBlock}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoLetter}>M</Text>
          </View>
          <Text style={styles.brand}>
            Me<Text style={styles.brandAccent}>Account</Text>
          </Text>
          <Text style={styles.tagline}>AI-Powered Accounting Platform</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>อีเมล</Text>
          <TextInput
            style={[styles.input, touched && !emailValid && styles.inputError]}
            placeholder="admin@company.com"
            placeholderTextColor={COLORS.textFaint}
            value={email}
            onChangeText={setEmail}
            onBlur={() => setTouched(true)}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />
          {touched && !emailValid && email.length > 0 && (
            <Text style={styles.errorText}>อีเมลไม่ถูกต้อง</Text>
          )}

          <Text style={[styles.label, { marginTop: SPACING.lg }]}>รหัสผ่าน</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={COLORS.textFaint}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {loginMutation.isError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorBoxText}>⚠ อีเมลหรือรหัสผ่านไม่ถูกต้อง</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit || loginMutation.isPending}
            onPress={() => loginMutation.mutate()}
          >
            {loginMutation.isPending ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.buttonText}>เข้าสู่ระบบ →</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>MeAccount Mobile v1.0.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: SPACING.xxl },
  logoBlock: { alignItems: 'center', marginBottom: SPACING.xxxl },
  logoIcon: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
  },
  logoLetter: { fontSize: 30, fontWeight: '900', color: COLORS.bg },
  brand: { fontSize: FONT_SIZE.xxl, fontWeight: '800', color: COLORS.text },
  brandAccent: { color: COLORS.accent },
  tagline: { fontSize: FONT_SIZE.xs, color: COLORS.textDim, marginTop: 4, letterSpacing: 1 },
  form: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.border },
  label: { fontSize: FONT_SIZE.xs, fontWeight: '700', color: COLORS.textMuted, marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#0A0E18', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, fontSize: FONT_SIZE.md, color: COLORS.text,
  },
  inputError: { borderColor: COLORS.red },
  errorText: { color: COLORS.red, fontSize: FONT_SIZE.xs, marginTop: 4 },
  errorBox: { backgroundColor: '#FF6B6B15', borderWidth: 1, borderColor: '#FF6B6B40', borderRadius: RADIUS.sm, padding: SPACING.md, marginTop: SPACING.lg },
  errorBoxText: { color: COLORS.red, fontSize: FONT_SIZE.sm },
  button: {
    backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: SPACING.md,
    alignItems: 'center', marginTop: SPACING.xl,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: COLORS.bg, fontWeight: '800', fontSize: FONT_SIZE.md },
  footer: { textAlign: 'center', color: COLORS.textFaint, fontSize: FONT_SIZE.xs, marginTop: SPACING.xxl },
});
