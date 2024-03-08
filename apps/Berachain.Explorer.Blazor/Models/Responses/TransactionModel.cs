using System.Numerics;

namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class TransactionModel : BaseTransactionModel
    {
        public string Id { get; set; } = null!;
        public string BlockHash { get; set; } = null!;
        public string Value { get; set; } = null!;
        public string GasUsed { get; set; } = null!;
        public string GasPrice { get; set; } = null!;
        public string GasLimit { get; set; } = null!;
        public string BurnedFees { get; set; } = null!;
        public bool Status { get; set; }
    }
}
