import { httpFetchOwned, httpGetTransaction, httpMint } from "../utils.js";

export class ThirdWebEngine {
  public static mint = async (receiver: string) => {
    const response = await httpMint(receiver);
    return response;
  };

  public static NFTOwned = async (receiver: string) => {
    const response = await httpFetchOwned(receiver);
    return response.result;
  };

  public static getTransaction = async (queueId: string) => {
    const response = await httpGetTransaction(queueId);
    return response.result;
  };
}
