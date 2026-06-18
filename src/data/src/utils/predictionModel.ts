import type {
  MatchPrediction,
  MatchResult,
  ModelSettings,
  PredictionContext,
  ScorePrediction,
} from '../types/football';
import { getEloComparison as getInternalEloComparison } from './eloModel';
import { getExternalEloComparison, getExternalEloRating } from './externalEloModel';

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

type ScoreModelKind =
  | 'independent_poisson'
  | 'dixon_coles'
  | 'bivariate_poisson'
  | 'hybrid_dc_bivariate';

type ScoreCalibrationKind =
  | 'none'
  | 'conservative'
  | 'classic_top1'
  | 'worldcup_prudent';

type CalibrationSettings = {
  favoriteShrinkBase: number;
  favoriteShrinkClose: number;
  favoriteShrinkMedium: number;
  drawBoostBase: number;
  drawBoostCloseMatch: number;
  drawBoostLowTotal: number;
  drawBoostMax: number;
  drawMultiplier: number;
  lowScoreDrawBoost: number;
  smartDrawBoost: boolean;
  smartDrawFavoritePenalty: number;
  smartDrawMaxBoost: number;
  externalEloImpact: number;
  internalEloImpact: number;
  scoreTemperature: number;
  useDixonColes: boolean;
  dixonColesRho: number;
  dixonColesWeight: number;
  scoreModel: ScoreModelKind;
  adaptiveDixonColes: boolean;
  bivariateSharedLambda: number;
  bivariateBlendWeight: number;
  advancedCompetitionWeights: boolean;
  opponentEloAdjustmentWeight: number;
  dataConfidenceWeight: number;
  scoreCalibration: ScoreCalibrationKind;
  favoriteControlWeight: number;
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
  drawBoostCloseMatch: 0.04,
  drawBoostLowTotal: 0.03,
  drawBoostMax: 1.22,
  drawMultiplier: 1.06,
  lowScoreDrawBoost: 0.06,
  smartDrawBoost: true,
  smartDrawFavoritePenalty: 0.75,
  smartDrawMaxBoost: 1.22,
  externalEloImpact: 0.35,
  internalEloImpact: 0.35,
  scoreTemperature: 1,
  useDixonColes: true,
  dixonColesRho: -0.08,
  dixonColesWeight: 1,
  scoreModel: 'hybrid_dc_bivariate',
  adaptiveDixonColes: true,
  bivariateSharedLambda: 0.08,
  bivariateBlendWeight: 0.25,
  advancedCompetitionWeights: true,
  opponentEloAdjustmentWeight: 0.45,
  dataConfidenceWeight: 1.2,
  scoreCalibration: 'classic_top1',
  favoriteControlWeight: 0.18,
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
    drawMultiplier:
      settings.drawMultiplier ?? DEFAULT_CALIBRATION.drawMultiplier,
    lowScoreDrawBoost:
      settings.lowScoreDrawBoost ?? DEFAULT_CALIBRATION.lowScoreDrawBoost,
    smartDrawBoost:
      settings.smartDrawBoost ?? DEFAULT_CALIBRATION.smartDrawBoost,
    smartDrawFavoritePenalty:
      settings.smartDrawFavoritePenalty ?? DEFAULT_CALIBRATION.smartDrawFavoritePenalty,
    smartDrawMaxBoost:
      settings.smartDrawMaxBoost ?? DEFAULT_CALIBRATION.smartDrawMaxBoost,
    externalEloImpact:
      settings.externalEloImpact ?? DEFAULT_CALIBRATION.externalEloImpact,
    internalEloImpact:
      settings.internalEloImpact ?? DEFAULT_CALIBRATION.internalEloImpact,
    scoreTemperature:
      settings.scoreTemperature ?? DEFAULT_CALIBRATION.scoreTemperature,
    useDixonColes:
      settings.useDixonColes ?? DEFAULT_CALIBRATION.useDixonColes,
    dixonColesRho:
      settings.dixonColesRho ?? DEFAULT_CALIBRATION.dixonColesRho,
    dixonColesWeight:
      settings.dixonColesWeight ?? DEFAULT_CALIBRATION.dixonColesWeight,
    scoreModel: settings.scoreModel ?? DEFAULT_CALIBRATION.scoreModel,
    adaptiveDixonColes:
      settings.adaptiveDixonColes ?? DEFAULT_CALIBRATION.adaptiveDixonColes,
    bivariateSharedLambda:
      settings.bivariateSharedLambda ?? DEFAULT_CALIBRATION.bivariateSharedLambda,
    bivariateBlendWeight:
      settings.bivariateBlendWeight ?? DEFAULT_CALIBRATION.bivariateBlendWeight,
    advancedCompetitionWeights:
      settings.advancedCompetitionWeights ?? DEFAULT_CALIBRATION.advancedCompetitionWeights,
    opponentEloAdjustmentWeight:
      settings.opponentEloAdjustmentWeight ?? DEFAULT_CALIBRATION.opponentEloAdjustmentWeight,
    dataConfidenceWeight:
      settings.dataConfidenceWeight ?? DEFAULT_CALIBRATION.dataConfidenceWeight,
    scoreCalibration:
      settings.scoreCalibration ?? DEFAULT_CALIBRATION.scoreCalibration,
    favoriteControlWeight:
      settings.favoriteControlWeight ?? DEFAULT_CALIBRATION.favoriteControlWeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getDataReliability(
  weightedMatches: number,
  rawMatches: number,
  settings: ModelSettings
): number {
  const calibration = getCalibration(settings);
  const volumeReliability = Math.sqrt(Math.max(0, weightedMatches) / 30);
  const rawVolumeReliability = Math.sqrt(Math.max(0, rawMatches) / 12);
  const blendedReliability = clamp(
    volumeReliability * 0.72 + rawVolumeReliability * 0.28,
    0,
    1
  );

  // Si dataConfidenceWeight > 1, les équipes avec peu de matchs sont davantage
  // ramenées vers la moyenne. Cela évite de sur-interpréter 3 ou 4 matchs récents.
  return clamp(
    Math.pow(blendedReliability, clamp(calibration.dataConfidenceWeight, 0.45, 2.4)),
    0,
    1
  );
}

function getExternalTeamQualityMultiplier(
  team: string,
  referenceDate: string | undefined,
  settings: ModelSettings
): number {
  const calibration = getCalibration(settings);
  const weight = clamp(calibration.opponentEloAdjustmentWeight, 0, 1.5);

  if (weight <= 0) {
    return 1;
  }

  const rating = getExternalEloRating(team, {
    neutral: true,
    teamAIsHome: true,
    predictionDate: referenceDate,
  });

  if (!rating) {
    return 1;
  }

  // Le centre de gravité du fichier Elo est proche de 1690.
  // Une équipe très forte rend les buts marqués contre elle plus précieux ;
  // à l'inverse, concéder contre elle est un peu moins grave.
  const normalizedQuality = clamp((rating.rating - 1690) / 520, -1.25, 1.25);

  return clamp(Math.exp(normalizedQuality * 0.34 * weight), 0.72, 1.38);
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
  const calibration = getCalibration(settings);
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

  if (!calibration.advancedCompetitionWeights) {
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

  // Nouvelle logique : on filtre beaucoup mieux la qualité des compétitions.
  // Les résultats de Coupe du Monde / qualifications / vraies coupes continentales
  // doivent structurer le niveau d'équipe. Les petits tournois amicaux ou séries
  // servent seulement de signal secondaire.
  const isSmallInvitational =
    normalized.includes('fifa series') ||
    normalized.includes('concacaf series') ||
    normalized.includes('mukuru') ||
    normalized.includes('tri-nations') ||
    normalized.includes('tri nations') ||
    normalized.includes('4 nations') ||
    normalized.includes('four nations') ||
    normalized.includes('unity cup') ||
    normalized.includes('diamond jubilee') ||
    normalized.includes('capital of african football') ||
    normalized.includes('baltic cup') ||
    normalized.includes('kirin') ||
    normalized.includes('king cup') ||
    normalized.includes('tournament');

  if (isWorldCupFinalTournament) {
    return Math.max(2.05, settings.officialMatchWeight * 1.15);
  }

  if (isQualification) {
    return Math.max(1.35, settings.officialMatchWeight * 0.85);
  }

  if (isContinentalCompetition) {
    return Math.max(1.45, settings.officialMatchWeight * 0.95);
  }

  if (isNationsLeague) {
    return Math.max(1.05, settings.officialMatchWeight * 0.62);
  }

  if (isSmallInvitational) {
    if (normalized.includes('baltic cup')) return 0.7;
    if (normalized.includes('fifa series')) return 0.68;
    if (normalized.includes('concacaf series')) return 0.72;
    return 0.52;
  }

  if (isFriendly) {
    return 0.5;
  }

  return 0.82;
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

    const reliability = getDataReliability(
      record.weightedMatches,
      record.rawMatches,
      settings
    );

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
    const opponentQualityMultiplier = getExternalTeamQualityMultiplier(
      opponent,
      match.date,
      settings
    );

    const weight = getMatchWeight(match, settings, referenceDate);
    const { goalsFor, goalsAgainst } = getGoalsForTeam(match, team);

    weightedAdjustedGoalsFor +=
      (goalsFor /
        clamp(opponentDefenseWeakness, 0.55, 1.9) *
        opponentQualityMultiplier) *
      weight;

    weightedAdjustedGoalsAgainst +=
      (goalsAgainst /
        clamp(opponentAttackStrength, 0.55, 1.9) /
        opponentQualityMultiplier) *
      weight;

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
    const opponentQualityMultiplier = getExternalTeamQualityMultiplier(
      opponent,
      match.date,
      settings
    );

    const weight = getMatchWeight(match, settings, referenceDate);
    const { goalsFor, goalsAgainst } = getGoalsForTeam(match, team);

    recentAdjustedGoalsFor +=
      (goalsFor /
        clamp(opponentDefenseWeakness, 0.55, 1.9) *
        opponentQualityMultiplier) *
      weight;

    recentAdjustedGoalsAgainst +=
      (goalsAgainst /
        clamp(opponentAttackStrength, 0.55, 1.9) /
        opponentQualityMultiplier) *
      weight;

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

  const reliability = getDataReliability(
    totalWeight,
    teamMatches.length,
    settings
  );

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
  const safeLambdaHome = clamp(lambdaHome, 0.05, 5.5);
  const safeLambdaAway = clamp(lambdaAway, 0.05, 5.5);

  if (homeGoals === 0 && awayGoals === 0) {
    return clamp(1 - safeLambdaHome * safeLambdaAway * rho, 0.45, 1.75);
  }

  if (homeGoals === 0 && awayGoals === 1) {
    return clamp(1 + safeLambdaHome * rho, 0.45, 1.75);
  }

  if (homeGoals === 1 && awayGoals === 0) {
    return clamp(1 + safeLambdaAway * rho, 0.45, 1.75);
  }

  if (homeGoals === 1 && awayGoals === 1) {
    return clamp(1 - rho, 0.45, 1.75);
  }

  return 1;
}

function getAdaptiveDixonColesRho(
  expectedGoals: ExpectedGoals,
  settings: ModelSettings
): number {
  const calibration = getCalibration(settings);
  const baseRho = clamp(calibration.dixonColesRho, -0.35, 0.25);

  if (!calibration.adaptiveDixonColes) {
    return baseRho;
  }

  const totalGoals = expectedGoals.teamA + expectedGoals.teamB;
  const goalDiff = Math.abs(expectedGoals.teamA - expectedGoals.teamB);

  let multiplier = 1;

  // Les matchs serrés et plutôt fermés ont historiquement plus de faibles scores.
  if (goalDiff < 0.25) multiplier += 0.25;
  else if (goalDiff < 0.5) multiplier += 0.12;

  if (totalGoals < 2.15) multiplier += 0.2;
  else if (totalGoals > 3.1) multiplier -= 0.18;

  // Si l'Elo dit que le match est très déséquilibré, on évite de sur-booster les nuls.
  const effectiveEloDiff = Math.abs(expectedGoals.eloDiff) * expectedGoals.eloImpact;
  if (effectiveEloDiff > 260) multiplier -= 0.18;
  else if (effectiveEloDiff > 180) multiplier -= 0.08;

  return clamp(baseRho * clamp(multiplier, 0.65, 1.45), -0.4, 0.3);
}

function getDixonColesFactor(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings
): number {
  const calibration = getCalibration(settings);

  if (!calibration.useDixonColes || calibration.scoreModel === 'independent_poisson') {
    return 1;
  }

  const rho = getAdaptiveDixonColesRho(expectedGoals, settings);
  const weight = clamp(calibration.dixonColesWeight, 0, 1.5);

  if (weight <= 0) {
    return 1;
  }

  const rawFactor = dixonColesAdjustment(
    homeGoals,
    awayGoals,
    expectedGoals.teamA,
    expectedGoals.teamB,
    rho
  );

  return clamp(1 + (rawFactor - 1) * weight, 0.4, 1.9);
}

function getLegacyDrawCalibrationFactor(
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

  let factor = calibration.drawBoostBase * calibration.drawMultiplier;

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

  if (homeGoals === 0) {
    factor += calibration.lowScoreDrawBoost;
  } else if (homeGoals === 1) {
    factor += calibration.lowScoreDrawBoost;
  } else if (homeGoals === 2) {
    factor += calibration.lowScoreDrawBoost * 0.45;
  }

  if (homeGoals >= 3) {
    factor *= 0.75;
  }

  const dynamicMax = Math.max(
    calibration.drawBoostMax,
    calibration.drawMultiplier + calibration.lowScoreDrawBoost + 0.08
  );

  return clamp(factor, 1, dynamicMax);
}

function getSmartDrawCalibrationFactor(
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
  const effectiveEloDiff = Math.abs(expectedGoals.eloDiff) * expectedGoals.eloImpact;
  const tournament = context.tournament?.toLowerCase() ?? '';

  // 1 = match très serré ; 0 = match avec favori clair en expected goals.
  const closenessScore = clamp(1 - xgDiff / 0.9, 0, 1);

  // 1 = match fermé ; 0 = match ouvert.
  const lowTotalScore = clamp((2.75 - xgTotal) / 0.95, 0, 1);

  // Pénalités quand un favori ressort clairement.
  const eloFavoriteSignal = clamp((effectiveEloDiff - 115) / 230, 0, 1);
  const xgFavoriteSignal = clamp((xgDiff - 0.42) / 0.85, 0, 1);
  const favoriteSignal = clamp(eloFavoriteSignal * 0.58 + xgFavoriteSignal * 0.42, 0, 1);
  const favoritePenalty = clamp(calibration.smartDrawFavoritePenalty, 0, 1.25);

  let scoreSpecificWeight = 0;

  if (homeGoals === 0 || homeGoals === 1) {
    scoreSpecificWeight = 1;
  } else if (homeGoals === 2) {
    scoreSpecificWeight = 0.42;
  } else {
    scoreSpecificWeight = 0.08;
  }

  const globalDrawBoost = Math.max(0, calibration.drawMultiplier - 1);

  let boost = 0;

  // Les nuls ne sont boostés que si le match est serré et/ou fermé.
  boost += globalDrawBoost * (0.25 + 0.75 * closenessScore);
  boost += calibration.drawBoostCloseMatch * closenessScore;
  boost += calibration.drawBoostLowTotal * lowTotalScore;
  boost +=
    calibration.lowScoreDrawBoost *
    scoreSpecificWeight *
    (0.35 + 0.65 * Math.max(closenessScore, lowTotalScore));

  if (tournament.includes('world cup')) {
    boost += 0.018 * closenessScore;
  }

  if (xgTotal > 3.05 && closenessScore < 0.45) {
    boost *= 0.65;
  }

  // C'est la partie importante : si le match n'est pas équilibré,
  // on évite de transformer trop de victoires en nuls.
  boost *= 1 - clamp(favoriteSignal * favoritePenalty, 0, 0.82);

  let factor = 1 + boost;

  if (favoriteSignal > 0.75) {
    factor = Math.min(factor, 1.04);
  } else if (favoriteSignal > 0.55) {
    factor = Math.min(factor, 1.08);
  }

  const smartMax = Math.min(
    calibration.drawBoostMax,
    Math.max(1, calibration.smartDrawMaxBoost)
  );

  return clamp(factor, 1, smartMax);
}

function getDrawCalibrationFactor(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings,
  context: PredictionContext
): number {
  const calibration = getCalibration(settings);

  if (!calibration.smartDrawBoost) {
    return getLegacyDrawCalibrationFactor(
      homeGoals,
      awayGoals,
      expectedGoals,
      settings,
      context
    );
  }

  return getSmartDrawCalibrationFactor(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings,
    context
  );
}

function getScoreCalibrationFactor(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings,
  context: PredictionContext
): number {
  const calibration = getCalibration(settings);
  const mode = calibration.scoreCalibration;

  if (mode === 'none') {
    return 1;
  }

  const totalGoals = homeGoals + awayGoals;
  const goalDiff = Math.abs(homeGoals - awayGoals);
  const xgTotal = expectedGoals.teamA + expectedGoals.teamB;
  const xgDiff = Math.abs(expectedGoals.teamA - expectedGoals.teamB);
  const tournament = context.tournament?.toLowerCase() ?? '';

  const lowTotalContext = clamp((2.85 - xgTotal) / 1.15, 0, 1);
  const closeContext = clamp(1 - xgDiff / 1.05, 0, 1);
  const favoriteContext = clamp(xgDiff / 1.25, 0, 1);

  let factor = 1;
  const strength = mode === 'conservative' ? 0.5 : mode === 'worldcup_prudent' ? 0.75 : 1;

  // Calibration empirique douce : elle ne modifie pas les probabilités d'issue
  // massivement, elle aide surtout à mieux ordonner les scores classiques.
  if (homeGoals === 0 && awayGoals === 0) {
    factor += 0.045 * strength * (0.45 + 0.55 * lowTotalContext);
  } else if (homeGoals === 1 && awayGoals === 1) {
    factor += 0.065 * strength * (0.35 + 0.65 * closeContext);
  } else if (goalDiff === 1 && totalGoals <= 3) {
    factor += 0.035 * strength;
  } else if (goalDiff === 2 && totalGoals <= 4) {
    factor += 0.012 * strength * favoriteContext;
  }

  if (totalGoals >= 5) {
    factor -= 0.045 * strength;
  }

  if (totalGoals >= 6) {
    factor -= 0.045 * strength;
  }

  if (homeGoals === awayGoals && homeGoals >= 3) {
    factor -= 0.14 * strength;
  }

  if (mode === 'worldcup_prudent' && tournament.includes('world cup')) {
    if (homeGoals === awayGoals && homeGoals <= 1) {
      factor += 0.025 * closeContext;
    }

    if (totalGoals >= 5) {
      factor -= 0.025;
    }
  }

  return clamp(factor, 0.74, 1.22);
}

function getFavoriteControlFactor(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings
): number {
  const calibration = getCalibration(settings);
  const weight = clamp(calibration.favoriteControlWeight, 0, 1.2);

  if (weight <= 0) {
    return 1;
  }

  const xgDiff = expectedGoals.teamA - expectedGoals.teamB;
  const effectiveEloDiff = expectedGoals.eloDiff * expectedGoals.eloImpact;
  const favoriteDirection =
    xgDiff + effectiveEloDiff / 520;

  const favoriteStrength = clamp((Math.abs(favoriteDirection) - 0.42) / 1.25, 0, 1);

  if (favoriteStrength <= 0) {
    return 1;
  }

  const teamAFavorite = favoriteDirection > 0;
  const scoreOutcome = homeGoals > awayGoals ? 'teamA' : homeGoals < awayGoals ? 'teamB' : 'draw';
  const favoriteOutcome = teamAFavorite ? 'teamA' : 'teamB';
  const favoriteGoals = teamAFavorite ? homeGoals : awayGoals;
  const underdogGoals = teamAFavorite ? awayGoals : homeGoals;
  const margin = favoriteGoals - underdogGoals;

  if (scoreOutcome !== favoriteOutcome && scoreOutcome !== 'draw') {
    return clamp(1 - 0.34 * weight * favoriteStrength, 0.58, 1);
  }

  if (scoreOutcome === 'draw') {
    return clamp(1 - 0.13 * weight * favoriteStrength, 0.78, 1);
  }

  if (margin >= 1 && margin <= 2 && favoriteGoals <= 3) {
    return clamp(1 + 0.065 * weight * favoriteStrength, 1, 1.12);
  }

  if (margin >= 4) {
    return clamp(1 - 0.04 * weight, 0.9, 1);
  }

  return 1;
}

function getScoreShapeAdjustment(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings,
  context: PredictionContext
): number {
  const dixonColesFactor = getDixonColesFactor(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings
  );

  const drawCalibrationFactor = getDrawCalibrationFactor(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings,
    context
  );

  const scoreCalibrationFactor = getScoreCalibrationFactor(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings,
    context
  );

  const favoriteControlFactor = getFavoriteControlFactor(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings
  );

  return (
    dixonColesFactor *
    drawCalibrationFactor *
    scoreCalibrationFactor *
    favoriteControlFactor
  );
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


function bivariatePoissonProbability(
  lambdaHome: number,
  lambdaAway: number,
  sharedLambda: number,
  homeGoals: number,
  awayGoals: number
): number {
  const safeShared = clamp(
    sharedLambda,
    0,
    Math.max(0, Math.min(lambdaHome, lambdaAway) * 0.65)
  );

  const independentHome = Math.max(lambdaHome - safeShared, 0.01);
  const independentAway = Math.max(lambdaAway - safeShared, 0.01);

  const base = Math.exp(-(independentHome + independentAway + safeShared));
  let sum = 0;

  for (let sharedGoals = 0; sharedGoals <= Math.min(homeGoals, awayGoals); sharedGoals += 1) {
    const homeIndependentGoals = homeGoals - sharedGoals;
    const awayIndependentGoals = awayGoals - sharedGoals;

    sum +=
      (Math.pow(independentHome, homeIndependentGoals) / factorial(homeIndependentGoals)) *
      (Math.pow(independentAway, awayIndependentGoals) / factorial(awayIndependentGoals)) *
      (Math.pow(safeShared, sharedGoals) / factorial(sharedGoals));
  }

  return base * sum;
}

function getAdaptiveSharedLambda(
  expectedGoals: ExpectedGoals,
  settings: ModelSettings
): number {
  const calibration = getCalibration(settings);
  const baseShared = clamp(calibration.bivariateSharedLambda, 0, 0.45);

  const totalGoals = expectedGoals.teamA + expectedGoals.teamB;
  const goalDiff = Math.abs(expectedGoals.teamA - expectedGoals.teamB);
  const favoriteStrength = Math.abs(expectedGoals.eloDiff) * expectedGoals.eloImpact;

  let multiplier = 1;

  if (goalDiff < 0.3) multiplier += 0.18;
  else if (goalDiff > 1.1) multiplier -= 0.16;

  if (totalGoals < 2.2) multiplier += 0.14;
  else if (totalGoals > 3.2) multiplier -= 0.2;

  if (favoriteStrength > 250) multiplier -= 0.18;

  return clamp(baseShared * clamp(multiplier, 0.55, 1.35), 0, 0.45);
}

function getScoreProbability(
  homeGoals: number,
  awayGoals: number,
  expectedGoals: ExpectedGoals,
  settings: ModelSettings,
  context: PredictionContext
): number {
  const calibration = getCalibration(settings);

  const independentProbability =
    poissonProbability(expectedGoals.teamA, homeGoals) *
    poissonProbability(expectedGoals.teamB, awayGoals);

  const shapeAdjustment = getScoreShapeAdjustment(
    homeGoals,
    awayGoals,
    expectedGoals,
    settings,
    context
  );

  const dixonColesProbability = independentProbability * shapeAdjustment;

  if (calibration.scoreModel === 'independent_poisson') {
    return independentProbability;
  }

  if (calibration.scoreModel === 'dixon_coles') {
    return dixonColesProbability;
  }

  const bivariateProbability = bivariatePoissonProbability(
    expectedGoals.teamA,
    expectedGoals.teamB,
    getAdaptiveSharedLambda(expectedGoals, settings),
    homeGoals,
    awayGoals
  );

  if (calibration.scoreModel === 'bivariate_poisson') {
    return bivariateProbability;
  }

  const bivariateWeight = clamp(calibration.bivariateBlendWeight, 0, 1);

  return (
    dixonColesProbability * (1 - bivariateWeight) +
    bivariateProbability * bivariateWeight
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
      distribution.push({
        homeGoals,
        awayGoals,
        probability: getScoreProbability(
          homeGoals,
          awayGoals,
          expectedGoals,
          settings,
          context
        ),
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
