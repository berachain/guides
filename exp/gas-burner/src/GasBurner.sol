// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title GasBurner
 * @dev A contract designed to burn a specified amount of gas for testing purposes.
 * This is useful for testing client behavior with large transactions.
 */
contract GasBurner {
    // Storage array to make operations more expensive
    uint256[] private storageArray;
    
    // Event to track gas usage
    event GasBurned(uint256 targetGas, uint256 actualGasUsed, uint256 gasLeft);
    
    /**
     * @dev Burns approximately the specified amount of gas
     * @param targetGas The approximate amount of gas to burn (in wei)
     */
    function burnGas(uint256 targetGas) external {
        uint256 gasStart = gasleft();
        uint256 targetGasLeft = gasStart - targetGas;
        
        // Use a combination of storage operations and loops to burn gas
        // Each storage operation costs ~20k gas, so we'll use that as a base
        
        uint256 storageOps = targetGas / 20000;
        uint256 loopIterations = (targetGas % 20000) / 100; // Rough estimate for loop overhead
        
        // Perform storage operations
        for (uint256 i = 0; i < storageOps && gasleft() > targetGasLeft; i++) {
            storageArray.push(i);
        }
        
        // Perform additional loop iterations to fine-tune gas usage
        for (uint256 i = 0; i < loopIterations && gasleft() > targetGasLeft; i++) {
            // Empty loop body - just burn gas through iteration overhead
        }
        
        // Additional expensive operations if we haven't burned enough gas
        while (gasleft() > targetGasLeft) {
            // Perform some expensive operations
            uint256 temp = 0;
            for (uint256 i = 0; i < 100 && gasleft() > targetGasLeft; i++) {
                temp += i;
            }
            // Use temp to prevent optimization
            if (temp > 0) {
                storageArray.push(temp);
            }
        }
        
        uint256 gasUsed = gasStart - gasleft();
        emit GasBurned(targetGas, gasUsed, gasleft());
    }
    
    /**
     * @dev Burns gas using a more precise method with exponential operations
     * @param targetGas The approximate amount of gas to burn (in wei)
     */
    function burnGasPrecise(uint256 targetGas) external {
        uint256 gasStart = gasleft();
        uint256 targetGasLeft = gasStart - targetGas;
        
        // Use exponential operations which are very gas expensive
        uint256 base = 2;
        uint256 exponent = 1;
        
        while (gasleft() > targetGasLeft) {
            // Perform expensive exponential operations
            uint256 result = 1;
            for (uint256 i = 0; i < exponent && gasleft() > targetGasLeft; i++) {
                result = result * base;
            }
            
            // Store result to prevent optimization
            storageArray.push(result);
            
            // Increase exponent for next iteration
            exponent++;
            
            // Safety check to prevent infinite loops
            if (exponent > 100) break;
        }
        
        uint256 gasUsed = gasStart - gasleft();
        emit GasBurned(targetGas, gasUsed, gasleft());
    }
    
    /**
     * @dev Burns gas using SHA256 operations (very expensive)
     * @param targetGas The approximate amount of gas to burn (in wei)
     */
    function burnGasWithHash(uint256 targetGas) external {
        uint256 gasStart = gasleft();
        uint256 targetGasLeft = gasStart - targetGas;
        
        // SHA256 operations cost ~60 gas per word, so very expensive
        uint256 counter = 0;
        
        while (gasleft() > targetGasLeft) {
            // Perform SHA256 hash operations
            bytes32 hash = keccak256(abi.encodePacked(counter, block.timestamp));
            
            // Store hash to prevent optimization
            storageArray.push(uint256(hash));
            
            counter++;
            
            // Safety check
            if (counter > 1000) break;
        }
        
        uint256 gasUsed = gasStart - gasleft();
        emit GasBurned(targetGas, gasUsed, gasleft());
    }
    
    /**
     * @dev Returns the current gas left
     * @return The amount of gas remaining
     */
    function getGasLeft() external view returns (uint256) {
        return gasleft();
    }
    
    /**
     * @dev Returns the length of the storage array
     * @return The number of items stored
     */
    function getStorageLength() external view returns (uint256) {
        return storageArray.length;
    }
    
    /**
     * @dev Clears the storage array to reset the contract state
     */
    function clearStorage() external {
        delete storageArray;
    }
} 