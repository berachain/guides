'use client';

// Imports
// ========================================================
import React, { useState, useEffect } from 'react';

// Page
// ========================================================
/**
 * @dev Helps fix hydration issues
 * @param param0 
 * @returns 
 */
export default function ClientOnly({ children }: { children: React.ReactNode }) {
    // State / Props
    const [hasMounted, setHasMounted] = useState(false);

    // Hooks
    useEffect(() => {
        setHasMounted(true);
    }, [])

    // Render
    if (!hasMounted) return null;

    return (
        <div>
            {children}
        </div>
    );
};