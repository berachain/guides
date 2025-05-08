const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APPS_DIR = path.join(__dirname, '../apps');

// Get all app directories
const apps = fs.readdirSync(APPS_DIR).filter(file => {
  const fullPath = path.join(APPS_DIR, file);
  return fs.statSync(fullPath).isDirectory();
});

// Standard package.json scripts
const standardScripts = {
  "build": "tsup",
  "dev": "tsup --watch",
  "lint": "eslint src/",
  "lint:fix": "eslint src/ --fix",
  "format": "prettier --write \"src/**/*.{ts,tsx}\"",
  "test": "jest",
  "clean": "rm -rf .turbo && rm -rf node_modules && rm -rf dist"
};

// Standard devDependencies
const standardDevDeps = {
  "@repo/eslint-config": "workspace:*",
  "@repo/typescript-config": "workspace:*",
  "@types/jest": "^29.5.0",
  "@types/node": "^20.0.0",
  "jest": "^29.5.0",
  "prettier": "^3.0.0",
  "tsup": "^8.0.0",
  "typescript": "^5.0.0"
};

// Process each app
apps.forEach(app => {
  const appPath = path.join(APPS_DIR, app);
  const packageJsonPath = path.join(appPath, 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`Skipping ${app} - no package.json found`);
    return;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Update scripts
    packageJson.scripts = {
      ...standardScripts,
      ...packageJson.scripts // Keep any existing scripts
    };

    // Update devDependencies
    packageJson.devDependencies = {
      ...standardDevDeps,
      ...packageJson.devDependencies // Keep any existing devDependencies
    };

    // Write back the updated package.json
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log(`Updated ${app}/package.json`);

    // Create .eslintrc.json if it doesn't exist
    const eslintrcPath = path.join(appPath, '.eslintrc.json');
    if (!fs.existsSync(eslintrcPath)) {
      const eslintrc = {
        "root": true,
        "extends": ["@repo/eslint-config/library"]
      };
      fs.writeFileSync(eslintrcPath, JSON.stringify(eslintrc, null, 2));
      console.log(`Created ${app}/.eslintrc.json`);
    }

    // Create tsconfig.json if it doesn't exist
    const tsconfigPath = path.join(appPath, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      const tsconfig = {
        "extends": "@repo/typescript-config/base.json",
        "include": ["src"],
        "exclude": ["node_modules", "dist"]
      };
      fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      console.log(`Created ${app}/tsconfig.json`);
    }

  } catch (error) {
    console.error(`Error processing ${app}:`, error);
  }
});

console.log('Done standardizing apps!'); 