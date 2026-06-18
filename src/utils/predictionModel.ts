import type {
  MatchPrediction,
  MatchResult,
  ModelSettings,
  PredictionContext,
  ScorePrediction,
} from '../types/football';
import { getEloComparison as getInternalEloComparison } from './eloModel';
import { getExternalEloComparison } from './externalEloModel';

type ExpectedGoals = {
  teamA: number;
  teamB: number;
  eloDiff: number;
  eloConfidence: number;
  eloSource: 'external' | 'internal';
  eloImpact: number;
};

type EloSignal = {
  ratingDiff: number;
  confidence: number;
  source: 'external' | 'internal';
  impact: number;
};

type GlobalScoringProfile = {
  avgGoalsPerTeam: number;
  avgGoalsPerMatch: number;
};

type BaseTeamStrength = {
  team: string;
  rawMatches: number;
  weightedMatches: number;
  attackStrength: number;
  defenseWeakness: number;
  reliability: number;
};

type TeamProfile = {
  team: string;
  rawMatches: number;
  weightedMatches: number;

  adjustedGoalsForPerMatch: number;
  adjustedGoalsAgainstPerMatch: number;

  recentAdjustedGoalsForPerMatch: number;
  recentAdjustedGoalsAgainstPerMatch: number;

  attackStrength: number;
  defenseWeakness: number;
  reliability: number;
  momentumMultiplier: number;
};

type CalibrationSettings = {
  favoriteShrinkBase: number;
  favoriteShrinkClose: number;
  favoriteShrinkMedium: number;
  drawBoostBase: number;
  drawBoostCloseMatch: number;
  drawBoostLowTotal: number;
  drawBoostMax: number;
  externalEloImpact: number;
  internalEloImpact: number;
  scoreTemperature: number;
};

const MIN_EXPECTED_GOALS = 0.12;
const MAX_EXPECTED_GOALS = 4.6;

const MIN_STRENGTH = 0.45;
const MAX_STRENGTH = 2.2;

/**
 * Par défaut, on fixe la v0.7 :
 * - calibration v0.3 agressive ;
 * - Elo externe très léger à 35 % ;
 * - température neutre.
 */
const DEFAULT_CALIBRATION: CalibrationSettings = {
  favoriteShrinkBase: 1,
  favoriteShrinkClose: 1,
  favoriteShrinkMedium: 1,
  drawBoostBase: 1,
  drawBoostCloseMatch: 0,
  drawBoostLowTotal: 0,
  drawBoostMax: 1,
  externalEloImpact: 0.35,
  internalEloImpact: 0.35,
  scoreTemperature: 1,
};

function getCalibration(settings: ModelSettings): CalibrationSettings {
  return {
    favoriteShrinkBase:
      settings.favoriteShrinkBase ?? DEFAULT_CALIBRATION.favoriteShrinkBase,
    favoriteShrinkClose:
      settings.favoriteShrinkClose ?? DEFAULT_CALIBRATION.favoriteShrinkClose,
    favoriteShrinkMedium:
      settings.favoriteShrinkMedium ?? DEFAULT_CALIBRATION.favoriteShrinkMedium,
    drawBoostBase: settings.drawBoostBase ?? DEFAULT_CALIBRATION.drawBoostBase,
    drawBoostCloseMatch:
      settings.drawBoostCloseMatch ?? DEFAULT_CALIBRATION.drawBoostCloseMatch,
    drawBoostLowTotal:
      settings.drawBoostLowTotal ?? DEFAULT_CALIBRATION.drawBoostLowTotal,
    drawBoostMax: settings.drawBoostMax ?? DEFAULT_CALIBRATION.drawBoostMax,
    externalEloImpact:
      settings.externalEloImpact ?? DEFAULT_CALIBRATION.externalEloImpact,
    internalEloImpact:
      settings.internalEloImpact ?? DEFAULT_CALIBRATION.internalEloImpact,
    scoreTemperature:
      settings.scoreTemperature ?? DEFAULT_CALIBRATION.scoreTemperature,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function factorial(n: number): number {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i += 1) {
    result *= i;
  }

  return result;
}

export function poissonProbability(lambda: number, goals: number): number {
  if (lambda <= 0) return goals === 0 ? 1 : 0;

  return (Math.exp(-lambda) * Math.pow(lambda, goals)) / factorial(goals);
}

function softenGoalValue(goals: number): number {
  if (goals <= 5) return goals;

  return 5 + (goals - 5) * 0.35;
}

function getRecencyWeight(matchDate: string, referenceDate?: string): number {
  const matchTime = new Date(`${matchDate}T12:00:00`).getTime();
  const referenceTime = referenceDate
    ? new Date(`${referenceDate}T12:00:00`).getTime()
    : Date.now();

  if (Number.isNaN(matchTime) || Number.isNaN(referenceTime)) {
    return 1;
  }

  const ageInDays = Math.max(
    0,
    (referenceTime - matchTime) / (1000 * 60 * 60 * 24)
  );

  const halfLifeDays = 365 * 3;

  return Math.pow(0.5, ageInDays / halfLifeDays);
}

function getTournamentWeight(
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
    return Math.max(1.85, settings.officialMatchWeight);
  }

  if (isContinentalCompetition) {
    return Math.max(1.45, settings.officialMatchWeight * 0.95);
  }

  if (isQualification) {
    return Math.max(1.25, settings.officialMatchWeight * 0.8);
  }

  if (isNationsLeague) {
    return Math.max(1.1, settings.officialMatchWeight * 0.65);
  }

  if (isFriendly) {
    return 0.6;
  }

  return 1;
}

