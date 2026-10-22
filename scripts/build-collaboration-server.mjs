import { buildServerBundle } from './build-server-bundle.mjs';
const result = await buildServerBundle();
console.log(
  `${result.reused ? 'Reused verified' : 'Built'} ${result.bundle} · ${result.manifest.sha256}`,
);
