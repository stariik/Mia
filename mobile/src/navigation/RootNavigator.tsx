import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { AlarmRingScreen } from '@/screens/AlarmRingScreen';
import { useAuthStore } from '@/stores/authStore';
import { colors } from '@/theme';

import { navigationRef, type RootStackParamList } from './navigationRef';

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bgDeep,
    card: colors.bgDeep,
    border: colors.stroke,
    primary: colors.primary,
    text: colors.text,
  },
};

export function RootNavigator({ onReady }: { onReady?: () => void }) {
  const { token, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) return null;

  return (
    <NavigationContainer theme={theme} ref={navigationRef} onReady={onReady}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // Screens slide in from the right while the one below drifts a
          // little left, and slide back out on close. The Android timing and
          // curve are tuned in android/app/src/main/res/anim; iOS uses its
          // native push.
          animation: 'ios_from_right',
        }}
      >
        {!token ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            {/* Settings slides in from the right, where its button sits.
                Timers, alarms and the translator have no screens: they are
                voice-only and live around the orb / in the chat area. */}
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen
              name="AlarmRing"
              component={AlarmRingScreen}
              options={{
                animation: 'fade',
                gestureEnabled: false,
                presentation: 'fullScreenModal',
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
