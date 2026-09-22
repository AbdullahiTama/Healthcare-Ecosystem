import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

export function renderWithQueryClient(ui, options = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  const ParentWrapper = options.wrapper

  function Wrapper({ children }) {
    const content = ParentWrapper
      ? <ParentWrapper>{children}</ParentWrapper>
      : children

    return (
      <QueryClientProvider client={queryClient}>
        {content}
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { ...options, wrapper: Wrapper }),
    queryClient,
  }
}
