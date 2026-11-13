const openmrsConfig = require('openmrs/default-rspack-config');
const { TsCheckerRspackPlugin } = require('ts-checker-rspack-plugin');

// `@openmrs/esm-patient-common-lib` is published as TypeScript source. Compile it like our own code; the chart
// shares one copy at run time, and this compiled copy is only the fallback.
openmrsConfig.scriptRuleConfig.exclude = /node_modules(?![\\/]@openmrs[\\/]esm-patient-common-lib[\\/])/;

/**
 * The OpenMRS default config, with one more change: the type checker reports issues in this module's `src/` only.
 * The tsconfig is strict, because Nexo Core needs strict null checks to narrow its result types.
 * `@openmrs/esm-patient-common-lib` is checked upstream without strict mode, so its issues are not ours to report.
 * `packages/nexo-forms` is checked by the tsconfig in openmrs/. Core is checked by the repository's own checks.
 */
module.exports = (env, argv) => {
  const config = openmrsConfig(env, argv);
  // Content hashes in chunk names, so a rebuild with the same version is not served from a stale browser cache.
  config.output = { ...config.output, chunkFilename: '[id].[contenthash:8].js' };
  config.plugins = config.plugins.map((plugin) =>
    plugin instanceof TsCheckerRspackPlugin
      ? new TsCheckerRspackPlugin({ issue: { include: [{ file: 'src/**/*' }] } })
      : plugin,
  );
  return config;
};