function getMatchWeight(
  match: MatchResult,
  settings: ModelSettings,
  referenceDate?: string
): number {
  return (
    getRecencyWeight(match.date, referenceDate) *
    getTournamentWeight(match.tournament, settings)
  );
}

function getAvailableMatches(
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): MatchResult[] {
  return matches.filter((match) => {
    const year = new Date(`${match.date}T12:00:00`).getFullYear();

    if (Number.isNaN(year)) return false;
    if (year < settings.startYear) return false;

    if (context.predictionDate && match.date >= context.predictionDate) {
      return false;
    }

    if (Number.isNaN(match.homeScore) || Number.isNaN(match.awayScore)) {
      return false;
    }

    return true;
  });
}

function computeGlobalScoringProfile(
  matches: MatchResult[],
  settings: ModelSettings,
  referenceDate?: string
): GlobalScoringProfile {
  let weightedGoals = 0;
  let weightedTeamMatches = 0;

  for (const match of matches) {
    const weight = getMatchWeight(match, settings, referenceDate);

    weightedGoals +=
      (softenGoalValue(match.homeScore) + softenGoalValue(match.awayScore)) *
      weight;

    weightedTeamMatches += 2 * weight;
  }

  const avgGoalsPerTeam =
    weightedTeamMatches > 0 ? weightedGoals / weightedTeamMatches : 1.25;

  return {
    avgGoalsPerTeam,
    avgGoalsPerMatch: avgGoalsPerTeam * 2,
  };
}

