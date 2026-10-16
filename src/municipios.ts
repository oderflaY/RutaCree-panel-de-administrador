// Cabeceras de los municipios del estado de Durango, para saltar a ellas en los mapas del panel.
export type Municipio = { name: string; center: [number, number]; zoom: number }

export const ESTADO: Municipio = { name: 'Todo el estado', center: [-104.9, 24.9], zoom: 6.4 }

export const MUNICIPIOS: Municipio[] = [
  { name: 'Durango', center: [-104.6532, 24.0277], zoom: 12.4 },
  { name: 'Gómez Palacio', center: [-103.4983, 25.5611], zoom: 12.6 },
  { name: 'Lerdo', center: [-103.5245, 25.5383], zoom: 13 },
  { name: 'Santiago Papasquiaro', center: [-105.4192, 25.0439], zoom: 13.5 },
  { name: 'Pueblo Nuevo (El Salto)', center: [-105.3606, 23.7783], zoom: 13.5 },
  { name: 'Canatlán', center: [-104.7740, 24.5250], zoom: 13.5 },
  { name: 'Guadalupe Victoria', center: [-104.1211, 24.4469], zoom: 13.5 },
  { name: 'Nombre de Dios', center: [-104.2461, 23.8492], zoom: 13.5 },
  { name: 'Vicente Guerrero', center: [-103.9842, 23.7353], zoom: 13.5 },
  { name: 'Poanas (Villa Unión)', center: [-104.0469, 23.9744], zoom: 13.5 },
  { name: 'Mezquital', center: [-104.3961, 23.4736], zoom: 13.5 },
  { name: 'Súchil', center: [-103.9233, 23.6211], zoom: 14 },
  { name: 'Cuencamé', center: [-103.6975, 24.8711], zoom: 13.5 },
  { name: 'Peñón Blanco', center: [-104.0306, 24.7881], zoom: 14 },
  { name: 'Pánuco de Coronado', center: [-104.3289, 24.5392], zoom: 14 },
  { name: 'San Juan del Río', center: [-104.4614, 24.7769], zoom: 14 },
  { name: 'Rodeo', center: [-104.5594, 25.1778], zoom: 14 },
  { name: 'Nazas', center: [-104.1131, 25.2250], zoom: 14 },
  { name: 'Mapimí', center: [-103.8500, 25.8333], zoom: 14 },
  { name: 'Tlahualilo', center: [-103.4436, 26.1053], zoom: 13.5 },
  { name: 'Santa María del Oro', center: [-105.3667, 25.9500], zoom: 14 },
  { name: 'Tepehuanes', center: [-105.7258, 25.3394], zoom: 14 },
  { name: 'Guanaceví', center: [-105.9500, 25.9333], zoom: 14 },
  { name: 'Topia', center: [-106.5711, 25.2119], zoom: 14 },
  { name: 'Tamazula', center: [-106.9672, 24.9686], zoom: 14 },
]
