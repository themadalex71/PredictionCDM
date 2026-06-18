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

  /**
   * Multiplicateur global appliqué aux scores nuls après Dixon-Coles.
   * 1 = aucun effet. 1.10 = +10 % sur tous les nuls avant renormalisation.
   */
  drawMultiplier?: number;

  /**
   * Bonus additionnel ciblé sur les nuls de faible score : 0-0 et 1-1,
   * puis plus légèrement 2-2. Permet de corriger un modèle qui sous-prédit les nuls.
   */
  lowScoreDrawBoost?: number;

  /**
   * Active un boost intelligent des nuls. Contrairement au boost global,
   * il augmente surtout 0-0 / 1-1 / 2-2 lorsque le match est serré, fermé
   * et sans favori Elo/xG trop clair.
   */
  smartDrawBoost?: boolean;

  /**
   * Intensité de pénalité lorsqu'un favori clair existe.
   * Plus la valeur est haute, moins les nuls sont boostés dans les matchs déséquilibrés.
   */
  smartDrawFavoritePenalty?: number;

  /**
   * Plafond spécifique du Smart Draw Boost.
   */
  smartDrawMaxBoost?: number;

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

  /**
   * Active la correction Dixon-Coles réelle sur les faibles scores.
   * Cette correction modifie surtout 0-0, 1-0, 0-1 et 1-1.
   */
  useDixonColes?: boolean;

  /**
   * Paramètre rho Dixon-Coles.
   * Valeurs typiques : -0.18 à 0.05.
   * En pratique, un rho négatif augmente les 0-0 / 1-1 et réduit les 1-0 / 0-1.
   */
  dixonColesRho?: number;

  /**
   * Intensité de la correction Dixon-Coles.
   * 0 = désactivé, 1 = correction complète.
   */
  dixonColesWeight?: number;

  /**
   * Type de distribution utilisée pour transformer les buts attendus en scores exacts.
   * - dixon_coles : Poisson indépendant + correction faibles scores.
   * - bivariate_poisson : ajoute une corrélation entre les buts des deux équipes.
   * - hybrid_dc_bivariate : mélange Dixon-Coles et Bivariate Poisson.
   */
  scoreModel?: 'independent_poisson' | 'dixon_coles' | 'bivariate_poisson' | 'hybrid_dc_bivariate';

  /**
   * Active l'adaptation automatique de rho selon le profil du match.
   * Les matchs serrés et à faible total de buts reçoivent une correction plus forte.
   */
  adaptiveDixonColes?: boolean;

  /**
   * Force de la composante commune du Bivariate Poisson.
   * 0 = aucune corrélation, 0.05-0.18 = zone généralement utile au football.
   */
  bivariateSharedLambda?: number;

  /**
   * Poids du Bivariate Poisson dans le modèle hybride.
   */
  bivariateBlendWeight?: number;

  /**
   * Active des poids de compétition plus stricts : les Coupes du Monde,
   * qualifications et compétitions continentales comptent davantage ; les
   * petits tournois amicaux / séries comptent moins.
   */
  advancedCompetitionWeights?: boolean;

  /**
   * Ajuste les buts marqués/encaissés selon le niveau Elo de l'adversaire.
   * 0 = désactivé, 1 = effet complet.
   */
  opponentEloAdjustmentWeight?: number;

  /**
   * Contrôle à quel point on fait confiance aux statistiques d'une équipe.
   * Plus la valeur est haute, plus les équipes avec peu de données sont
   * ramenées vers un profil moyen/Elo.
   */
  dataConfidenceWeight?: number;

  /**
   * Calibration empirique score par score pour mieux classer les scores
   * classiques en Top 1.
   */
  scoreCalibration?: 'none' | 'conservative' | 'classic_top1' | 'worldcup_prudent';

  /**
   * Réduit les scénarios outsider quand un favori statistique/Elo est net.
   * 0 = désactivé.
   */
  favoriteControlWeight?: number;

  /**
   * Nom du preset appliqué depuis le backtest modèle. Sert uniquement à l'interface
   * pour vérifier clairement quel réglage est actif.
   */
  activePresetName?: string;

  /**
   * Date ISO de la dernière application d'un preset.
   */
  activePresetAppliedAt?: string;

  /**
   * Origine du preset actif : calibration simple, robuste ou réglage manuel.
   */
  activePresetSource?: 'manual' | 'calibration' | 'robust_calibration';
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
