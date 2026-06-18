import type { OutcomeProbabilities } from './football';

export type MppOutcome = 'teamA' | 'draw' | 'teamB';

export type MppOdds = {
  teamAWin: number;
  draw: number;
  teamBWin: number;
};

export type MppExactBonusRules = {
  veryCommonThreshold: number;
  rareThreshold: number;
  veryRareThreshold: number;
  megaRareThreshold: number;

  veryCommonBonus: number;
  rareBonus: number;
  veryRareBonus: number;
  megaRareBonus: number;
  ultraRareBonus: number;
};

export type MppScoringRules = {
  exactBonusRules: MppExactBonusRules;

  /**
   * Poids donné au fait qu’une issue semble sous-estimée par les points MPP.
   * Ce n’est pas un facteur de classement : ça sert juste à départager
   * deux scores proches.
   */
  valueWeight: number;

  /**
   * Pénalité appliquée aux issues trop peu probables.
   */
  riskPenaltyWeight: number;
};

export type MppOutcomeAdvice = {
  outcome: MppOutcome;
  label: string;

  modelProbability: number;

  /**
   * Dans MPP, la cote correspond aux points gagnés si l’issue est correcte.
   */
  mppPoints: number | null;

  impliedProbability: number | null;
  normalizedMarketProbability: number | null;

  edge: number | null;
  edgeLabel: string;

  bestScoreLabel: string;
  bestScoreProbability: number;
};

export type MppScoreAdvice = {
  homeGoals: number;
  awayGoals: number;
  scoreLabel: string;

  outcome: MppOutcome;
  outcomeLabel: string;

  exactProbability: number;
  outcomeProbability: number;
  correctOutcomeOnlyProbability: number;

  estimatedPopularityAmongCorrect: number;
  exactBonusPoints: number;

  outcomePoints: number;
  exactScoreTotalPoints: number;

  /**
   * Espérance totale :
   * P(résultat) × points résultat + P(score exact) × bonus exact.
   */
  expectedPoints: number;

  baseExpectedPoints: number;
  exactBonusExpectedPoints: number;
  maxPoints: number;

  marketProbability: number | null;
  edge: number | null;

  riskLevel: number;
  riskLabel: string;

  safetyScore: number;
  valueScore: number;
  upsideScore: number;
  recommendedScore: number;

  readingLabel: string;
  reason: string;
};

export type MppAnalysis = {
  analysisLabel: string;
  analysisExplanation: string;

  outcomeAdvices: MppOutcomeAdvice[];
  scoreAdvices: MppScoreAdvice[];

  safestPick: MppScoreAdvice;
  bestExpectedPick: MppScoreAdvice;
  upsidePick: MppScoreAdvice;
  recommendedPick: MppScoreAdvice;

  predictionOutcomes: OutcomeProbabilities;
};

export const defaultMppExactBonusRules: MppExactBonusRules = {
  veryCommonThreshold: 0.3,
  rareThreshold: 0.2,
  veryRareThreshold: 0.05,
  megaRareThreshold: 0.005,

  veryCommonBonus: 20,
  rareBonus: 30,
  veryRareBonus: 50,
  megaRareBonus: 70,
  ultraRareBonus: 100,
};

export const defaultMppScoringRules: MppScoringRules = {
  exactBonusRules: defaultMppExactBonusRules,
  valueWeight: 1.4,
  riskPenaltyWeight: 1.25,
};
