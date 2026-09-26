module.exports = {
  presets: ['babel-preset-expo'],
  plugins: [
    [
      'module-resolver',
      {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
          '@': './src',
        },
      },
    ],
    // Strip console.* calls from production bundles only — dev still gets
    // logs in Metro/adb logcat. RN sets BABEL_ENV='production' for release
    // builds and 'development' otherwise.
    ...(process.env.BABEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production'
      ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
      : []),
    // Worklets plugin MUST be last. Reanimated 4.x moved the babel plugin
    // out of `react-native-reanimated` into `react-native-worklets`.
    'react-native-worklets/plugin',
  ],
};
