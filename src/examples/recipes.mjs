export const WEB_SCRIPT = [
  {
    selector: '#refresh',
    dwellMs: 2200,
    label: 'Refresh data',
    expect: { selector: '#toast', text: 'Data refreshed' },
  },
  {
    selector: '#deploy',
    dwellMs: 2600,
    label: 'Deploy to production',
    expect: { selector: '#toast', text: 'Deploy succeeded' },
  },
  {
    selector: '.tab[data-tab="Reports"]',
    dwellMs: 2000,
    label: 'Reports tab',
    expect: { selector: '#title', text: 'Reports' },
  },
  {
    selector: '.tab[data-tab="Alerts"]',
    dwellMs: 2200,
    label: 'Alerts tab',
    expect: { selector: '#title', text: 'Alerts' },
  },
]
export const ELECTRON_SCRIPT = [
  { selector: '#sync', dwellMs: 2000, label: 'Sync' },
  { selector: '#deploy', dwellMs: 2600, label: 'Deploy' },
  { selector: '.item[data-view="Services"]', dwellMs: 2000, label: 'Services' },
  {
    selector: '.item[data-view="Incidents"]',
    dwellMs: 2200,
    label: 'Incidents',
  },
]
export const ELECTRON_ANCHORS = [
  '#sync',
  '#deploy',
  '#m1',
  '#m2',
  '#m3',
  '#list .row:first-child',
  '.item[data-view="Incidents"]',
]
