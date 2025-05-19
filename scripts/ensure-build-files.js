const fs = require('fs');
const path = require('path');

const packages = [
  'rpc-config',
  'typescript-config',
  'ui',
  'eslint-config'
];

packages.forEach(pkg => {
  const distPath = path.join(__dirname, '..', 'packages', pkg, 'dist');
  if (!fs.existsSync(distPath)) {
    fs.mkdirSync(distPath, { recursive: true });
  }
  
  // Create empty index files
  const files = ['index.js', 'index.mjs', 'index.d.ts'];
  files.forEach(file => {
    const filePath = path.join(distPath, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
    }
  });
}); 