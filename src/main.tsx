import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import maplibregl from 'maplibre-gl'
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './index.css'
import App from './App'
import './theme'

maplibregl.setWorkerUrl(maplibreWorker)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
