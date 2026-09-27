module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The RN preset only transforms react-native itself inside node_modules;
  // async-storage ships untranspiled ESM, so allow it through Babel too.
  // expo/virtual/env is where babel-preset-expo points process.env.EXPO_PUBLIC_*
  // outside a bundle (config/env.ts).
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-async-storage|expo/virtual)/)',
  ],
};