function getTeamMatches(matches: MatchResult[], team: string): MatchResult[] {
  return matches
    .filter((match) => match.homeTeam === team || match.awayTeam === team)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function getOpponent(match: MatchResult, team: string): string {
  return match.homeTeam === team ? match.awayTeam : match.homeTeam;
}

function getGoalsForTeam(
  match: MatchResult,
  team: string
): { goalsFor: number; goalsAgainst: number } {
  const isHome = match.homeTeam === team;

  return {
    goalsFor: softenGoalValue(isHome ? match.homeScore : match.awayScore),
    goalsAgainst: softenGoalValue(isHome ? match.awayScore : match.homeScore),
  };
}

function getResultPoints(match: MatchResult, team: string): number {
  const { goalsFor, goalsAgainst } = getGoalsForTeam(match, team);

  if (goalsFor > goalsAgainst) return 3;
  if (goalsFor === goalsAgainst) return 1;
  return 0;
}

function computeBaseTeamStrengths(
  matches: MatchResult[],
  settings: ModelSettings,
  globalProfile: GlobalScoringProfile,
  referenceDate?: string
): Map<string, BaseTeamStrength> {
  const records = new Map<
    string,
    {
      rawMatches: number;
      weightedMatches: number;
      weightedGoalsFor: number;
      weightedGoalsAgainst: number;
    }
  >();

  function ensureTeam(team: string) {
    if (!records.has(team)) {
      records.set(team, {
        rawMatches: 0,
        weightedMatches: 0,
        weightedGoalsFor: 0,
        weightedGoalsAgainst: 0,
      });
    }

    return records.get(team)!;
  }

  for (const match of matches) {
    const weight = getMatchWeight(match, settings, referenceDate);

    const homeRecord = ensureTeam(match.homeTeam);
    const awayRecord = ensureTeam(match.awayTeam);

    const homeGoals = softenGoalValue(match.homeScore);
    const awayGoals = softenGoalValue(match.awayScore);

    homeRecord.rawMatches += 1;
    homeRecord.weightedMatches += weight;
    homeRecord.weightedGoalsFor += homeGoals * weight;
    homeRecord.weightedGoalsAgainst += awayGoals * weight;

    awayRecord.rawMatches += 1;
    awayRecord.weightedMatches += weight;
    awayRecord.weightedGoalsFor += awayGoals * weight;
    awayRecord.weightedGoalsAgainst += homeGoals * weight;
  }

  const strengths = new Map<string, BaseTeamStrength>();

  for (const [team, record] of records.entries()) {
    const goalsForPerMatch =
      record.weightedMatches > 0
        ? record.weightedGoalsFor / record.weightedMatches
        : globalProfile.avgGoalsPerTeam;

    const goalsAgainstPerMatch =
      record.weightedMatches > 0
        ? record.weightedGoalsAgainst / record.weightedMatches
        : globalProfile.avgGoalsPerTeam;

    const rawAttackStrength =
      globalProfile.avgGoalsPerTeam > 0
        ? goalsForPerMatch / globalProfile.avgGoalsPerTeam
        : 1;

    const rawDefenseWeakness =
      globalProfile.avgGoalsPerTeam > 0
        ? goalsAgainstPerMatch / globalProfile.avgGoalsPerTeam
        : 1;

    const reliability = clamp(Math.sqrt(record.weightedMatches / 30), 0, 1);

    strengths.set(team, {
      team,
      rawMatches: record.rawMatches,
      weightedMatches: record.weightedMatches,
      attackStrength: clamp(
        1 + (rawAttackStrength - 1) * reliability,
        MIN_STRENGTH,
        MAX_STRENGTH
      ),
      defenseWeakness: clamp(
        1 + (rawDefenseWeakness - 1) * reliability,
        MIN_STRENGTH,
        MAX_STRENGTH
      ),
      reliability,
    });
  }

  return strengths;
}

function computeOpponentAdjustedTeamProfile(
  team: string,
  matches: MatchResult[],
  settings: ModelSettings,
  globalProfile: GlobalScoringProfile,
  baseStrengths: Map<string, BaseTeamStrength>,
  referenceDate?: string
): TeamProfile {
  const teamMatches = getTeamMatches(matches, team);

  let weightedAdjustedGoalsFor = 0;
  let weightedAdjustedGoalsAgainst = 0;
  let totalWeight = 0;

  for (const match of teamMatches) {
    const opponent = getOpponent(match, team);
    const opponentStrength = baseStrengths.get(opponent);

    const opponentDefenseWeakness = opponentStrength?.defenseWeakness ?? 1;
    const opponentAttackStrength = opponentStrength?.attackStrength ?? 1;

    const weight = getMatchWeight(match, settings, referenceDate);
    const { goalsFor, goalsAgainst } = getGoalsForTeam(match, team);

    weightedAdjustedGoalsFor +=
      (goalsFor / clamp(opponentDefenseWeakness, 0.55, 1.9)) * weight;

    weightedAdjustedGoalsAgainst +=
      (goalsAgainst / clamp(opponentAttackStrength, 0.55, 1.9)) * weight;

    totalWeight += weight;
  }

  const adjustedGoalsForPerMatch =
    totalWeight > 0
      ? weightedAdjustedGoalsFor / totalWeight
      : globalProfile.avgGoalsPerTeam;

  const adjustedGoalsAgainstPerMatch =
    totalWeight > 0
      ? weightedAdjustedGoalsAgainst / totalWeight
      : globalProfile.avgGoalsPerTeam;

  const recentMatches = teamMatches.slice(0, settings.recentMatchCount);

  let recentWeight = 0;
  let recentAdjustedGoalsFor = 0;
  let recentAdjustedGoalsAgainst = 0;
  let recentWeightedPoints = 0;

  for (const match of recentMatches) {
    const opponent = getOpponent(match, team);
    const opponentStrength = baseStrengths.get(opponent);

    const opponentDefenseWeakness = opponentStrength?.defenseWeakness ?? 1;
    const opponentAttackStrength = opponentStrength?.attackStrength ?? 1;

    const weight = getMatchWeight(match, settings, referenceDate);
    const { goalsFor, goalsAgainst } = getGoalsForTeam(match, team);

    recentAdjustedGoalsFor +=
      (goalsFor / clamp(opponentDefenseWeakness, 0.55, 1.9)) * weight;

    recentAdjustedGoalsAgainst +=
      (goalsAgainst / clamp(opponentAttackStrength, 0.55, 1.9)) * weight;

    recentWeightedPoints += getResultPoints(match, team) * weight;
    recentWeight += weight;
  }

  const recentAdjustedGoalsForPerMatch =
    recentWeight > 0
      ? recentAdjustedGoalsFor / recentWeight
      : adjustedGoalsForPerMatch;

  const recentAdjustedGoalsAgainstPerMatch =
    recentWeight > 0
      ? recentAdjustedGoalsAgainst / recentWeight
      : adjustedGoalsAgainstPerMatch;

  const recentPointsRatio =
    recentWeight > 0 ? recentWeightedPoints / (recentWeight * 3) : 0.5;

  const recentFormWeight = clamp(settings.recentFormWeight, 0, 1);

  const blendedGoalsFor =
    adjustedGoalsForPerMatch * (1 - recentFormWeight) +
    recentAdjustedGoalsForPerMatch * recentFormWeight;

  const blendedGoalsAgainst =
    adjustedGoalsAgainstPerMatch * (1 - recentFormWeight) +
    recentAdjustedGoalsAgainstPerMatch * recentFormWeight;

  const rawAttackStrength =
    globalProfile.avgGoalsPerTeam > 0
      ? blendedGoalsFor / globalProfile.avgGoalsPerTeam
      : 1;

  const rawDefenseWeakness =
    globalProfile.avgGoalsPerTeam > 0
      ? blendedGoalsAgainst / globalProfile.avgGoalsPerTeam
      : 1;

  const reliability = clamp(Math.sqrt(totalWeight / 30), 0, 1);

  const momentumMultiplier = clamp(
    1 + (recentPointsRatio - 0.5) * recentFormWeight * 0.45,
    0.9,
    1.1
  );

  return {
    team,
    rawMatches: teamMatches.length,
    weightedMatches: totalWeight,

    adjustedGoalsForPerMatch,
    adjustedGoalsAgainstPerMatch,

    recentAdjustedGoalsForPerMatch,
    recentAdjustedGoalsAgainstPerMatch,

    attackStrength: clamp(
      1 + (rawAttackStrength - 1) * reliability,
      MIN_STRENGTH,
      MAX_STRENGTH
    ),
    defenseWeakness: clamp(
      1 + (rawDefenseWeakness - 1) * reliability,
      MIN_STRENGTH,
      MAX_STRENGTH
    ),
    reliability,
    momentumMultiplier,
  };
}

function clampExpectedGoals(value: number): number {
  return clamp(value, MIN_EXPECTED_GOALS, MAX_EXPECTED_GOALS);
}

function getTournamentTempoMultiplier(context: PredictionContext): number {
  const tournament = context.tournament?.toLowerCase() ?? '';

  if (tournament.includes('world cup')) {
    return 0.96;
  }

  if (
    tournament.includes('euro') ||
    tournament.includes('copa america') ||
    tournament.includes('african cup') ||
    tournament.includes('asian cup')
  ) {
    return 0.97;
  }

  return 1;
}

function getBestEloSignal(
  teamA: string,
  teamB: string,
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext
): EloSignal {
  const calibration = getCalibration(settings);
  const externalComparison = getExternalEloComparison(teamA, teamB, context);

  if (externalComparison) {
    return {
      ratingDiff: externalComparison.ratingDiff,
      confidence: externalComparison.confidence,
      source: 'external',
      impact: clamp(calibration.externalEloImpact, 0, 2),
    };
  }

  const internalComparison = getInternalEloComparison(
    teamA,
    teamB,
    matches,
    settings,
    context
  );

  return {
    ratingDiff: internalComparison.ratingDiff,
    confidence: internalComparison.confidence,
    source: 'internal',
    impact: clamp(calibration.internalEloImpact, 0, 2),
  };
}

function getEloGoalMultiplier(signal: EloSignal): {
  teamA: number;
  teamB: number;
} {
  if (signal.impact <= 0) {
    return {
      teamA: 1,
      teamB: 1,
    };
  }

  const normalizedDiff = clamp(signal.ratingDiff / 400, -1.35, 1.35);

  const baseImpact = signal.source === 'external' ? 0.18 : 0.14;
  const impact = baseImpact * signal.confidence * signal.impact;

  return {
    teamA: Math.exp(normalizedDiff * impact),
    teamB: Math.exp(-normalizedDiff * impact),
  };
}

function shrinkFavoriteGap(
  expectedGoalsA: number,
  expectedGoalsB: number,
  settings: ModelSettings,
  context: PredictionContext,
  eloSignal: EloSignal
): ExpectedGoals {
  const calibration = getCalibration(settings);
  const totalGoals = expectedGoalsA + expectedGoalsB;

  if (totalGoals <= 0) {
    return {
      teamA: expectedGoalsA,
      teamB: expectedGoalsB,
      eloDiff: eloSignal.ratingDiff,
      eloConfidence: eloSignal.confidence,
      eloSource: eloSignal.source,
      eloImpact: eloSignal.impact,
    };
  }

  const diff = expectedGoalsA - expectedGoalsB;
  const absDiff = Math.abs(diff);

  const tournament = context.tournament?.toLowerCase() ?? '';
  const isWorldCup = tournament.includes('world cup');

  let shrinkFactor = calibration.favoriteShrinkBase;

  if (absDiff < 0.35) {
    shrinkFactor = calibration.favoriteShrinkClose;
  } else if (absDiff < 0.75) {
    shrinkFactor = calibration.favoriteShrinkMedium;
  } else if (absDiff > 1.6) {
    shrinkFactor = Math.max(calibration.favoriteShrinkBase, 0.91);
  }

  const effectiveEloDiff = Math.abs(eloSignal.ratingDiff) * eloSignal.impact;

  if (effectiveEloDiff > 260) {
    shrinkFactor = Math.max(shrinkFactor, 0.98);
  } else if (effectiveEloDiff > 180) {
    shrinkFactor = Math.max(shrinkFactor, 0.95);
  }

  if (isWorldCup) {
    shrinkFactor -= 0.01;
  }

  shrinkFactor = clamp(shrinkFactor, 0.7, 1);

  const adjustedDiff = diff * shrinkFactor;

  return {
    teamA: clampExpectedGoals(totalGoals / 2 + adjustedDiff / 2),
    teamB: clampExpectedGoals(totalGoals / 2 - adjustedDiff / 2),
    eloDiff: eloSignal.ratingDiff,
    eloConfidence: eloSignal.confidence,
    eloSource: eloSignal.source,
    eloImpact: eloSignal.impact,
  };
}

export function estimateExpectedGoals(
  teamA: string,
  teamB: string,
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext = { neutral: true, teamAIsHome: true }
): ExpectedGoals {
  const availableMatches = getAvailableMatches(matches, settings, context);
  const referenceDate = context.predictionDate;

  const globalProfile = computeGlobalScoringProfile(
    availableMatches,
    settings,
    referenceDate
  );

  const baseStrengths = computeBaseTeamStrengths(
    availableMatches,
    settings,
    globalProfile,
    referenceDate
  );

  const teamAProfile = computeOpponentAdjustedTeamProfile(
    teamA,
    availableMatches,
    settings,
    globalProfile,
    baseStrengths,
    referenceDate
  );

  const teamBProfile = computeOpponentAdjustedTeamProfile(
    teamB,
    availableMatches,
    settings,
    globalProfile,
    baseStrengths,
    referenceDate
  );

  const eloSignal = getBestEloSignal(teamA, teamB, matches, settings, context);

  const eloMultiplier = getEloGoalMultiplier(eloSignal);

  let expectedGoalsA =
    globalProfile.avgGoalsPerTeam *
    teamAProfile.attackStrength *
    teamBProfile.defenseWeakness *
    teamAProfile.momentumMultiplier *
    eloMultiplier.teamA;

  let expectedGoalsB =
    globalProfile.avgGoalsPerTeam *
    teamBProfile.attackStrength *
    teamAProfile.defenseWeakness *
    teamBProfile.momentumMultiplier *
    eloMultiplier.teamB;

  const tournamentTempoMultiplier = getTournamentTempoMultiplier(context);

  expectedGoalsA *= tournamentTempoMultiplier;
  expectedGoalsB *= tournamentTempoMultiplier;

  if (!context.neutral) {
    if (context.teamAIsHome) {
      expectedGoalsA *= 1 + settings.homeAdvantage;
      expectedGoalsB *= 1 - settings.homeAdvantage * 0.35;
    } else {
      expectedGoalsB *= 1 + settings.homeAdvantage;
      expectedGoalsA *= 1 - settings.homeAdvantage * 0.35;
    }
  }

  return shrinkFavoriteGap(
    clampExpectedGoals(expectedGoalsA),
    clampExpectedGoals(expectedGoalsB),
    settings,
    context,
    eloSignal
  );
}

function dixonColesAdjustment(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return clamp(1 - lambdaHome * lambdaAway * rho, 0.65, 1.35);
  }

  if (homeGoals === 0 && awayGoals === 1) {
    return clamp(1 + lambdaHome * rho, 0.65, 1.35);
  }

  if (homeGoals === 1 && awayGoals === 0) {
    return clamp(1 + lambdaAway * rho, 0.65, 1.35);
  }

  if (homeGoals === 1 && awayGoals === 1) {
    return clamp(1 - rho, 0.65, 1.35);
  }

  return 1;
}

