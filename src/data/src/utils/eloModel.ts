import type {
  MatchResult,
  ModelSettings,
  PredictionContext,
} from '../types/football';

export type TeamEloRating = {
  team: string;
  rating: number;
  matches: number;
  lastMatchDate?: string;
};

export type EloComparison = {
  teamA: TeamEloRating;
  teamB: TeamEloRating;
  ratingDiff: number;
  expectedScoreA: number;
  expectedScoreB: number;
  confidence: number;
};

const INITIAL_ELO = 1500;
const DEFAULT_ELO_MATCHES = 0;
const HOME_ADVANTAGE_ELO = 55;

const eloCache = new Map<string, Map<string, TeamEloRating>>();

function isValidScoredMatch(match: MatchResult): boolean {
  return (
    Boolean(match.date) &&
    Number.isFinite(match.homeScore) &&
    Number.isFinite(match.awayScore)
  );
}

function getMatchYear(match: MatchResult): number {
  return new Date(`${match.date}T12:00:00`).getFullYear();
}

function getActualResult(homeScore: number, awayScore: number): number {
  if (homeScore > awayScore) return 1;
  if (homeScore < awayScore) return 0;
  return 0.5;
}

function getExpectedResult(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getGoalDifferenceMultiplier(
  homeScore: number,
  awayScore: number
): number {
  const goalDifference = Math.abs(homeScore - awayScore);

  if (goalDifference <= 1) return 1;
  if (goalDifference === 2) return 1.35;
  if (goalDifference === 3) return 1.65;

  return Math.min(2.15, 1.65 + (goalDifference - 3) * 0.12);
}

function getTournamentKFactor(
  tournament: string,
  settings: ModelSettings
): number {
  const normalized = tournament.toLowerCase();

  const isFriendly =
    normalized.includes('friendly') || normalized.includes('friendlies');

  const isQualification =
    normalized.includes('qualification') ||
    normalized.includes('qualifiers') ||
    normalized.includes('qualifying');

  const isWorldCupFinalTournament =
    !isQualification &&
    (normalized.includes('fifa world cup') ||
      normalized === 'world cup' ||
      normalized.includes('world cup'));

  const isContinentalCompetition =
    normalized.includes('uefa euro') ||
    normalized.includes('euro') ||
    normalized.includes('copa america') ||
    normalized.includes('african cup') ||
    normalized.includes('africa cup') ||
    normalized.includes('asian cup') ||
    normalized.includes('gold cup') ||
    normalized.includes('concacaf') ||
    normalized.includes('ofc nations') ||
    normalized.includes('nations cup');

  const isNationsLeague = normalized.includes('nations league');

  if (isWorldCupFinalTournament) {
    return 34;
  }

  if (isContinentalCompetition) {
    return 30;
  }

  if (isQualification) {
    return 22;
  }

  if (isNationsLeague) {
    return 16;
  }

  if (isFriendly) {
    return 8;
  }

  return Math.max(14, settings.officialMatchWeight * 10);
}

function getOrCreateRating(
  ratings: Map<string, TeamEloRating>,
  team: string
): TeamEloRating {
  if (!ratings.has(team)) {
    ratings.set(team, {
      team,
      rating: INITIAL_ELO,
      matches: DEFAULT_ELO_MATCHES,
    });
  }

  return ratings.get(team)!;
}

function buildCacheKey(
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): string {
  const firstDate = matches[0]?.date ?? 'empty';
  const lastDate = matches[matches.length - 1]?.date ?? 'empty';

  return [
    matches.length,
    firstDate,
    lastDate,
    settings.startYear,
    settings.officialMatchWeight,
    context.predictionDate ?? 'all',
  ].join('|');
}

function getAvailableMatchesForElo(
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): MatchResult[] {
  return matches
    .filter(isValidScoredMatch)
    .filter((match) => {
      const year = getMatchYear(match);

      if (Number.isNaN(year)) return false;
      if (year < settings.startYear) return false;

      if (context.predictionDate && match.date >= context.predictionDate) {
        return false;
      }

      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateEloRatings(
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): Map<string, TeamEloRating> {
  const cacheKey = buildCacheKey(matches, settings, context);
  const cachedRatings = eloCache.get(cacheKey);

  if (cachedRatings) {
    return cachedRatings;
  }

  const ratings = new Map<string, TeamEloRating>();
  const availableMatches = getAvailableMatchesForElo(
    matches,
    settings,
    context
  );

  for (const match of availableMatches) {
    const homeRating = getOrCreateRating(ratings, match.homeTeam);
    const awayRating = getOrCreateRating(ratings, match.awayTeam);

    const homeRatingWithAdvantage = match.neutral
      ? homeRating.rating
      : homeRating.rating + HOME_ADVANTAGE_ELO;

    const expectedHome = getExpectedResult(
      homeRatingWithAdvantage,
      awayRating.rating
    );

    const actualHome = getActualResult(match.homeScore, match.awayScore);

    const kFactor = getTournamentKFactor(match.tournament, settings);
    const goalDifferenceMultiplier = getGoalDifferenceMultiplier(
      match.homeScore,
      match.awayScore
    );

    const eloChange =
      kFactor * goalDifferenceMultiplier * (actualHome - expectedHome);

    homeRating.rating += eloChange;
    awayRating.rating -= eloChange;

    homeRating.matches += 1;
    awayRating.matches += 1;

    homeRating.lastMatchDate = match.date;
    awayRating.lastMatchDate = match.date;
  }

  eloCache.set(cacheKey, ratings);

  return ratings;
}

export function getTeamEloRating(
  team: string,
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): TeamEloRating {
  const ratings = calculateEloRatings(matches, settings, context);

  return (
    ratings.get(team) ?? {
      team,
      rating: INITIAL_ELO,
      matches: DEFAULT_ELO_MATCHES,
    }
  );
}

export function getEloComparison(
  teamA: string,
  teamB: string,
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): EloComparison {
  const teamARating = getTeamEloRating(teamA, matches, settings, context);
  const teamBRating = getTeamEloRating(teamB, matches, settings, context);

  const ratingDiff = teamARating.rating - teamBRating.rating;
  const expectedScoreA = getExpectedResult(
    teamARating.rating,
    teamBRating.rating
  );
  const expectedScoreB = 1 - expectedScoreA;

  const minimumTeamHistory = Math.min(teamARating.matches, teamBRating.matches);

  const confidence = Math.min(1, Math.sqrt(minimumTeamHistory / 25));

  return {
    teamA: teamARating,
    teamB: teamBRating,
    ratingDiff,
    expectedScoreA,
    expectedScoreB,
    confidence,
  };
}
