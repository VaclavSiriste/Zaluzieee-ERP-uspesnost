/**
 * Konfigurace provozních dashboardů podle ERP organizace a Daktela linek.
 * Úspěšnost navolání: ERP organization_id (orders.organization_id).
 * SLA příchozích linek: fronty v Daktela (q.title / q.name).
 */

const CZ_SLA_QUEUE_BREAKDOWN = [
  { queueId: '2002', label: 'Příjem zakázek IN', countsForSla: true },
  { queueId: '2003', label: 'Příjem zakázek OUT' },
  { queueId: '2021', label: 'Příjem zakázek OUT (739028295)' },
  { queueId: '2028', label: 'Koordinátor schůzek IN' },
  { queueId: '6021', label: 'q_ŽAL POP HK' },
  { queueId: '6025', label: 'q_ŽAL POP JHČ' },
  { queueId: '6007', label: 'q_ŽAL POP JMK' },
  { queueId: '6027', label: 'q_ŽAL POP KAR' },
  { queueId: '6017', label: 'q_ŽAL POP LIB' },
  { queueId: '6001', label: 'q_ŽAL POP MSK' },
  { queueId: '6029', label: 'q_ŽAL POP NEPŘ' },
  { queueId: '6003', label: 'q_ŽAL POP OL' },
  { queueId: '6019', label: 'q_ŽAL POP PCE' },
  { queueId: '6013', label: 'q_ŽAL POP PL' },
  { queueId: '6009', label: 'q_ŽAL POP PR' },
  { queueId: '6011', label: 'q_ŽAL POP SČK' },
  { queueId: '6015', label: 'q_ŽAL POP ÚST' },
  { queueId: '6023', label: 'q_ŽAL POP VYS' },
  { queueId: '6005', label: 'q_ŽAL POP ZL' }
]

const VENKOVKY_SLA_QUEUE_BREAKDOWN = [
  { queueId: '2026', label: 'Venkovky IN', countsForSla: true },
  { queueId: '2025', label: 'Venkovky OUT' },
  { queueId: '2027', label: 'Mimopracovní Venkovky' }
]

/** Všechny fronty Venkovky v Daktela — vyloučit z ostatních značek. */
export const VENKOVKY_ALL_QUEUE_IDS = [
  '2025',
  '2026',
  '2027',
  '6050',
  '6500',
  '6501',
  '6502',
  '6503',
  '6504',
  '6505',
  '6506',
  '6507',
  '6508',
  '6509',
  '6511',
  '6512',
  '6513',
  '6514',
  '6515'
]

export const VENKOVKY_QUEUE_NAME_PATTERN = 'venkovky'

