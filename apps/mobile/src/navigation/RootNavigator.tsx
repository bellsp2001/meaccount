import React, { useEffect } from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SecureStore from 'expo-secure-store';

import { useAuthStore } from '@/store/authStore';
import api from '@/api/client';
import { createMeAccountApi } from '@/api/endpoints';
import { COLORS } from '@/constants/theme';

import LoginScreen from '@/screens/auth/LoginScreen';
import DashboardScreen from '@/screens/dashboard/DashboardScreen';
import ApprovalScreen from '@/screens/ap/ApprovalScreen';
import ReceiptScanScreen from '@/screens/ap/ReceiptScanScreen';
import AIChatScreen from '@/screens/chat/AIChatScreen';

const meApi = createMeAccountApi(api);

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: COLORS.bg,
    card: COLORS.card,
    text: COLORS.text,
    border: COLORS.border,
    primary: COLORS.accent,
  },
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{label}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.bg },
        headerTintColor: COLORS.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: COLORS.card, borderTopColor: COLORS.border },
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textDim,
      }}
    >
      <Tab.Screen
        name="Dashboard" component={DashboardScreen}
        options={{ title: 'แดชบอร์ด', tabBarIcon: ({ focused }) => <TabIcon label="◈" focused={focused} /> }}
      />
      <Tab.Screen
        name="Approvals" component={ApprovalScreen}
        options={{ title: 'อนุมัติ', tabBarIcon: ({ focused }) => <TabIcon label="✓" focused={focused} /> }}
      />
      <Tab.Screen
        name="Scan" component={ReceiptScanScreen}
        options={{ title: 'สแกน', tabBarIcon: ({ focused }) => <TabIcon label="📷" focused={focused} /> }}
      />
      <Tab.Screen
        name="Chat" component={AIChatScreen}
        options={{ title: 'AI Chat', tabBarIcon: ({ focused }) => <TabIcon label="🤖" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isHydrating, setUser, setHydrating } = useAuthStore();

  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync('meaccount_access_token');
      if (!token) {
        setHydrating(false);
        return;
      }
      try {
        const { data } = await meApi.auth.me();
        const refresh = (await SecureStore.getItemAsync('meaccount_refresh_token')) || '';
        await setUser(data, token, refresh);
      } catch {
        setHydrating(false);
      }
    })();
  }, []);

  if (isHydrating) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
