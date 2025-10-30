// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/GasBurner.sol";

contract GasBurnerTest is Test {
    GasBurner public gasBurner;
    
    function setUp() public {
        gasBurner = new GasBurner();
    }
    
    function testBurnGas() public {
        uint256 gasBefore = gasleft();
        uint256 targetGas = 1000000; // 1M gas
        
        gasBurner.burnGas(targetGas);
        
        uint256 gasAfter = gasleft();
        uint256 gasUsed = gasBefore - gasAfter;
        
        // Should have burned approximately the target amount
        assertApproxEqRel(gasUsed, targetGas, 0.1e18); // Within 10%
    }
    
    function testBurnGasPrecise() public {
        uint256 gasBefore = gasleft();
        uint256 targetGas = 2000000; // 2M gas
        
        gasBurner.burnGasPrecise(targetGas);
        
        uint256 gasAfter = gasleft();
        uint256 gasUsed = gasBefore - gasAfter;
        
        // Should have burned approximately the target amount
        assertApproxEqRel(gasUsed, targetGas, 0.1e18); // Within 10%
    }
    
    function testBurnGasWithHash() public {
        uint256 gasBefore = gasleft();
        uint256 targetGas = 500000; // 500K gas
        
        gasBurner.burnGasWithHash(targetGas);
        
        uint256 gasAfter = gasleft();
        uint256 gasUsed = gasBefore - gasAfter;
        
        // Should have burned approximately the target amount
        assertApproxEqRel(gasUsed, targetGas, 0.1e18); // Within 10%
    }
    
    function testBurn8MillionGas() public {
        uint256 gasBefore = gasleft();
        uint256 targetGas = 8000000; // 8M gas - the problematic amount
        
        gasBurner.burnGas(targetGas);
        
        uint256 gasAfter = gasleft();
        uint256 gasUsed = gasBefore - gasAfter;
        
        console.log("Target gas to burn:", targetGas);
        console.log("Actual gas burned:", gasUsed);
        console.log("Gas remaining:", gasAfter);
        
        // Should have burned approximately the target amount
        assertApproxEqRel(gasUsed, targetGas, 0.2e18); // Within 20% for large amounts
    }
    
    function testGetGasLeft() public {
        uint256 gasLeft = gasBurner.getGasLeft();
        assertGt(gasLeft, 0);
    }
    
    function testStorageOperations() public {
        uint256 initialLength = gasBurner.getStorageLength();
        assertEq(initialLength, 0);
        
        gasBurner.burnGas(100000);
        
        uint256 finalLength = gasBurner.getStorageLength();
        assertGt(finalLength, 0);
        
        gasBurner.clearStorage();
        
        uint256 clearedLength = gasBurner.getStorageLength();
        assertEq(clearedLength, 0);
    }
} 