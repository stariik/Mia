import React from 'react';
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

// Wrappers translate React Navigation's prop shape to the screens' simpler
// `onBack` callback signature.
function AlarmsRoute({ navigation }: any) {
  return <AlarmsScreen onBack={() => navigation.goBack()} />;
}
function TimersRoute({ navigation }: any) {
  return <TimersScreen onBack={() => navigation.goBack()} />;
}
function TranslatorRoute({ navigation }: any) {
  return <TranslatorScreen onBack={() => navigation.goBack()} />;
}

export function RootNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <NavigationContainer theme={theme} ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Alarms" component={AlarmsRoute} />
            <Stack.Screen name="Timers" component={TimersRoute} />
            <Stack.Screen name="Translator" component={TranslatorRoute} />
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
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
