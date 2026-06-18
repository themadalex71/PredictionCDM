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

  drawPredictionGap: number;
  absoluteDrawPredictionGap: number;

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

export type DrawTuningPreset = {
  id: string;
  label: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
};

export type DixonColesRhoPreset = {
  id: string;
  label: string;
  value: number;
  description: string;
};

export type ScoreModelPreset = {
  id: string;
  label: string;
  scoreModel: ModelSettings['scoreModel'];
  description: string;
  settingsPatch?: Partial<ModelSettings>;
};

export type CalibrationSearchRow = {
  id: string;
  name: string;
  description: string;
  eloImpactLabel: string;
  eloImpactValue: number;
  temperatureLabel: string;
  temperatureValue: number;
  dixonColesRhoLabel?: string;
  dixonColesRhoValue?: number;
  scoreModelLabel?: string;
  scoreModelId?: string;
  drawTuningLabel?: string;
  drawTuningId?: string;
  settings: ModelSettings;
  summary: BacktestSummary;

  /**
   * Scores de calibration sur 100, calculés uniquement à partir du backtest modèle.
   * Ils ne regardent pas les points MPP, pour éviter de calibrer le moteur statistique
   * sur seulement 24 matchs.
   */
  resultScore: number;
  exactScore: number;
  drawBalanceScore: number;
  globalScore: number;
};

export type CalibrationSearchResult = {
  rows: CalibrationSearchRow[];
  bestByLogLoss?: CalibrationSearchRow;
  bestByBrier?: CalibrationSearchRow;
  bestByOutcome?: CalibrationSearchRow;
  bestByTop5?: CalibrationSearchRow;
  bestByResultScore?: CalibrationSearchRow;
  bestByExactScore?: CalibrationSearchRow;
  bestByDrawBalance?: CalibrationSearchRow;
  bestByGlobalScore?: CalibrationSearchRow;
};

export type CalibrationQualityScores = {
  resultScore: number;
  exactScore: number;
  drawBalanceScore: number;
  globalScore: number;
};

