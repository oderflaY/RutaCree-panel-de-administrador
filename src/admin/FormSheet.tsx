import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { FormCell, FormSheet as Sheet, FormStyle } from './types'

// Dibuja una hoja del formato como en Excel: mismos anchos de columna, altos de fila, celdas
// combinadas, letras, rellenos, bordes y logos. Las celdas que se llenan son campos de texto.
// Fondo azul claro = lo llenó el sistema; amarillo = escrito a mano en el panel.

function cellCss(s: FormStyle | undefined): CSSProperties {
  if (!s) return {}
  const [l, r, t, b] = s.bd
  const line = (w: number) => (w ? `${w}px solid #000` : undefined)
  return {
    fontWeight: s.b ? 700 : 400,
    fontStyle: s.i ? 'italic' : undefined,
    textDecoration: s.u ? 'underline' : undefined,
    // Un poco menor: sin Calibri, el navegador usa una letra más ancha y el texto no cabría como en Excel.
    fontSize: `${(s.sz || 11) * 0.9}pt`,
    fontFamily: s.ff ? `"${s.ff}", Calibri, Arial, sans-serif` : 'Calibri, Arial, sans-serif',
    color: s.c || '#000',
    background: s.bg || undefined,
    textAlign: (s.ha === 'centerContinuous' ? 'center' : s.ha || 'left') as CSSProperties['textAlign'],
    verticalAlign: s.va === 'center' ? 'middle' : s.va === 'top' ? 'top' : 'bottom',
    whiteSpace: s.wr ? 'pre-wrap' : 'pre',
    borderLeft: line(l), borderRight: line(r), borderTop: line(t), borderBottom: line(b),
  }
}

export function FormSheet({
  sheet, values, edited, onChange, zoom,
}: {
  sheet: Sheet
  values: Record<string, string>
  edited: Record<string, string>
  onChange: (ref: string, value: string) => void
  zoom: number
}) {
  // Celdas por posición, y las que quedan tapadas por una combinada.
  const { byPos, covered } = useMemo(() => {
    const byPos = new Map<string, FormCell>()
    const covered = new Set<string>()
    for (const c of sheet.cells) {
      byPos.set(`${c.r}:${c.c}`, c)
      for (let r = c.r; r < c.r + (c.rs ?? 1); r++) {
        for (let k = c.c; k < c.c + (c.cs ?? 1); k++) if (r !== c.r || k !== c.c) covered.add(`${r}:${k}`)
      }
    }
    return { byPos, covered }
  }, [sheet])

  const left = useMemo(() => sheet.cols.reduce<number[]>((a, w, i) => [...a, (a[i] ?? 0) + w], [0]), [sheet.cols])
  const top = useMemo(() => sheet.rows.reduce<number[]>((a, h, i) => [...a, (a[i] ?? 0) + h], [0]), [sheet.rows])
  const width = left[left.length - 1]

  return (
    <div className="relative bg-white" style={{ width: width * zoom, height: top[top.length - 1] * zoom }}>
      <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', width, position: 'absolute', inset: 0 }}>
        <table style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width, color: '#000' }}>
          <colgroup>{sheet.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <tbody>
            {sheet.rows.map((h, ri) => {
              const r = ri + 1
              return (
                <tr key={r} style={{ height: h }}>
                  {sheet.cols.map((_, ci) => {
                    const c = ci + 1
                    const key = `${r}:${c}`
                    if (covered.has(key)) return null
                    const cell = byPos.get(key)
                    const s = cell ? sheet.styles[cell.s] : undefined
                    const css: CSSProperties = { ...cellCss(s), padding: '0 2px', overflow: 'hidden', lineHeight: 1.15 }
                    if (!cell) return <td key={c} style={css} />
                    if (!cell.f) {
                      return <td key={c} colSpan={cell.cs} rowSpan={cell.rs} style={css}>{cell.v}</td>
                    }
                    const value = values[cell.ref] ?? cell.v ?? ''
                    const isEdited = cell.ref in edited
                    const fromSystem = !isEdited && (cell.a ?? '') !== ''
                    const multiline = (cell.rs ?? 1) > 1 || !!s?.wr
                    // Como en Excel, un texto de una celda sola se desborda sobre las vacías de la derecha.
                    let spill = 0
                    if (!multiline && (cell.cs ?? 1) === 1 && css.textAlign !== 'right' && css.textAlign !== 'center') {
                      for (let k = c + 1; k <= sheet.cols.length; k++) {
                        const next = byPos.get(`${r}:${k}`)
                        if (covered.has(`${r}:${k}`) || next?.f || next?.v) break
                        spill += sheet.cols[k - 1]
                      }
                    }
                    return (
                      <td key={c} colSpan={cell.cs} rowSpan={cell.rs} style={{ ...css, padding: 0, position: 'relative', overflow: spill ? 'visible' : 'hidden' }}>
                        <textarea
                          aria-label={`Celda ${cell.ref}`}
                          title={isEdited ? `Escrito a mano · el sistema pondría: “${cell.a ?? ''}”` : fromSystem ? 'Lo llenó el sistema; puedes cambiarlo' : 'Escribe aquí'}
                          value={value}
                          onChange={(e) => onChange(cell.ref, e.target.value)}
                          rows={1}
                          spellCheck={false}
                          className="form-cell"
                          data-state={isEdited ? 'edited' : fromSystem ? 'auto' : 'empty'}
                          style={{
                            font: 'inherit', color: 'inherit', textAlign: css.textAlign,
                            width: spill ? `calc(100% + ${spill}px)` : undefined,
                            whiteSpace: multiline ? 'pre-wrap' : 'pre',
                            // Una línea se acomoda como en Excel: abajo (lo normal), al centro o arriba.
                            paddingTop: multiline || css.verticalAlign === 'top' ? 1
                              : css.verticalAlign === 'middle' ? Math.max(0, (h * (cell.rs ?? 1) - 18) / 2)
                              : Math.max(1, h * (cell.rs ?? 1) - 20),
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {sheet.pictures.map((p, i) => {
          // Excel muestra un recorte de la imagen: se agranda y se mueve dentro de un marco del tamaño final.
          const [cl, ct, cr, cb] = p.crop ?? [0, 0, 0, 0]
          const iw = p.w / Math.max(0.01, 1 - cl - cr)
          const ih = p.h / Math.max(0.01, 1 - ct - cb)
          return (
            <div
              key={i}
              style={{ position: 'absolute', left: left[p.c - 1] + p.dx, top: top[p.r - 1] + p.dy, width: p.w, height: p.h, overflow: 'hidden', pointerEvents: 'none' }}
            >
              <img src={p.src} alt="" draggable={false} style={{ position: 'absolute', left: -cl * iw, top: -ct * ih, width: iw, height: ih, maxWidth: 'none' }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