export const OPERATIONS_BRANDS = {
  cz: {
    id: 'cz',
    menuLabel: 'zaluzieee - CZ',
    pageTitle: 'zaluzieee - CZ',
    organizationId: 5,
    route: '/rizeni-provozu',
    activeMenuKey: 'operations-cz',
    showTargets: true,
    targetsBrandId: 'cz',
    navolaniHint: 'ERP · organizace č. 5 (zaluzieee) · termín zaměření ANO / dopadl hovor ANO',
    slaLineHint: 'Daktela · Příjem zakázek IN/OUT, Koordinátor schůzek, q_ŽAL POP regiony',
    slaQueueMatch: {
      mode: 'lines',
      queueIds: CZ_SLA_QUEUE_BREAKDOWN.map((segment) => segment.queueId)
    },
    slaQueueBreakdown: CZ_SLA_QUEUE_BREAKDOWN
  },
  sk: {
    id: 'sk',
    menuLabel: 'zaluzieee - SK',
    pageTitle: 'zaluzieee - SK',
    organizationId: null,
    route: '/rizeni-provozu-sk',
    activeMenuKey: 'operations-sk',
    navolaniHint: 'ERP · organizace SK · termín zaměření ANO / dopadl hovor ANO',
    slaLineHint: 'Daktela · fronty SK_Příjem zakázek IN / OUT / Zmeškaný hovor (2029, 9001, 5050)',
    slaQueueMatch: {
      mode: 'lines',
      queueIds: ['2029', '9001', '5050']
    },
    slaQueueBreakdown: [
      { queueId: '2029', label: 'SK_Příjem zakázek IN', countsForSla: true },
      { queueId: '9001', label: 'SK_Příjem zakázek OUT' },
      { queueId: '5050', label: 'SK_Progresivní kampaň Zmeškaný hovor' }
    ]
  },
  malujemeee: {
    id: 'malujemeee',
    menuLabel: 'malujemeee',
    pageTitle: 'malujemeee',
    organizationId: 6,
    route: '/rizeni-provozu-malujemeee',
    activeMenuKey: 'operations-malujemeee',
    showTargets: true,
    targetsBrandId: 'malujemeee',
    navolaniHint: 'ERP · organizace č. 6 (malujemeee) · termín zaměření ANO / dopadl hovor ANO',
    slaLineHint: 'Daktela · fronty Malujemeee IN / OUT / Mimopracovní (2014, 2015, 2017)',
    slaQueueMatch: {
      mode: 'lines',
      queueIds: ['2014', '2015', '2017']
    },
    slaQueueBreakdown: [
      { queueId: '2014', label: 'Malujemeee IN', countsForSla: true },
      { queueId: '2015', label: 'Malujemeee OUT' },
      { queueId: '2017', label: 'Mimopracovní Malujemeee' }
    ]
  },
  pokladamee: {
    id: 'pokladamee',
    menuLabel: 'pokladamee',
    pageTitle: 'pokladamee',
    organizationId: 7,
    route: '/rizeni-provozu-pokladamee',
    activeMenuKey: 'operations-pokladamee',
    showTargets: true,
    targetsBrandId: 'pokladamee',
    navolaniHint: 'ERP · organizace č. 7 (pokladameee) · termín zaměření ANO / dopadl hovor ANO',
    slaLineHint: 'Daktela · fronty Pokládámeee IN / OUT / Zmeškaný hovor (2031, 9002, 4040)',
    slaQueueMatch: {
      mode: 'lines',
      queueIds: ['2031', '9002', '4040']
    },
    slaQueueBreakdown: [
      { queueId: '2031', label: 'Pokládámeee IN', countsForSla: true },
      { queueId: '9002', label: 'Pokládámeee OUT' },
      { queueId: '4040', label: 'Pokládámeee – Zmeškaný hovor' }
    ]
  },
  venkovky: {
    id: 'venkovky',
    menuLabel: 'Venkovky',
    pageTitle: 'Venkovky',
    organizationId: 8,
    route: '/rizeni-provozu-venkovky',
    activeMenuKey: 'operations-venkovky',
    showTargets: true,
    targetsBrandId: 'venkovky',
    navolaniHint: 'ERP · organizace č. 8 (Venkovky) · termín zaměření ANO / dopadl hovor ANO',
    slaLineHint: 'Daktela · fronty Venkovky IN / OUT / Mimopracovní (2026, 2025, 2027)',
    slaQueueMatch: {
      mode: 'lines',
      queueIds: VENKOVKY_SLA_QUEUE_BREAKDOWN.map((segment) => segment.queueId)
    },
    slaQueueBreakdown: VENKOVKY_SLA_QUEUE_BREAKDOWN
  }
}

/** @deprecated použijte slaQueueMatch u jednotlivých značek */
export const SLA_OTHER_BRAND_QUEUE_PATTERNS = ['pokladameee', 'malujemeee', 'sk']

export function resolveOperationsBrand(brandId) {
  if (!brandId) return OPERATIONS_BRANDS.cz
  return OPERATIONS_BRANDS[brandId] || null
}

export function resolveOrganizationId({ brandId, organizationId }) {
  if (organizationId != null && organizationId !== '') {
    const parsed = Number(organizationId)
    return Number.isFinite(parsed) ? parsed : null
  }
  const brand = resolveOperationsBrand(brandId)
  return brand?.organizationId ?? null
}