function getDixonColesRho(context: PredictionContext): number {
  const tournament = context.tournament?.toLowerCase() ?? '';

  if (tournament.includes('world cup')) {
    return -0.06;
  }

  return -0.05;
}

function getDrawCalibrationFactor(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings,
  context: PredictionContext
): number {
  if (homeGoals !== awayGoals) {
    return 1;
  }

  const calibration = getCalibration(settings);
  const xgDiff = Math.abs(expectedGoals.teamA - expectedGoals.teamB);
  const xgTotal = expectedGoals.teamA + expectedGoals.teamB;
  const effectiveEloDiff =
    Math.abs(expectedGoals.eloDiff) * expectedGoals.eloImpact;
  const tournament = context.tournament?.toLowerCase() ?? '';

  let factor = calibration.drawBoostBase;

  if (xgDiff < 0.25) {
    factor += calibration.drawBoostCloseMatch;
  } else if (xgDiff < 0.5) {
    factor += calibration.drawBoostCloseMatch * 0.65;
  } else if (xgDiff < 0.8) {
    factor += calibration.drawBoostCloseMatch * 0.35;
  }

  if (xgTotal < 2.1) {
    factor += calibration.drawBoostLowTotal;
  } else if (xgTotal > 3.2) {
    factor -= calibration.drawBoostLowTotal * 0.7;
  }

  if (effectiveEloDiff < 80) {
    factor += 0.025;
  } else if (effectiveEloDiff > 240) {
    factor -= 0.04;
  } else if (effectiveEloDiff > 170) {
    factor -= 0.02;
  }

  if (tournament.includes('world cup')) {
    factor += 0.03;
  }

  if (homeGoals >= 3) {
    factor *= 0.75;
  }

  return clamp(factor, 1, calibration.drawBoostMax);
}

