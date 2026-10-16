// Fondo de los mapas. Con VITE_MAPBOX_TOKEN (token público pk. de Mapbox, al compilar) usa los estilos
// Mapbox Streets y Dark; sin él, Esri Light/Dark Gray con su capa de nombres de calles y lugares.
// Las capas de los dos temas viven en el estilo y solo se alterna su visibilidad, así cambiar de tema
// no borra las rutas ni las unidades dibujadas.
import type maplibregl from 'maplibre-gl'
import type { Theme } from './theme'

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() ?? ''
export const usesMapbox = MAPBOX_TOKEN.startsWith('pk.')

const mapbox = (style: string) =>
  `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
const esri = (name: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`

type Layer = { id: string; theme: Theme }
// Fondo oscuro más profundo y contrastado, para que las rutas DIF resalten como neón suave.
const DARK_PAINT = { 'raster-brightness-max': 0.78, 'raster-contrast': 0.12, 'raster-saturation': -0.15 }
const LAYERS: Layer[] = usesMapbox
  ? [{ id: 'base-light', theme: 'light' }, { id: 'base-dark', theme: 'dark' }]
  : [
      { id: 'base-light', theme: 'light' }, { id: 'labels-light', theme: 'light' },
      { id: 'base-dark', theme: 'dark' }, { id: 'labels-dark', theme: 'dark' },
    ]

export function baseStyle(theme: Theme): maplibregl.StyleSpecification {
  const visibility = (t: Theme) => (t === theme ? 'visible' : 'none') as 'visible' | 'none'
  if (usesMapbox) {
    const attribution = '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    return {
      version: 8,
      sources: {
        light: { type: 'raster', tiles: [mapbox('streets-v12')], tileSize: 512, maxzoom: 22, attribution },
        dark: { type: 'raster', tiles: [mapbox('dark-v11')], tileSize: 512, maxzoom: 22, attribution },
      },
      layers: [
        { id: 'base-light', type: 'raster', source: 'light', layout: { visibility: visibility('light') } },
        { id: 'base-dark', type: 'raster', source: 'dark', layout: { visibility: visibility('dark') }, paint: DARK_PAINT },
      ],
    }
  }
  const attribution = 'Esri, HERE, Garmin, © OpenStreetMap'
  return {
    version: 8,
    sources: {
      light: { type: 'raster', tiles: [esri('World_Light_Gray_Base')], tileSize: 256, maxzoom: 16, attribution },
      lightLabels: { type: 'raster', tiles: [esri('World_Light_Gray_Reference')], tileSize: 256, maxzoom: 16 },
      dark: { type: 'raster', tiles: [esri('World_Dark_Gray_Base')], tileSize: 256, maxzoom: 16, attribution },
      darkLabels: { type: 'raster', tiles: [esri('World_Dark_Gray_Reference')], tileSize: 256, maxzoom: 16 },
    },
    layers: [
      { id: 'base-light', type: 'raster', source: 'light', layout: { visibility: visibility('light') } },
      { id: 'labels-light', type: 'raster', source: 'lightLabels', layout: { visibility: visibility('light') } },
      { id: 'base-dark', type: 'raster', source: 'dark', layout: { visibility: visibility('dark') }, paint: DARK_PAINT },
      { id: 'labels-dark', type: 'raster', source: 'darkLabels', layout: { visibility: visibility('dark') }, paint: { 'raster-opacity': 0.85 } },
    ],
  }
}

export function applyBase(map: maplibregl.Map, theme: Theme) {
  for (const l of LAYERS) {
    if (map.getLayer(l.id)) map.setLayoutProperty(l.id, 'visibility', l.theme === theme ? 'visible' : 'none')
  }
}
