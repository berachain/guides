//import event class from generated files
//import datatype
import { BigInt } from "@graphprotocol/graph-ts";

import { Transfer } from "../generated/Erc20/Erc20";
//import the functions defined in utils.ts
import { fetchAccount, fetchTokenDetails, updateTokenBalance } from "./utils";

export function handleTransfer(event: Transfer): void {
  // 1. Get token details
  const token = fetchTokenDetails(event);
  if (!token) {
    return;
  }

  // 2. Get account details
  const fromAddress = event.params.from.toHex();
  const toAddress = event.params.to.toHex();

  const fromAccount = fetchAccount(fromAddress);
  const toAccount = fetchAccount(toAddress);

  if (!fromAccount || !toAccount) {
    return;
  }

  // 3. Update the token balances
  // Setting the token balance of the 'from' account
  updateTokenBalance(
    token,
    fromAccount,
    BigInt.fromI32(0).minus(event.params.value),
  );

  // Setting the token balance of the 'to' account
  updateTokenBalance(token, toAccount, event.params.value);
}
