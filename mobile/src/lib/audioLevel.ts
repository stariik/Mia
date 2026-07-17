import { makeMutable } from 'react-native-reanimated';

/**
 * Live microphone amplitude in 0..1, updated by `usePcmRecorder` while
 * recording is active. Read from any worklet (e.g. inside `useAnimatedStyle`)
 * for smooth, render-free reactivity.
 */
export const audioLevel = makeMutable(0);
