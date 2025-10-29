// Imports
// ------------------------------------------------------------
import Link from "next/link";

// Protected Page
// ------------------------------------------------------------
const ProtectedPage = () => {
  return (
    <div>
      <h1>Protected</h1>
      <p>Congrats you now have access to this protected page!</p>
      <p>
        See the{" "}
        <code className="text-xs text-white bg-zinc-900 p-2 rounded-md inline-block">
          proxy.ts
        </code>{" "}
        file for more details.
      </p>
      <Link className="btn" href="/">
        Home
      </Link>
    </div>
  );
};

// Exports
// ------------------------------------------------------------
export default ProtectedPage;
