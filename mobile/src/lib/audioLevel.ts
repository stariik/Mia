import { makeMutable } from 'react-native-reanimated';

/**
 * Live microphone amplitude in 0..1, updated by `useAudioRecorder` while
 * recording is active. Read from any worklet (e.g. inside `useAnimatedStyle`)
 * for smooth, render-free reactivity.
 *
 * The recorder hook smooths raw dB into this value; consumers should treat
 * the value as already-debounced.
 */
export const audioLevel = makeMutable(0);
