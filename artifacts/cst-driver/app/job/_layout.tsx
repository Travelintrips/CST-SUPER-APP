import { Stack } from 'expo-router';

export default function JobStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0F3460' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
        headerBackTitle: 'Kembali',
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Detail Job' }} />
      <Stack.Screen name="update" options={{ title: 'Update Status' }} />
      <Stack.Screen name="photos" options={{ title: 'Foto Bukti' }} />
      <Stack.Screen name="pod" options={{ title: 'Bukti Pengiriman' }} />
    </Stack>
  );
}
