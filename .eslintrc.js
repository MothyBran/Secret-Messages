module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended',
    'plugin:security/recommended'
  ],
  plugins: [
    'security'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // Error prevention
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'no-alert': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    
    // Code quality
    'prefer-const': 'error',
    'no-var': 'error',
    'no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_' 
    }],
    'no-undef': 'error',
    'no-undefined': 'off',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'dot-notation': 'error',
    'no-multi-spaces': 'error',
    'no-trailing-spaces': 'error',
    
    // Style
    'indent': ['error', 4, { SwitchCase: 1 }],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'semi': ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    'object-curly-spacing': ['error', 'always'],
    'array-bracket-spacing': ['error', 'never'],
    'space-before-function-paren': ['error', 'never'],
    'keyword-spacing': 'error',
    'space-infix-ops': 'error',
    
    // Functions
    'function-paren-newline': ['error', 'consistent'],
    'prefer-arrow-callback': 'error',
    'arrow-spacing': 'error',
    
    // Objects and Arrays
    'object-shorthand': 'error',
    'prefer-destructuring': ['error', {
      array: false,
      object: true
    }],
    
    // Strings
    'prefer-template': 'error',
    'template-curly-spacing': 'error',
    
    // Comments
    'spaced-comment': ['error', 'always'],
    
    // Node.js specific
    'no-process-exit': 'error',
    'no-path-concat': 'error',
    
    // Security rules
    'security/detect-object-injection': 'error',
    'security/detect-non-literal-regexp': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'warn',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-require': 'warn',
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-pseudoRandomBytes': 'error'
  },
  overrides: [
    {
      // Test files
      files: ['**/*.test.js', '**/*.spec.js', '**/tests/**/*.js'],
      env: {
        jest: true
      },
      rules: {
        'no-console': 'off',
        'security/detect-non-literal-fs-filename': 'off',
        'security/detect-child-process': 'off'
      }
    },
    {
      // Config files
      files: [
        'jest.config.js',
        '.eslintrc.js',
        'webpack.config.js',
        'babel.config.js'
      ],
      env: {
        node: true
      },
      rules: {
        'no-console': 'off'
      }
    },
    {
      // Scripts
      files: ['scripts/**/*.js'],
      env: {
        node: true
      },
      rules: {
        'no-console': 'off',
        'no-process-exit': 'off',
        'security/detect-child-process': 'off',
        'security/detect-non-literal-fs-filename': 'off'
      }
    }
  ],
  globals: {
    // Global test utilities
    testUtils: 'readonly',
    cleanupDatabase: 'readonly'
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    'logs/',
    'backups/',
    '*.min.js'
  ]
};
