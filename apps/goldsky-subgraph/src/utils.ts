//import smart contract class from generated files
//import datatypes
import { BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";

import { Erc20 } from "../generated/Erc20/Erc20";
//import entities
import { Account, Token, TokenBalance } from "../generated/schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Fetch token details
export function fetchTokenDetails(event: ethereum.Event): Token | null {
  //check if token details are already saved
  let token = Token.load(event.address.toHex());
  if (!token) {
    //if token details are not available
    //create a new token
    token = new Token(event.address.toHex());

    //set some default values
    token.name = "N/A";
    token.symbol = "N/A";
    token.decimals = BigDecimal.fromString("0");

    //bind the contract
    const erc20 = Erc20.bind(event.address);

    //fetch name
    const tokenName = erc20.try_name();
    if (!tokenName.reverted) {
      token.name = tokenName.value;
    }

    //fetch symbol
    const tokenSymbol = erc20.try_symbol();
    if (!tokenSymbol.reverted) {
      token.symbol = tokenSymbol.value;
    }

    //fetch decimals
    const tokenDecimal = erc20.try_decimals();
    if (!tokenDecimal.reverted) {
      token.decimals = BigDecimal.fromString(tokenDecimal.value.toString());
    }

    //save the details
    token.save();
  }
  return token;
}

// Fetch account details
export function fetchAccount(address: string): Account | null {
  //check if account details are already saved
  let account = Account.load(address);
  if (!account) {
    //if account details are not available
    //create new account
    account = new Account(address);
    account.save();
  }
  return account;
}

export function updateTokenBalance(
  token: Token,
  account: Account,
  amount: bigint
): void {
  // Don't update zero address
  if (ZERO_ADDRESS == account.id) return;

  // Get existing account balance or create a new one
  const accountBalance = getOrCreateAccountBalance(account, token);
  const balance = accountBalance.amount.plus(bigIntToBigDecimal(amount));

  // Update the account balance
  accountBalance.amount = balance;
  accountBalance.save();
}

function getOrCreateAccountBalance(
  account: Account,
  token: Token
): TokenBalance {
  const id = token.id + "-" + account.id;
  let tokenBalance = TokenBalance.load(id);

  // If balance is not already saved
  // create a new TokenBalance instance
  if (!tokenBalance) {
    tokenBalance = new TokenBalance(id);
    tokenBalance.account = account.id;
    tokenBalance.token = token.id;
    tokenBalance.amount = BigDecimal.fromString("0");

    tokenBalance.save();
  }

  return tokenBalance;
}

function bigIntToBigDecimal(quantity: bigint, decimals: i32 = 18): BigDecimal {
  return quantity.toBigDecimal().div(
    BigInt.fromI32(10)
      .pow(decimals as u8)
      .toBigDecimal()
  );
}
