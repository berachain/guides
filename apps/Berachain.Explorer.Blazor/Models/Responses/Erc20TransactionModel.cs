namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class Erc20TransactionModel : BaseTransactionModel
    {
        public string TxHash { get; set; } = null!;
        public string Amount { get; set; } = null!;
        public string TokenAddress { get; set; } = null!;
        public string TokenName { get; set; } = null!;
        public string TokenSymbol { get; set; } = null!;
    }
}
