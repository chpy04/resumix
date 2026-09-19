import { createRequire } from 'node:module';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  serverExternalPackages: ['postgres'],
  // The board moved to `/` when applications became the front door. Kept as a
  // redirect rather than a second page so there is one URL for it, and any
  // link already written down still lands somewhere.
  async redirects() {
    return [{ source: '/applications', destination: '/', permanent: false }];
  },
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
