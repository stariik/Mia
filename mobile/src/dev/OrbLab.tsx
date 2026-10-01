// DEV ONLY — HomeScreen requires this behind __DEV__, so it never ships.
//
// A floating "ORB" pill that opens a panel for judging the orb without
// talking: force any state, play a synthetic user or Mia voice through a real
// analyser (optionally audible), toggle reduced motion, and watch live perf.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MiaOrbHandle, OrbPerf, OrbState } from '@/orb';
import { colors } from '@/theme';

const STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];

type Props = {
  orbRef: React.RefObject<MiaOrbHandle | null>;
  labState: OrbState | null;
  onLabState: (s: OrbState | null) => void;
};

export function OrbLab({ orbRef, labState, onLabState }: Props) {
  const [open, setOpen] = useState(false);
  const [sim, setSim] = useState<'mic' | 'tts' | null>(null);
  const [audible, setAudible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [perf, setPerf] = useState<OrbPerf | null>(null);

  useEffect(() => orbRef.current?.onPerf(setPerf), [orbRef, open]);

  const simulate = (ch: 'mic' | 'tts' | null, loud = audible) => {
    setSim(ch);
    orbRef.current?.simulate(ch, 'speech', loud);
    if (ch === 'mic') onLabState('listening');
    else if (ch === 'tts') onLabState('speaking');
  };

  if (!open) {
    return (
      <Pressable style={styles.pill} onPress={() => setOpen(true)} hitSlop={8}>
        <Text style={styles.pillText}>ORB</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.title}>Orb lab</Text>
        <Pressable
          onPress={() => {
            simulate(null);
            onLabState(null);
            setOpen(false);
          }}
          hitSlop={8}
        >
          <Text style={styles.close}>close ×</Text>
        </Pressable>
      </View>
      <Text style={styles.perf}>
        {perf
          ? `${perf.fps} fps${perf.calm ? ' (calm)' : ''} · ${perf.ms} ms · tier ${perf.tier} (dpr ${perf.dpr}, ${perf.slices} slices, interior ×${perf.inner}) · ${perf.px} / ${perf.ipx}${perf.fallback ? ' · FALLBACK' : ''}`
          : 'waiting for perf…'}
      </Text>
      <View style={styles.wrap}>
        <Chip label="live" on={labState === null} onPress={() => onLabState(null)} />
        {STATES.map((s) => (
          <Chip key={s} label={s} on={labState === s} onPress={() => onLabState(s)} />
        ))}
      </View>
      <View style={styles.wrap}>
        <Chip label="🎙 user voice" on={sim === 'mic'} onPress={() => simulate(sim === 'mic' ? null : 'mic')} />
        <Chip label="🔊 Mia voice" on={sim === 'tts'} onPress={() => simulate(sim === 'tts' ? null : 'tts')} />
        <Chip
          label="audible"
          on={audible}
          onPress={() => {
            setAudible(!audible);
            if (sim) simulate(sim, !audible);
          }}
        />
        <Chip
          label="reduced motion"
          on={reduced}
          onPress={() => {
            setReduced(!reduced);
            orbRef.current?.setReducedMotion(!reduced);
          }}
        />
      </View>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} hitSlop={4}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    right: 12,
    top: 64,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.surfaceElev,
    borderWidth: 1,
    borderColor: colors.strokeBrand,
  },
  pillText: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  panel: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 60,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.surfaceElev,
    borderWidth: 1,
    borderColor: colors.strokeStrong,
    gap: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontWeight: '700' },
  close: { color: colors.textMuted },
  perf: { color: colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.stroke,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primaryGlow },
  chipText: { color: colors.textMuted, fontSize: 12 },
  chipTextOn: { color: colors.text },
});
