/**
 * Utility funkce pro výpočty metrik
 */

/**
 * Vypočítá show-up rate
 * @param {number} completed - Počet realizovaných schůzek
 * @param {number} scheduled - Počet sjednaných schůzek
 * @returns {number} Procento (0-100)
 */
export function calculateShowUpRate(completed, scheduled) {
  if (scheduled === 0) return 0
  return ((completed / scheduled) * 100).toFixed(2)
}

/**
 * Vypočítá offer rate
 * @param {number} offered - Počet schůzek s nabídkou
 * @param {number} completed - Počet realizovaných schůzek
 * @returns {number} Procento (0-100)
 */
export function calculateOfferRate(offered, completed) {
  if (completed === 0) return 0
  return ((offered / completed) * 100).toFixed(2)
}

/**
 * Vypočítá close rate
 * @param {number} closed - Počet uzavřených schůzek
 * @param {number} offered - Počet schůzek s nabídkou
 * @returns {number} Procento (0-100)
 */
export function calculateCloseRate(closed, offered) {
  if (offered === 0) return 0
  return ((closed / offered) * 100).toFixed(2)
}

/**
 * Vypočítá end-to-end close rate
 * @param {number} closed - Počet uzavřených
 * @param {number} scheduled - Počet sjednaných
 * @returns {number} Procento (0-100)
 */
export function calculateEndToEndRate(closed, scheduled) {
  if (scheduled === 0) return 0
  return ((closed / scheduled) * 100).toFixed(2)
}

/**
 * Vypočítá průměrnou hodnotu objednávky
 * @param {number} totalRevenue - Celkový tržby
 * @param {number} closedCount - Počet uzavřených
 * @returns {number} Průměr
 */
export function calculateAverageOrderValue(totalRevenue, closedCount) {
  if (closedCount === 0) return 0
  return (totalRevenue / closedCount).toFixed(2)
}

/**
 * Generuje leaderboard
 * @param {Array} operators - Array operátorů s metrikami
 * @param {string} sortBy - 'showUpRate' | 'closeRate' | 'avgValue'
 * @returns {Array} Seřazený leaderboard
 */
export function generateLeaderboard(operators, sortBy = 'showUpRate') {
  return operators
    .map(op => ({
      ...op,
      showUpRate: calculateShowUpRate(op.completed, op.scheduled),
      closeRate: calculateCloseRate(op.closed, op.offered),
      avgValue: calculateAverageOrderValue(op.totalRevenue, op.closed)
    }))
    .sort((a, b) => {
      const aValue = parseFloat(a[sortBy]) || 0
      const bValue = parseFloat(b[sortBy]) || 0
      return bValue - aValue
    })
    .map((op, index) => ({
      ...op,
      rank: index + 1
    }))
}

/**
 * Generuje funnel data
 */
export function generateFunnel(data) {
  return {
    scheduled: data.scheduled || 0,
    completed: data.completed || 0,
    offered: data.offered || 0,
    closed: data.closed || 0,
    dropoffs: {
      scheduledToCompleted: ((data.scheduled - data.completed) / data.scheduled * 100).toFixed(2),
      completedToOffered: ((data.completed - data.offered) / data.completed * 100).toFixed(2),
      offeredToClosed: ((data.offered - data.closed) / data.offered * 100).toFixed(2)
    }
  }
}

/**
 * Segmentuje metriky podle kategorie
 */
export function segmentMetrics(data, byField) {
  const segments = {}
  
  data.forEach(item => {
    const key = item[byField]
    if (!segments[key]) {
      segments[key] = {
        scheduled: 0,
        completed: 0,
        offered: 0,
        closed: 0,
        revenue: 0,
        count: 0
      }
    }
    segments[key].scheduled += item.scheduled || 0
    segments[key].completed += item.completed || 0
    segments[key].offered += item.offered || 0
    segments[key].closed += item.closed || 0
    segments[key].revenue += item.revenue || 0
    segments[key].count += 1
  })
  
  // Vypočítá metriky pro každý segment
  Object.keys(segments).forEach(key => {
    segments[key].showUpRate = calculateShowUpRate(
      segments[key].completed,
      segments[key].scheduled
    )
    segments[key].closeRate = calculateCloseRate(
      segments[key].closed,
      segments[key].offered
    )
    segments[key].avgValue = calculateAverageOrderValue(
      segments[key].revenue,
      segments[key].closed
    )
  })
  
  return segments
}

export default {
  calculateShowUpRate,
  calculateOfferRate,
  calculateCloseRate,
  calculateEndToEndRate,
  calculateAverageOrderValue,
  generateLeaderboard,
  generateFunnel,
  segmentMetrics
}
