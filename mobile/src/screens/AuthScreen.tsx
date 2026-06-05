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

import { AIAssistantOrb } from '@/components/AIAssistantOrb';
import { AuroraBackdrop } from '@/components/AuroraBackdrop';
import { useAuthStore } from '@/stores/authStore';
import { brandGradient, colors, radius, spacing, typography } from '@/theme';

type Mode = 'login' | 'register';

/**
 * Lightweight auth page. Orb stays mounted in a fixed-size slot at the top —
 * no swap, no KeyboardAvoidingView, no conditional rendering. Android's
 * `adjustResize` (set in AndroidManifest) raises the form area when the
 * keyboard opens; the orb sits above the form and out of the keyboard's way.
 */
export function AuthScreen() {
  const { signIn, signUp, pending, error, clearError } = useAuthStore();

  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    if (mode === 'login') signIn(email, password);
    else signUp(name, email, password);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    clearError();
  };

  return (
    <View style={styles.root}>
      <AuroraBackdrop />
      <StatusBar barStyle="light-content" backgroundColor={colors.bgDeep} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <AIAssistantOrb size={110} state="idle" />
            <Text style={styles.title}>Mia</Text>
            <Text style={styles.subtitle}>შენი ხმოვანი დამხმარე</Text>
          </View>

          <View style={styles.tabs}>
            <Tab
              label="შესვლა"
              active={mode === 'login'}
              onPress={() => switchMode('login')}
            />
            <Tab
              label="რეგისტრაცია"
              active={mode === 'register'}
              onPress={() => switchMode('register')}
            />
          </View>

          {mode === 'register' && (
            <Field
              label="სახელი"
              value={name}
              onChangeText={setName}
              placeholder="შენი სახელი"
              autoCapitalize="words"
              autoComplete="name"
            />
          )}

          <Field
            label="ელ. ფოსტა"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />

          <Field
            label="პაროლი"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={pending}
            style={({ pressed }) => [
              styles.submit,
              pending && styles.submitDisabled,
              pressed && !pending && styles.submitPressed,
            ]}
          >
            <LinearGradient
              colors={[...brandGradient]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Text style={styles.submitLabel}>
              {pending ? '…' : mode === 'login' ? 'შესვლა' : 'რეგისტრაცია'}
            </Text>
          </Pressable>

          <Text style={styles.legal}>
            გაგრძელებით ეთანხმები წესებსა და პირობებს.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: any;
  keyboardType?: 'default' | 'email-address';
};

function Field({ label, ...rest }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor={colors.outline}
        cursorColor={colors.primary}
        selectionColor={colors.primaryGlow}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },

  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    fontFamily: typography.display.fontFamily,
    fontSize: 32,
    color: colors.text,
    letterSpacing: -0.4,
    marginTop: spacing.md,
  },
  subtitle: {
    fontFamily: typography.body.fontFamily,
    fontSize: 14,
    color: colors.textMuted,
  },

  tabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(2,2,10,0.5)',
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: radius.full,
    padding: 4,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderRadius: radius.full,
  },
  tabActive: {
    backgroundColor: 'rgba(255,77,139,0.10)',
    borderWidth: 1,
    borderColor: colors.strokeBrand,
  },
  tabLabel: {
    fontFamily: typography.body.fontFamily,
    fontSize: 14,
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.primary,
  },

  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: typography.body.fontFamily,
    fontSize: 12,
    color: colors.textMuted,
  },
  input: {
    fontFamily: typography.body.fontFamily,
    fontSize: 16,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(2,4,16,0.6)',
    borderWidth: 1,
    borderColor: colors.stroke,
    borderRadius: radius.lg,
  },

  error: {
    fontFamily: typography.body.fontFamily,
    fontSize: 13,
    color: colors.danger,
    marginTop: spacing.xs,
  },

  submit: {
    marginTop: spacing.md,
    height: 52,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 16,
    elevation: 8,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  submitLabel: {
    color: '#ffffff',
    fontFamily: typography.body.fontFamily,
    fontSize: 15,
    letterSpacing: 0.3,
  },

  legal: {
    fontFamily: typography.body.fontFamily,
    fontSize: 12,
    color: colors.outline,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
