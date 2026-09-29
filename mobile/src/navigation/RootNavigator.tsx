import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { AlarmsScreen } from '@/screens/AlarmsScreen';
import { TimersScreen } from '@/screens/TimersScreen';
import { TranslatorScreen } from '@/screens/TranslatorScreen';
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
            {/* Each tool enters from the side its toolbar button sits on:
                Translator and Timers from the left, Alarms from the right. */}
            <Stack.Screen name="Alarms" component={AlarmsScreen} />
            <Stack.Screen
              name="Timers"
              component={TimersScreen}
              options={{ animation: 'ios_from_left' }}
            />
            <Stack.Screen
              name="Translator"
              component={TranslatorScreen}
              options={{ animation: 'ios_from_left' }}
            />
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
