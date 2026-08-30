import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ethers } = require('../vendor/ethers.min.js');

export { ethers };
