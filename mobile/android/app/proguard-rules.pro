# R8/ProGuard rules for Mia (release builds).
#
# React Native + Hermes + autolinked native modules generally Just Work, but
# specific libraries we depend on need explicit keep rules so R8 doesn't strip
# classes the JS bridge resolves by name at runtime.

# ──────────────── React Native core ────────────────
# RN handles its own R8 rules via consumerProguardFiles in the gradle plugin,
# so most of the core/Hermes/Reanimated rules are already applied. We only
# need to keep classes that R8 can't see referenced through reflection or
# JNI hot paths.

# ──────────────── Notifee (alarms/timers) ────────────────
# Notifee uses reflection for event delivery.
-keep class io.invertase.notifee.** { *; }
-keepclassmembers class io.invertase.notifee.** { *; }

# ──────────────── Picovoice voice processor (streaming STT) ────────────────
# @picovoice/react-native-voice-processor captures the PCM frames for STT and
# uses JNI bindings. (This is NOT Porcupine — the wake word moved to
# openWakeWord/ONNX Runtime below — but the STT recorder still needs this keep.)
-keep class ai.picovoice.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# ──────────────── ONNX Runtime ("Hey Mia" wake word) ────────────────
# ORT resolves its JNI bridge by name; keep the API surface and don't warn on
# the optional providers/classes it references but we don't ship.
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**

# ──────────────── react-native-nitro-sound + nitro-modules ────────────────
# Nitro autogenerates JNI; keep generated specs.
-keep class com.margelo.nitro.** { *; }
-keep class * extends com.margelo.nitro.core.HybridObject { *; }

# ──────────────── Our own native module (music control + alarm) ────────────────
-keep class com.mobile.music.** { *; }
-keep class com.mobile.alarm.** { *; }

# ──────────────── React Navigation / Gesture Handler ────────────────
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.rnscreens.** { *; }

# ──────────────── WebView (orb shader runtime) ────────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ──────────────── Strip console.log/warn at the JS level ────────────────
# Handled in babel.config.js with babel-plugin-transform-remove-console,
# applied only on env.production builds. R8 takes care of native log
# stripping via the default Android rules.

# Keep annotations Hermes/RN may consult.
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Don't warn on optional/missing classes referenced by libs we don't use.
-dontwarn com.facebook.react.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
-dontwarn javax.annotation.**
