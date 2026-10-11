'use strict';

const $ = id => document.getElementById(id);
const API = 'https://api.chess.cz/api/competitions';
const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const state = { regions: [], regionCode: null, competition: null, details: null, schedule: [], round: null, match: null, selectedTeamId: null, rosters: [], boards: [] };
let revision = 0;
let report = null;
let templateSource = null;
let retryAction = null;

// Searchable, keyboard-accessible selections. Typed text is never treated as a selected ID.
class Picker {
  constructor(container, label, onSelect) {
    this.items = [];
    this.selected = null;
    this.onSelect = onSelect;
    this.root = document.createElement('div');
    this.root.className = 'combo';
    const caption = document.createElement('label');
    const id = `${container.id || 'player'}-${Picker.nextId++}`;
    caption.htmlFor = id;
    caption.textContent = label;
    this.input = document.createElement('input');
    this.input.id = id;
    this.input.type = 'text';
    this.input.autocomplete = 'off';
    this.input.placeholder = 'Hledat nebo vybrat…';
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'false');
    this.list = document.createElement('ul');
    this.list.id = `${id}-list`;
    this.list.className = 'suggestions';
    this.list.setAttribute('role', 'listbox');
    this.input.setAttribute('aria-controls', this.list.id);
    this.root.append(caption, this.input, this.list);
    container.append(this.root);
    this.close();
    this.input.addEventListener('focus', () => this.open());
    this.input.addEventListener('input', () => {
      if (this.selected) { this.selected = null; this.onSelect(null); }
      this.open();
      queueDraftSave();
    });
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') { this.close(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (this.list.hidden) this.open();
      if (event.key === 'Enter') { if (this.filtered[this.active]) this.choose(this.filtered[this.active]); return; }
      const length = this.filtered.length;
      if (length) this.active = this.active < 0
        ? (event.key === 'ArrowDown' ? 0 : length - 1)
        : (this.active + (event.key === 'ArrowDown' ? 1 : -1) + length) % length;
      this.highlight();
    });
    this.root.addEventListener('focusout', event => { if (!this.root.contains(event.relatedTarget)) this.close(); });
    this.setItems([]);
  }
  setItems(items) {
    this.items = items;
    this.selected = null;
    this.input.value = '';
    this.input.disabled = !items.length;
    this.close();
  }
  open() {
    const query = this.selected ? '' : normalize(this.input.value).trim();
    const terms = query.split(/\s+/).filter(Boolean);
    this.filtered = this.items.filter(item => terms.every(term => normalize(`${item.label} ${item.search || ''}`).includes(term)));
    this.active = -1;
    this.list.replaceChildren();
    this.filtered.forEach((item, index) => {
      const option = document.createElement('li');
      option.id = `${this.list.id}-${index}`;
      option.setAttribute('role', 'option');
      option.textContent = item.label;
      option.addEventListener('mousedown', event => { event.preventDefault(); this.choose(item); });
      this.list.append(option);
    });
    if (!this.filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Žádné odpovídající možnosti';
      this.list.append(empty);
    }
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.highlight();
  }
  highlight() {
    [...this.list.children].forEach((child, index) => child.setAttribute('aria-selected', String(index === this.active)));
    if (this.active >= 0) {
      this.input.setAttribute('aria-activedescendant', this.list.children[this.active].id);
      this.list.children[this.active].scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }
  choose(item) {
    this.display(item);
    this.onSelect(item.value);
    queueDraftSave();
  }
  display(item) {
    this.selected = item;
    this.input.value = item?.label || '';
    this.close();
  }
  close() { this.list.hidden = true; this.input.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant'); }
}
Picker.nextId = 0;

function message(text = '', error = false, retry = null) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
  retryAction = retry;
  $('retry').hidden = !retry;
}
$('retry').addEventListener('click', () => retryAction?.());

async function get(path) {
  const response = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`API: HTTP ${response.status}`);
  return response.json();
}
async function load(task, loading, success, retry) {
  const ticket = ++revision;
  message(loading);
  try {
    const result = await task();
    if (ticket !== revision) return;
    message();
    success(result);
  } catch (error) {
    if (ticket !== revision) return;
    message(`Data se nepodařilo načíst. ${error.message}. Zkontrolujte připojení a zkuste to znovu.`, true, retry);
  }
}
function invalidateReport() { report = null; $('report').hidden = true; }
function clearMatch() {
  revision++;
  state.match = null; state.selectedTeamId = null; state.rosters = []; state.boards = [];
  $('lineup-section').hidden = true; $('email-section').hidden = true; $('fixture').hidden = true;
  $('boards').replaceChildren(); $('order-warning').hidden = true; $('order-warning').textContent = '';
  invalidateReport();
}
function clearRound() { clearMatch(); state.round = null; teamPicker.setItems([]); }
function clearCompetition() {
  clearRound(); state.competition = null; state.details = null; state.schedule = [];
  roundPicker.setItems([]);
}

