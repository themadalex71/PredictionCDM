import type { MatchResult } from './football';

export type GroupStageEdition = {
  id: string;
  competition: string;
  edition: number;
  tournamentAliases: string[];
  startDate: string;
  endDate: string;
  stageCategory?: 'final_tournament' | 'qualification';
  reconstructionMode?: 'fixed_group_stage' | 'inferred_qualification';
  groupCount: number;
  teamsPerGroup: number;
  /**
   * Cas particuliers où un groupe n'a pas la taille standard.
   * Exemple : CAN 2010, groupe B à 3 équipes après le retrait du Togo.
   * Si absent, tous les groupes utilisent teamsPerGroup.
   */
  groupTeamCounts?: number[];
  qualifiedPerGroup: number;
  bestThirdCount: number;
  /** Nombre d'allers-retours : 1 en tournoi final, 2 en qualifications aller-retour. */
  roundRobinLegs?: number;
  /** Utilisé pour les qualifications reconstruites automatiquement. */
  minGroupSize?: number;
  maxGroupSize?: number;
  notes?: string;
};

export type GroupStandingRow = {
  team: string;
  played: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  rank: number;
  maxPoints: number;
};

export type GroupMatchContext = {
  editionId: string;
  competition: string;
  edition: number;
  stageCategory?: 'final_tournament' | 'qualification';
  group: string;
  matchday: number;
  isFinalGroupMatchday: boolean;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeBefore: GroupStandingRow;
  awayBefore: GroupStandingRow;
  groupTableBefore: GroupStandingRow[];
  homeIncentive: TeamIncentiveContext;
  awayIncentive: TeamIncentiveContext;
  matchProfile: GroupMatchProfile;
  sourceMatch: MatchResult;
};

export type TeamIncentiveContext = {
  team: string;
  pointsBefore: number;
  rankBefore: number;
  matchesPlayedBefore: number;
  matchesRemainingBefore: number;
  guaranteedTopGroupQualification: boolean;
  eliminatedFromTopGroupQualification: boolean;
  mustWinForTopGroupQualification: boolean;
  drawLikelyEnoughForTopGroupQualification: boolean;
  canStillWinGroup: boolean;
  likelyRotationRisk: 'low' | 'medium' | 'high';
  urgency: 'none' | 'low' | 'medium' | 'high' | 'must_win';
  notes: string[];
};

export type GroupMatchProfile = {
  bothAlreadySafe: boolean;
  oneAlreadySafeOneMustWin: boolean;
  bothNeedResult: boolean;
  drawCouldSuitBoth: boolean;
  deadRubberRisk: boolean;
  upsetRiskBoost: number;
  drawIncentiveBoost: number;
  openGameBoost: number;
  favoriteMotivationPenalty: number;
};


export type GroupStakeProfileKey =
  | 'baseline_non_final'
  | 'standard_final_day'
  | 'one_team_must_win'
  | 'both_need_result'
  | 'draw_suits_both'
  | 'safe_vs_must_win'
  | 'rotation_risk'
  | 'dead_rubber';

export type GroupStakeCoefficientRow = {
  profileKey: GroupStakeProfileKey;
  label: string;
  description: string;
  sampleSize: number;
  favoriteSampleSize: number;
  drawRate: number;
  baselineDrawRate: number;
  goalsPerMatch: number;
  baselineGoalsPerMatch: number;
  over25Rate: number;
  baselineOver25Rate: number;
  favoriteWinRate: number | null;
  baselineFavoriteWinRate: number | null;
  upsetRate: number | null;
  baselineUpsetRate: number | null;
  drawCoefficient: number;
  openGameCoefficient: number;
  upsetCoefficient: number;
  favoriteMotivationPenalty: number;
  confidence: 'low' | 'medium' | 'high';
  recommendation: string;
};

export type GroupStakeCoefficientReport = {
  generatedAt: string;
  baseline: GroupStakeCoefficientRow;
  rows: GroupStakeCoefficientRow[];
};

export type GroupStageBuildWarning = {
  editionId: string;
  message: string;
};

export type GroupStageDatabase = {
  editions: GroupStageEdition[];
  contexts: GroupMatchContext[];
  warnings: GroupStageBuildWarning[];
  generatedAt: string;
};

