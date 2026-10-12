import { useCallback, useEffect, useState } from 'react'

/**
 * Filtr období sdílený napříč stránkami (sessionStorage — drží se při překliknutí
 * v menu i po reloadu, nový tab / zavření prohlížeče začne od výchozího).
 *
 * Stránky se renderují až na klientovi (AccessGate), takže čtení v inicializaci
 * useState nezpůsobí hydration mismatch.
 */

const STORAGE_KEY = 'prvni.dateFilter.v1'
const PERIODS = new Set(['week', 'month', 'ytd', 'custom'])

function readStored() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !PERIODS.has(parsed.period)) return null
    return {
      period: parsed.period,
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : '',
      endDate: typeof parsed.endDate === 'string' ? parsed.endDate : ''
    }
  } catch {
    return null
  }
}

function writeStored(value) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // privátní okno / zablokované úložiště — filtr jen nepřežije navigaci
  }
}

/**
 * @param {{ period?: string, startDate?: string, endDate?: string }} defaults
 *   výchozí hodnoty stránky, když v session nic není. Když uložené období
 *   odpovídá výchozímu (např. „month“) a stránka chce explicitní data, použijí se její.
 */
export default function usePersistedDateFilter(defaults = {}) {
  const [state, setState] = useState(() => {
    const fallback = {
      period: defaults.period || 'month',
      startDate: defaults.startDate || '',
      endDate: defaults.endDate || ''
    }
    const stored = typeof window === 'undefined' ? null : readStored()
    if (!stored) return fallback
    if (stored.period !== 'custom' && stored.period === fallback.period) return fallback
    return stored
  })

  useEffect(() => {
    writeStored(state)
  }, [state])

  const setPeriod = useCallback((period) => setState((s) => ({ ...s, period })), [])
  const setStartDate = useCallback((startDate) => setState((s) => ({ ...s, startDate })), [])
  const setEndDate = useCallback((endDate) => setState((s) => ({ ...s, endDate })), [])

  return {
    period: state.period,
    startDate: state.startDate,
    endDate: state.endDate,
    setPeriod,
    setStartDate,
    setEndDate
  }
}
