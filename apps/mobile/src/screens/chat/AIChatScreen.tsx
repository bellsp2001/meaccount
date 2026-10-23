import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import api from '@/api/client';
import { createMeAccountApi, ChatV2Response } from '@/api/endpoints';
import { COLORS, SPACING, RADIUS, FONT_SIZE } from '@/constants/theme';

const meApi = createMeAccountApi(api);

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; source?: string }[];
}

const SUGGESTIONS = ['สรุปรายได้เดือนนี้', 'มีลูกหนี้เกินกำหนดกี่ราย?', 'VAT ต้องยื่นวันไหน?'];

export default function AIChatScreen() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'assistant', content: 'สวัสดีครับ! ผมคือมีบัญชี AI ถามอะไรก็ได้เกี่ยวกับบัญชีของคุณครับ' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || loading) return;
    setInput('');

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: message };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const { data } = await meApi.chat.sendMessage({ conversation_id: conversationId, message });
      setConversationId(data.conversation_id);
      const assistantMsg: Message = {
        id: data.message_id,
        role: 'assistant',
        content: data.content,
        sources: data.sources,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', content: '⚠️ ไม่สามารถเชื่อมต่อ AI ได้ ลองใหม่อีกครั้ง' },
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={[styles.bubbleRow, item.role === 'user' && styles.bubbleRowUser]}>
            <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
              <Text style={styles.bubbleText}>{item.content}</Text>
              {item.sources && item.sources.length > 0 && (
                <View style={styles.sourcesBox}>
                  <Text style={styles.sourcesLabel}>📚 อ้างอิง</Text>
                  {item.sources.map((s, i) => (
                    <Text key={i} style={styles.sourceItem}>• {s.title}</Text>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}
      />

      {messages.length === 1 && (
        <View style={styles.suggestionsRow}>
          {SUGGESTIONS.map((s) => (
            <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => send(s)}>
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="ถามเกี่ยวกับบัญชีของคุณ..."
          placeholderTextColor={COLORS.textFaint}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send()}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => send()}
          disabled={!input.trim() || loading}
        >
          {loading ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Text style={styles.sendBtnText}>➤</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, gap: SPACING.md },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1 },
  bubbleUser: { backgroundColor: '#00D4AA18', borderColor: '#00D4AA30', alignSelf: 'flex-end' },
  bubbleAssistant: { backgroundColor: COLORS.card, borderColor: COLORS.borderLight, alignSelf: 'flex-start' },
  bubbleText: { color: COLORS.text, fontSize: FONT_SIZE.sm, lineHeight: 20 },
  sourcesBox: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: '#1A2230' },
  sourcesLabel: { color: COLORS.accent, fontSize: FONT_SIZE.xs, fontWeight: '700', marginBottom: 4 },
  sourceItem: { color: '#5A7A90', fontSize: FONT_SIZE.xs },
  suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  suggestionChip: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.borderLight, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  suggestionText: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs },
  inputRow: {
    flexDirection: 'row', gap: SPACING.sm, padding: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border,
    backgroundColor: COLORS.card, alignItems: 'center',
  },
  input: { flex: 1, color: COLORS.text, fontSize: FONT_SIZE.sm, paddingVertical: SPACING.sm },
  sendBtn: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: COLORS.border },
  sendBtnText: { color: COLORS.bg, fontSize: FONT_SIZE.lg },
});
