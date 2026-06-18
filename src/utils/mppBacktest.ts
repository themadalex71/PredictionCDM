import type {
  MatchPrediction,
  MatchResult,
  ModelSettings,
  PredictionContext,
} from '../types/football';
import type {
  MppAnalysis,
  MppOdds,
  MppOutcome,
  MppScoreAdvice,
} from '../types/mpp';
import { analyzeMppPrediction, getScoreOutcome } from './mppScoring';
import { predictScoreDistribution } from './predictionModel';

export type MppBacktestInput = {
  matchKey: string;
  date: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;

  homeMppPoints: number;
  drawMppPoints: number;
  awayMppPoints: number;

  actualHomeScore: number;
  actualAwayScore: number;
};

export type MppBacktestStrategyId =
  | 'model_top_score'
  | 'safest'
  | 'best_expected'
  | 'upside'
  | 'recommended'
  | 'market_favorite'
  | 'consensus_70_30'
  | 'consensus_50_50'
  | 'consensus_40_60'
  | 'filtered_ev_30'
  | 'filtered_ev_40'
  | 'filtered_ev_50'
  | 'anti_underdog_ev_70'
  | 'anti_underdog_ev_90'
  | 'anti_underdog_ev_110';

export type MppBacktestStrategyResult = {
  strategyId: MppBacktestStrategyId;
  strategyLabel: string;

  pickedScore: string;
  pickedOutcomeLabel: string;

  pickedExpectedPoints: number;
  pickedRiskLabel: string;
  pickedReason: string;

  pointsWon: number;
  maxPossiblePoints: number;
  missedPoints: number;

  correctOutcome: boolean;
  exactScore: boolean;
};

export type MppBacktestMatchResult = {
  matchKey: string;
  date: string;
  group?: string;

  homeTeam: string;
  awayTeam: string;

  actualHomeScore: number;
  actualAwayScore: number;
  actualScoreLabel: string;

  homeMppPoints: number;
  drawMppPoints: number;
  awayMppPoints: number;

  prediction: MatchPrediction;
  analysis: MppAnalysis;

  actualOutcome: MppOutcome;
  actualOutcomeLabel: string;

  actualScoreAdvice?: MppScoreAdvice;
  maxPossiblePoints: number;

  strategyResults: MppBacktestStrategyResult[];
};

export type MppBacktestStrategySummary = {
  strategyId: MppBacktestStrategyId;
  strategyLabel: string;

  matches: number;
  correctOutcomes: number;
  exactScores: number;

  pointsWon: number;
  maxPossiblePoints: number;
  missedPoints: number;
  captureRate: number;

  correctOutcomeRate: number;
  exactScoreRate: number;
};

export type MppBacktestResult = {
  matches: MppBacktestMatchResult[];
  summaries: MppBacktestStrategySummary[];
  bestStrategy?: MppBacktestStrategySummary;
};

const STRATEGY_IDS: MppBacktestStrategyId[] = [
  'model_top_score',
  'safest',
  'best_expected',
  'upside',
  'recommended',
  'market_favorite',
  'consensus_70_30',
  'consensus_50_50',
  'consensus_40_60',
  'filtered_ev_30',
  'filtered_ev_40',
  'filtered_ev_50',
  'anti_underdog_ev_70',
  'anti_underdog_ev_90',
  'anti_underdog_ev_110',
];

