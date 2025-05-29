const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Compile contracts
console.log('Compiling contracts...');
execSync('forge build', { stdio: 'inherit' });

// Read artifacts
const artifactsDir = path.join(__dirname, '../out');
const contracts = ['BatchTransaction', 'UrsaToken', 'VestingContract'];

const artifacts = {};
for (const contract of contracts) {
    const artifactPath = path.join(artifactsDir, `${contract}.sol/${contract}.json`);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    artifacts[contract] = {
        abi: artifact.abi,
        bytecode: artifact.bytecode.object
    };
}

// Write artifacts to a file that can be imported
const outputPath = path.join(__dirname, 'artifacts.js');
fs.writeFileSync(
    outputPath,
    `module.exports = ${JSON.stringify(artifacts, null, 2)};`
);

console.log('Artifacts generated at:', outputPath); 