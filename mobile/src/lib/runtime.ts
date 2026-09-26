import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * True inside the Expo Go app. Expo Go only ships Expo's own native modules,
 * so the app's other native libraries (Picovoice, Notifee, nitro-sound,
 * bootsplash, community geolocation, and our own Kotlin modules) are missing
 * there. Code that touches them checks this and falls back to an Expo module
 * or skips the feature, instead of crashing at import.
 */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