const regionPicker = new Picker($('region-picker'), 'Kraj / svaz', region => {
  state.regionCode = region?.regionCode || null;
  clearCompetition(); message();
  competitionPicker.setItems((region?.competitions || []).map(comp => ({ label: comp.compName, value: comp })));
});
const competitionPicker = new Picker($('competition-picker'), 'Soutěž', selectCompetition);
const roundPicker = new Picker($('round-picker'), 'Kolo', round => {
  clearRound(); message();
  state.round = round;
  if (!round) return;
  const items = teamOptions(round);
  teamPicker.setItems(items);
  if (!items.length) message('V tomto kole nejsou žádná utkání dvou družstev.');
});
const teamPicker = new Picker($('team-picker'), 'Družstvo v tomto kole', selectMatch);

function loadYear() {
  clearCompetition(); state.regionCode = null; competitionPicker.setItems([]); regionPicker.setItems([]);
  if (!$('year').checkValidity()) { message('Zadejte platný rok začátku sezóny.', true); return; }
  load(() => get($('year').value), 'Načítám soutěže…', data => {
    state.regions = Object.values(data || {}).filter(region => Array.isArray(region.competitions));
    regionPicker.setItems(state.regions.map(region => ({ label: region.regionName, search: region.regionCode, value: region })));
    if (!state.regions.length) message('Pro tento rok nejsou dostupné soutěže. Zkuste jiný rok.');
  }, loadYear);
}
function selectCompetition(comp) {
  clearCompetition(); message(); state.competition = comp;
  if (!comp) return;
  load(() => Promise.all([get(`${comp.compId}/details`), get(`${comp.compId}/schedule`)]), 'Načítám podrobnosti soutěže a rozlosování…', ([details, schedule]) => {
    if (!Array.isArray(schedule)) throw new Error('Neočekávaný formát rozlosování');
    state.details = details; state.schedule = schedule;
    roundPicker.setItems(schedule
      .map(round => ({ label: `${round.roundNr}. kolo · ${round.roundDate || 'datum neuvedeno'}`, value: round }))
      .sort((a, b) => a.label.localeCompare(b.label, 'cs', { numeric: true })));
    if (!schedule.length) message('Soutěž zatím nemá zveřejněné rozlosování.');
  }, () => selectCompetition(comp));
}
function selectMatch(selection) {
  clearMatch(); message();
  if (!selection) return;
  const { match, teamId } = selection;
  state.selectedTeamId = teamId;
  const compId = state.competition.compId;
  load(() => Promise.all([get(`${compId}/team/${match.homeTeamId}/roster`), get(`${compId}/team/${match.awayTeamId}/roster`)]), 'Načítám soupisky obou družstev…', rosters => {
    if (!rosters.every(Array.isArray)) throw new Error('Neočekávaný formát soupisek');
    if (rosters.some(roster => !roster.length)) { message('Jedno z družstev zatím nemá zveřejněnou soupisku.', true, () => selectMatch(selection)); return; }
    state.match = match; state.selectedTeamId = teamId;
    state.rosters = rosters.map(roster => [...roster].sort((a, b) => a.rosterPosition - b.rosterPosition));
    const max = Math.min(...rosters.map(roster => roster.length));
    $('board-count').max = max;
    $('board-count').value = Math.min(8, max);
    $('venue').value = ''; $('referee').value = '';
    $('match-date').value = dateInput(state.round.roundDate);
    $('recipient').value = state.details.compManagerEmail || '';
    $('fixture').textContent = `Domácí: ${match.homeTeamName} · Hosté: ${match.awayTeamName}`;
    $('fixture').hidden = false; $('lineup-section').hidden = false; $('email-section').hidden = false;
    renderBoards();
    if (!$('recipient').value) message('API neuvádí e-mail vedoucího soutěže. Doplňte adresu před přípravou zápisu.');
  }, () => selectMatch(selection));
}
function dateInput(value) {
  const match = String(value || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match || Number(match[3]) >= 9999) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}
