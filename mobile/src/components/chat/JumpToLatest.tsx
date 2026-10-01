import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { IconButton } from '@/components/ui/IconButton';
import { colors, duration } from '@/theme';

/** Appears only when the user has scrolled up and something new arrived. */
export function JumpToLatest({
  onPress,
  bottom,
}: {
  onPress: () => void;
  bottom: number;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(duration.fast)}
      exiting={FadeOut.duration(duration.fast)}
      style={[styles.wrap, { bottom }]}
    >
      <IconButton
        icon="arrowDown"
        label="ბოლო შეტყობინებაზე გადასვლა"
        onPress={onPress}
        color={colors.text}
        size={18}
        style={styles.btn}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 16 },
  btn: {
    backgroundColor: colors.surfaceSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.strokeStrong,
  },
});
