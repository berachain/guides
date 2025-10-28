// Imports
// ------------------------------------------------------------
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAuthToken } from '@privy-io/node';

// Proxy
// ------------------------------------------------------------
export const proxy = async (req: NextRequest) => {
  // 1 - Validate if token is present
  const token = req.cookies.get('privy-token')?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // 2 - Verify token
  try {
    await verifyAuthToken({
      app_id: process.env.NEXT_PUBLIC_PRIVY_APP_ID as string,
      auth_token: token,
      verification_key: process.env.PRIVY_VERIFICATION_KEY as string,
    });
    return NextResponse.next();
  } catch (error) {
    console.error('Privy auth verification failed:', error);
    return NextResponse.redirect(new URL('/', req.url));
  }
}

// Config Paths
// ------------------------------------------------------------
// Optional: match only certain paths
export const config = {
  matcher: ['/protected/:path*'],
};