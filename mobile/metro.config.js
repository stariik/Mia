const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
  resolver: {
    blockList: [
      /[\\/]\.cxx([\\/].*)?$/,
      /[\\/]\.gradle([\\/].*)?$/,
      /[\\/]android[\\/](?:app[\\/])?build([\\/].*)?$/,
      /[\\/]ios[\\/]build([\\/].*)?$/,
      /[\\/]node_modules[\\/].*[\\/]android[\\/]build([\\/].*)?$/,
    ],
  },
  watcher: {
    additionalExts: [],
    healthCheck: { enabled: false },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
