/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Token público de Mapbox (pk.…) para el fondo de los mapas; sin él se usa Esri.
  readonly VITE_MAPBOX_TOKEN?: string
}