function teamOptions(round) {
  const items = new Map();
  for (const match of round.roundMatches || []) {
    // A bye has no opposing team and cannot produce a match report.
    if (!match.homeTeamId || !match.awayTeamId) continue;
    if (!items.has(match.homeTeamId)) items.set(match.homeTeamId, { label: match.homeTeamName, value: { match, teamId: match.homeTeamId } });
    if (!items.has(match.awayTeamId)) items.set(match.awayTeamId, { label: match.awayTeamName, value: { match, teamId: match.awayTeamId } });
  }
  return [...items.values()];
}

function renderBoards() {
  invalidateReport();
  if (!$('board-count').checkValidity()) return;
  const count = Number($('board-count').value);
  state.boards = Array.from({ length: count }, (_, index) => state.boards[index] || { home: null, away: null, result: '' });
  $('boards').replaceChildren();
  state.boards.forEach((board, index) => {
    const row = document.createElement('div'); row.className = 'board';
    const number = document.createElement('span'); number.className = 'board-number'; number.textContent = index + 1;
    row.append(number);
    for (const [side, rosterIndex] of [['home', 0], ['away', 1]]) {
      const container = document.createElement('div');
      const picker = new Picker(container, `${side === 'home' ? 'Domácí' : 'Hosté'} · šachovnice ${index + 1}`, player => {
        board[side] = player; invalidateReport(); updateRosterWarnings(); queueDraftSave();
      });
      picker.setItems(state.rosters[rosterIndex].map(player => ({ label: `${player.rosterPosition}. ${player.playerName} · ${player.playerFideElo || player.playerCzeElo || 'bez ELO'}`, search: player.playerId, value: player })));
      if (board[side]) { picker.selected = picker.items.find(item => item.value.playerId === board[side].playerId); picker.input.value = picker.selected.label; }
      row.append(container);
      if (side === 'home') {
        const label = document.createElement('label'); label.textContent = 'Výsledek';
        const select = document.createElement('select'); select.required = true;
        for (const value of ['', '1:0', '0:1', '1/2:1/2']) {
          const option = document.createElement('option'); option.value = value; option.textContent = value || 'Vyberte…'; select.append(option);
        }
        select.value = board.result;
        select.addEventListener('change', () => { board.result = select.value; invalidateReport(); updateScore(); queueDraftSave(); });
        label.append(select); row.append(label);
      }
    }
    $('boards').append(row);
  });
  updateScore(); updateRosterWarnings();
}
function updateRosterWarnings() {
  const problems = [];
  for (const [side, label] of [['home', 'domácích'], ['away', 'hostů']]) {
    for (let index = 1; index < state.boards.length; index++) {
      const previous = state.boards[index - 1][side];
      const current = state.boards[index][side];
      if (previous && current && current.rosterPosition < previous.rosterPosition) {
        problems.push(`${label}: šachovnice ${index + 1} (${current.rosterPosition}. ${current.playerName}) je před šachovnicí ${index} (${previous.rosterPosition}. ${previous.playerName})`);
      }
    }
    const hPlayers = state.boards.filter(board => board[side] && /(^|\s)H(?=\s|$)/.test(board[side].playerFlags || '')).length;
    if (state.boards.length && hPlayers >= state.boards.length / 2) {
      problems.push(`${label}: ${hPlayers} hráčů s označením H z ${state.boards.length} šachovnic (limit je méně než polovina)`);
    }
  }
  const warning = $('order-warning');
  warning.hidden = problems.length === 0;
  warning.textContent = problems.length
    ? `Pozor: ${problems.join('. ')}. Zkontrolujte pořadí hráčů a označení H; můžete pokračovat i tak.`
    : '';
}
function totals() {
  return state.boards.reduce(([home, away], board) => {
    if (board.result === '1:0') home++;
    if (board.result === '0:1') away++;
    if (board.result === '1/2:1/2') { home += .5; away += .5; }
    return [home, away];
  }, [0, 0]);
}
const scoreText = () => totals().map(score => String(score).replace('.', ',')).join(' : ');
function updateScore() {
  const done = state.boards.filter(board => board.result).length;
  $('score').textContent = `Celkový výsledek: ${scoreText()} · vyplněno ${done}/${state.boards.length}`;
}
function validateLineup() {
  if (!state.match || !state.boards.length) throw new Error('Vyberte utkání a počet šachovnic.');
  for (const side of ['home', 'away']) {
    const ids = new Set();
    for (const [index, board] of state.boards.entries()) {
      if (!board[side]) throw new Error(`Vyberte hráče ${side === 'home' ? 'domácích' : 'hostů'} na šachovnici ${index + 1}.`);
      if (ids.has(board[side].playerId)) throw new Error(`Hráč ${board[side].playerName} je v sestavě vícekrát.`);
      ids.add(board[side].playerId);
      if (!['1:0', '0:1', '1/2:1/2'].includes(board.result)) throw new Error(`Vyberte výsledek na šachovnici ${index + 1}.`);
    }
  }
}
function buildReport(source) {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const date = $('match-date').value.split('-').reverse().join('.');
  const [homeScore, awayScore] = totals().map(value => String(value).replace('.', ','));
  const comp = state.competition;
  const replacements = {
    '[Název soutěže]': state.details.compName || comp.compName,
    '[Ročník]': `${comp.compSeason || $('year').value}/${Number(comp.compSeason || $('year').value) + 1}`,
    '[Kolo]': String(state.round.roundNr),
    '[Datum utkání]': date, '[Místo utkání]': $('venue').value.trim(),
    '[Název domácího družstva]': state.match.homeTeamName, '[Název hostujícího družstva]': state.match.awayTeamName,
    '[Domácí]': homeScore, '[Hosté]': awayScore, '[Jméno]': $('referee').value.trim()
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  // Replace text nodes, rather than HTML strings, so names remain literal text.
  for (const node of nodes) node.textContent = node.textContent.replace(/\[[^\]]+\]/g, token => replacements[token] ?? token);
  const body = document.querySelector('tbody');
  const prototype = body.querySelector('tr').cloneNode(true);
  body.replaceChildren();
  state.boards.forEach((board, index) => {
    const row = prototype.cloneNode(true);
    const values = [index + 1, board.home.playerName, board.result, board.away.playerName];
    [...row.cells].forEach((cell, cellIndex) => { cell.textContent = values[cellIndex]; });
    body.append(row);
  });
  const text = [
    `Soutěž: ${replacements['[Název soutěže]']}`, `Ročník: ${replacements['[Ročník]']}`,
    `Kolo: ${state.round.roundNr}`, `Datum: ${date}`, `Místo: ${replacements['[Místo utkání]']}`,
    '', 'Sestavy družstev', `Domácí: ${state.match.homeTeamName}`, `Hosté: ${state.match.awayTeamName}`, '',
    ...state.boards.map((board, index) => `${index + 1}. ${board.home.playerName} — ${board.result} — ${board.away.playerName}`),
    '', `Celkový výsledek zápasu: ${scoreText()}`, `Rozhodčí: ${replacements['[Jméno]']}`
  ].join('\r\n');
  return { html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML, text,
    subject: `${replacements['[Název soutěže]']} — ${state.round.roundNr}. kolo — ${state.match.homeTeamName} : ${state.match.awayTeamName} (${scoreText()})`,
    to: $('recipient').value.trim() };
}
async function loadTemplate() {
  if (templateSource) return templateSource;
  // Browsers block fetch() of local files even though API requests may work.
  // Use the editable external template on HTTP, with a bundled offline fallback.
  if (window.location.protocol !== 'file:') {
    try {
      const response = await fetch('template.html', { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const source = await response.text();
        if (new DOMParser().parseFromString(source, 'text/html').querySelector('tbody tr')) {
          templateSource = source;
          return templateSource;
        }
      }
    } catch {
      // Preview still works if the template request fails or times out.
    }
  }
  templateSource = $('report-template')?.textContent.trim();
  if (!templateSource) throw new Error('Šablona zápisu není dostupná. Zkontrolujte soubory webu.');
  return templateSource;
}
async function prepareReport() {
  if (!$('match-form').reportValidity()) return null;
  const ticket = revision;
  validateLineup();
  const source = await loadTemplate();
  if (ticket !== revision || !$('match-form').reportValidity()) return null;
  validateLineup();
  return buildReport(source);
}
$('match-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const prepared = await prepareReport();
    if (!prepared) return;
    report = prepared;
    $('subject').value = report.subject; $('preview').srcdoc = report.html; $('report').hidden = false;
    message('Zápis je připraven. Zkontrolujte náhled a zvolte způsob přípravy e-mailu.');
  } catch (error) { message(error.message, true); }
});
$('compose').addEventListener('click', () => {
  if (!report) return;
  const subject = report.subject.replaceAll(' — ', ' ');
  const body = report.text.replaceAll(' — ', ' ');
  window.location.href = `mailto:${encodeURIComponent(report.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
$('copy').addEventListener('click', async () => {
  if (!report) return;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([report.html], { type: 'text/html' }), 'text/plain': new Blob([report.text], { type: 'text/plain' }) })]);
    } else {
      const holder = document.createElement('div'); holder.innerHTML = report.html;
      holder.style.position = 'fixed'; holder.style.left = '-10000px'; document.body.append(holder);
      const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(holder); selection.removeAllRanges(); selection.addRange(range);
      const copied = document.execCommand('copy'); selection.removeAllRanges(); holder.remove();
      if (!copied) throw new Error('Kopírování není podporováno');
    }
    message('Formátovaný zápis zkopírován. Vložte jej do těla nového e-mailu.');
  } catch { message('Prohlížeč nepovolil kopírování. Použijte stažení konceptu .eml.', true); }
});
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function encodedBody(value) { return base64Utf8(value).match(/.{1,76}/g).join('\r\n'); }
$('download').addEventListener('click', () => {
  if (!report) return;
  const boundary = `chess-${crypto.randomUUID()}`;
  const subject = Array.from(report.subject).reduce((chunks, char) => {
    if (!chunks.length || new TextEncoder().encode(chunks[chunks.length - 1] + char).length > 42) chunks.push(char);
    else chunks[chunks.length - 1] += char;
    return chunks;
  }, []).map(chunk => `=?UTF-8?B?${base64Utf8(chunk)}?=`).join('\r\n ');
  const eml = [
    `To: ${report.to.replace(/[\r\n]/g, '')}`, `Subject: ${subject}`, 'X-Unsent: 1', 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody(report.text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody(report.html), `--${boundary}--`, ''
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
  const link = document.createElement('a'); link.href = url; link.download = `zapis-kolo-${state.round.roundNr}.eml`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
const DRAFT_KEY = 'chess-match-writer-draft-v1';
let restoringDraft = false;
let saveTimer = null;
let restoreToken = 0;
function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return draft && draft.version === 1 ? draft : null;
  } catch { return null; }
}
function queueDraftSave() {
  if (restoringDraft) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const draft = {
      version: 1,
      year: $('year').value,
      regionCode: state.regionCode,
      compId: state.competition?.compId || null,
      roundNr: state.round?.roundNr ?? null,
      teamId: state.selectedTeamId,
      boardCount: Number($('board-count').value) || 0,
      boards: state.boards.map(board => ({ homeId: board.home?.playerId ?? null, awayId: board.away?.playerId ?? null, result: board.result || '' })),
      date: $('match-date').value,
      venue: $('venue').value,
      referee: $('referee').value,
      recipient: $('recipient').value
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* Storage may be disabled or full. */ }
  }, 180);
}
async function restoreDraft(draft) {
  const token = ++restoreToken;
  restoringDraft = true;
  $('match-form').inert = true;
  message('Obnovuji uložený formulář…');
  try {
    if (draft.year && /^\d{4}$/.test(String(draft.year))) $('year').value = draft.year;
    const year = $('year').value;
    const data = await get(year);
    if (token !== restoreToken) return;
    const regions = Object.values(data || {}).filter(region => Array.isArray(region.competitions));
    const region = regions.find(item => item.regionCode === draft.regionCode) || null;
    const competition = region?.competitions.find(item => Number(item.compId) === Number(draft.compId)) || null;
    let details = null, schedule = [], round = null, options = [], team = null, rosters = [];
    if (competition) {
      [details, schedule] = await Promise.all([get(`${competition.compId}/details`), get(`${competition.compId}/schedule`)]);
      if (token !== restoreToken) return;
      if (!Array.isArray(schedule)) throw new Error('Neočekávaný formát rozlosování.');
      round = schedule.find(item => Number(item.roundNr) === Number(draft.roundNr)) || null;
      if (round) {
        options = teamOptions(round);
        team = options.find(item => Number(item.value.teamId) === Number(draft.teamId)) || null;
        if (team) {
          rosters = await Promise.all([
            get(`${competition.compId}/team/${team.value.match.homeTeamId}/roster`),
            get(`${competition.compId}/team/${team.value.match.awayTeamId}/roster`)
          ]);
          if (token !== restoreToken) return;
          if (!rosters.every(Array.isArray)) throw new Error('Neočekávaný formát soupisek.');
          rosters = rosters.map(roster => [...roster].sort((a, b) => a.rosterPosition - b.rosterPosition));
        }
      }
    }

    // Commit all restored picker selections and fields together, after the API data is ready.
    const regionItems = regions.map(item => ({ label: item.regionName, search: item.regionCode, value: item }));
    const regionItem = regionItems.find(item => item.value === region) || null;
    const competitionItems = (region?.competitions || []).map(item => ({ label: item.compName, value: item }));
    const competitionItem = competitionItems.find(item => item.value === competition) || null;
    const roundItems = schedule.map(item => ({ label: `${item.roundNr}. kolo · ${item.roundDate || 'datum neuvedeno'}`, value: item }))
      .sort((a, b) => a.label.localeCompare(b.label, 'cs', { numeric: true }));
    const roundItem = roundItems.find(item => item.value === round) || null;
    regionPicker.setItems(regionItems); regionPicker.display(regionItem);
    competitionPicker.setItems(competitionItems); competitionPicker.display(competitionItem);
    roundPicker.setItems(roundItems); roundPicker.display(roundItem);
    teamPicker.setItems(options); teamPicker.display(team);
    state.regions = regions; state.regionCode = region?.regionCode || null;
    state.competition = competition; state.details = details; state.schedule = schedule;
    state.round = round; state.match = team?.value.match || null; state.selectedTeamId = team?.value.teamId || null;
    state.rosters = rosters; state.boards = [];

    if (typeof draft.date === 'string') $('match-date').value = draft.date;
    if (typeof draft.venue === 'string') $('venue').value = draft.venue;
    if (typeof draft.referee === 'string') $('referee').value = draft.referee;
    if (typeof draft.recipient === 'string') $('recipient').value = draft.recipient;
    if (team && rosters.length === 2) {
      const max = Math.min(...rosters.map(roster => roster.length));
      const count = Math.max(1, Math.min(Number(draft.boardCount) || draft.boards?.length || 8, max));
      $('board-count').max = max;
      $('board-count').value = count;
      state.boards = Array.from({ length: count }, (_, index) => {
        const saved = draft.boards?.[index] || {};
        return {
          home: rosters[0].find(player => Number(player.playerId) === Number(saved.homeId)) || null,
          away: rosters[1].find(player => Number(player.playerId) === Number(saved.awayId)) || null,
          result: ['1:0', '0:1', '1/2:1/2'].includes(saved.result) ? saved.result : ''
        };
      });
      $('match-date').value ||= dateInput(round.roundDate);
      $('recipient').value ||= details.compManagerEmail || '';
      $('fixture').textContent = `Domácí: ${team.value.match.homeTeamName} · Hosté: ${team.value.match.awayTeamName}`;
      $('fixture').hidden = false; $('lineup-section').hidden = false; $('email-section').hidden = false;
      renderBoards();
    } else {
      $('fixture').hidden = true; $('lineup-section').hidden = true; $('email-section').hidden = true;
    }
    const incomplete = draft.compId && !competition || draft.roundNr != null && !round || draft.teamId != null && !team;
    message(incomplete
      ? 'Některá uložená volba už není v API dostupná; dostupná část formuláře byla obnovena.'
      : 'Uložený formulář byl obnoven. Změny se průběžně ukládají v tomto prohlížeči.');
  } catch (error) {
    if (token !== restoreToken) return;
    message(`Uložený formulář se nepodařilo plně obnovit: ${error.message}`, true);
  } finally {
    if (token === restoreToken) {
      restoringDraft = false;
      $('match-form').inert = false;
      queueDraftSave();
    }
  }
}
function clearForm() {
  restoreToken++;
  clearTimeout(saveTimer);
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* Storage may be disabled. */ }
  restoringDraft = true;
  state.regionCode = null;
  state.regions = [];
  regionPicker.setItems([]);
  clearCompetition();
  $('year').value = new Date().getFullYear();
  for (const id of ['match-date', 'venue', 'referee', 'recipient']) $(id).value = '';
  $('board-count').value = 8;
  $('report').hidden = true;
  restoringDraft = false;
  $('match-form').inert = false;
  message('Formulář a uložený návrh byly vymazány.');
  loadYear();
}
$('clear-form').addEventListener('click', clearForm);
$('board-count').addEventListener('input', () => { renderBoards(); queueDraftSave(); });
for (const id of ['match-date', 'venue', 'referee', 'recipient']) $(id).addEventListener('input', () => { invalidateReport(); queueDraftSave(); });
const savedDraft = readDraft();
$('year').value = savedDraft?.year || new Date().getFullYear();
$('year').addEventListener('change', () => { loadYear(); queueDraftSave(); });
if (savedDraft) restoreDraft(savedDraft);
else loadYear();
