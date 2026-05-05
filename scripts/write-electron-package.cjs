const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve(__dirname, '..', 'dist-electron');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' })
);
