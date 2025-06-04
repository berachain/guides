const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Compile the contract
console.log('Compiling UrsaToken contract...');
execSync('forge build', { stdio: 'inherit' });

// Read the artifact file
const artifactPath = path.join(__dirname, '../out/UrsaToken.sol/UrsaToken.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

// Get the bytecode and abi
const bytecode = artifact.bytecode.object;
const abi = artifact.abi;

// Create a new file with the bytecode and abi
const outputPath = path.join(__dirname, '../bytecode/UrsaToken.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ bytecode, abi }, null, 2));

console.log('Artifact generated successfully!');
console.log('Artifact saved to:', outputPath); 