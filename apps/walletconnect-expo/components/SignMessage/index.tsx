// Imports
// ========================================================
import { useState } from "react";
import { View, Pressable, Text, TextInput } from "react-native";
import { useAccount, useSignMessage } from "wagmi";

// Component
// ========================================================
export default function SignMessage() {
	// Hooks
	const [message, setMessage] = useState("");
	const [signature, setSignature] = useState("(Signature will show up here)");
	const [error, setError] = useState("");
	const { isConnected, address } = useAccount();
	const { signMessageAsync } = useSignMessage();

	// Functions
  /**
   * @dev Handles signing message
   */
	const onPressSignMessage = async () => {
		console.group("onPressSignMessage");
		setError("");

		try {
			const signature = await signMessageAsync({
				message,
			});
			setSignature(signature);
		} catch (error: unknown) {
			console.error({ error });
			setError("Error signing message.");
		}
		console.groupEnd();
	};

	// Return
  /**
   * If not connected and no address, then don't show anything
   */
	if (!isConnected || !address) return null;

	return (
		<View className="SignMessage">
			<Text className="Text">Sign Message</Text>
			<TextInput
				className="TextInput"
				placeholder="Message to sign"
				onChangeText={setMessage}
				value={message}
			/>
			<Text className="Text">Signature Generated</Text>
			<Text
				className="Code"
			>{signature}</Text>
			<Pressable
				className="Button"
				onPress={onPressSignMessage}
			>
				<Text className="text-white text-base">Sign Message</Text>
			</Pressable>

			{error ? (
				<Text className="TextError">
					{error}
				</Text>
			) : null}
		</View>
	);
}
