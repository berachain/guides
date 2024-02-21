namespace Berachain.Explorer.Blazor.Models.Configurations
{
    public class ExplorerConfiguration
    {
        public int ChainId { get; set; }
        public string NetworkId { get; set; } = null!;
        public string ExplorerUrl { get; set; } = null!;
    }
}
