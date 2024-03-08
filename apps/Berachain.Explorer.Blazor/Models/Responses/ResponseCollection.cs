using Berachain.Explorer.Blazor.Interfaces;

namespace Berachain.Explorer.Blazor.Models.Responses
{
    public class ResponseCollection<T> : IMessage
        where T : class
    {
        public T[] Items { get; set; } = [];

        public ResponseLink? Link { get; set; }
    }

    public class ResponseLink
    {
        public string? NextToken { get; set; }
    }
}