function getScoreShapeAdjustment(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings,
  context: PredictionContext
): number {
  const rho = getDixonColesRho(context);

  const dixonColesFactor = dixonColesAdjustment(
    homeGoals,
    awayGoals,
    expectedGoals.teamA,
    expectedGoals.teamB,
    rho
  );

  const drawCalibrationFactor = getDrawCalibrationFactor(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings,
    context
  );

  return dixonColesFactor * drawCalibrationFactor;
}

function applyTemperature(
  distribution: ScorePrediction[],
  settings: ModelSettings
): ScorePrediction[] {
  const calibration = getCalibration(settings);
  const temperature = clamp(calibration.scoreTemperature, 0.65, 1.6);

  if (Math.abs(temperature - 1) < 0.0001) {
    return distribution;
  }

  /**
   * Température :
   * - T < 1 : on concentre les probabilités sur les scores les plus probables.
   * - T > 1 : on aplatit la distribution.
   */
  const exponent = 1 / temperature;

  const adjusted = distribution.map((score) => ({
    ...score,
    probability: Math.pow(score.probability, exponent),
  }));

  const total = adjusted.reduce((sum, score) => sum + score.probability, 0);

  return adjusted.map((score) => ({
    ...score,
    probability: total > 0 ? score.probability / total : 0,
  }));
}