export type GroupStakeResidualRow = {
  profileKey: GroupStakeProfileKey;
  label: string;
  description: string;
  sampleSize: number;
  favoriteSampleSize: number;
  confidence: 'low' | 'medium' | 'high';

  predictedHomeWinRate: number;
  actualHomeWinRate: number;
  homeWinResidual: number;

  predictedDrawRate: number;
  actualDrawRate: number;
  drawResidual: number;
  drawResidualVsBaseline: number;

  predictedAwayWinRate: number;
  actualAwayWinRate: number;
  awayWinResidual: number;

  predictedFavoriteWinRate: number | null;
  actualFavoriteWinRate: number | null;
  favoriteWinResidual: number | null;
  favoriteWinResidualVsBaseline: number | null;

  predictedOutsiderWinRate: number | null;
  actualOutsiderWinRate: number | null;
  outsiderWinResidual: number | null;
  outsiderWinResidualVsBaseline: number | null;

  predictedOutsiderPointRate: number | null;
  actualOutsiderPointRate: number | null;
  outsiderPointResidual: number | null;
  outsiderPointResidualVsBaseline: number | null;

  predictedGoalsPerMatch: number;
  actualGoalsPerMatch: number;
  goalsResidual: number;
  goalsResidualVsBaseline: number;

  predictedOver25Rate: number;
  actualOver25Rate: number;
  over25Residual: number;
  over25ResidualVsBaseline: number;

  favoritePenaltyCorrection: number;
  outsiderPointBoostCorrection: number;
  drawCorrection: number;
  goalsMultiplierCorrection: number;
  varianceBoostCorrection: number;
  recommendation: string;
};

export type GroupStakeResidualReport = {
  generatedAt: string;
  modelLabel: string;
  baseline: GroupStakeResidualRow;
  rows: GroupStakeResidualRow[];
};

export type FirstMatchEffectProfileKey =
  | 'all_j2'
  | 'winner_vs_loser'
  | 'both_won_j1'
  | 'both_lost_j1'
  | 'both_drew_j1'
  | 'favorite_won_j1'
  | 'favorite_drew_j1'
  | 'favorite_lost_j1'
  | 'outsider_won_favorite_not_won'
  | 'at_least_one_zero_point'
  | 'at_least_one_three_point';

export type FirstMatchEffectRow = {
  profileKey: FirstMatchEffectProfileKey;
  label: string;
  description: string;
  sampleSize: number;
  favoriteSampleSize: number;
  confidence: 'low' | 'medium' | 'high';

  predictedHomeWinRate: number;
  actualHomeWinRate: number;
  homeWinResidual: number;

  predictedDrawRate: number;
  actualDrawRate: number;
  drawResidual: number;
  drawResidualVsBaseline: number;

  predictedAwayWinRate: number;
  actualAwayWinRate: number;
  awayWinResidual: number;

  predictedFavoriteWinRate: number | null;
  actualFavoriteWinRate: number | null;
  favoriteWinResidual: number | null;
  favoriteWinResidualVsBaseline: number | null;

  predictedOutsiderWinRate: number | null;
  actualOutsiderWinRate: number | null;
  outsiderWinResidual: number | null;
  outsiderWinResidualVsBaseline: number | null;

  predictedOutsiderPointRate: number | null;
  actualOutsiderPointRate: number | null;
  outsiderPointResidual: number | null;
  outsiderPointResidualVsBaseline: number | null;

  predictedGoalsPerMatch: number;
  actualGoalsPerMatch: number;
  goalsResidual: number;
  goalsResidualVsBaseline: number;

  predictedOver25Rate: number;
  actualOver25Rate: number;
  over25Residual: number;
  over25ResidualVsBaseline: number;

  favoritePenaltyCorrection: number;
  outsiderPointBoostCorrection: number;
  drawCorrection: number;
  goalsMultiplierCorrection: number;
  varianceBoostCorrection: number;
  recommendation: string;
};

export type FirstMatchEffectReport = {
  generatedAt: string;
  modelLabel: string;
  baseline: FirstMatchEffectRow;
  rows: FirstMatchEffectRow[];
};

export type HistoricalContextBacktestScopeKey =
  | 'all_context_matches'
  | 'j2_context_matches'
  | 'j3_context_matches'
  | string;

export type HistoricalContextBacktestMetrics = {
  testedMatches: number;
  outcomeAccuracy: number;
  exactTop1Accuracy: number;
  exactTop5Accuracy: number;
  averageActualOutcomeProbability: number;
  averageActualScoreProbability: number;
  averageResultLogLoss: number;
  averageBrierScore: number;
  predictedDrawShare: number;
  actualDrawShare: number;
  drawPredictionGap: number;
  predictedGoalsPerMatch: number;
  actualGoalsPerMatch: number;
  averageGoalsError: number;
};

export type HistoricalContextBacktestRow = {
  scopeKey: HistoricalContextBacktestScopeKey;
  label: string;
  description: string;
  sampleSize: number;
  contextTypes: string[];
  baseline: HistoricalContextBacktestMetrics;
  contextual: HistoricalContextBacktestMetrics;
  deltaOutcomeAccuracy: number;
  deltaTop1Accuracy: number;
  deltaTop5Accuracy: number;
  deltaActualOutcomeProbability: number;
  deltaActualScoreProbability: number;
  deltaResultLogLoss: number;
  deltaBrierScore: number;
  deltaDrawGapAbs: number;
  deltaGoalsErrorAbs: number;
  verdict: 'improved' | 'mixed' | 'worse' | 'neutral';
  recommendation: string;
};

export type HistoricalContextBacktestReport = {
  generatedAt: string;
  modelLabel: string;
  settingsWeight: number;
  rows: HistoricalContextBacktestRow[];
  bestRow?: HistoricalContextBacktestRow;
  globalRow?: HistoricalContextBacktestRow;
};
