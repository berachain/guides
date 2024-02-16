"use client";

// Imports
// ========================================================
import { useAccount, useSignMessage, useVerifyMessage } from "wagmi";
import { useState } from "react";
import { berachainTestnet } from "wagmi/chains";

// Main Page
// ========================================================
export default function SignMessage() {
  // Hooks
  const { isConnected, address } = useAccount();
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState<`0x${string}`>('0x');
  const [result, setResult] = useState('');
  const { signMessageAsync } = useSignMessage();
  const verification = useVerifyMessage({
    chainId: berachainTestnet.id,
    address,
    message,
    signature
  });

  // Functions
  /**
   * @dev Handles signing messages from whatever is placed in textarea
   * @param event 
   */
  const onSubmitSignMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.group('onSubmitSignMessage');

    try {
      const signature = await signMessageAsync({
        message
      });
      setSignature(signature);
      setResult(signature);
      verification.refetch();
    } catch (error: any) {
      console.error(error?.reason);
      console.error(error);
      setResult(error?.reason ?? error?.message);
    }

    console.groupEnd();
  };

  // Render
  return (
    <section className="pb-6 mb-6 border-zinc-700 border-b">
      <>
        <h2>Sign Message</h2>

        {isConnected
          ? <div>
            <form onSubmit={onSubmitSignMessage}>
              <div>
                <label>Message</label>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex: My Message" />
              </div>
              <div>
                <button disabled={!message} type="submit">Sign</button>
              </div>
            </form>

            {result ? <div>
              <label>Signature Result</label>
              <pre><code>{result}</code></pre>

              <label>Verification Result</label>
              <pre><code>{verification.status === 'pending' ? `Status: ${verification.status}\n\nVerifying...` : ''}{verification.status === 'error' ? `Status: ${verification.status}\n\n${verification?.failureReason?.message}` : ''}{verification.status === 'success' ? `Status: ${verification.status}\n\nVerified signature and message` : ''}</code></pre>
            </div> : null}
          </div>
          : <div>
            <pre><code>Not Connected</code></pre>
          </div>
        }
      </>
    </section>
  )
};