export function getTopScorePredictions(
  distribution: ScorePrediction[],
  count = 5
): ScorePrediction[] {
  return [...distribution]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, count);
}

function computeOutcomeProbabilities(distribution: ScorePrediction[]) {
  return distribution.reduce(
    (acc, score) => {
      if (score.homeGoals > score.awayGoals) {
        acc.teamAWin += score.probability;
      } else if (score.homeGoals === score.awayGoals) {
        acc.draw += score.probability;
      } else {
        acc.teamBWin += score.probability;
      }

      if (score.homeGoals + score.awayGoals > 1.5) {
        acc.over15 += score.probability;
      }

      if (score.homeGoals + score.awayGoals > 2.5) {
        acc.over25 += score.probability;
      }

      if (score.awayGoals === 0) {
        acc.teamACleanSheet += score.probability;
      }

      if (score.homeGoals === 0) {
        acc.teamBCleanSheet += score.probability;
      }

      return acc;
    },
    {
      teamAWin: 0,
      draw: 0,
      teamBWin: 0,
      over15: 0,
      over25: 0,
      teamACleanSheet: 0,
      teamBCleanSheet: 0,
    }
  );
}

export function predictScoreDistribution(
  teamA: string,
  teamB: string,
  matches: MatchResult[],
  settings: ModelSettings,
  context: PredictionContext = { neutral: true, teamAIsHome: true }
): MatchPrediction {
  const expectedGoals = estimateExpectedGoals(
    teamA,
    teamB,
    matches,
    settings,
    context
  );

  const distribution: ScorePrediction[] = [];

  for (let homeGoals = 0; homeGoals <= settings.maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= settings.maxGoals; awayGoals += 1) {
      const homeProbability = poissonProbability(
        expectedGoals.teamA,
        homeGoals
      );
      const awayProbability = poissonProbability(
        expectedGoals.teamB,
        awayGoals
      );

      const scoreShapeAdjustment = getScoreShapeAdjustment(
        homeGoals,
        awayGoals,
        expectedGoals,
        settings,
        context
      );

      distribution.push({
        homeGoals,
        awayGoals,
        probability: homeProbability * awayProbability * scoreShapeAdjustment,
      });
    }
  }

  const totalProbability = distribution.reduce(
    (sum, score) => sum + score.probability,
    0
  );

  const normalizedDistribution = distribution.map((score) => ({
    ...score,
    probability:
      totalProbability > 0 ? score.probability / totalProbability : 0,
  }));

  const temperatureAdjustedDistribution = applyTemperature(
    normalizedDistribution,
    settings
  );

  const topScores = getTopScorePredictions(temperatureAdjustedDistribution, 5);
  const outcomes = computeOutcomeProbabilities(temperatureAdjustedDistribution);

  return {
    teamA,
    teamB,
    expectedGoalsA: expectedGoals.teamA,
    expectedGoalsB: expectedGoals.teamB,
    distribution: temperatureAdjustedDistribution,
    topScores,
    outcomes,
  };
}
