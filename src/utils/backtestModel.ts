import type {
  MatchPrediction,
  MatchResult,
  ModelSettings,
  PredictionContext,
  ScorePrediction,
} from '../types/football';
import { predictScoreDistribution } from './predictionModel';

export type MatchOutcome = 'teamA' | 'draw' | 'teamB';

export type BacktestOptions = {
  testStartDate: string;
  testEndDate: string;
  maxMatches: number;
  includeFriendlies: boolean;
  minPriorMatchesPerTeam: number;
};

export type BacktestRow = {
  id: string;
  date: string;
  tournament: string;

  homeTeam: string;
  awayTeam: string;

  actualHomeGoals: number;
  actualAwayGoals: number;

  predictedHomeGoals: number;
  predictedAwayGoals: number;
  predictedScoreProbability: number;

  actualScoreProbability: number;
  actualScoreRank: number | null;

  actualOutcome: MatchOutcome;
  predictedOutcome: MatchOutcome;
  actualOutcomeProbability: number;

  exactTop1Hit: boolean;
  exactTop5Hit: boolean;
  correctOutcomeHit: boolean;

  resultLogLoss: number;
  exactScoreLogLoss: number;
  brierScore: number;

  priorHomeMatches: number;
  priorAwayMatches: number;
};

export type BacktestSummary = {
  testedMatches: number;
  candidateMatches: number;
  skippedMatches: number;

  exactTop1Accuracy: number;
  exactTop5Accuracy: number;
  outcomeAccuracy: number;

  actualHomeWinShare: number;
  actualDrawShare: number;
  actualAwayWinShare: number;

  predictedHomeWinShare: number;
  predictedDrawShare: number;
  predictedAwayWinShare: number;

  averageActualScoreProbability: number;
  averageActualOutcomeProbability: number;

  averageExactScoreLogLoss: number;
  averageResultLogLoss: number;
  averageBrierScore: number;

  bestExactScoreProbability: number;
  worstExactScoreProbability: number;
};

export type BacktestResult = {
  options: BacktestOptions;
  summary: BacktestSummary;
  rows: BacktestRow[];
};

export type CalibrationPreset = {
  id: string;
  name: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
};

export type EloImpactPreset = {
  id: string;
  label: string;
  value: number;
  description: string;
};

export type TemperaturePreset = {
  id: string;
  label: string;
  value: number;
  description: string;
};

export type CalibrationSearchRow = {
  id: string;
  name: string;
  description: string;
  eloImpactLabel: string;
  eloImpactValue: number;
  temperatureLabel: string;
  temperatureValue: number;
  settings: ModelSettings;
  summary: BacktestSummary;
};

export type CalibrationSearchResult = {
  rows: CalibrationSearchRow[];
  bestByLogLoss?: CalibrationSearchRow;
  bestByBrier?: CalibrationSearchRow;
  bestByOutcome?: CalibrationSearchRow;
  bestByTop5?: CalibrationSearchRow;
};

/**
 * Calibration rapide :
 * on garde seulement les réglages déjà prometteurs.
 *
 * Avant : 8 calibrations.
 * Maintenant : 3 calibrations.
 */
export const calibrationPresets: CalibrationPreset[] = [
  {
    id: 'v03_like',
    name: 'v0.3 agressif',
    description:
      'Très peu de correction des nuls. Meilleur résultat brut dans les tests précédents.',
    settingsPatch: {
      favoriteShrinkBase: 1,
      favoriteShrinkClose: 1,
      favoriteShrinkMedium: 1,
      drawBoostBase: 1,
      drawBoostCloseMatch: 0,
      drawBoostLowTotal: 0,
      drawBoostMax: 1,
    },
  },
  {
    id: 'light_1',
    name: 'Léger nul 1',
    description: 'Petite correction des nuls. Bon compromis Top 5 / stabilité.',
    settingsPatch: {
      favoriteShrinkBase: 0.96,
      favoriteShrinkClose: 1,
      favoriteShrinkMedium: 0.98,
      drawBoostBase: 1.02,
      drawBoostCloseMatch: 0.04,
      drawBoostLowTotal: 0.02,
      drawBoostMax: 1.14,
    },
  },
  {
    id: 'balanced_3',
    name: 'Équilibré 3',
    description:
      'Un peu plus de nuls. Souvent intéressant pour le Top 5 score exact.',
    settingsPatch: {
      favoriteShrinkBase: 0.88,
      favoriteShrinkClose: 0.96,
      favoriteShrinkMedium: 0.92,
      drawBoostBase: 1.06,
      drawBoostCloseMatch: 0.1,
      drawBoostLowTotal: 0.05,
      drawBoostMax: 1.32,
    },
  },
];

