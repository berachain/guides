using System.Numerics;
using System.Text.Json.Serialization;

namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class BaseTransactionModel
    {
        public DateTime Timestamp { get; set; }
        [JsonConverter(typeof(BigIntegerConverter))]
        public BigInteger BlockNumber { get; set; }
        public string From { get; set; } = null!;
        public string To { get; set; } = null!;
    }
}
