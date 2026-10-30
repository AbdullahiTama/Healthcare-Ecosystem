// Must run before App (and with it the Supabase client) is imported: see lib/authLinkErrorRedirect.js.
import './lib/authLinkErrorRedirect'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/global.css'

// Each deploy replaces the hashed chunk files, and every route here is lazy.
// A tab left open across a deploy still asks for the old names, so the next
// screen it opens fails to load. Reload once to pick up the new build; the
// timestamp guard stops a loop if the chunk is missing for some other reason.
const CHUNK_RELOAD_KEY = 'carehub_chunk_reload_at'
window.addEventListener('vite:preloadError', (event) => {
  let last = 0
  try { last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0 } catch (e) {}
  if (Date.now() - last < 60000) return
  try { sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now())) } catch (e) {}
  console.warn('[app] a newer CareHub build was deployed; reloading to load it')
  event.preventDefault()
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>
)
