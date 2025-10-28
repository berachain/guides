
// Imports
// ------------------------------------------------------------
import Auth from "@/components/Auth";

// Home Page
// ------------------------------------------------------------
const HomePage = () => {
  return (
    <div>
      <h1>Berachain NextJS Privy Implementation</h1>
      <p>Demonstrating how to use Privy with NextJS on Berachain.</p>
      <div className="mt-10">
        <Auth />
      </div>
    </div>
  );
};

// Exports
// ------------------------------------------------------------
export default HomePage;