import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./src', import.meta.url));

/**
 * The sync service declares @clerk/backend in its own package.json, so the
 * repo can hold two physical copies (root + sync-service/node_modules).
 * Unpinned, `import { verifyToken } from '@clerk/backend'` inside
 * sync-service/src/auth.js resolves to whichever copy Node finds first, and a
 * bare-specifier mock in a test then intercepts the OTHER copy — the mock
 * silently no-ops and the real verifyToken runs against the test's fake JWT.
 *
 * Pinning the specifier makes both runtimes resolve to one module instance,
 * so one vi.mock() call covers either importer. The root copy is used because
 * CI only installs root dependencies for this job.
 */
const clerkBackend = fileURLToPath(new URL('./node_modules/@clerk/backend', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': src,
      '@clerk/backend': clerkBackend,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
