import { defineConfig } from 'cf/config';
export default defineConfig({
  accountId: '694f545fd44b7c4d36bde3a51fc55182',
  worker: {
    name: 'ferrymappernyc-live', entrypoint: './worker.js', compatibilityDate: '2026-11-05',
    compatibilityFlags: ['nodejs_compat'], workersDev: true,
    observability: { enabled: true, headSamplingRate: 0.1, traces: { enabled: true, headSamplingRate: 0.1 } },
  },
});
