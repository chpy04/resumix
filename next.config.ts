import { createRequire } from 'node:module';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  // Emits `.next/standalone` — a self-contained server plus only the
  // node_modules the app actually reaches at runtime. The production image
  // (Dockerfile, `runtime` stage) is built from it. Left on unconditionally
  // rather than gated behind an env var so `npm run build` in the merge gate
  // produces the same output prod ships; a standalone-only build failure
  // that only reproduces inside Docker is exactly the kind of thing that
  // reaches main (CLAUDE.md, "Merge gate").
  output: 'standalone',
  serverExternalPackages: ['postgres'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      // react-pdf's `pdfjs-dist` dependency optionally `require`s the Node
      // `canvas` package (a guarded, Node-only fallback path); webpack
      // still tries to resolve it client-side unless aliased away.
      canvas: false,
      // The unminified `pdfjs-dist/build/pdf.mjs` (react-pdf's default
      // `pdfjs-dist` resolution) trips a `next dev` webpack/HMR bug that
      // doesn't reproduce with the minified build
      // or in `next build`/`next start`. Aliasing to the minified build
      // sidesteps it in dev without changing anything at runtime.
      'pdfjs-dist$': require.resolve('pdfjs-dist/build/pdf.min.mjs'),
    };
    return config;
  },
};

export default nextConfig;
