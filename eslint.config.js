// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', 'supabase/functions/**', '.expo/*'],
  },
  {
    rules: {
      // Expo Router screens export route configuration alongside components.
      'react-refresh/only-export-components': 'off',
      // React Compiler advisories: they only mean the compiler skips memoising a
      // component. Imperative media APIs (expo-video / expo-audio players,
      // PanResponder refs, Animated values) must be mutated by design, so these
      // stay visible as warnings instead of failing the build.
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]);
