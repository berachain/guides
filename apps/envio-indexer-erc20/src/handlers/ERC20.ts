import { indexer, type Account, type Approval } from "envio";

indexer.onEvent(
  { contract: "ERC20", event: "Approval" },
  async ({ event, context }) => {
    let ownerAccount = await context.Account.get(event.params.owner);

    if (ownerAccount === undefined) {
      let accountObject: Account = {
        id: event.params.owner,
        balance: 0n,
      };
      context.Account.set(accountObject);
    }

    let approvalId = event.params.owner + "-" + event.params.spender;

    let approvalObject: Approval = {
      id: approvalId,
      amount: event.params.value,
      owner_id: event.params.owner,
      spender_id: event.params.spender,
    };

    context.Approval.set(approvalObject);
  },
);

indexer.onEvent(
  { contract: "ERC20", event: "Transfer" },
  async ({ event, context }) => {
    let [senderAccount, receiverAccount] = await Promise.all([
      context.Account.get(event.params.from),
      context.Account.get(event.params.to),
    ]);

    if (senderAccount === undefined) {
      let accountObject: Account = {
        id: event.params.from,
        balance: 0n - event.params.value,
      };

      context.Account.set(accountObject);
    } else {
      let accountObject: Account = {
        id: senderAccount.id,
        balance: senderAccount.balance - event.params.value,
      };
      context.Account.set(accountObject);
    }

    if (receiverAccount === undefined) {
      let accountObject: Account = {
        id: event.params.to,
        balance: event.params.value,
      };
      context.Account.set(accountObject);
    } else {
      let accountObject: Account = {
        id: receiverAccount.id,
        balance: receiverAccount.balance + event.params.value,
      };

      context.Account.set(accountObject);
    }
  },
);
