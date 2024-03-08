using Berachain.Explorer.Blazor.Hubs;
using Berachain.Explorer.Blazor.Services;

namespace Berachain.Explorer.Blazor.Workers
{
    public class LatestActionsWorker : BackgroundService
    {
        private readonly ILogger<LatestActionsWorker> _logger;
        private readonly ExplorerService _explorerService;
        private readonly MessageHub _messageHub;

        public LatestActionsWorker(ILogger<LatestActionsWorker> logger, ExplorerService explorerService, MessageHub messageHub)
        {
            _logger = logger;
            _explorerService = explorerService;
            _messageHub = messageHub;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var isSubscribed = _messageHub.IsSubscribed;
                    if (isSubscribed)
                    {
                        var blocks = await _explorerService.GetBlocks();
                        var transactions = await _explorerService.GetTransactions();

                        if (blocks != null)
                        {
                            _messageHub.Publish(blocks);
                        }

                        if (transactions != null)
                        {
                            _messageHub.Publish(transactions);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error while getting latest actions");
                }

                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            }
        }
    }
}
