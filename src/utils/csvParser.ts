import { getWorldCupTeamByName } from '../data/worldcup2026/teams';
import type { MatchResult } from '../types/football';

const STORAGE_KEY = 'mpp_predictor_matches';

function normalizeKey(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Certains datasets publics n'utilisent pas exactement les mêmes noms
 * que notre référentiel Coupe du Monde 2026.
 *
 * Objectif :
 * - garder les noms d'équipes cohérents dans toute l'application ;
 * - éviter d'avoir "South Korea" d'un côté et "Korea Republic" de l'autre ;
 * - permettre au modèle de retrouver les bons matchs historiques.
 */
const TEAM_NAME_ALIAS_PAIRS: [string, string][] = [
  ['USA', 'United States'],
  ['U.S.A.', 'United States'],
  ['United States of America', 'United States'],

  ['Korea Republic', 'South Korea'],
  ['Republic of Korea', 'South Korea'],

  ['Czech Republic', 'Czechia'],
  ['Czech Republics', 'Czechia'],

  ['Türkiye', 'Turkey'],
  ['Turkiye', 'Turkey'],

  ["Côte d'Ivoire", 'Ivory Coast'],
  ['Cote dIvoire', 'Ivory Coast'],
  ["Cote d'Ivoire", 'Ivory Coast'],

  ['Curaçao', 'Curacao'],

  ['Cabo Verde', 'Cape Verde'],

  ['Bosnia-Herzegovina', 'Bosnia and Herzegovina'],
  ['Bosnia', 'Bosnia and Herzegovina'],

  ['Congo DR', 'DR Congo'],
  ['Democratic Republic of the Congo', 'DR Congo'],
  ['RD Congo', 'DR Congo'],
];

const TEAM_NAME_ALIASES = new Map(
  TEAM_NAME_ALIAS_PAIRS.map(([sourceName, canonicalName]) => [
    normalizeKey(sourceName),
    canonicalName,
  ])
);

export function normalizeTeamName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, ' ');

  /**
   * D'abord, on regarde si le nom correspond à une équipe
   * de notre Coupe du Monde 2026 via name, fifaCode ou aliases.
   */
  const worldCupTeam = getWorldCupTeamByName(cleaned);
  if (worldCupTeam) {
    return worldCupTeam.name;
  }

  /**
   * Ensuite, on applique notre table manuelle d'alias.
   */
  const alias = TEAM_NAME_ALIASES.get(normalizeKey(cleaned));
  if (alias) {
    return alias;
  }

  /**
   * Si l'équipe n'est pas dans la Coupe du Monde 2026,
   * on conserve son nom d'origine.
   */
  return cleaned;
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return ['true', '1', 'yes', 'y', 'oui'].includes(normalized);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseCsvText(csvText: string): MatchResult[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase()
  );
  const indexOf = (name: string) => headers.indexOf(name.toLowerCase());

  const requiredColumns = [
    'date',
    'home_team',
    'away_team',
    'home_score',
    'away_score',
    'tournament',
    'neutral',
  ];

  const missing = requiredColumns.filter((column) => indexOf(column) === -1);

  if (missing.length > 0) {
    throw new Error(`Colonnes manquantes dans le CSV : ${missing.join(', ')}`);
  }

  const matches: MatchResult[] = [];
  let skippedRows = 0;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);

    const homeScoreRaw = cells[indexOf('home_score')];
    const awayScoreRaw = cells[indexOf('away_score')];

    const homeScore = Number(homeScoreRaw);
    const awayScore = Number(awayScoreRaw);

    /**
     * Certains CSV contiennent les matchs futurs avec :
     * home_score = NA
     * away_score = NA
     *
     * Ces matchs ne peuvent pas servir à entraîner le modèle,
     * donc on les ignore au lieu de bloquer l'import.
     */
    if (
      !homeScoreRaw ||
      !awayScoreRaw ||
      homeScoreRaw.toUpperCase() === 'NA' ||
      awayScoreRaw.toUpperCase() === 'NA' ||
      Number.isNaN(homeScore) ||
      Number.isNaN(awayScore)
    ) {
      skippedRows += 1;
      continue;
    }

    const match: MatchResult = {
      date: cells[indexOf('date')],
      homeTeam: normalizeTeamName(cells[indexOf('home_team')]),
      awayTeam: normalizeTeamName(cells[indexOf('away_team')]),
      homeScore,
      awayScore,
      tournament: cells[indexOf('tournament')] || 'Unknown',
      city: indexOf('city') >= 0 ? cells[indexOf('city')] : undefined,
      country: indexOf('country') >= 0 ? cells[indexOf('country')] : undefined,
      neutral: parseBoolean(cells[indexOf('neutral')]),
    };

    if (!match.date) {
      skippedRows += 1;
      continue;
    }

    matches.push(match);
  }

  console.info(
    `Import CSV terminé : ${matches.length} matchs importés, ${skippedRows} lignes ignorées.`
  );

  return matches;
}

export async function parseCsvResults(file: File): Promise<MatchResult[]> {
  const csvText = await file.text();
  return parseCsvText(csvText);
}

export function saveMatchesToLocalStorage(matches: MatchResult[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
}

export function loadMatchesFromLocalStorage(): MatchResult[] | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MatchResult[];
  } catch {
    return null;
  }
}

export function clearStoredMatches(): void {
  localStorage.removeItem(STORAGE_KEY);
}
