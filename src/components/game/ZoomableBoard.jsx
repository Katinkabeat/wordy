import Board from './Board.jsx'
import useBoardZoom from '../../hooks/useBoardZoom.js'

export default function ZoomableBoard(props) {
  const { cellSize } = props
  // Total board pixel size: 15 cells + 14 gap pixels + 4px border
  const totalSize = 15 * cellSize + 18

  const { containerRef, boardStyle } = useBoardZoom(totalSize)

  return (
    <div
      ref={containerRef}
      style={{
        width: totalSize + 4,
        height: totalSize + 4,
        overflow: 'hidden',
        position: 'relative',
        touchAction: 'none',
        padding: 2,
      }}
    >
      <div style={boardStyle}>
        <Board {...props} />
      </div>
    </div>
  )
}
