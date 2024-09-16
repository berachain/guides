// Imports
// ========================================================
import Irys from "@irys/sdk";
import { config } from "dotenv";
import fs from "fs";
import path from "path";

// Config
// ========================================================
/**
 * @dev Loads our environment variables from .env
 */
config();

// Main Script
// ========================================================
/**
 * @dev Main upload script
 */
const main = async () => {
	console.group("main()");

	// Get file and its size
	const filePath = path.join(__dirname, "../assets", "berachain-upload.jpg");
	const stats = fs.statSync(filePath);
	const fileSize = stats.size;
	console.log({ fileSize });

	// Irys Config
	const irys = new Irys({
		url: `${process.env.IRYS_NODE}`, // URL of the node you want to connect to
		token: `${process.env.IRYS_TOKEN}`, // Token used for payment
		key: `${process.env.WALLET_PRIVATE_KEY}`, // Private key used for signing transactions and paying for uploads
		config: {
			providerUrl: `${process.env.CHAIN_RPC_URL}`, // Optional RPC provider URL, only required when using Devnet
		},
	});
	console.log(`Connected to Irys from ${irys.address}`);
	// Get price needed in `$BERA`
	const price = irys.utils.fromAtomic(await irys.getPrice(fileSize));
	console.log({
		price: `${price} $${irys.token}`,
	});
	const priceWithBuffer = price.plus(Number(`${process.env.IRYS_BUFFER}`));
	console.log(`priceWithBuffer: ${priceWithBuffer.toString()}`);

	// Get balance
	let currentBalance = irys.utils.fromAtomic(await irys.getLoadedBalance());
	console.log({
		currentBalance: `${currentBalance} $${irys.token}`,
	});

	// If needed fund the Irys node
	if (currentBalance.isLessThan(priceWithBuffer)) {
		// Fund the Irys node
		console.log("Not enough balance, funding node...");
		const fundTx = await irys.fund(irys.utils.toAtomic(priceWithBuffer));
		console.log(`Successfully funded '${irys.utils.fromAtomic(fundTx.quantity)}' $${irys.token}`);
		currentBalance = irys.utils.fromAtomic(await irys.getLoadedBalance());
		console.log({
			currentBalance: `${currentBalance} $${irys.token}`,
		});
	}

	console.log("Uploading file...");
	// Upload file
	// Irys also provides methods for uploading folders and pure binary data
	const receipt = await irys.uploadFile(filePath, {
		// Add optional tags
		// Tags are indexed and are queryable using the Irys query package
		// https://docs.irys.xyz/developer-docs/querying/query-package
		tags: [
			{
				name: "application-id",
				value: "Irys + Berachain",
			},
		],
	});
	// https://gateway.irys.xyz/mDKWFxvoIzC15z3cAyR2EAl9S3EY1ZlhKzaEOcITE0g

	// Files are instantly available from the Irys gateway
	console.log(`https://gateway.irys.xyz/${receipt.id}`);

	console.groupEnd();
};

// Init Script
// ========================================================
main()
	.then(() => {
		console.log("Script complete.");
	})
	.catch((error) => {
		console.error({ error });
	});
