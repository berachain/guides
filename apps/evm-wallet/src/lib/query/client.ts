import { QueryClient } from '@tanstack/react-query';

export const BALANCE_STALE_TIME_MS = 15_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: BALANCE_STALE_TIME_MS,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});

export default queryClient;
