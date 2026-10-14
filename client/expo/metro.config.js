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
};
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_enableSymlinks = true;

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
