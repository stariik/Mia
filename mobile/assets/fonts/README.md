# Font assets

React Native uses the `.ttf` filename stem (no extension) as the `fontFamily`
value on Android. These four files must exist in this folder:

- `SpaceGrotesk-Medium.ttf`   ✅ included (from floriankarsten/space-grotesk)
- `SpaceGrotesk-Bold.ttf`     ✅ included (from floriankarsten/space-grotesk)
- `Manrope-Regular.ttf`       ⚠️ download manually — see below
- `Manrope-SemiBold.ttf`      ⚠️ download manually — see below

## Getting Manrope

Until a Manrope TTF is dropped in here, the app falls back to the system font
(Roboto on Android). To fix:

1. Visit https://fonts.google.com/specimen/Manrope and click "Download family".
2. Unzip. Copy `static/Manrope-Regular.ttf` and `static/Manrope-SemiBold.ttf`
   into this folder, keeping the exact filenames.
3. From the `mobile/` directory, run:
   ```
   npx react-native-asset
   npx react-native run-android
   ```

The `react-native-asset` step copies the TTFs into
`android/app/src/main/assets/fonts/` so Android can find them at runtime.
