// Imports
// ========================================================
import { useState } from "react";
import { Pressable, Text, TextInput } from "react-native";
import { useAccount, useSignMessage } from "wagmi";

// Component
// ========================================================
export default function SignMessage() {
  // Hooks
  const [message, setMessage] = useState('');
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Functions
  const onPressSignMessage = async () => {
    console.group('onPressSignMessage');
    setError('');

    try {
      const signature = await signMessageAsync({
        message
      });
      setSignature(signature);
    } catch (error: any) {
      console.error({ error });
      setError('Error signing message.')
    }

    console.groupEnd();
  };

  // Return
  if (!isConnected || !address) return null;

  return (
    <>
      <Text className="text-[#2E1E1A] mb-2">Sign Message</Text>
      <TextInput
        className="bg-white text-base h-12 px-2 align-text-top rounded w-full mb-4"
        placeholder="Message to sign"
        onChangeText={setMessage}
        value={message}
      />
      <Text className="text-[#2E1E1A] mb-2">Signature Generated</Text>
      <TextInput
        className="bg-[#ff843d] whitespace-nowrap overflow-scroll mb-4 text-[#874c2a] placeholder:text-[#874c2a] text-base h-12 px-2 align-text-top rounded w-full"
        placeholder="Signature"
        value={signature}
      />
      <Pressable
        className="bg-[#2E1E1A] h-12 flex items-center justify-center rounded-lg mb-4"
        onPress={onPressSignMessage}>
        <Text className="text-white text-base">
          Sign Message
        </Text>
      </Pressable>

      {error ? <Text className="text-red-800 bg-red-200 mb-2 text-base p-4">{error}</Text> : null}
    </>
  );
}