const STRATEGY_LABELS: Record<MppBacktestStrategyId, string> = {
  model_top_score: 'Score le plus probable',
  safest: 'Choix le plus sûr',
  best_expected: 'Meilleure espérance',
  upside: 'Score différenciant',
  recommended: 'Conseil final',

  market_favorite: 'Favori MPP',
  consensus_70_30: 'Consensus modèle 70 / MPP 30',
  consensus_50_50: 'Consensus modèle 50 / MPP 50',
  consensus_40_60: 'Consensus modèle 40 / MPP 60',
  filtered_ev_30: 'EV filtrée ≥ 30 %',
  filtered_ev_40: 'EV filtrée ≥ 40 %',
  filtered_ev_50: 'EV filtrée ≥ 50 %',

  anti_underdog_ev_70: 'EV anti-outsider favori ≤ 70 pts',
  anti_underdog_ev_90: 'EV anti-outsider favori ≤ 90 pts',
  anti_underdog_ev_110: 'EV anti-outsider favori ≤ 110 pts',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getOutcomeLabel(
  homeTeam: string,
  awayTeam: string,
  outcome: MppOutcome
): string {
  if (outcome === 'teamA') return `Victoire ${homeTeam}`;
  if (outcome === 'teamB') return `Victoire ${awayTeam}`;
  return 'Match nul';
}

function getActualOutcome(homeGoals: number, awayGoals: number): MppOutcome {
  return getScoreOutcome(homeGoals, awayGoals);
}

function getTotalGoals(score: MppScoreAdvice): number {
  return score.homeGoals + score.awayGoals;
}

function isReasonableScore(score: MppScoreAdvice): boolean {
  return (
    score.exactProbability >= 0.004 &&
    score.outcomeProbability >= 0.08 &&
    getTotalGoals(score) <= 7
  );
}

function findScoreAdvice(
  analysis: MppAnalysis,
  homeGoals: number,
  awayGoals: number
): MppScoreAdvice | undefined {
  return analysis.scoreAdvices.find(
    (score) => score.homeGoals === homeGoals && score.awayGoals === awayGoals
  );
}

function getBestBy(
  scores: MppScoreAdvice[],
  selector: (score: MppScoreAdvice) => number
): MppScoreAdvice | undefined {
  if (scores.length === 0) return undefined;

  return [...scores].sort((a, b) => selector(b) - selector(a))[0];
}

function getSearchSpace(analysis: MppAnalysis): MppScoreAdvice[] {
  const reasonableScores = analysis.scoreAdvices.filter(isReasonableScore);

  return reasonableScores.length > 0 ? reasonableScores : analysis.scoreAdvices;
}

function getTopScoreAdvice(
  prediction: MatchPrediction,
  analysis: MppAnalysis
): MppScoreAdvice | undefined {
  const topScore = prediction.topScores[0];

  if (!topScore) {
    return undefined;
  }

  return findScoreAdvice(analysis, topScore.homeGoals, topScore.awayGoals);
}

function getMarketFavoriteOutcome(
  analysis: MppAnalysis
): MppOutcome | undefined {
  const sorted = [...analysis.outcomeAdvices]
    .filter((advice) => advice.normalizedMarketProbability !== null)
    .sort(
      (a, b) =>
        (b.normalizedMarketProbability ?? 0) -
        (a.normalizedMarketProbability ?? 0)
    );

  return sorted[0]?.outcome;
}

function getMarketFavoritePoints(analysis: MppAnalysis): number | null {
  const favoriteOutcome = getMarketFavoriteOutcome(analysis);

  if (!favoriteOutcome) {
    return null;
  }

  const favoriteAdvice = analysis.outcomeAdvices.find(
    (advice) => advice.outcome === favoriteOutcome
  );

  return favoriteAdvice?.mppPoints ?? null;
}

function getBestModelScoreForOutcome(
  analysis: MppAnalysis,
  outcome: MppOutcome
): MppScoreAdvice | undefined {
  const scores = getSearchSpace(analysis)
    .filter((score) => score.outcome === outcome)
    .sort((a, b) => b.exactProbability - a.exactProbability);

  return scores[0];
}

function getMarketFavoritePick(
  analysis: MppAnalysis
): MppScoreAdvice | undefined {
  const marketFavoriteOutcome = getMarketFavoriteOutcome(analysis);

  if (!marketFavoriteOutcome) {
    return analysis.safestPick;
  }

  return (
    getBestModelScoreForOutcome(analysis, marketFavoriteOutcome) ??
    analysis.safestPick
  );
}

function getBlendedOutcomeProbability(
  score: MppScoreAdvice,
  modelWeight: number
): number {
  const marketWeight = 1 - modelWeight;
  const marketProbability = score.marketProbability ?? score.outcomeProbability;

  return clamp(
    score.outcomeProbability * modelWeight + marketProbability * marketWeight,
    0,
    1
  );
}

function getBlendedExactProbability(
  score: MppScoreAdvice,
  blendedOutcomeProbability: number
): number {
  if (score.outcomeProbability <= 0) {
    return 0;
  }

  const conditionalExactShare =
    score.exactProbability / score.outcomeProbability;

  return clamp(
    blendedOutcomeProbability * conditionalExactShare,
    0,
    blendedOutcomeProbability
  );
}

function getConsensusScore(score: MppScoreAdvice, modelWeight: number): number {
  const blendedOutcomeProbability = getBlendedOutcomeProbability(
    score,
    modelWeight
  );

  const blendedExactProbability = getBlendedExactProbability(
    score,
    blendedOutcomeProbability
  );

  const blendedExpectedPoints =
    blendedOutcomeProbability * score.outcomePoints +
    blendedExactProbability * score.exactBonusPoints;

  const riskLevel = 1 - blendedOutcomeProbability;

  const riskPenalty = Math.pow(riskLevel, 1.65) * 14;

  const disagreementPenalty =
    score.edge !== null && score.edge > 0.12 ? score.edge * 10 : 0;

  const exactPlausibilityBonus =
    score.exactProbability >= 0.04
      ? score.exactProbability * score.exactBonusPoints * 0.08
      : 0;

  return (
    blendedExpectedPoints -
    riskPenalty -
    disagreementPenalty +
    exactPlausibilityBonus
  );
}

function getConsensusPick(
  analysis: MppAnalysis,
  modelWeight: number
): MppScoreAdvice | undefined {
  const searchSpace = getSearchSpace(analysis);

  const filteredScores = searchSpace.filter((score) => {
    const blendedOutcomeProbability = getBlendedOutcomeProbability(
      score,
      modelWeight
    );

    return (
      blendedOutcomeProbability >= 0.14 &&
      score.exactProbability >= 0.004 &&
      getTotalGoals(score) <= 7
    );
  });

  return getBestBy(
    filteredScores.length > 0 ? filteredScores : searchSpace,
    (score) => getConsensusScore(score, modelWeight)
  );
}

function getFilteredEvScore(
  score: MppScoreAdvice,
  minOutcomeProbability: number
): number {
  const marketProbability = score.marketProbability ?? score.outcomeProbability;

  const blendedProbability =
    score.outcomeProbability * 0.65 + marketProbability * 0.35;

  const riskLevel = 1 - blendedProbability;

  const riskPenalty = Math.pow(riskLevel, 1.55) * (minOutcomeProbability * 22);

  const edgeBonus =
    score.edge !== null && score.edge > 0
      ? Math.min(score.edge, 0.1) * Math.min(score.outcomePoints, 160) * 0.08
      : 0;

  return score.expectedPoints + edgeBonus - riskPenalty;
}

function getFilteredEvPick(
  analysis: MppAnalysis,
  minOutcomeProbability: number
): MppScoreAdvice | undefined {
  const searchSpace = getSearchSpace(analysis);

  const filteredScores = searchSpace.filter((score) => {
    const marketProbability =
      score.marketProbability ?? score.outcomeProbability;

    const blendedProbability =
      score.outcomeProbability * 0.65 + marketProbability * 0.35;

    return (
      blendedProbability >= minOutcomeProbability &&
      score.exactProbability >= 0.004 &&
      getTotalGoals(score) <= 7
    );
  });

  return getBestBy(
    filteredScores.length > 0 ? filteredScores : searchSpace,
    (score) => getFilteredEvScore(score, minOutcomeProbability)
  );
}

/**
 * Stratégie importante :
 * - on part de la meilleure espérance ;
 * - on garde les nuls value, car ils peuvent rapporter gros ;
 * - mais on refuse les victoires outsiders trop attirantes quand MPP indique clairement un favori.
 */
function getAntiUnderdogEvPick(
  analysis: MppAnalysis,
  favoriteMaxPoints: number
): MppScoreAdvice | undefined {
  const bestExpected = analysis.bestExpectedPick;
  const marketFavoriteOutcome = getMarketFavoriteOutcome(analysis);
  const marketFavoritePoints = getMarketFavoritePoints(analysis);
  const marketFavoritePick = getMarketFavoritePick(analysis);

  if (!bestExpected) {
    return marketFavoritePick;
  }

  if (
    !marketFavoriteOutcome ||
    !marketFavoritePick ||
    marketFavoritePoints === null
  ) {
    return bestExpected;
  }

  const bestPickIsMarketFavorite =
    bestExpected.outcome === marketFavoriteOutcome;

  const bestPickIsDraw = bestExpected.outcome === 'draw';

  const marketFavoriteIsClearlyIdentified =
    marketFavoritePoints <= favoriteMaxPoints;

  const bestPickIsNonDrawOutsider =
    !bestPickIsMarketFavorite && !bestPickIsDraw;

  if (marketFavoriteIsClearlyIdentified && bestPickIsNonDrawOutsider) {
    return marketFavoritePick;
  }

  return bestExpected;
}

function getStrategyPick(
  strategyId: MppBacktestStrategyId,
  prediction: MatchPrediction,
  analysis: MppAnalysis
): MppScoreAdvice | undefined {
  if (strategyId === 'model_top_score') {
    return getTopScoreAdvice(prediction, analysis);
  }

  if (strategyId === 'safest') {
    return analysis.safestPick;
  }

  if (strategyId === 'best_expected') {
    return analysis.bestExpectedPick;
  }

  if (strategyId === 'upside') {
    return analysis.upsidePick;
  }

  if (strategyId === 'recommended') {
    return analysis.recommendedPick;
  }

  if (strategyId === 'market_favorite') {
    return getMarketFavoritePick(analysis);
  }

  if (strategyId === 'consensus_70_30') {
    return getConsensusPick(analysis, 0.7);
  }

  if (strategyId === 'consensus_50_50') {
    return getConsensusPick(analysis, 0.5);
  }

  if (strategyId === 'consensus_40_60') {
    return getConsensusPick(analysis, 0.4);
  }

  if (strategyId === 'filtered_ev_30') {
    return getFilteredEvPick(analysis, 0.3);
  }

  if (strategyId === 'filtered_ev_40') {
    return getFilteredEvPick(analysis, 0.4);
  }

  if (strategyId === 'filtered_ev_50') {
    return getFilteredEvPick(analysis, 0.5);
  }

  if (strategyId === 'anti_underdog_ev_70') {
    return getAntiUnderdogEvPick(analysis, 70);
  }

  if (strategyId === 'anti_underdog_ev_90') {
    return getAntiUnderdogEvPick(analysis, 90);
  }

  return getAntiUnderdogEvPick(analysis, 110);
}

function scorePickAgainstActual(
  pick: MppScoreAdvice | undefined,
  input: MppBacktestInput,
  actualOutcome: MppOutcome,
  maxPossiblePoints: number,
  strategyId: MppBacktestStrategyId
): MppBacktestStrategyResult {
  if (!pick) {
    return {
      strategyId,
      strategyLabel: STRATEGY_LABELS[strategyId],

      pickedScore: '-',
      pickedOutcomeLabel: '-',

      pickedExpectedPoints: 0,
      pickedRiskLabel: '-',
      pickedReason: 'Aucun score disponible pour cette stratégie.',

      pointsWon: 0,
      maxPossiblePoints,
      missedPoints: maxPossiblePoints,

      correctOutcome: false,
      exactScore: false,
    };
  }

  const correctOutcome = pick.outcome === actualOutcome;

  const exactScore =
    pick.homeGoals === input.actualHomeScore &&
    pick.awayGoals === input.actualAwayScore;

  let pointsWon = 0;

  if (correctOutcome && exactScore) {
    pointsWon = pick.exactScoreTotalPoints;
  } else if (correctOutcome) {
    pointsWon = pick.outcomePoints;
  }

  return {
    strategyId,
    strategyLabel: STRATEGY_LABELS[strategyId],

    pickedScore: pick.scoreLabel,
    pickedOutcomeLabel: pick.outcomeLabel,

    pickedExpectedPoints: pick.expectedPoints,
    pickedRiskLabel: pick.riskLabel,
    pickedReason: pick.reason,

    pointsWon,
    maxPossiblePoints,
    missedPoints: Math.max(0, maxPossiblePoints - pointsWon),

    correctOutcome,
    exactScore,
  };
}

function buildPredictionContext(input: MppBacktestInput): PredictionContext {
  return {
    neutral: input.neutral,
    teamAIsHome: true,
    tournament: 'FIFA World Cup',
    predictionDate: input.date,
  };
}

function buildMppOdds(input: MppBacktestInput): MppOdds {
  return {
    teamAWin: input.homeMppPoints,
    draw: input.drawMppPoints,
    teamBWin: input.awayMppPoints,
  };
}

function runMatchBacktest(
  input: MppBacktestInput,
  historicalMatches: MatchResult[],
  settings: ModelSettings
): MppBacktestMatchResult {
  const context = buildPredictionContext(input);

  const backtestSettings: ModelSettings = {
    ...settings,
    maxGoals: Math.max(settings.maxGoals, 8),
  };

  const prediction = predictScoreDistribution(
    input.homeTeam,
    input.awayTeam,
    historicalMatches,
    backtestSettings,
    context
  );

  const odds = buildMppOdds(input);
  const analysis = analyzeMppPrediction(prediction, odds);

  const actualOutcome = getActualOutcome(
    input.actualHomeScore,
    input.actualAwayScore
  );

  const actualScoreAdvice = findScoreAdvice(
    analysis,
    input.actualHomeScore,
    input.actualAwayScore
  );

  const maxPossiblePoints =
    actualScoreAdvice?.exactScoreTotalPoints ??
    analysis.outcomeAdvices.find((advice) => advice.outcome === actualOutcome)
      ?.mppPoints ??
    0;

  const strategyResults = STRATEGY_IDS.map((strategyId) => {
    const pick = getStrategyPick(strategyId, prediction, analysis);

    return scorePickAgainstActual(
      pick,
      input,
      actualOutcome,
      maxPossiblePoints,
      strategyId
    );
  });

  return {
    matchKey: input.matchKey,
    date: input.date,
    group: input.group,

    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,

    actualHomeScore: input.actualHomeScore,
    actualAwayScore: input.actualAwayScore,
    actualScoreLabel: `${input.actualHomeScore}-${input.actualAwayScore}`,

    homeMppPoints: input.homeMppPoints,
    drawMppPoints: input.drawMppPoints,
    awayMppPoints: input.awayMppPoints,

    prediction,
    analysis,

    actualOutcome,
    actualOutcomeLabel: getOutcomeLabel(
      input.homeTeam,
      input.awayTeam,
      actualOutcome
    ),

    actualScoreAdvice,
    maxPossiblePoints,

    strategyResults,
  };
}

function buildStrategySummaries(
  matchResults: MppBacktestMatchResult[]
): MppBacktestStrategySummary[] {
  return STRATEGY_IDS.map((strategyId) => {
    const results = matchResults
      .flatMap((match) => match.strategyResults)
      .filter((result) => result.strategyId === strategyId);

    const matches = results.length;
    const correctOutcomes = results.filter(
      (result) => result.correctOutcome
    ).length;
    const exactScores = results.filter((result) => result.exactScore).length;

    const pointsWon = results.reduce(
      (sum, result) => sum + result.pointsWon,
      0
    );

    const maxPossiblePoints = results.reduce(
      (sum, result) => sum + result.maxPossiblePoints,
      0
    );

    const missedPoints = Math.max(0, maxPossiblePoints - pointsWon);

    return {
      strategyId,
      strategyLabel: STRATEGY_LABELS[strategyId],

      matches,
      correctOutcomes,
      exactScores,

      pointsWon,
      maxPossiblePoints,
      missedPoints,

      captureRate: maxPossiblePoints > 0 ? pointsWon / maxPossiblePoints : 0,

      correctOutcomeRate: matches > 0 ? correctOutcomes / matches : 0,

      exactScoreRate: matches > 0 ? exactScores / matches : 0,
    };
  }).sort((a, b) => b.pointsWon - a.pointsWon);
}

export function runMppBacktest(
  inputs: MppBacktestInput[],
  historicalMatches: MatchResult[],
  settings: ModelSettings
): MppBacktestResult {
  const validInputs = inputs
    .filter((input) => {
      return (
        input.homeTeam &&
        input.awayTeam &&
        input.date &&
        Number.isFinite(input.homeMppPoints) &&
        Number.isFinite(input.drawMppPoints) &&
        Number.isFinite(input.awayMppPoints) &&
        Number.isFinite(input.actualHomeScore) &&
        Number.isFinite(input.actualAwayScore)
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const matchResults = validInputs.map((input) =>
    runMatchBacktest(input, historicalMatches, settings)
  );

  const summaries = buildStrategySummaries(matchResults);

  return {
    matches: matchResults,
    summaries,
    bestStrategy: summaries[0],
  };
}
