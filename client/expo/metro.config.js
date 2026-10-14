const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules/expo/node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  '@gameplan/rules': path.resolve(workspaceRoot, 'lib/rules'),
  '@gameplan/types': path.resolve(workspaceRoot, 'lib/types'),
  '@gameplan/client-session': path.resolve(workspaceRoot, 'client/session'),
  // @testing-library/react-native hoists pretty-format 30 (ESM-only). Expo's
  // web HMR client expects the CJS default export from 29.x.
  'pretty-format': path.resolve(
    workspaceRoot,
    'node_modules/expo/node_modules/pretty-format',
  ),
};
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_enableSymlinks = true;

const prettyFormat29 = path.resolve(
  workspaceRoot,
  'node_modules/expo/node_modules/pretty-format/build/index.js',
);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'pretty-format') {
    return { type: 'sourceFile', filePath: prettyFormat29 };
  }
  if (
    moduleName.endsWith('.js') &&
    moduleName.startsWith('.') &&
    !context.originModulePath.includes(`${path.sep}node_modules${path.sep}`)
  ) {
    return (upstream ?? context.resolveRequest)(
      context,
      moduleName.slice(0, -3),
      platform,
    );
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
