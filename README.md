# RutaCree — Panel de administrador

Centro de control web de RutaCree (Ruta Azul, DIF Estatal Durango): Ojo de Dios (unidades en vivo),
formatos DIF en Excel, estadísticas de pasajeros, turnos y flotilla, mantenimiento, incidencias, rutas,
pasajeros y cuentas.

React 19 + Vite + Tailwind + MapLibre. El backend (Go) está en
[Bakend-ruta-cree](https://github.com/oderflaY/Bakend-ruta-cree) y sirve este panel en `/panel/`.

```bash
npm install
npm run dev     # http://localhost:5173/panel/ — reenvía /api al backend (API_TARGET, por defecto producción)
npm run build   # dist/ → lo empaqueta scripts/empaquetar.sh del backend
```

Mapa base: con `VITE_MAPBOX_TOKEN=pk.…` en `.env.local` usa Mapbox; sin él, Esri.
