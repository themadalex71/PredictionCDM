export type MatchResult = {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  tournament: string;
  city?: string;
  country?: string;
  neutral: boolean;
};

export type TeamStats = {
  team: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  recentFormScore: number;
  attackStrength: number;
  defenseStrength: number;
};

export type ModelSettings = {
  startYear: number;
  recentMatchCount: number;
  recentFormWeight: number;
  officialMatchWeight: number;
  homeAdvantage: number;
  maxGoals: number;

  favoriteShrinkBase?: number;
  favoriteShrinkClose?: number;
  favoriteShrinkMedium?: number;

  drawBoostBase?: number;
  drawBoostCloseMatch?: number;
  drawBoostLowTotal?: number;
  drawBoostMax?: number;

  externalEloImpact?: number;
  internalEloImpact?: number;

  /**
   * Température de distribution.
   *
   * 1 = distribution normale.
   * < 1 = distribution plus concentrée sur les scores favoris.
   * > 1 = distribution plus plate, donc plus prudente.
   */
  scoreTemperature?: number;
};

export type PredictionContext = {
  neutral: boolean;
  teamAIsHome: boolean;
  tournament?: string;
  predictionDate?: string;
};

export type ScorePrediction = {
  homeGoals: number;
  awayGoals: number;
  probability: number;
};

export type OutcomeProbabilities = {
  teamAWin: number;
  draw: number;
  teamBWin: number;
  over15: number;
  over25: number;
  teamACleanSheet: number;
  teamBCleanSheet: number;
};

export type MatchPrediction = {
  teamA: string;
  teamB: string;
  expectedGoalsA: number;
  expectedGoalsB: number;
  distribution: ScorePrediction[];
  topScores: ScorePrediction[];
  outcomes: OutcomeProbabilities;
};
