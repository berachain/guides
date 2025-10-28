// Imports
// ------------------------------------------------------------
import Link from "next/link";
import { BerachainLogo } from "../SVG";

// Component
// ------------------------------------------------------------
const Nav = () => {
  return (
    <nav className="border-b border-[var(--border-light)] px-8 py-6 flex space-x-6 items-center">
      <Link href="/">
        <BerachainLogo className="w-10 h-10" />
      </Link>
      <Link href="/">Home</Link>
      <Link href="/protected">Protected</Link>
    </nav>
  );
};

// Exports
// ------------------------------------------------------------
export default Nav;
