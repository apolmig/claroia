const { build } = require('./package.json')

module.exports = {
  ...build,
  artifactName: '${productName}-${version}-privacy-bundled-win-${arch}.${ext}',
  extraResources: [
    ...build.extraResources,
    'privacy-filter-model/**/*'
  ]
}
