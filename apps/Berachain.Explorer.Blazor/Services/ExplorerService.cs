using Berachain.Explorer.Blazor.Models;
using Berachain.Explorer.Blazor.Models.Configurations;
using Berachain.Explorer.Blazor.Models.Responses;
using Microsoft.Extensions.Options;
using System.Numerics;

namespace Berachain.Explorer.Blazor.Services
{
    public class ExplorerService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<ExplorerService> _logger;
        private readonly ExplorerConfiguration _explorerConfiguration;

        private int _chainId => _explorerConfiguration.ChainId;
        private string _networkId => _explorerConfiguration.NetworkId;

        public ExplorerService(HttpClient httpClient, ILogger<ExplorerService> logger, IOptions<ExplorerConfiguration> explorerConfiguration)
        {
            _httpClient = httpClient;
            _logger = logger;
            _explorerConfiguration = explorerConfiguration.Value;
        }

        public async Task<ResponseCollection<TransactionModel>?> GetTransactions(int take = 10, string? nextToken = null)
        {
            try
            {
                var url = $"/v2/network/{_networkId}/evm/{_chainId}/transactions?sort=desc&limit={take}";

                if (!string.IsNullOrEmpty(nextToken))
                {
                    url += $"&next={nextToken}";
                }

                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<TransactionModel>>(url);

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting transactions");

                return null;
            }
        }

        public async Task<TransactionModel?> GetTransaction(string transactionId)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<TransactionModel>($"/v2/network/{_networkId}/evm/{_chainId}/transactions/{transactionId}");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting transaction");

                return null;
            }
        }

        public async Task<ResponseCollection<BlockModel>?> GetBlocks(int take = 10, string? nextToken = null)
        {
            try
            {
                var url = $"/v2/network/{_networkId}/evm/{_chainId}/blocks?sort=desc&limit={take}";
                if (!string.IsNullOrEmpty(nextToken))
                {
                    url += $"&next={nextToken}";
                }

                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<BlockModel>>(url);

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting blocks");

                return null;
            }
        }

        public async Task<BlockModel?> GetBlock(string blockId)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<BlockModel>($"/v2/network/{_networkId}/evm/{_chainId}/blocks/{blockId}");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting block");

                return null;
            }
        }

        public async Task<AddressModel?> GetAddressDetails(string address)
        {
            try
            {
                var balanceResponse = await _httpClient.GetFromJsonAsync<ResponseCollection<BalanceModel>>($"/v2/network/{_networkId}/evm/{_chainId}/address/{address}/gas-balance?limit=25");

                var balance = balanceResponse?.Items?.FirstOrDefault()?.Balance;
                _ = BigInteger.TryParse(balance, out BigInteger balanceParsed);

                return new AddressModel(address, balanceParsed);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting address details");

                return null;
            }
        }

        public async Task<ResponseCollection<TokenModel>?> GetAddressTokens(string address)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<TokenModel>>($"/v2/network/{_networkId}/evm/{_chainId}/address/{address}/erc20-holdings?limit=25");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting address tokens");

                return null;
            }
        }

        public async Task<ResponseCollection<TransactionModel>?> GetAddressTransactions(string address, int take = 25)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<TransactionModel>>($"/v2/network/{_networkId}/evm/{_chainId}/address/{address}/transactions?limit={take}");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting address transactions");

                return null;
            }
        }

        public async Task<ResponseCollection<InternalTransactionModel>?> GetAddressInternalTransactions(string address, int take = 25)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<InternalTransactionModel>>($"/v2/network/{_networkId}/evm/{_chainId}/address/{address}/internal-operations?limit={take}");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting address transactions");

                return null;
            }
        }

        public async Task<ResponseCollection<Erc20TransactionModel>?> GetAddressErc20Transactions(string address, int take = 25)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<Erc20TransactionModel>>($"/v2/network/{_networkId}/evm/{_chainId}/address/{address}/erc20-transfers?limit={take}");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting address transactions");

                return null;
            }
        }

        public async Task<ResponseCollection<Erc721TransactionModel>?> GetAddressErc721Transactions(string address, int take = 25)
        {
            try
            {
                var response = await _httpClient.GetFromJsonAsync<ResponseCollection<Erc721TransactionModel>>($"/v2/network/{_networkId}/evm/{_chainId}/address/{address}/erc721-transfers?limit={take}");

                return response;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while getting address transactions");

                return null;
            }
        }
    }
}
