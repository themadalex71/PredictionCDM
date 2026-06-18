import type { MatchPrediction, ScorePrediction } from '../types/football';
import type {
  MppAnalysis,
  MppExactBonusRules,
  MppOdds,
  MppOutcome,
  MppOutcomeAdvice,
  MppScoreAdvice,
  MppScoringRules,
} from '../types/mpp';
import { defaultMppScoringRules } from '../types/mpp';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isValidMppPoints(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function getScoreOutcome(
  homeGoals: number,
  awayGoals: number
): MppOutcome {
  if (homeGoals > awayGoals) return 'teamA';
  if (homeGoals < awayGoals) return 'teamB';
  return 'draw';
}

function getOutcomeProbability(
  prediction: MatchPrediction,
  outcome: MppOutcome
): number {
  if (outcome === 'teamA') return prediction.outcomes.teamAWin;
  if (outcome === 'teamB') return prediction.outcomes.teamBWin;
  return prediction.outcomes.draw;
}

function getOutcomeLabel(
  prediction: MatchPrediction,
  outcome: MppOutcome
): string {
  if (outcome === 'teamA') return `Victoire ${prediction.teamA}`;
  if (outcome === 'teamB') return `Victoire ${prediction.teamB}`;
  return 'Match nul';
}

function getMppPoints(odds: MppOdds, outcome: MppOutcome): number | null {
  const points =
    outcome === 'teamA'
      ? odds.teamAWin
      : outcome === 'teamB'
      ? odds.teamBWin
      : odds.draw;

  return isValidMppPoints(points) ? points : null;
}

function getImpliedProbability(mppPoints: number | null): number | null {
  if (!mppPoints || !isValidMppPoints(mppPoints)) return null;

  return 1 / mppPoints;
}

function getNormalizedMarketProbabilities(
  odds: MppOdds
): Record<MppOutcome, number | null> {
  const implied = {
    teamA: getImpliedProbability(getMppPoints(odds, 'teamA')),
    draw: getImpliedProbability(getMppPoints(odds, 'draw')),
    teamB: getImpliedProbability(getMppPoints(odds, 'teamB')),
  };

  if (
    implied.teamA === null ||
    implied.draw === null ||
    implied.teamB === null
  ) {
    return {
      teamA: null,
      draw: null,
      teamB: null,
    };
  }

  const total = implied.teamA + implied.draw + implied.teamB;

  if (total <= 0) {
    return {
      teamA: null,
      draw: null,
      teamB: null,
    };
  }

  return {
    teamA: implied.teamA / total,
    draw: implied.draw / total,
    teamB: implied.teamB / total,
  };
}

function getEdgeLabel(edge: number | null): string {
  if (edge === null) return 'Cotes incomplètes';

  if (edge >= 0.1) return 'Très sous-estimé par MPP';
  if (edge >= 0.05) return 'Sous-estimé par MPP';
  if (edge >= 0.02) return 'Légèrement intéressant';

  if (edge <= -0.1) return 'Très surjoué / mal payé';
  if (edge <= -0.05) return 'Surjoué par MPP';
  if (edge <= -0.02) return 'Un peu mal payé';

  return 'Marché proche du modèle';
}

function getBestScoreForOutcome(
  distribution: ScorePrediction[],
  outcome: MppOutcome
): ScorePrediction {
  const scores = distribution
    .filter(
      (score) => getScoreOutcome(score.homeGoals, score.awayGoals) === outcome
    )
    .sort((a, b) => b.probability - a.probability);

  return (
    scores[0] ??
    distribution[0] ?? {
      homeGoals: 0,
      awayGoals: 0,
      probability: 0,
    }
  );
}

function getExactBonusFromPopularity(
  estimatedPopularityAmongCorrect: number,
  rules: MppExactBonusRules
): number {
  if (estimatedPopularityAmongCorrect > rules.veryCommonThreshold) {
    return rules.veryCommonBonus;
  }

  if (estimatedPopularityAmongCorrect > rules.rareThreshold) {
    return rules.rareBonus;
  }

  if (estimatedPopularityAmongCorrect > rules.veryRareThreshold) {
    return rules.veryRareBonus;
  }

  if (estimatedPopularityAmongCorrect > rules.megaRareThreshold) {
    return rules.megaRareBonus;
  }

  return rules.ultraRareBonus;
}

function estimateScorePopularityAmongCorrect(
  score: ScorePrediction,
  outcomeProbability: number,
  marketProbability: number | null
): number {
  if (outcomeProbability <= 0) {
    return 0.001;
  }

  const conditionalShare = score.probability / outcomeProbability;
  const scoreLabel = `${score.homeGoals}-${score.awayGoals}`;
  const totalGoals = score.homeGoals + score.awayGoals;

  let multiplier = 1;

  const veryPopularScores = ['1-0', '2-0', '2-1', '1-1', '0-0'];
  const popularScores = ['0-1', '1-2', '0-2', '3-0', '3-1', '2-2'];
  const lessPopularScores = ['3-2', '2-3', '4-0', '0-4', '4-1', '1-4'];

  if (veryPopularScores.includes(scoreLabel)) {
    multiplier *= 1.22;
  } else if (popularScores.includes(scoreLabel)) {
    multiplier *= 1.05;
  } else if (lessPopularScores.includes(scoreLabel)) {
    multiplier *= 0.78;
  }

  if (totalGoals >= 6) {
    multiplier *= 0.42;
  } else if (totalGoals >= 5) {
    multiplier *= 0.58;
  } else if (totalGoals >= 4) {
    multiplier *= 0.82;
  }

  if (marketProbability !== null && marketProbability > 0.55) {
    multiplier *= 1.1;
  }

  if (marketProbability !== null && marketProbability < 0.18) {
    multiplier *= 0.86;
  }

  return clamp(conditionalShare * multiplier, 0.001, 0.65);
}

function getRiskLabel(outcomeProbability: number): string {
  if (outcomeProbability >= 0.55) return 'Risque faible';
  if (outcomeProbability >= 0.38) return 'Risque modéré';
  if (outcomeProbability >= 0.22) return 'Risque élevé';
  return 'Risque très élevé';
}

function getReadingLabel(score: {
  expectedPoints: number;
  outcomeProbability: number;
  exactProbability: number;
  exactBonusPoints: number;
  outcomePoints: number;
  edge: number | null;
}): string {
  const edge = score.edge ?? 0;

  if (score.expectedPoints >= 18 && score.outcomeProbability >= 0.35) {
    return 'Très bon rendement';
  }

  if (score.outcomeProbability >= 0.5 && score.outcomePoints <= 40) {
    return 'Sûr mais peu payé';
  }

  if (score.outcomeProbability >= 0.42 && score.expectedPoints >= 12) {
    return 'Solide et rentable';
  }

  if (score.exactProbability >= 0.07 && score.exactBonusPoints >= 50) {
    return 'Score exact intéressant';
  }

  if (edge >= 0.06 && score.outcomeProbability >= 0.2) {
    return 'Value risquée';
  }

  if (score.outcomeProbability < 0.16) {
    return 'Trop spéculatif';
  }

  if (score.exactProbability < 0.008) {
    return 'Très improbable';
  }

  return 'Option correcte';
}

function getScoreReason(score: {
  scoreLabel: string;
  expectedPoints: number;
  outcomeProbability: number;
  exactProbability: number;
  edge: number | null;
  exactBonusPoints: number;
  outcomePoints: number;
  exactScoreTotalPoints: number;
  estimatedPopularityAmongCorrect: number;
  outcomeLabel: string;
}): string {
  const edge = score.edge ?? 0;
  const outcomePercent = (score.outcomeProbability * 100).toFixed(1);
  const exactPercent = (score.exactProbability * 100).toFixed(1);
  const popularityPercent = (
    score.estimatedPopularityAmongCorrect * 100
  ).toFixed(1);

  if (score.expectedPoints >= 18 && score.outcomeProbability >= 0.35) {
    return `Bon profil : ${
      score.outcomeLabel
    } reste assez probable (${outcomePercent} %) et le rendement moyen est élevé (${score.expectedPoints.toFixed(
      2
    )} pts).`;
  }

  if (score.outcomeProbability >= 0.5 && score.outcomePoints <= 40) {
    return `Choix logique : l’issue est fiable (${outcomePercent} %), mais les points MPP sont limités (${score.outcomePoints.toFixed(
      0
    )} pts hors score exact).`;
  }

  if (edge >= 0.08 && score.outcomeProbability >= 0.2) {
    return `MPP semble sous-estimer cette issue : le modèle la voit à ${outcomePercent} %, avec un rendement correct malgré le risque.`;
  }

  if (score.exactBonusPoints >= 70 && score.exactProbability >= 0.025) {
    return `Score différenciant : seulement ${popularityPercent} % de popularité estimée, donc gros bonus possible, tout en gardant ${exactPercent} % de probabilité.`;
  }

  if (score.exactBonusPoints >= 50 && score.exactProbability >= 0.06) {
    return `Score exact intéressant : ${exactPercent} % de probabilité et bonus estimé à +${score.exactBonusPoints}, sans tomber dans le coup absurde.`;
  }

  if (score.outcomeProbability < 0.16) {
    return `Rendement potentiel élevé, mais l’issue n’a que ${outcomePercent} % de chances selon le modèle. Le risque est probablement trop fort.`;
  }

  if (score.exactProbability < 0.008) {
    return `Score très peu probable (${exactPercent} %). Même avec un gros bonus, l’espérance reste fragile.`;
  }

  if (edge <= -0.08) {
    return `Issue probablement trop mal payée par MPP par rapport au modèle. Elle reste jouable surtout si tu privilégies la probabilité du résultat.`;
  }

  return `Option correcte : risque et rendement sont à peu près cohérents, sans avantage énorme ni alerte majeure.`;
}

function buildOutcomeAdvices(
  prediction: MatchPrediction,
  odds: MppOdds
): MppOutcomeAdvice[] {
  const marketProbabilities = getNormalizedMarketProbabilities(odds);
  const outcomes: MppOutcome[] = ['teamA', 'draw', 'teamB'];

  return outcomes.map((outcome) => {
    const modelProbability = getOutcomeProbability(prediction, outcome);
    const mppPoints = getMppPoints(odds, outcome);
    const impliedProbability = getImpliedProbability(mppPoints);
    const normalizedMarketProbability = marketProbabilities[outcome];

    const edge =
      normalizedMarketProbability === null
        ? null
        : modelProbability - normalizedMarketProbability;

    const bestScore = getBestScoreForOutcome(prediction.distribution, outcome);

    return {
      outcome,
      label: getOutcomeLabel(prediction, outcome),

      modelProbability,
      mppPoints,
      impliedProbability,
      normalizedMarketProbability,

      edge,
      edgeLabel: getEdgeLabel(edge),

      bestScoreLabel: `${bestScore.homeGoals}-${bestScore.awayGoals}`,
      bestScoreProbability: bestScore.probability,
    };
  });
}

function getOutcomeAdvice(
  advices: MppOutcomeAdvice[],
  outcome: MppOutcome
): MppOutcomeAdvice {
  return advices.find((advice) => advice.outcome === outcome) ?? advices[0];
}

function buildScoreAdvices(
  prediction: MatchPrediction,
  odds: MppOdds,
  rules: MppScoringRules,
  outcomeAdvices: MppOutcomeAdvice[]
): MppScoreAdvice[] {
  const safeDistribution =
    prediction.distribution.length > 0
      ? prediction.distribution
      : [{ homeGoals: 0, awayGoals: 0, probability: 1 }];

  return safeDistribution.map((score) => {
    const outcome = getScoreOutcome(score.homeGoals, score.awayGoals);
    const outcomeProbability = getOutcomeProbability(prediction, outcome);
    const correctOutcomeOnlyProbability = Math.max(
      0,
      outcomeProbability - score.probability
    );

    const outcomeAdvice = getOutcomeAdvice(outcomeAdvices, outcome);
    const edge = outcomeAdvice?.edge ?? null;
    const positiveEdge = Math.max(0, edge ?? 0);
    const marketProbability =
      outcomeAdvice?.normalizedMarketProbability ?? null;

    const outcomePoints = outcomeAdvice?.mppPoints ?? 0;

    const estimatedPopularityAmongCorrect = estimateScorePopularityAmongCorrect(
      score,
      outcomeProbability,
      marketProbability
    );

    const exactBonusPoints = getExactBonusFromPopularity(
      estimatedPopularityAmongCorrect,
      rules.exactBonusRules
    );

    const exactScoreTotalPoints = outcomePoints + exactBonusPoints;

    const baseExpectedPoints = outcomeProbability * outcomePoints;
    const exactBonusExpectedPoints = score.probability * exactBonusPoints;

    const expectedPoints = baseExpectedPoints + exactBonusExpectedPoints;

    const maxPoints = exactScoreTotalPoints;
    const riskLevel = 1 - outcomeProbability;

    const riskPenalty =
      Math.pow(riskLevel, 1.45) * rules.riskPenaltyWeight * 3.4;

    const valueBonus =
      positiveEdge * Math.min(outcomePoints, 160) * rules.valueWeight * 0.035;

    const safetyScore =
      outcomeProbability * 100 + score.probability * 35 + expectedPoints * 0.18;

    const valueScore = expectedPoints;

    const upsideScore =
      exactBonusExpectedPoints * 1.4 +
      expectedPoints * 0.55 +
      (exactBonusPoints / 100) * 3 -
      Math.pow(riskLevel, 1.25) * 2.5;

    const recommendedScore =
      expectedPoints +
      valueBonus +
      score.probability * exactBonusPoints * 0.08 -
      riskPenalty;

    const readingLabel = getReadingLabel({
      expectedPoints,
      outcomeProbability,
      exactProbability: score.probability,
      exactBonusPoints,
      outcomePoints,
      edge,
    });

    const reason = getScoreReason({
      scoreLabel: `${score.homeGoals}-${score.awayGoals}`,
      expectedPoints,
      outcomeProbability,
      exactProbability: score.probability,
      edge,
      exactBonusPoints,
      outcomePoints,
      exactScoreTotalPoints,
      estimatedPopularityAmongCorrect,
      outcomeLabel: outcomeAdvice?.label ?? 'Issue inconnue',
    });

    return {
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      scoreLabel: `${score.homeGoals}-${score.awayGoals}`,

      outcome,
      outcomeLabel: outcomeAdvice?.label ?? 'Issue inconnue',

      exactProbability: score.probability,
      outcomeProbability,
      correctOutcomeOnlyProbability,

      estimatedPopularityAmongCorrect,
      exactBonusPoints,

      outcomePoints,
      exactScoreTotalPoints,

      expectedPoints,
      baseExpectedPoints,
      exactBonusExpectedPoints,
      maxPoints,

      marketProbability,
      edge,

      riskLevel,
      riskLabel: getRiskLabel(outcomeProbability),

      safetyScore,
      valueScore,
      upsideScore,
      recommendedScore,

      readingLabel,
      reason,
    };
  });
}

function getBestBy(
  scores: MppScoreAdvice[],
  selector: (score: MppScoreAdvice) => number
): MppScoreAdvice | undefined {
  if (scores.length === 0) return undefined;

  return [...scores].sort((a, b) => selector(b) - selector(a))[0];
}

function getDiversePick(
  scores: MppScoreAdvice[],
  selector: (score: MppScoreAdvice) => number,
  alreadyPicked: MppScoreAdvice[],
  minimumRatio = 0.7
): MppScoreAdvice | undefined {
  if (scores.length === 0) return undefined;

  const best = getBestBy(scores, selector);

  if (!best) {
    return undefined;
  }

  const bestScore = selector(best);

  const alreadyPickedLabels = new Set(
    alreadyPicked.map((score) => score.scoreLabel)
  );

  const availableScores = scores.filter((score) => {
    if (alreadyPickedLabels.has(score.scoreLabel)) return false;

    return selector(score) >= bestScore * minimumRatio;
  });

  return (
    getBestBy(
      availableScores.length > 0
        ? availableScores
        : scores.filter((score) => !alreadyPickedLabels.has(score.scoreLabel)),
      selector
    ) ?? getBestBy(scores, selector)
  );
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

function getMarketFavoriteOutcome(
  outcomeAdvices: MppOutcomeAdvice[]
): MppOutcome | undefined {
  const sorted = [...outcomeAdvices]
    .filter((advice) => advice.normalizedMarketProbability !== null)
    .sort(
      (a, b) =>
        (b.normalizedMarketProbability ?? 0) -
        (a.normalizedMarketProbability ?? 0)
    );

  return sorted[0]?.outcome;
}

function getMarketFavoritePoints(
  outcomeAdvices: MppOutcomeAdvice[]
): number | null {
  const favoriteOutcome = getMarketFavoriteOutcome(outcomeAdvices);

  if (!favoriteOutcome) {
    return null;
  }

  const favoriteAdvice = outcomeAdvices.find(
    (advice) => advice.outcome === favoriteOutcome
  );

  return favoriteAdvice?.mppPoints ?? null;
}

function getBestModelScoreForOutcome(
  scores: MppScoreAdvice[],
  outcome: MppOutcome
): MppScoreAdvice | undefined {
  return scores
    .filter((score) => score.outcome === outcome)
    .sort((a, b) => b.exactProbability - a.exactProbability)[0];
}

/**
 * Stratégie validée par le backtest actuel :
 * EV anti-outsider favori ≤ 90 pts.
 *
 * Elle part de la meilleure espérance, mais si elle choisit une victoire outsider
 * alors que MPP identifie un favori clair, elle revient au score le plus probable
 * de ce favori. Les nuls value restent autorisés.
 */
function getAntiUnderdogRecommendedPick(
  scores: MppScoreAdvice[],
  outcomeAdvices: MppOutcomeAdvice[],
  bestExpectedPick: MppScoreAdvice
): MppScoreAdvice {
  const favoriteMaxPoints = 90;

  const marketFavoriteOutcome = getMarketFavoriteOutcome(outcomeAdvices);
  const marketFavoritePoints = getMarketFavoritePoints(outcomeAdvices);

  if (!marketFavoriteOutcome || marketFavoritePoints === null) {
    return bestExpectedPick;
  }

  const marketFavoritePick =
    getBestModelScoreForOutcome(scores, marketFavoriteOutcome) ??
    bestExpectedPick;

  const bestPickIsMarketFavorite =
    bestExpectedPick.outcome === marketFavoriteOutcome;

  const bestPickIsDraw = bestExpectedPick.outcome === 'draw';

  const marketFavoriteIsClearlyIdentified =
    marketFavoritePoints <= favoriteMaxPoints;

  const bestPickIsNonDrawOutsider =
    !bestPickIsMarketFavorite && !bestPickIsDraw;

  if (marketFavoriteIsClearlyIdentified && bestPickIsNonDrawOutsider) {
    return {
      ...marketFavoritePick,
      readingLabel: 'Conseil anti-outsider',
      reason: `${marketFavoritePick.reason} Le choix brut à l’espérance partait sur une victoire outsider, mais le backtest montre qu’il vaut mieux revenir au favori MPP quand celui-ci est clairement identifié à 90 pts ou moins.`,
    };
  }

  return bestExpectedPick;
}

function createEmergencyPick(prediction: MatchPrediction): MppScoreAdvice {
  const fallbackScore = prediction.topScores[0] ??
    prediction.distribution[0] ?? {
      homeGoals: 0,
      awayGoals: 0,
      probability: 0,
    };

  const outcome = getScoreOutcome(
    fallbackScore.homeGoals,
    fallbackScore.awayGoals
  );
  const outcomeProbability = getOutcomeProbability(prediction, outcome);

  return {
    homeGoals: fallbackScore.homeGoals,
    awayGoals: fallbackScore.awayGoals,
    scoreLabel: `${fallbackScore.homeGoals}-${fallbackScore.awayGoals}`,

    outcome,
    outcomeLabel: getOutcomeLabel(prediction, outcome),

    exactProbability: fallbackScore.probability,
    outcomeProbability,
    correctOutcomeOnlyProbability: Math.max(
      0,
      outcomeProbability - fallbackScore.probability
    ),

    estimatedPopularityAmongCorrect: 0,
    exactBonusPoints: 20,

    outcomePoints: 0,
    exactScoreTotalPoints: 20,

    expectedPoints: 0,
    baseExpectedPoints: 0,
    exactBonusExpectedPoints: 0,
    maxPoints: 20,

    marketProbability: null,
    edge: null,

    riskLevel: 1 - outcomeProbability,
    riskLabel: getRiskLabel(outcomeProbability),

    safetyScore: 0,
    valueScore: 0,
    upsideScore: 0,
    recommendedScore: 0,

    readingLabel: 'Données insuffisantes',
    reason:
      'Le modèle n’a pas réussi à produire une sélection MPP complète pour ce match.',
  };
}

export function analyzeMppPrediction(
  prediction: MatchPrediction,
  odds: MppOdds,
  scoringRules: Partial<MppScoringRules> = {}
): MppAnalysis {
  const rules: MppScoringRules = {
    ...defaultMppScoringRules,
    ...scoringRules,
    exactBonusRules: {
      ...defaultMppScoringRules.exactBonusRules,
      ...scoringRules.exactBonusRules,
    },
  };

  const outcomeAdvices = buildOutcomeAdvices(prediction, odds);

  const scoreAdvices = buildScoreAdvices(
    prediction,
    odds,
    rules,
    outcomeAdvices
  );

  const realisticScores = scoreAdvices.filter(isReasonableScore);

  const searchSpace =
    realisticScores.length > 0
      ? realisticScores
      : scoreAdvices.length > 0
      ? scoreAdvices
      : [];

  const emergencyPick = createEmergencyPick(prediction);

  const safestPick =
    getBestBy(searchSpace, (score) => score.safetyScore) ?? emergencyPick;

  const bestExpectedPick =
    getBestBy(searchSpace, (score) => score.expectedPoints) ?? safestPick;

  const upsidePick =
    getDiversePick(
      searchSpace,
      (score) => score.upsideScore,
      [safestPick, bestExpectedPick],
      0.55
    ) ?? bestExpectedPick;

  const recommendedPick = getAntiUnderdogRecommendedPick(
    searchSpace,
    outcomeAdvices,
    bestExpectedPick
  );

  return {
    analysisLabel: 'Conseil final : EV anti-outsider favori ≤ 90 pts',
    analysisExplanation:
      'Le conseil final utilise la stratégie qui a le mieux performé au backtest actuel : il maximise l’espérance de points, mais évite les victoires outsiders trop attirantes quand MPP identifie un favori clair à 90 points ou moins. Les nuls value restent autorisés.',

    outcomeAdvices: [...outcomeAdvices].sort(
      (a, b) => b.modelProbability - a.modelProbability
    ),

    scoreAdvices: [...scoreAdvices].sort(
      (a, b) => b.recommendedScore - a.recommendedScore
    ),

    safestPick,
    bestExpectedPick,
    upsidePick,
    recommendedPick,

    predictionOutcomes: prediction.outcomes,
  };
}
