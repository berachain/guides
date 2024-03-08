namespace Berachain.Explorer.Blazor.Models
{
    public class TokenModel
    {
        public string TokenAddress { get; set; } = null!;
        public string TokenName { get; set; } = null!;
        public string TokenSymbol { get; set; } = null!;
        public int TokenDecimals { get; set; }
        public string TokenQuantity { get; set; } = null!;
        public string TokenValueInUsd { get; set; } = null!;
    }
}