/**
 * On garde uniquement les impacts Elo qui avaient du sens :
 * 0 %, 35 %, 65 %.
 *
 * Les tests précédents montraient que 100 % et 135 % n'apportaient pas
 * suffisamment pour justifier le temps de calcul.
 */
export const eloImpactPresets: EloImpactPreset[] = [
  {
    id: 'elo_0',
    label: 'Elo 0 %',
    value: 0,
    description: 'Elo désactivé.',
  },
  {
    id: 'elo_35',
    label: 'Elo 35 %',
    value: 0.35,
    description: 'Elo très léger.',
  },
  {
    id: 'elo_65',
    label: 'Elo 65 %',
    value: 0.65,
    description: 'Elo modéré.',
  },
];

/**
 * Températures limitées à 3 valeurs pour éviter de bloquer StackBlitz.
 */
export const temperaturePresets: TemperaturePreset[] = [
  {
    id: 'temp_095',
    label: 'Temp 0.95',
    value: 0.95,
    description: 'Distribution légèrement plus concentrée.',
  },
  {
    id: 'temp_100',
    label: 'Temp 1.00',
    value: 1,
    description: 'Distribution normale.',
  },
  {
    id: 'temp_110',
    label: 'Temp 1.10',
    value: 1.1,
    description: 'Distribution légèrement plus plate.',
  },
];

function isFriendlyTournament(tournament: string): boolean {
  const normalized = tournament.toLowerCase();

  return normalized.includes('friendly') || normalized.includes('friendlies');
}

function isValidScoredMatch(match: MatchResult): boolean {
  return (
    Boolean(match.date) &&
    Number.isFinite(match.homeScore) &&
    Number.isFinite(match.awayScore)
  );
}

function getOutcome(homeGoals: number, awayGoals: number): MatchOutcome {
  if (homeGoals > awayGoals) return 'teamA';
  if (homeGoals < awayGoals) return 'teamB';
  return 'draw';
}

export function formatOutcomeLabel(outcome: MatchOutcome): string {
  if (outcome === 'teamA') return 'Victoire équipe A';
  if (outcome === 'teamB') return 'Victoire équipe B';
  return 'Nul';
}

function getPredictedOutcome(prediction: MatchPrediction): MatchOutcome {
  const probabilities = [
    {
      outcome: 'teamA' as const,
      probability: prediction.outcomes.teamAWin,
    },
    {
      outcome: 'draw' as const,
      probability: prediction.outcomes.draw,
    },
    {
      outcome: 'teamB' as const,
      probability: prediction.outcomes.teamBWin,
    },
  ];

  return probabilities.sort((a, b) => b.probability - a.probability)[0].outcome;
}

function getOutcomeProbability(
  prediction: MatchPrediction,
  outcome: MatchOutcome
): number {
  if (outcome === 'teamA') return prediction.outcomes.teamAWin;
  if (outcome === 'teamB') return prediction.outcomes.teamBWin;
  return prediction.outcomes.draw;
}

function findScorePrediction(
  distribution: ScorePrediction[],
  homeGoals: number,
  awayGoals: number
): ScorePrediction | undefined {
  return distribution.find(
    (score) => score.homeGoals === homeGoals && score.awayGoals === awayGoals
  );
}

function getActualScoreRank(
  distribution: ScorePrediction[],
  homeGoals: number,
  awayGoals: number
): number | null {
  const sortedDistribution = [...distribution].sort(
    (a, b) => b.probability - a.probability
  );

  const index = sortedDistribution.findIndex(
    (score) => score.homeGoals === homeGoals && score.awayGoals === awayGoals
  );

  return index >= 0 ? index + 1 : null;
}

function countPriorMatches(
  allMatches: MatchResult[],
  team: string,
  beforeDate: string,
  startYear: number
): number {
  return allMatches.filter((match) => {
    if (match.date >= beforeDate) return false;

    const year = new Date(`${match.date}T12:00:00`).getFullYear();

    if (Number.isNaN(year)) return false;
    if (year < startYear) return false;

    return match.homeTeam === team || match.awayTeam === team;
  }).length;
}

