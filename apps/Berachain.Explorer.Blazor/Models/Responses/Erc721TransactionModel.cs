namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class Erc721TransactionModel : TransactionModel
    {
        public string TxHash { get; set; } = null!;
        public string TokenId { get; set; } = null!;
        public string TokenName { get; set; } = null!;
        public string TokenSymbol { get; set; } = null!;
    }
}
