import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'server/remotion/src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      reactRefresh.configs.vite,
    ],
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: [
      'server/lib/external-image-cache.ts',
      'server/lib/fal-client.ts',
      'server/lib/generation.ts',
      'server/lib/media-utils.ts',
      'server/lib/normalize.ts',
      'server/lib/replicate-client.ts',
      'server/lib/storage.ts',
      'server/routes/generate/director.ts',
      'server/routes/generate/image.ts',
      'server/routes/generate/video.ts',
      'server/routes/projects.ts',
      'src/stores/projectStore.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
