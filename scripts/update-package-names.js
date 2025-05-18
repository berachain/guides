const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APPS_DIR = path.join(__dirname, '../apps');
const PACKAGES_DIR = path.join(__dirname, '../packages');

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Update package names and dependencies
  content = content.replace(/@repo\//g, '@berachain/');
  
  // Update ESLint config references
  content = content.replace(/"extends":\s*\["@berachain\/eslint-config\/guides"\]/g, 
    '"extends": ["@berachain/eslint-config/library.js"]');
  
  // Update TypeScript config references
  content = content.replace(/"extends":\s*"@berachain\/typescript-config\/base\.json"/g,
    '"extends": "@berachain/typescript-config/base.json"');
  content = content.replace(/"extends":\s*"@berachain\/typescript-config\/react-library\.json"/g,
    '"extends": "@berachain/typescript-config/react-library.json"');
  
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${filePath}`);
}

function processDirectory(dir) {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      processDirectory(itemPath);
    } else if (item === 'package.json' || item === 'tsconfig.json' || item.endsWith('.eslintrc.json') || item.endsWith('.eslintrc.js')) {
      updateFile(itemPath);
    }
  }
}

// Process both apps and packages directories
processDirectory(APPS_DIR);
processDirectory(PACKAGES_DIR);

// Update root tsconfig.json
const rootTsConfig = path.join(__dirname, '../tsconfig.json');
if (fs.existsSync(rootTsConfig)) {
  updateFile(rootTsConfig);
}

// Update root .eslintrc.js
const rootEslintConfig = path.join(__dirname, '../.eslintrc.js');
if (fs.existsSync(rootEslintConfig)) {
  updateFile(rootEslintConfig);
}

console.log('Package name update complete!'); 