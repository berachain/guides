using System.Numerics;

namespace Berachain.Explorer.Blazor
{
    public static class Helpers
    {
        public static string TrimHash(string hash)
        {
            if (string.IsNullOrEmpty(hash))
            {
                return string.Empty;
            }

            return hash.Length > 7 ? $"{hash.Substring(0, 7)}...{hash.Substring(hash.Length - 6)}" : hash;
        }

        public static double ToFriendlyNumber(string value)
        {
            if (BigInteger.TryParse(value, out var bigInteger))
            {
                return ToFriendlyNumber(bigInteger);
            }

            return 0;
        }

        public static double ToFriendlyNumber(BigInteger value)
        {
            var normalizedValue = (double)value / 1_000_000_000_000_000_000;

            return Math.Round(normalizedValue, 8);
        }
    }
}
