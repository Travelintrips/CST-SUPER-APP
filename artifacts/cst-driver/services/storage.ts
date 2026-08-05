import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  AUTH_TOKEN: 'cst_driver_token',
  DRIVER: 'cst_driver_profile',
  JOBS: 'cst_driver_jobs',
};

export const storage = {
  async getToken(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.AUTH_TOKEN);
  },
  async setToken(token: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.AUTH_TOKEN, token);
  },
  async clearToken(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.AUTH_TOKEN);
  },
  async getJobs(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.JOBS);
  },
  async setJobs(jobs: unknown): Promise<void> {
    await AsyncStorage.setItem(KEYS.JOBS, JSON.stringify(jobs));
  },
  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  },
};