function computeBrierScore(
  prediction: MatchPrediction,
  actualOutcome: MatchOutcome
): number {
  const homeTarget = actualOutcome === 'teamA' ? 1 : 0;
  const drawTarget = actualOutcome === 'draw' ? 1 : 0;
  const awayTarget = actualOutcome === 'teamB' ? 1 : 0;

  return (
    Math.pow(prediction.outcomes.teamAWin - homeTarget, 2) +
    Math.pow(prediction.outcomes.draw - drawTarget, 2) +
    Math.pow(prediction.outcomes.teamBWin - awayTarget, 2)
  );
}

function safeLogLoss(probability: number): number {
  return -Math.log(Math.max(probability, 0.000001));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function share(
  rows: BacktestRow[],
  predicate: (row: BacktestRow) => boolean
): number {
  if (rows.length === 0) return 0;

  return rows.filter(predicate).length / rows.length;
}

function buildSummary(
  rows: BacktestRow[],
  candidateMatches: number,
  skippedMatches: number
): BacktestSummary {
  const testedMatches = rows.length;

  if (testedMatches === 0) {
    return {
      testedMatches: 0,
      candidateMatches,
      skippedMatches,
      exactTop1Accuracy: 0,
      exactTop5Accuracy: 0,
      outcomeAccuracy: 0,
      actualHomeWinShare: 0,
      actualDrawShare: 0,
      actualAwayWinShare: 0,
      predictedHomeWinShare: 0,
      predictedDrawShare: 0,
      predictedAwayWinShare: 0,
      averageActualScoreProbability: 0,
      averageActualOutcomeProbability: 0,
      averageExactScoreLogLoss: 0,
      averageResultLogLoss: 0,
      averageBrierScore: 0,
      bestExactScoreProbability: 0,
      worstExactScoreProbability: 0,
    };
  }

  const actualScoreProbabilities = rows.map(
    (row) => row.actualScoreProbability
  );

  return {
    testedMatches,
    candidateMatches,
    skippedMatches,

    exactTop1Accuracy:
      rows.filter((row) => row.exactTop1Hit).length / testedMatches,

    exactTop5Accuracy:
      rows.filter((row) => row.exactTop5Hit).length / testedMatches,

    outcomeAccuracy:
      rows.filter((row) => row.correctOutcomeHit).length / testedMatches,

    actualHomeWinShare: share(rows, (row) => row.actualOutcome === 'teamA'),
    actualDrawShare: share(rows, (row) => row.actualOutcome === 'draw'),
    actualAwayWinShare: share(rows, (row) => row.actualOutcome === 'teamB'),

    predictedHomeWinShare: share(
      rows,
      (row) => row.predictedOutcome === 'teamA'
    ),
    predictedDrawShare: share(rows, (row) => row.predictedOutcome === 'draw'),
    predictedAwayWinShare: share(
      rows,
      (row) => row.predictedOutcome === 'teamB'
    ),

    averageActualScoreProbability: average(actualScoreProbabilities),

    averageActualOutcomeProbability: average(
      rows.map((row) => row.actualOutcomeProbability)
    ),

    averageExactScoreLogLoss: average(rows.map((row) => row.exactScoreLogLoss)),

    averageResultLogLoss: average(rows.map((row) => row.resultLogLoss)),

    averageBrierScore: average(rows.map((row) => row.brierScore)),

    bestExactScoreProbability: Math.max(...actualScoreProbabilities),
    worstExactScoreProbability: Math.min(...actualScoreProbabilities),
  };
}

export function runBacktest(
  matches: MatchResult[],
  settings: ModelSettings,
  options: BacktestOptions
): BacktestResult {
  const candidateMatches = matches
    .filter(isValidScoredMatch)
    .filter((match) => match.date >= options.testStartDate)
    .filter((match) => match.date <= options.testEndDate)
    .filter((match) => {
      if (options.includeFriendlies) return true;
      return !isFriendlyTournament(match.tournament);
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const rows: BacktestRow[] = [];
  let skippedMatches = 0;

  for (const match of candidateMatches) {
    if (rows.length >= options.maxMatches) {
      break;
    }

    const priorHomeMatches = countPriorMatches(
      matches,
      match.homeTeam,
      match.date,
      settings.startYear
    );

    const priorAwayMatches = countPriorMatches(
      matches,
      match.awayTeam,
      match.date,
      settings.startYear
    );

    if (
      priorHomeMatches < options.minPriorMatchesPerTeam ||
      priorAwayMatches < options.minPriorMatchesPerTeam
    ) {
      skippedMatches += 1;
      continue;
    }

    const context: PredictionContext = {
      neutral: match.neutral,
      teamAIsHome: true,
      tournament: match.tournament,
      predictionDate: match.date,
    };

    const backtestSettings: ModelSettings = {
      ...settings,
      maxGoals: Math.max(settings.maxGoals, 8),
    };

    const prediction = predictScoreDistribution(
      match.homeTeam,
      match.awayTeam,
      matches,
      backtestSettings,
      context
    );

    const topScore = prediction.topScores[0];

    const actualScorePrediction = findScorePrediction(
      prediction.distribution,
      match.homeScore,
      match.awayScore
    );

    const actualScoreProbability = actualScorePrediction?.probability ?? 0;

    const actualScoreRank = getActualScoreRank(
      prediction.distribution,
      match.homeScore,
      match.awayScore
    );

    const actualOutcome = getOutcome(match.homeScore, match.awayScore);
    const predictedOutcome = getPredictedOutcome(prediction);
    const actualOutcomeProbability = getOutcomeProbability(
      prediction,
      actualOutcome
    );

    const exactTop1Hit =
      topScore.homeGoals === match.homeScore &&
      topScore.awayGoals === match.awayScore;

    const exactTop5Hit = prediction.topScores.some(
      (score) =>
        score.homeGoals === match.homeScore &&
        score.awayGoals === match.awayScore
    );

    const correctOutcomeHit = actualOutcome === predictedOutcome;

    rows.push({
      id: `${match.date}-${match.homeTeam}-${match.awayTeam}`,
      date: match.date,
      tournament: match.tournament,

      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,

      actualHomeGoals: match.homeScore,
      actualAwayGoals: match.awayScore,

      predictedHomeGoals: topScore.homeGoals,
      predictedAwayGoals: topScore.awayGoals,
      predictedScoreProbability: topScore.probability,

      actualScoreProbability,
      actualScoreRank,

      actualOutcome,
      predictedOutcome,
      actualOutcomeProbability,

      exactTop1Hit,
      exactTop5Hit,
      correctOutcomeHit,

      resultLogLoss: safeLogLoss(actualOutcomeProbability),
      exactScoreLogLoss: safeLogLoss(actualScoreProbability),
      brierScore: computeBrierScore(prediction, actualOutcome),

      priorHomeMatches,
      priorAwayMatches,
    });
  }

  return {
    options,
    rows,
    summary: buildSummary(rows, candidateMatches.length, skippedMatches),
  };
}

export function runCalibrationSearch(
  matches: MatchResult[],
  baseSettings: ModelSettings,
  options: BacktestOptions
): CalibrationSearchResult {
  const rows: CalibrationSearchRow[] = [];

  for (const calibrationPreset of calibrationPresets) {
    for (const eloImpactPreset of eloImpactPresets) {
      for (const temperaturePreset of temperaturePresets) {
        const calibratedSettings: ModelSettings = {
          ...baseSettings,
          ...calibrationPreset.settingsPatch,
          externalEloImpact: eloImpactPreset.value,
          internalEloImpact: eloImpactPreset.value,
          scoreTemperature: temperaturePreset.value,
        };

        const result = runBacktest(matches, calibratedSettings, options);

        rows.push({
          id: `${calibrationPreset.id}_${eloImpactPreset.id}_${temperaturePreset.id}`,
          name: `${calibrationPreset.name} · ${eloImpactPreset.label} · ${temperaturePreset.label}`,
          description: `${calibrationPreset.description} ${eloImpactPreset.description} ${temperaturePreset.description}`,
          eloImpactLabel: eloImpactPreset.label,
          eloImpactValue: eloImpactPreset.value,
          temperatureLabel: temperaturePreset.label,
          temperatureValue: temperaturePreset.value,
          settings: calibratedSettings,
          summary: result.summary,
        });
      }
    }
  }

  const byLogLoss = [...rows].sort(
    (a, b) => a.summary.averageResultLogLoss - b.summary.averageResultLogLoss
  );

  const byBrier = [...rows].sort(
    (a, b) => a.summary.averageBrierScore - b.summary.averageBrierScore
  );

  const byOutcome = [...rows].sort(
    (a, b) => b.summary.outcomeAccuracy - a.summary.outcomeAccuracy
  );

  const byTop5 = [...rows].sort(
    (a, b) => b.summary.exactTop5Accuracy - a.summary.exactTop5Accuracy
  );

  return {
    rows,
    bestByLogLoss: byLogLoss[0],
    bestByBrier: byBrier[0],
    bestByOutcome: byOutcome[0],
    bestByTop5: byTop5[0],
  };
}
