const fs = require('fs');
const path = require('path');

const appsDir = path.join(__dirname, '../apps');
const packagesDir = path.join(__dirname, '../packages');

function ensureBuildFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const packagePath = path.join(dir, entry.name);
      const packageJsonPath = path.join(packagePath, 'package.json');
      
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        
        // Check if package has a build script
        if (packageJson.scripts?.build) {
          const srcDir = path.join(packagePath, 'src');
          const indexFile = path.join(srcDir, 'index.ts');
          
          // Create src directory and index.ts if they don't exist
          if (!fs.existsSync(srcDir)) {
            fs.mkdirSync(srcDir, { recursive: true });
          }
          
          if (!fs.existsSync(indexFile)) {
            const content = `// Placeholder file for build process
// TODO: Implement actual functionality
export const placeholder = 'This is a placeholder file for build process';
`;
            fs.writeFileSync(indexFile, content);
            console.log(`Created placeholder ${indexFile}`);
          }
        }
      }
    }
  }
}

// Process both apps and packages directories
ensureBuildFiles(appsDir);
ensureBuildFiles(packagesDir); 