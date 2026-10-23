import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string) || 'http://localhost:8000';

const TOKEN_KEY = 'meaccount_access_token';
const REFRESH_KEY = 'meaccount_refresh_token';

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function setTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export function createApiClient(baseURL: string = API_URL): AxiosInstance {
  const client = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config;
      if (error.response?.status === 401 && !original._retry) {
        original._retry = true;
        const refresh = await getRefreshToken();
        if (refresh) {
          try {
            const { data } = await axios.post(`${baseURL}/api/v1/auth/refresh`, {
              refresh_token: refresh,
            });
            await setTokens(data.access_token, data.refresh_token);
            original.headers.Authorization = `Bearer ${data.access_token}`;
            return client(original);
          } catch {
            await clearTokens();
          }
        }
      }
      return Promise.reject(error);
    }
  );

  return client;
}

const api = createApiClient();
export default api;
