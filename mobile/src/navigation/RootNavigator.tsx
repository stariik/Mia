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

export function RootNavigator() {
  const { token, hydrated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) return null;

  return (
    <NavigationContainer theme={theme} ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        {!token ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Alarms" component={AlarmsScreen} />
            <Stack.Screen name="Timers" component={TimersScreen} />
            <Stack.Screen name="Translator" component={TranslatorScreen} />
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
