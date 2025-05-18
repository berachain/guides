const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Function to recursively get all files in a directory
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !filePath.includes('node_modules') && !filePath.includes('.git')) {
      getAllFiles(filePath, fileList);
    } else if (stat.isFile() && 
      (filePath.endsWith('.json') || 
       filePath.endsWith('.js') || 
       filePath.endsWith('.ts') || 
       filePath.endsWith('.tsx') || 
       filePath.endsWith('.cjs'))) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Function to replace content in a file
function replaceInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Replace @repo with @berachain
    content = content.replace(/@repo\//g, '@berachain/');
    
    // Only write if changes were made
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

// Main execution
console.log('Starting package name updates...');
const files = getAllFiles('.');
files.forEach(replaceInFile);
console.log('Package name updates completed!'); 