export type ModelCalibrationCandidate = {
  id: string;
  name: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHigherIsBetter(
  value: number,
  weakReference: number,
  strongReference: number
): number {
  return clamp((value - weakReference) / (strongReference - weakReference), 0, 1);
}

function normalizeLowerIsBetter(
  value: number,
  strongReference: number,
  weakReference: number
): number {
  return clamp((weakReference - value) / (weakReference - strongReference), 0, 1);
}

export function buildCalibrationQualityScores(
  summary: BacktestSummary
): CalibrationQualityScores {
  const drawBalance = 1 - clamp(summary.absoluteDrawPredictionGap / 0.24, 0, 1);

  const resultScore =
    100 *
    (
      0.36 * normalizeHigherIsBetter(summary.outcomeAccuracy, 0.45, 0.60) +
      0.22 * normalizeLowerIsBetter(summary.averageResultLogLoss, 0.88, 1.12) +
      0.16 * normalizeLowerIsBetter(summary.averageBrierScore, 0.50, 0.68) +
      0.16 * normalizeHigherIsBetter(summary.averageActualOutcomeProbability, 0.36, 0.48) +
      0.10 * drawBalance
    );

  const exactScore =
    100 *
    (
      0.30 * normalizeHigherIsBetter(summary.exactTop1Accuracy, 0.04, 0.12) +
      0.28 * normalizeHigherIsBetter(summary.exactTop5Accuracy, 0.45, 0.60) +
      0.24 * normalizeHigherIsBetter(summary.averageActualScoreProbability, 0.06, 0.095) +
      0.18 * normalizeLowerIsBetter(summary.averageExactScoreLogLoss, 2.35, 2.95)
    );

  const drawBalanceScore = 100 * drawBalance;

  const globalScore =
    0.60 * resultScore +
    0.30 * exactScore +
    0.10 * drawBalanceScore;

  return {
    resultScore,
    exactScore,
    drawBalanceScore,
    globalScore,
  };
}

const stableModelBase: Partial<ModelSettings> = {
  scoreModel: 'hybrid_dc_bivariate',
  adaptiveDixonColes: true,
  bivariateSharedLambda: 0.08,
  bivariateBlendWeight: 0.25,
  useDixonColes: true,
  dixonColesRho: -0.08,
  dixonColesWeight: 1,
  externalEloImpact: 0.35,
  internalEloImpact: 0.35,
  scoreTemperature: 1,
  smartDrawBoost: false,
  drawMultiplier: 1,
  lowScoreDrawBoost: 0,
  drawBoostCloseMatch: 0,
  drawBoostLowTotal: 0,
  drawBoostMax: 1,
  smartDrawMaxBoost: 1,
  advancedCompetitionWeights: false,
  opponentEloAdjustmentWeight: 0,
  dataConfidenceWeight: 1,
  scoreCalibration: 'none',
  favoriteControlWeight: 0,
};

const smartDrawLight: Partial<ModelSettings> = {
  smartDrawBoost: true,
  drawMultiplier: 1.05,
  lowScoreDrawBoost: 0.04,
  drawBoostCloseMatch: 0.035,
  drawBoostLowTotal: 0.025,
  drawBoostMax: 1.16,
  smartDrawMaxBoost: 1.16,
  smartDrawFavoritePenalty: 0.85,
};

const smartDrawMedium: Partial<ModelSettings> = {
  smartDrawBoost: true,
  drawMultiplier: 1.08,
  lowScoreDrawBoost: 0.07,
  drawBoostCloseMatch: 0.055,
  drawBoostLowTotal: 0.04,
  drawBoostMax: 1.25,
  smartDrawMaxBoost: 1.25,
  smartDrawFavoritePenalty: 0.8,
};

const legacyDrawMedium: Partial<ModelSettings> = {
  smartDrawBoost: false,
  drawMultiplier: 1.12,
  lowScoreDrawBoost: 0.1,
  drawBoostCloseMatch: 0.06,
  drawBoostLowTotal: 0.04,
  drawBoostMax: 1.75,
  smartDrawMaxBoost: 1.75,
};

const resultV1Light: Partial<ModelSettings> = {
  advancedCompetitionWeights: true,
  opponentEloAdjustmentWeight: 0.25,
  dataConfidenceWeight: 0.95,
  scoreCalibration: 'conservative',
  favoriteControlWeight: 0.08,
};

const resultV1Balanced: Partial<ModelSettings> = {
  advancedCompetitionWeights: true,
  opponentEloAdjustmentWeight: 0.45,
  dataConfidenceWeight: 1.15,
  scoreCalibration: 'classic_top1',
  favoriteControlWeight: 0.15,
};

const resultV1Strong: Partial<ModelSettings> = {
  advancedCompetitionWeights: true,
  opponentEloAdjustmentWeight: 0.65,
  dataConfidenceWeight: 1.4,
  scoreCalibration: 'worldcup_prudent',
  favoriteControlWeight: 0.25,
};

/**
 * Candidats réellement testés par le bouton de calibration du backtest modèle.
 * On privilégie une grille ciblée de coefficients plutôt qu'un énorme produit cartésien,
 * pour que le test reste utilisable dans StackBlitz avec une grosse base historique.
 */
export const modelCalibrationCandidates: ModelCalibrationCandidate[] = [
  {
    id: 'stable_original',
    name: 'Stable témoin',
    description: 'Socle propre : pas de boost nul, pas de pondération avancée, Elo léger, température neutre.',
    settingsPatch: stableModelBase,
  },
  {
    id: 'stable_temp_110',
    name: 'Stable · Temp 1.10',
    description: 'Même socle, mais distribution de scores plus plate.',
    settingsPatch: { ...stableModelBase, scoreTemperature: 1.1 },
  },
  {
    id: 'stable_dc_m04',
    name: 'Stable · DC rho -0.04',
    description: 'Correction Dixon-Coles plus douce.',
    settingsPatch: { ...stableModelBase, dixonColesRho: -0.04 },
  },
  {
    id: 'stable_dc_m12',
    name: 'Stable · DC rho -0.12',
    description: 'Correction Dixon-Coles plus forte.',
    settingsPatch: { ...stableModelBase, dixonColesRho: -0.12 },
  },
  {
    id: 'stable_elo_50',
    name: 'Stable · Elo 50 %',
    description: 'Elo un peu plus présent sans changer le reste.',
    settingsPatch: { ...stableModelBase, externalEloImpact: 0.5, internalEloImpact: 0.5 },
  },
  {
    id: 'stable_elo_65',
    name: 'Stable · Elo 65 %',
    description: 'Elo plus présent, utile à tester pour les matchs intercontinentaux.',
    settingsPatch: { ...stableModelBase, externalEloImpact: 0.65, internalEloImpact: 0.65 },
  },
  {
    id: 'smart_light',
    name: 'Smart Draw léger',
    description: 'Petit boost des nuls uniquement si le match paraît serré/fermé.',
    settingsPatch: { ...stableModelBase, ...smartDrawLight },
  },
  {
    id: 'smart_light_temp_105',
    name: 'Smart Draw léger · Temp 1.05',
    description: 'Smart Draw léger avec légère distribution plus plate.',
    settingsPatch: { ...stableModelBase, ...smartDrawLight, scoreTemperature: 1.05 },
  },
  {
    id: 'smart_light_temp_110',
    name: 'Smart Draw léger · Temp 1.10',
    description: 'Smart Draw léger avec distribution plus plate.',
    settingsPatch: { ...stableModelBase, ...smartDrawLight, scoreTemperature: 1.1 },
  },
  {
    id: 'smart_medium',
    name: 'Smart Draw moyen',
    description: 'Correction plus marquée des vrais profils de nuls.',
    settingsPatch: { ...stableModelBase, ...smartDrawMedium },
  },
  {
    id: 'legacy_draw_medium_temp110',
    name: 'Nuls moyen classique · Temp 1.10',
    description: 'Ancien preset MPP performant, conservé comme témoin dans le backtest modèle.',
    settingsPatch: { ...stableModelBase, ...legacyDrawMedium, scoreTemperature: 1.1 },
  },
  {
    id: 'result_light',
    name: 'Résultat v1 léger',
    description: 'Pondération compétition/adversaire douce, pour limiter le sur-réglage.',
    settingsPatch: { ...stableModelBase, ...resultV1Light },
  },
  {
    id: 'result_light_temp105',
    name: 'Résultat v1 léger · Temp 1.05',
    description: 'Version légère avec un peu plus de dispersion des scores.',
    settingsPatch: { ...stableModelBase, ...resultV1Light, scoreTemperature: 1.05 },
  },
  {
    id: 'result_balanced',
    name: 'Résultat v1 équilibré',
    description: 'Pondération avancée moyenne, proche du modèle v1.',
    settingsPatch: { ...stableModelBase, ...resultV1Balanced },
  },
  {
    id: 'result_balanced_temp110',
    name: 'Résultat v1 équilibré · Temp 1.10',
    description: 'Version v1 équilibrée avec distribution plus plate.',
    settingsPatch: { ...stableModelBase, ...resultV1Balanced, scoreTemperature: 1.1 },
  },
  {
    id: 'result_strong',
    name: 'Résultat v1 fort',
    description: 'Pondération adversaire/données/favoris plus forte, à vérifier contre le sur-réglage.',
    settingsPatch: { ...stableModelBase, ...resultV1Strong },
  },
  {
    id: 'result_light_smart',
    name: 'Résultat léger + Smart Draw',
    description: 'Version résultat légère avec correction intelligente des nuls.',
    settingsPatch: { ...stableModelBase, ...resultV1Light, ...smartDrawLight },
  },
  {
    id: 'result_balanced_smart',
    name: 'Résultat équilibré + Smart Draw',
    description: 'Version v1 équilibrée avec Smart Draw moyen.',
    settingsPatch: { ...stableModelBase, ...resultV1Balanced, ...smartDrawMedium },
  },
  {
    id: 'dc_pure_stable',
    name: 'Dixon-Coles pur stable',
    description: 'Dixon-Coles sans composante bivariée.',
    settingsPatch: { ...stableModelBase, scoreModel: 'dixon_coles', bivariateBlendWeight: 0 },
  },
  {
    id: 'poisson_stable',
    name: 'Poisson indépendant stable',
    description: 'Poisson simple amélioré, utile comme point de comparaison.',
    settingsPatch: { ...stableModelBase, scoreModel: 'independent_poisson', useDixonColes: false, dixonColesWeight: 0, bivariateBlendWeight: 0 },
  },
  {
    id: 'bivariate_stable',
    name: 'Bivariate stable',
    description: 'Bivariate Poisson pur avec lambda commun modéré.',
    settingsPatch: { ...stableModelBase, scoreModel: 'bivariate_poisson', bivariateSharedLambda: 0.08, bivariateBlendWeight: 1 },
  },
  {
    id: 'hybrid_biv_light',
    name: 'Hybride · bivarié léger',
    description: 'Hybride avec composante bivariée réduite.',
    settingsPatch: { ...stableModelBase, bivariateSharedLambda: 0.05, bivariateBlendWeight: 0.15 },
  },
  {
    id: 'hybrid_biv_strong',
    name: 'Hybride · bivarié fort',
    description: 'Hybride avec composante bivariée plus forte.',
    settingsPatch: { ...stableModelBase, bivariateSharedLambda: 0.12, bivariateBlendWeight: 0.35 },
  },
  {
    id: 'top1_classic_no_adv',
    name: 'Scores classiques sans avancé',
    description: 'Calibration score par score seule, sans autres coefficients avancés.',
    settingsPatch: { ...stableModelBase, scoreCalibration: 'classic_top1' },
  },
  {
    id: 'top1_conservative_no_adv',
    name: 'Scores conservateurs sans avancé',
    description: 'Calibration score par score conservatrice uniquement.',
    settingsPatch: { ...stableModelBase, scoreCalibration: 'conservative' },
  },
];

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
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.2,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.18,
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
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.25,
      scoreCalibration: 'conservative',
      favoriteControlWeight: 0.16,
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
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.55,
      dataConfidenceWeight: 1.35,
      scoreCalibration: 'worldcup_prudent',
      favoriteControlWeight: 0.24,
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

export const drawTuningPresets: DrawTuningPreset[] = [
  {
    id: 'draw_neutral',
    label: 'Nuls neutres',
    description: 'Aucun boost supplémentaire : sert de témoin.',
    settingsPatch: {
      smartDrawBoost: false,
      drawMultiplier: 1,
      lowScoreDrawBoost: 0,
      drawBoostCloseMatch: 0,
      drawBoostLowTotal: 0,
      drawBoostMax: 1.05,
      smartDrawMaxBoost: 1.05,
    },
  },
  {
    id: 'smart_draw_light',
    label: 'Smart Draw léger',
    description: 'Boost intelligent doux : nuls seulement si le match est serré/fermé.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'smart_draw_medium',
    label: 'Smart Draw moyen',
    description: 'Réglage recommandé : corrige les nuls sans forcer ceux avec favori clair.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
  {
    id: 'smart_draw_mpp',
    label: 'Smart Draw MPP',
    description: 'Version orientée MPP : un peu plus agressive mais pénalisée si favori clair.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.1,
      lowScoreDrawBoost: 0.09,
      drawBoostCloseMatch: 0.065,
      drawBoostLowTotal: 0.045,
      drawBoostMax: 1.32,
      smartDrawMaxBoost: 1.32,
      smartDrawFavoritePenalty: 0.72,
    },
  },
  {
    id: 'draw_medium_legacy',
    label: 'Nuls moyen classique',
    description: 'Ancienne correction globale des nuls, conservée pour comparaison.',
    settingsPatch: {
      smartDrawBoost: false,
      drawMultiplier: 1.12,
      lowScoreDrawBoost: 0.1,
      drawBoostCloseMatch: 0.06,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.75,
      smartDrawMaxBoost: 1.75,
    },
  },
];

/**
 * Rho Dixon-Coles : le paramètre qui corrige les faibles scores.
 * On teste volontairement peu de valeurs pour ne pas exploser le temps de calcul.
 */

export const scoreModelPresets: ScoreModelPreset[] = [
  {
    id: 'dc',
    label: 'Dixon-Coles',
    scoreModel: 'dixon_coles',
    description: 'Poisson indépendant avec vrai correctif Dixon-Coles sur les faibles scores.',
  },
  {
    id: 'hybrid',
    label: 'Hybride DC+Biv',
    scoreModel: 'hybrid_dc_bivariate',
    description: 'Mélange Dixon-Coles et Bivariate Poisson, recommandé pour les scores exacts.',
    settingsPatch: {
      adaptiveDixonColes: true,
      bivariateSharedLambda: 0.08,
      bivariateBlendWeight: 0.25,
    },
  },
  {
    id: 'bivariate',
    label: 'Bivariate',
    scoreModel: 'bivariate_poisson',
    description: 'Bivariate Poisson pur, utile comme test de corrélation entre les buts.',
    settingsPatch: {
      bivariateSharedLambda: 0.08,
      bivariateBlendWeight: 1,
    },
  },
];

export const dixonColesRhoPresets: DixonColesRhoPreset[] = [
  {
    id: 'dc_off',
    label: 'DC off',
    value: 999,
    description: 'Dixon-Coles désactivé, utile comme témoin Poisson. ',
  },
  {
    id: 'rho_m12',
    label: 'rho -0.12',
    value: -0.12,
    description: 'Correction forte des 0-0 / 1-1. ',
  },
  {
    id: 'rho_m08',
    label: 'rho -0.08',
    value: -0.08,
    description: 'Correction Dixon-Coles moyenne, bon point de départ. ',
  },
  {
    id: 'rho_m04',
    label: 'rho -0.04',
    value: -0.04,
    description: 'Correction légère des faibles scores. ',
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
      drawPredictionGap: 0,
      absoluteDrawPredictionGap: 0,
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

    drawPredictionGap:
      share(rows, (row) => row.predictedOutcome === 'draw') -
      share(rows, (row) => row.actualOutcome === 'draw'),

    absoluteDrawPredictionGap: Math.abs(
      share(rows, (row) => row.predictedOutcome === 'draw') -
        share(rows, (row) => row.actualOutcome === 'draw')
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

export function createCalibrationSearchRow(
  candidate: ModelCalibrationCandidate,
  settings: ModelSettings,
  summary: BacktestSummary
): CalibrationSearchRow {
  const qualityScores = buildCalibrationQualityScores(summary);
  const eloImpact = settings.externalEloImpact ?? 0;
  const temperature = settings.scoreTemperature ?? 1;

  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    eloImpactLabel: `Elo ${Math.round(eloImpact * 100)} %`,
    eloImpactValue: eloImpact,
    temperatureLabel: `Temp ${temperature.toFixed(2)}`,
    temperatureValue: temperature,
    dixonColesRhoLabel:
      settings.useDixonColes === false
        ? 'DC off'
        : `rho ${(settings.dixonColesRho ?? -0.08).toFixed(2)}`,
    dixonColesRhoValue:
      settings.useDixonColes === false ? undefined : settings.dixonColesRho,
    scoreModelLabel: settings.scoreModel ?? 'hybrid_dc_bivariate',
    scoreModelId: settings.scoreModel,
    drawTuningLabel:
      settings.smartDrawBoost
        ? 'Smart Draw'
        : (settings.drawMultiplier ?? 1) > 1
          ? 'Boost nul classique'
          : 'Nuls neutres',
    drawTuningId: candidate.id,
    settings,
    summary,
    ...qualityScores,
  };
}

export function buildCalibrationSearchResult(
  rows: CalibrationSearchRow[]
): CalibrationSearchResult {
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

  const byResultScore = [...rows].sort((a, b) => b.resultScore - a.resultScore);
  const byExactScore = [...rows].sort((a, b) => b.exactScore - a.exactScore);
  const byDrawBalance = [...rows].sort(
    (a, b) => b.drawBalanceScore - a.drawBalanceScore
  );
  const byGlobalScore = [...rows].sort((a, b) => b.globalScore - a.globalScore);

  return {
    rows,
    bestByLogLoss: byLogLoss[0],
    bestByBrier: byBrier[0],
    bestByOutcome: byOutcome[0],
    bestByTop5: byTop5[0],
    bestByResultScore: byResultScore[0],
    bestByExactScore: byExactScore[0],
    bestByDrawBalance: byDrawBalance[0],
    bestByGlobalScore: byGlobalScore[0],
  };
}

export function runCalibrationSearch(
  matches: MatchResult[],
  baseSettings: ModelSettings,
  options: BacktestOptions
): CalibrationSearchResult {
  const rows: CalibrationSearchRow[] = [];

  for (const candidate of modelCalibrationCandidates) {
    const calibratedSettings: ModelSettings = {
      ...baseSettings,
      ...candidate.settingsPatch,
    };

    const result = runBacktest(matches, calibratedSettings, options);
    rows.push(createCalibrationSearchRow(candidate, calibratedSettings, result.summary));
  }

  return buildCalibrationSearchResult(rows);
}
