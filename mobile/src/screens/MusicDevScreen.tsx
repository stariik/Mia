import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Path } from 'react-native-svg';

import { music, type MusicProvider } from '@/lib/tools/music';
import { colors, radius, spacing, typography } from '@/theme';

type Props = { onBack: () => void };

type LogLine = { ts: number; text: string };

const PROVIDERS: { key: MusicProvider | 'any'; label: string }[] = [
  { key: 'any', label: 'Any (default)' },
  { key: 'spotify', label: 'Spotify' },
  { key: 'apple_music', label: 'Apple Music' },
  { key: 'samsung_music', label: 'Samsung Music' },
];

export function MusicDevScreen({ onBack }: Props) {
  const [query, setQuery] = useState('Imagine Dragons Believer');
  const [provider, setProvider] = useState<MusicProvider | 'any'>('spotify');
  const [log, setLog] = useState<LogLine[]>([]);

  const push = (text: string) => {
    setLog((prev) => [{ ts: Date.now(), text }, ...prev].slice(0, 30));
  };

  const wrap = (name: string, fn: () => Promise<unknown>) => async () => {
    push(`→ ${name}`);
    try {
      await fn();
      push(`✓ ${name}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      push(`✗ ${name}: ${msg}`);
    }
  };

  const doPlay = wrap(
    `play_music("${query.trim()}", ${provider})`,
    () =>
      music.playFromSearch(
        query.trim(),
        provider === 'any' ? undefined : provider,
      ),
  );

  const transport: { label: string; run: () => Promise<unknown> }[] = [
    { label: 'pause', run: () => music.pause() },
    { label: 'resume', run: () => music.resume() },
    { label: 'toggle', run: () => music.togglePlay() },
    { label: 'skip ▶▶', run: () => music.skipNext() },
    { label: '◀◀ prev', run: () => music.skipPrevious() },
    { label: 'restart', run: () => music.restart() },
    { label: 'stop', run: () => music.stop() },
  ];

  const checkInstalled = wrap('check installed', async () => {
    for (const p of ['spotify', 'apple_music', 'samsung_music'] as const) {
      const installed = await music.isProviderInstalled(p);
      push(`  ${p}: ${installed ? 'installed' : 'missing'}`);
    }
  });

  return (
    <LinearGradient
      colors={['#080818', '#000000']}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor="#080818" />

        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.iconBtn} hitSlop={8}>
            <Svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke={colors.text}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Path d="M19 12H5" />
              <Path d="M12 19l-7-7 7-7" />
            </Svg>
          </Pressable>
          <Text style={[typography.title, styles.title]}>Music dev</Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[typography.labelSm, styles.sectionLabel]}>
            play_music
          </Text>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="song or artist"
            placeholderTextColor={colors.outline}
            style={styles.input}
            cursorColor={colors.primary}
            selectionColor={colors.primaryGlow}
          />

          <View style={styles.providerRow}>
            {PROVIDERS.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => setProvider(p.key)}
                style={[
                  styles.providerChip,
                  provider === p.key && styles.providerChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.providerText,
                    provider === p.key && styles.providerTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={doPlay} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Play</Text>
          </Pressable>

          <Text style={[typography.labelSm, styles.sectionLabel]}>
            transport
          </Text>
          <View style={styles.grid}>
            {transport.map((t) => (
              <Pressable
                key={t.label}
                onPress={wrap(t.label, t.run)}
                style={styles.gridBtn}
              >
                <Text style={styles.gridText}>{t.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={checkInstalled} style={styles.gridBtn}>
              <Text style={styles.gridText}>check installed</Text>
            </Pressable>
          </View>

          <Text style={[typography.labelSm, styles.sectionLabel]}>log</Text>
          <View style={styles.logBox}>
            {log.length === 0 ? (
              <Text style={styles.logEmpty}>no calls yet</Text>
            ) : (
              log.map((l) => (
                <Text key={l.ts + l.text} style={styles.logLine}>
                  {l.text}
                </Text>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  sectionLabel: {
    color: colors.outline,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  input: {
    height: 48,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: radius.lg,
    color: colors.text,
    fontFamily: 'Manrope-Regular',
    fontSize: 15,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  providerChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  providerChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  providerText: {
    fontFamily: 'Manrope-SemiBold',
    fontSize: 13,
    color: colors.text,
  },
  providerTextActive: { color: colors.primaryOn },
  primaryBtn: {
    marginTop: spacing.md,
    height: 52,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryText: {
    fontFamily: 'Manrope-SemiBold',
    color: colors.primaryOn,
    fontSize: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridBtn: {
    flexBasis: '31%',
    flexGrow: 1,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  gridText: {
    fontFamily: 'Manrope-SemiBold',
    color: colors.text,
    fontSize: 14,
  },
  logBox: {
    minHeight: 120,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  logEmpty: {
    fontFamily: 'Manrope-Regular',
    color: colors.outline,
    fontSize: 13,
  },
  logLine: {
    fontFamily: 'SpaceGrotesk-Bold',
    color: colors.text,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
