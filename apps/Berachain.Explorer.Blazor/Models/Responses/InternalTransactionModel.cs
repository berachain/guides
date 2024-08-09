namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class InternalTransactionModel : BaseTransactionModel
    {
        public string TxHash { get; set; } = null!;
        public string Value { get; set; } = null!;
    }
}
