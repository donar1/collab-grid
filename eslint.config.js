const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // browser
        window: 'readonly', document: 'readonly', fetch: 'readonly', WebSocket: 'readonly',
        Event: 'readonly', FormData: 'readonly', console: 'readonly',
        // node
        process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', __filename: 'readonly',
        // mocha
        describe: 'readonly', it: 'readonly', before: 'readonly', after: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'eqeqeq': ['warn', 'always'],
    },
    ignore: ['node_modules/', 'public/bundle.js', 'data/', 'backups/', 'scripts/build.js'],
  },
];
