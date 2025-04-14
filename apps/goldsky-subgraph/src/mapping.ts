//import event class from generated files
import { Transfer } from "../generated/Erc20/Erc20";
//import the functions defined in utils.ts
import { fetchTokenDetails, fetchAccount, updateTokenBalance } from "./utils";
//import datatype
import { BigInt } from "@graphprotocol/graph-ts";

export function handleTransfer(event: Transfer): void {
  // 1. Get token details
  let token = fetchTokenDetails(event);
  if (!token) {
    return;
  }

  // 2. Get account details
  let fromAddress = event.params.from.toHex();
  let toAddress = event.params.to.toHex();

  let fromAccount = fetchAccount(fromAddress);
  let toAccount = fetchAccount(toAddress);

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
