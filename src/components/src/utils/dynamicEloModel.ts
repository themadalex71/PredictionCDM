import type { MatchResult, ModelSettings, PredictionContext } from '../types/football';

type DynamicEloComparison = {
  ratingA: number;
  ratingB: number;
  ratingDiff: number;
  confidence: number;
  matchesA: number;
  matchesB: number;
};

type DynamicEloSnapshot = {
  ratings: Map<string, number>;
  counts: Map<string, number>;
};

const BASE_ELO = 1500;
const HOME_ADVANTAGE_ELO = 55;
const cache = new WeakMap<MatchResult[], Map<string, DynamicEloSnapshot>>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getYear(date: string): number {
  return new Date(`${date}T12:00:00`).getFullYear();
}

function getTournamentKFactor(tournament: string): number {
  const normalized = tournament.toLowerCase();
  const isFriendly = normalized.includes('friendly') || normalized.includes('friendlies');
  const isQualification =
    normalized.includes('qualification') ||
    normalized.includes('qualifiers') ||
    normalized.includes('qualifying');
  const isWorldCup =
    !isQualification &&
    (normalized.includes('fifa world cup') || normalized.includes('world cup'));
  const isContinental =
    normalized.includes('euro') ||
    normalized.includes('copa america') ||
    normalized.includes('african cup') ||
    normalized.includes('africa cup') ||
    normalized.includes('asian cup') ||
    normalized.includes('gold cup') ||
    normalized.includes('concacaf') ||
    normalized.includes('nations cup');
  const isSmallTournament =
    normalized.includes('fifa series') ||
    normalized.includes('concacaf series') ||
    normalized.includes('mukuru') ||
    normalized.includes('tri-nations') ||
    normalized.includes('tri nations') ||
    normalized.includes('unity cup') ||
    normalized.includes('diamond jubilee') ||
    normalized.includes('capital of african football') ||
    normalized.includes('baltic cup') ||
    normalized.includes('tournament');

  if (isWorldCup) return 34;
  if (isContinental) return 28;
  if (isQualification) return 24;
  if (normalized.includes('nations league')) return 20;
  if (isSmallTournament) return 12;
  if (isFriendly) return 10;
  return 16;
}

function getResult(homeScore: number, awayScore: number): number {
  if (homeScore > awayScore) return 1;
  if (homeScore < awayScore) return 0;
  return 0.5;
}

function getExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getMarginMultiplier(goalDiff: number, eloDiff: number): number {
  if (goalDiff <= 0) return 1;

  const raw = Math.log(goalDiff + 1) * (2.2 / (Math.abs(eloDiff) * 0.001 + 2.2));
  return clamp(raw, 0.75, 2.25);
}

function getSnapshotKey(settings: ModelSettings, predictionDate?: string): string {
  return [
    predictionDate ?? 'latest',
    settings.startYear,
    settings.homeAdvantage ?? 0,
  ].join('|');
}

function buildSnapshot(
  matches: MatchResult[],
  settings: ModelSettings,
  predictionDate?: string
): DynamicEloSnapshot {
  const ratings = new Map<string, number>();
  const counts = new Map<string, number>();

  const eligible = matches
    .filter((match) => {
      if (!match.date) return false;
      if (predictionDate && match.date >= predictionDate) return false;
      const year = getYear(match.date);
      if (Number.isNaN(year) || year < settings.startYear) return false;
      return Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore);
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const match of eligible) {
    const homeRating = ratings.get(match.homeTeam) ?? BASE_ELO;
    const awayRating = ratings.get(match.awayTeam) ?? BASE_ELO;

    const homeAdvantage = match.neutral ? 0 : HOME_ADVANTAGE_ELO * clamp(settings.homeAdvantage / 0.18, 0.3, 1.8);
    const adjustedHomeRating = homeRating + homeAdvantage;
    const expectedHome = getExpectedScore(adjustedHomeRating, awayRating);
    const actualHome = getResult(match.homeScore, match.awayScore);
    const goalDiff = Math.abs(match.homeScore - match.awayScore);
    const k = getTournamentKFactor(match.tournament) * getMarginMultiplier(goalDiff, adjustedHomeRating - awayRating);
    const delta = k * (actualHome - expectedHome);

    ratings.set(match.homeTeam, homeRating + delta);
    ratings.set(match.awayTeam, awayRating - delta);
    counts.set(match.homeTeam, (counts.get(match.homeTeam) ?? 0) + 1);
    counts.set(match.awayTeam, (counts.get(match.awayTeam) ?? 0) + 1);
  }

  return { ratings, counts };
}

function getSnapshot(
  matches: MatchResult[],
  settings: ModelSettings,
  predictionDate?: string
): DynamicEloSnapshot {
  let matchCache = cache.get(matches);

  if (!matchCache) {
    matchCache = new Map<string, DynamicEloSnapshot>();
    cache.set(matches, matchCache);
  }

  const key = getSnapshotKey(settings, predictionDate);
  const existing = matchCache.get(key);

  if (existing) {
    return existing;
  }

  const snapshot = buildSnapshot(matches, settings, predictionDate);
  matchCache.set(key, snapshot);

  return snapshot;
}

export function getDynamicEloComparison(
  teamA: string,
  teamB: string,
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): DynamicEloComparison | null {
  const snapshot = getSnapshot(matches, settings, context.predictionDate);
  const ratingA = snapshot.ratings.get(teamA) ?? BASE_ELO;
  const ratingB = snapshot.ratings.get(teamB) ?? BASE_ELO;
  const matchesA = snapshot.counts.get(teamA) ?? 0;
  const matchesB = snapshot.counts.get(teamB) ?? 0;

  if (matchesA === 0 && matchesB === 0) {
    return null;
  }

  const dataConfidence = clamp(Math.sqrt(Math.min(matchesA, matchesB) / 18), 0.15, 1);

  return {
    ratingA,
    ratingB,
    ratingDiff: ratingA - ratingB,
    confidence: dataConfidence,
    matchesA,
    matchesB,
  };
}
