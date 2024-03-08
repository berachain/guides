using System.Numerics;
using System.Text.Json.Serialization;

namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class BlockModel
    {
        [JsonConverter(typeof(BigIntegerConverter))]
        public BigInteger Number { get; set; }
        public string Id { get; set; } = null!;
        public string Parent { get; set; } = null!;
        public string Size { get; set; } = null!;
        public string Volume { get; set; } = null!;
        public string GasLimit { get; set; } = null!;
        public string GasUsed { get; set; } = null!;
        public string[] Transactions { get; set; } = null!;
        public string BurnedFees { get; set; } = null!;
        public DateTime Timestamp { get; set; }
        [JsonConverter(typeof(BigIntegerConverter))]
        public BigInteger CurrentBlockNumber { get; set; }
    }
}
