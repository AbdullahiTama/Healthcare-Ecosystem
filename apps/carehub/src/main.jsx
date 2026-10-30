import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/global.css'

// Each deploy replaces the hashed chunk files. A tab left open across a deploy
// still asks for the old names, and the first lazily loaded screen it opens
// (the Discovery map, Excel import/export) fails to load, leaving that screen
// broken. Reload once to pick up the new build; the timestamp guard stops a
// loop if the chunk is missing for some other reason.
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
