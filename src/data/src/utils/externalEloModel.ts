import eloCsvText from '../data/rankings/elo_ratings_wc2026.csv?raw';
import type { PredictionContext } from '../types/football';

export type ExternalEloRating = {
  team: string;
  matchedCountry: string;
  snapshotDate: string;
  rank: number;
  rating: number;
  matchesTotal: number;
  confederation: string;
  isHost: boolean;
};

export type ExternalEloComparison = {
  teamA: ExternalEloRating;
  teamB: ExternalEloRating;
  ratingDiff: number;
  rankDiff: number;
  expectedScoreA: number;
  expectedScoreB: number;
  confidence: number;
  snapshotDateA: string;
  snapshotDateB: string;
};

type ExternalEloRow = {
  snapshotDate: string;
  country: string;
  countryKey: string;
  rank: number;
  rating: number;
  matchesTotal: number;
  confederation: string;
  isHost: boolean;
};

const ratingsByCountry = new Map<string, ExternalEloRow[]>();
let isParsed = false;

function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normalizeCountryKey(country: string): string {
  const normalized = removeAccents(country)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const aliases: Record<string, string> = {
    usa: 'united states',
    us: 'united states',
    'u s a': 'united states',
    'united states of america': 'united states',

    'korea republic': 'south korea',
    'republic of korea': 'south korea',
    korea: 'south korea',

    'czech republic': 'czechia',

    turkiye: 'turkey',
    turkey: 'turkey',

    curacao: 'curacao',
    curaçao: 'curacao',

    'cote divoire': 'ivory coast',
    'cote d ivoire': 'ivory coast',
    'côte divoire': 'ivory coast',
    'côte d ivoire': 'ivory coast',
    'ivory coast': 'ivory coast',

    'congo dr': 'dr congo',
    'dr congo': 'dr congo',
    'democratic republic of congo': 'dr congo',
    'congo democratic republic': 'dr congo',

    'bosnia herzegovina': 'bosnia and herzegovina',
    'bosnia and herzegovina': 'bosnia and herzegovina',
    'bosnia herz': 'bosnia and herzegovina',

    'cape verde islands': 'cape verde',
    'cabo verde': 'cape verde',

    'iran islamic republic': 'iran',
    'ir iran': 'iran',

    holland: 'netherlands',
  };

  return aliases[normalized] ?? normalized;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}

function parseNumber(value: string): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBoolean01(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true';
}

function getColumnIndex(headers: string[], columnName: string): number {
  return headers.findIndex((header) => header.trim() === columnName);
}

function parseExternalEloCsvOnce() {
  if (isParsed) return;

  ratingsByCountry.clear();

  const lines = eloCsvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    isParsed = true;
    return;
  }

  const headers = splitCsvLine(lines[0]);

  const snapshotDateIndex = getColumnIndex(headers, 'snapshot_date');
  const countryIndex = getColumnIndex(headers, 'country');
  const rankIndex = getColumnIndex(headers, 'rank');
  const ratingIndex = getColumnIndex(headers, 'rating');
  const matchesTotalIndex = getColumnIndex(headers, 'matches_total');
  const confederationIndex = getColumnIndex(headers, 'confederation');
  const isHostIndex = getColumnIndex(headers, 'is_host');

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);

    const snapshotDate = values[snapshotDateIndex];
    const country = values[countryIndex];

    if (!snapshotDate || !country) {
      continue;
    }

    const row: ExternalEloRow = {
      snapshotDate,
      country,
      countryKey: normalizeCountryKey(country),
      rank: parseNumber(values[rankIndex]),
      rating: parseNumber(values[ratingIndex]),
      matchesTotal: parseNumber(values[matchesTotalIndex]),
      confederation: values[confederationIndex] ?? '',
      isHost: parseBoolean01(values[isHostIndex] ?? '0'),
    };

    if (!ratingsByCountry.has(row.countryKey)) {
      ratingsByCountry.set(row.countryKey, []);
    }

    ratingsByCountry.get(row.countryKey)!.push(row);
  }

  for (const rows of ratingsByCountry.values()) {
    rows.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }

  isParsed = true;
}

function getReferenceDate(context: PredictionContext): string {
  if (context.predictionDate) {
    return context.predictionDate;
  }

  return new Date().toISOString().slice(0, 10);
}

function findLatestRatingBeforeDate(
  team: string,
  referenceDate: string
): ExternalEloRating | null {
  parseExternalEloCsvOnce();

  const teamKey = normalizeCountryKey(team);
  const rows = ratingsByCountry.get(teamKey);

  if (!rows || rows.length === 0) {
    return null;
  }

  let latest: ExternalEloRow | null = null;

  for (const row of rows) {
    if (row.snapshotDate <= referenceDate) {
      latest = row;
    } else {
      break;
    }
  }

  if (!latest) {
    return null;
  }

  return {
    team,
    matchedCountry: latest.country,
    snapshotDate: latest.snapshotDate,
    rank: latest.rank,
    rating: latest.rating,
    matchesTotal: latest.matchesTotal,
    confederation: latest.confederation,
    isHost: latest.isHost,
  };
}

function getExpectedResult(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function hasExternalEloRatings(): boolean {
  parseExternalEloCsvOnce();

  return ratingsByCountry.size > 0;
}

export function getExternalEloRating(
  team: string,
  context: PredictionContext
): ExternalEloRating | null {
  const referenceDate = getReferenceDate(context);

  return findLatestRatingBeforeDate(team, referenceDate);
}

export function getExternalEloComparison(
  teamA: string,
  teamB: string,
  context: PredictionContext
): ExternalEloComparison | null {
  const referenceDate = getReferenceDate(context);

  const teamARating = findLatestRatingBeforeDate(teamA, referenceDate);
  const teamBRating = findLatestRatingBeforeDate(teamB, referenceDate);

  if (!teamARating || !teamBRating) {
    return null;
  }

  const ratingDiff = teamARating.rating - teamBRating.rating;
  const rankDiff = teamBRating.rank - teamARating.rank;

  const expectedScoreA = getExpectedResult(
    teamARating.rating,
    teamBRating.rating
  );

  const expectedScoreB = 1 - expectedScoreA;

  const minimumHistory = Math.min(
    teamARating.matchesTotal,
    teamBRating.matchesTotal
  );

  const confidence = Math.min(1, Math.sqrt(minimumHistory / 80));

  return {
    teamA: teamARating,
    teamB: teamBRating,
    ratingDiff,
    rankDiff,
    expectedScoreA,
    expectedScoreB,
    confidence,
    snapshotDateA: teamARating.snapshotDate,
    snapshotDateB: teamBRating.snapshotDate,
  };
}

export function getExternalEloDiagnostics(
  teams: string[],
  referenceDate: string
) {
  parseExternalEloCsvOnce();

  return teams.map((team) => {
    const rating = findLatestRatingBeforeDate(team, referenceDate);

    return {
      team,
      found: Boolean(rating),
      matchedCountry: rating?.matchedCountry ?? null,
      rating: rating?.rating ?? null,
      rank: rating?.rank ?? null,
      snapshotDate: rating?.snapshotDate ?? null,
      confederation: rating?.confederation ?? null,
    };
  });
}
