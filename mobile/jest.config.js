module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The RN preset only transforms react-native itself inside node_modules;
  // async-storage ships untranspiled ESM, so allow it through Babel too.
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-async-storage)/)',
  ],
};
