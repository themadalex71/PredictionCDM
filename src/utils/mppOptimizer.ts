import type {
  MppAnalysis,
  MppOutcome,
  MppOutcomeAdvice,
  MppScoreAdvice,
} from '../types/mpp';

export type MppDecisionClass = 'ok' | 'warning' | 'danger';

export type MppDecisionPick = {
  id: string;
  label: string;
  shortLabel: string;
  pick: MppScoreAdvice;
  score: number;
  tag: string;
  className: MppDecisionClass;
  reliabilityScore: number;
  reliabilityLabel: string;
  reliabilityClass: MppDecisionClass;
  reliabilityExplanation: string;
  explanation: string;
};

export type MppDecisionPlan = {
  confidenceScore: number;
  confidenceLabel: string;
  confidenceClass: MppDecisionClass;
  topOutcomeProbability: number;
  favoriteGap: number;
  volatilityLabel: string;
  matchReading: string;
  warnings: string[];
  decisionLabel: string;
  decisionClass: MppDecisionClass;
  finalPick: MppDecisionPick;
  finalReason: string;

  safePick: MppDecisionPick;
  valuePick: MppDecisionPick;
  leaguePick: MppDecisionPick;
  x2SafePick: MppDecisionPick;
  x2ValuePick: MppDecisionPick;
  x2AggressivePick: MppDecisionPick;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function getSearchSpace(analysis: MppAnalysis): MppScoreAdvice[] {
  const reasonableScores = analysis.scoreAdvices.filter(isReasonableScore);

  return reasonableScores.length > 0 ? reasonableScores : analysis.scoreAdvices;
}

function getBestBy(
  scores: MppScoreAdvice[],
  selector: (score: MppScoreAdvice) => number
): MppScoreAdvice {
  const fallback = scores[0] ?? analysisFallbackScore();

  return [...scores].sort((a, b) => selector(b) - selector(a))[0] ?? fallback;
}

function analysisFallbackScore(): MppScoreAdvice {
  return {
    homeGoals: 0,
    awayGoals: 0,
    scoreLabel: '0-0',
    outcome: 'draw',
    outcomeLabel: 'Match nul',
    exactProbability: 0,
    outcomeProbability: 0,
    correctOutcomeOnlyProbability: 0,
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
    riskLevel: 1,
    riskLabel: 'Risque très élevé',
    safetyScore: 0,
    valueScore: 0,
    upsideScore: 0,
    recommendedScore: 0,
    readingLabel: 'Données insuffisantes',
    reason: 'Aucun score exploitable.',
  };
}

function getSortedOutcomeAdvices(
  outcomeAdvices: MppOutcomeAdvice[]
): MppOutcomeAdvice[] {
  return [...outcomeAdvices].sort(
    (a, b) => b.modelProbability - a.modelProbability
  );
}

function getMarketFavoriteOutcome(
  outcomeAdvices: MppOutcomeAdvice[]
): MppOutcome | null {
  const sorted = [...outcomeAdvices]
    .filter((advice) => advice.normalizedMarketProbability !== null)
    .sort(
      (a, b) =>
        (b.normalizedMarketProbability ?? 0) -
        (a.normalizedMarketProbability ?? 0)
    );

  return sorted[0]?.outcome ?? null;
}

function getMarketFavoritePoints(
  outcomeAdvices: MppOutcomeAdvice[]
): number | null {
  const marketFavoriteOutcome = getMarketFavoriteOutcome(outcomeAdvices);

  if (!marketFavoriteOutcome) return null;

  return (
    outcomeAdvices.find((advice) => advice.outcome === marketFavoriteOutcome)
      ?.mppPoints ?? null
  );
}

function getTopScoreProbability(analysis: MppAnalysis): number {
  return analysis.scoreAdvices[0]?.exactProbability ?? 0;
}

function getPositiveEdge(score: MppScoreAdvice): number {
  return Math.max(0, score.edge ?? 0);
}

function getNegativeEdge(score: MppScoreAdvice): number {
  return Math.max(0, -(score.edge ?? 0));
}

function isNonDrawOutsiderAgainstClearFavorite(
  score: MppScoreAdvice,
  outcomeAdvices: MppOutcomeAdvice[],
  favoriteMaxPoints: number
): boolean {
  const marketFavoriteOutcome = getMarketFavoriteOutcome(outcomeAdvices);
  const marketFavoritePoints = getMarketFavoritePoints(outcomeAdvices);

  if (!marketFavoriteOutcome || marketFavoritePoints === null) {
    return false;
  }

  if (marketFavoritePoints > favoriteMaxPoints) {
    return false;
  }

  return score.outcome !== 'draw' && score.outcome !== marketFavoriteOutcome;
}

function getSafeScore(score: MppScoreAdvice): number {
  return (
    score.outcomeProbability * 100 +
    score.exactProbability * 28 +
    score.expectedPoints * 0.22 -
    getNegativeEdge(score) * 18 -
    Math.pow(score.riskLevel, 1.45) * 9
  );
}

function getValueScore(
  score: MppScoreAdvice,
  outcomeAdvices: MppOutcomeAdvice[]
): number {
  const clearOutsiderPenalty = isNonDrawOutsiderAgainstClearFavorite(
    score,
    outcomeAdvices,
    80
  )
    ? 5.5
    : 0;

  const lowProbabilityPenalty =
    score.outcomeProbability < 0.18 ? (0.18 - score.outcomeProbability) * 35 : 0;

  return (
    score.expectedPoints +
    getPositiveEdge(score) * Math.min(score.outcomePoints, 160) * 0.075 +
    score.exactProbability * score.exactBonusPoints * 0.06 -
    lowProbabilityPenalty -
    clearOutsiderPenalty
  );
}

function getLeagueScore(
  score: MppScoreAdvice,
  outcomeAdvices: MppOutcomeAdvice[]
): number {
  const clearOutsiderPenalty = isNonDrawOutsiderAgainstClearFavorite(
    score,
    outcomeAdvices,
    70
  )
    ? 4
    : 0;

  const impossiblePenalty =
    score.outcomeProbability < 0.14 ? (0.14 - score.outcomeProbability) * 45 : 0;

  const rarityBonus =
    (1 - score.estimatedPopularityAmongCorrect) *
    Math.min(score.exactBonusPoints, 100) *
    0.055;

  return (
    score.expectedPoints * 0.9 +
    score.exactBonusExpectedPoints * 0.9 +
    getPositiveEdge(score) * Math.min(score.outcomePoints, 180) * 0.09 +
    rarityBonus -
    Math.pow(score.riskLevel, 1.25) * 2.4 -
    impossiblePenalty -
    clearOutsiderPenalty
  );
}

function getX2SafeScore(score: MppScoreAdvice): number {
  return (
    score.expectedPoints * clamp(score.outcomeProbability / 0.5, 0.55, 1.25) +
    score.outcomeProbability * 8 -
    Math.pow(score.riskLevel, 1.9) * 5
  );
}

function getX2ValueScore(score: MppScoreAdvice): number {
  return (
    score.expectedPoints * clamp(score.outcomeProbability + 0.45, 0.55, 1.05) +
    getPositiveEdge(score) * 10 -
    Math.pow(score.riskLevel, 1.45) * 2.5
  );
}

function getX2AggressiveScore(
  score: MppScoreAdvice,
  outcomeAdvices: MppOutcomeAdvice[]
): number {
  const impossiblePenalty =
    score.outcomeProbability < 0.16 ? (0.16 - score.outcomeProbability) * 30 : 0;

  const clearOutsiderPenalty = isNonDrawOutsiderAgainstClearFavorite(
    score,
    outcomeAdvices,
    65
  )
    ? 3
    : 0;

  return (
    score.expectedPoints * 0.95 +
    score.maxPoints * 0.025 +
    getPositiveEdge(score) * 12 -
    impossiblePenalty -
    clearOutsiderPenalty
  );
}

function pickWithMinimumProbability(
  scores: MppScoreAdvice[],
  minProbability: number,
  selector: (score: MppScoreAdvice) => number
): MppScoreAdvice {
  const filtered = scores.filter(
    (score) => score.outcomeProbability >= minProbability
  );

  return getBestBy(filtered.length > 0 ? filtered : scores, selector);
}

function getReliabilityClass(score: number): MppDecisionClass {
  if (score >= 60) return 'ok';
  if (score >= 42) return 'warning';

  return 'danger';
}

function getReliabilityLabel(score: number): string {
  if (score >= 72) return 'Très fiable';
  if (score >= 60) return 'Fiable';
  if (score >= 48) return 'Moyen';
  if (score >= 36) return 'Risqué';

  return 'Très risqué';
}

function getReliabilityExplanation(
  pick: MppScoreAdvice,
  score: number
): string {
  if (score >= 72) {
    return 'Issue très lisible : bon candidat pour un prono prudent ou un x2 safe.';
  }

  if (score >= 60) {
    return 'Issue assez solide : bon compromis entre sécurité et rendement.';
  }

  if (score >= 48) {
    return 'Pick jouable mais pas sécurisé : à éviter en x2 trop important.';
  }

  if (score >= 36) {
    return 'Pick risqué : intéressant seulement si la value MPP compense vraiment.';
  }

  if (pick.outcomeProbability < 0.22) {
    return 'Pick très spéculatif : plutôt différenciant qu’un vrai prono fiable.';
  }

  return 'Fiabilité faible : les probabilités du modèle sont trop dispersées.';
}

function getPickReliabilityScore(
  pick: MppScoreAdvice,
  confidence: { topOutcomeProbability: number; favoriteGap: number }
): number {
  const edge = pick.edge ?? 0;
  const positiveEdge = Math.max(0, edge);
  const negativeEdge = Math.max(0, -edge);

  const score =
    12 +
    pick.outcomeProbability * 72 +
    pick.exactProbability * 42 +
    confidence.favoriteGap * 22 +
    confidence.topOutcomeProbability * 10 +
    Math.min(positiveEdge, 0.12) * 45 -
    Math.min(negativeEdge, 0.12) * 28 -
    Math.pow(pick.riskLevel, 1.25) * 6.5;

  return Math.round(clamp(score, 0, 100));
}

function buildDecisionPick(params: {
  id: string;
  label: string;
  shortLabel: string;
  pick: MppScoreAdvice;
  score: number;
  className: MppDecisionClass;
  tag: string;
  explanation: string;
  confidence: { topOutcomeProbability: number; favoriteGap: number };
}): MppDecisionPick {
  const reliabilityScore = getPickReliabilityScore(
    params.pick,
    params.confidence
  );

  return {
    ...params,
    reliabilityScore,
    reliabilityLabel: getReliabilityLabel(reliabilityScore),
    reliabilityClass: getReliabilityClass(reliabilityScore),
    reliabilityExplanation: getReliabilityExplanation(
      params.pick,
      reliabilityScore
    ),
  };
}

function getConfidence(analysis: MppAnalysis): {
  confidenceScore: number;
  confidenceLabel: string;
  confidenceClass: MppDecisionClass;
  topOutcomeProbability: number;
  favoriteGap: number;
  volatilityLabel: string;
  matchReading: string;
} {
  const sortedOutcomes = getSortedOutcomeAdvices(analysis.outcomeAdvices);
  const topOutcomeProbability = sortedOutcomes[0]?.modelProbability ?? 0;
  const secondOutcomeProbability = sortedOutcomes[1]?.modelProbability ?? 0;
  const favoriteGap = Math.max(0, topOutcomeProbability - secondOutcomeProbability);
  const topScoreProbability = getTopScoreProbability(analysis);

  const confidenceScore = clamp(
    topOutcomeProbability * 0.82 + favoriteGap * 0.5 + topScoreProbability * 0.9,
    0,
    1
  );

  if (confidenceScore >= 0.58) {
    return {
      confidenceScore,
      confidenceLabel: 'Confiance élevée',
      confidenceClass: 'ok',
      topOutcomeProbability,
      favoriteGap,
      volatilityLabel: 'Match lisible',
      matchReading:
        'Le modèle voit une issue principale assez claire. C’est plutôt un terrain pour un pick prudent ou un x2 safe.',
    };
  }

  if (confidenceScore >= 0.47) {
    return {
      confidenceScore,
      confidenceLabel: 'Confiance moyenne',
      confidenceClass: 'warning',
      topOutcomeProbability,
      favoriteGap,
      volatilityLabel: 'Match ouvert',
      matchReading:
        'Le modèle voit un avantage, mais pas assez net pour ignorer les points MPP. Les picks value peuvent être intéressants.',
    };
  }

  return {
    confidenceScore,
    confidenceLabel: 'Confiance faible',
    confidenceClass: 'danger',
    topOutcomeProbability,
    favoriteGap,
    volatilityLabel: 'Match instable',
    matchReading:
      'Les issues sont proches. Il faut éviter le x2 trop agressif et chercher un compromis risque/rendement.',
  };
}

function selectFinalPick(params: {
  safePick: MppDecisionPick;
  valuePick: MppDecisionPick;
  leaguePick: MppDecisionPick;
  confidenceClass: MppDecisionClass;
}): { finalPick: MppDecisionPick; label: string; reason: string } {
  const { safePick, valuePick, leaguePick, confidenceClass } = params;

  if (safePick.pick.outcome === valuePick.pick.outcome) {
    const finalPick =
      valuePick.pick.expectedPoints >= safePick.pick.expectedPoints ? valuePick : safePick;

    return {
      finalPick,
      label: finalPick.id === 'value' ? 'Jouer value mesurée' : 'Jouer prudent',
      reason:
        'Le prono prudent et le prono value vont dans le même sens : on peut suivre ce choix sans conflit stratégique.',
    };
  }

  const valueExpectedGain =
    valuePick.pick.expectedPoints - safePick.pick.expectedPoints;
  const valueReliabilityGap =
    valuePick.reliabilityScore - safePick.reliabilityScore;
  const valueIsDefensible =
    valuePick.pick.outcomeProbability >= 0.32 &&
    valuePick.reliabilityScore >= 48 &&
    valueExpectedGain >= 8;

  if (confidenceClass !== 'ok' && valueIsDefensible) {
    return {
      finalPick: valuePick,
      label: 'Jouer value mesurée',
      reason:
        'Le match est assez ouvert et la value apporte un gain d’espérance réel sans tomber dans un pari trop faible.',
    };
  }

  if (confidenceClass === 'ok' && valueIsDefensible && valueReliabilityGap >= -6) {
    return {
      finalPick: valuePick,
      label: 'Jouer value mesurée',
      reason:
        'Le modèle reste lisible et la value est presque aussi fiable que le pick prudent : le rendement justifie le risque.',
    };
  }

  if (
    leaguePick.pick.outcome === valuePick.pick.outcome &&
    valuePick.reliabilityScore >= 50 &&
    leaguePick.pick.expectedPoints >= safePick.pick.expectedPoints + 12
  ) {
    return {
      finalPick: valuePick,
      label: 'Jouer value mesurée',
      reason:
        'Le pick différenciant confirme la même issue que la value, mais on reste sur la version value plutôt que sur la version agressive.',
    };
  }

  return {
    finalPick: safePick,
    label: confidenceClass === 'ok' ? 'Jouer prudent' : 'Rester conservateur',
    reason:
      'Le pick value part sur une issue différente du prono prudent avec une fiabilité trop basse : on privilégie le résultat le plus solide.',
  };
}

function getPlanWarnings(
  analysis: MppAnalysis,
  safePick: MppScoreAdvice,
  valuePick: MppScoreAdvice,
  leaguePick: MppScoreAdvice,
  topOutcomeProbability: number,
  favoriteGap: number
): string[] {
  const warnings: string[] = [];

  const hasMissingMppPoints = analysis.outcomeAdvices.some(
    (advice) => advice.mppPoints === null || advice.mppPoints <= 0
  );

  if (hasMissingMppPoints) {
    warnings.push('Points MPP incomplets : la stratégie value est moins fiable.');
  }

  if (topOutcomeProbability < 0.4) {
    warnings.push('Aucune issue ne dépasse 40 % : match très incertain.');
  }

  if (favoriteGap < 0.06) {
    warnings.push('Les deux meilleures issues sont très proches.');
  }

  if (safePick.outcome !== valuePick.outcome) {
    warnings.push('Le pick prudent et le pick value ne jouent pas la même issue.');
  }

  if (leaguePick.outcomeProbability < 0.18) {
    warnings.push('Le pick ligue est très spéculatif : à éviter en x2 prudent.');
  }

  return warnings;
}

export function buildMppDecisionPlan(analysis: MppAnalysis): MppDecisionPlan {
  const searchSpace = getSearchSpace(analysis);
  const confidence = getConfidence(analysis);
  const outcomeAdvices = analysis.outcomeAdvices;

  const safeRaw = pickWithMinimumProbability(
    searchSpace,
    0.36,
    getSafeScore
  );

  const valueRaw = pickWithMinimumProbability(searchSpace, 0.18, (score) =>
    getValueScore(score, outcomeAdvices)
  );

  const leagueRaw = pickWithMinimumProbability(searchSpace, 0.14, (score) =>
    getLeagueScore(score, outcomeAdvices)
  );

  const x2SafeRaw = pickWithMinimumProbability(searchSpace, 0.42, getX2SafeScore);
  const x2ValueRaw = pickWithMinimumProbability(searchSpace, 0.28, getX2ValueScore);
  const x2AggressiveRaw = pickWithMinimumProbability(searchSpace, 0.18, (score) =>
    getX2AggressiveScore(score, outcomeAdvices)
  );

  const safePick = buildDecisionPick({
    id: 'safe',
    label: 'Prono safe',
    shortLabel: 'Safe',
    pick: safeRaw,
    score: getSafeScore(safeRaw),
    className: safeRaw.outcomeProbability >= 0.48 ? 'ok' : 'warning',
    tag: safeRaw.outcomeProbability >= 0.48 ? 'Bon pick prudent' : 'Prudent mais pas blindé',
    explanation:
      'Choix orienté probabilité : il privilégie le bon résultat avant la rentabilité MPP.',
    confidence,
  });

  const valuePick = buildDecisionPick({
    id: 'value',
    label: 'Meilleur choix value',
    shortLabel: 'Value',
    pick: valueRaw,
    score: getValueScore(valueRaw, outcomeAdvices),
    className:
      getPositiveEdge(valueRaw) >= 0.04 && valueRaw.outcomeProbability >= 0.22
        ? 'ok'
        : 'warning',
    tag:
      getPositiveEdge(valueRaw) >= 0.06
        ? 'Très bon value pick'
        : getPositiveEdge(valueRaw) >= 0.025
        ? 'Value raisonnable'
        : 'Rendement modèle',
    explanation:
      'Choix orienté espérance : il cherche le meilleur compromis entre probabilité modèle et points MPP.',
    confidence,
  });

  const leaguePick = buildDecisionPick({
    id: 'league',
    label: 'Pick pour gagner la ligue',
    shortLabel: 'Ligue',
    pick: leagueRaw,
    score: getLeagueScore(leagueRaw, outcomeAdvices),
    className:
      leagueRaw.outcomeProbability >= 0.22
        ? 'ok'
        : leagueRaw.outcomeProbability >= 0.16
        ? 'warning'
        : 'danger',
    tag:
      leagueRaw.outcomeProbability >= 0.24
        ? 'Différenciant jouable'
        : 'Gros risque',
    explanation:
      'Choix plus agressif : il accepte davantage de risque pour viser un meilleur rendement et un score moins évident.',
    confidence,
  });

  const x2SafePick = buildDecisionPick({
    id: 'x2_safe',
    label: 'x2 prudent',
    shortLabel: 'x2 safe',
    pick: x2SafeRaw,
    score: getX2SafeScore(x2SafeRaw),
    className: x2SafeRaw.outcomeProbability >= 0.48 ? 'ok' : 'warning',
    tag: 'Sécuriser le bonus',
    explanation:
      'Candidat x2 prudent : priorité à la probabilité du résultat, pas au jackpot.',
    confidence,
  });

  const x2ValuePick = buildDecisionPick({
    id: 'x2_value',
    label: 'x2 value',
    shortLabel: 'x2 value',
    pick: x2ValueRaw,
    score: getX2ValueScore(x2ValueRaw),
    className:
      x2ValueRaw.outcomeProbability >= 0.34 ? 'ok' : 'warning',
    tag: 'Bon rendement x2',
    explanation:
      'Candidat x2 équilibré : meilleure espérance en gardant une probabilité de résultat correcte.',
    confidence,
  });

  const x2AggressivePick = buildDecisionPick({
    id: 'x2_aggressive',
    label: 'x2 agressif',
    shortLabel: 'x2 agressif',
    pick: x2AggressiveRaw,
    score: getX2AggressiveScore(x2AggressiveRaw, outcomeAdvices),
    className:
      x2AggressiveRaw.outcomeProbability >= 0.22 ? 'warning' : 'danger',
    tag: 'Rattrapage / pari assumé',
    explanation:
      'Candidat x2 agressif : seulement utile si tu dois prendre du retard sur ta ligue.',
    confidence,
  });

  const warnings = getPlanWarnings(
    analysis,
    safeRaw,
    valueRaw,
    leagueRaw,
    confidence.topOutcomeProbability,
    confidence.favoriteGap
  );

  const finalDecision = selectFinalPick({
    safePick,
    valuePick,
    leaguePick,
    confidenceClass: confidence.confidenceClass,
  });

  const decisionClass: MppDecisionClass =
    warnings.length >= 3 ? 'danger' : finalDecision.finalPick.reliabilityClass;

  return {
    ...confidence,
    warnings,
    decisionLabel: finalDecision.label,
    decisionClass,
    finalPick: finalDecision.finalPick,
    finalReason: finalDecision.reason,
    safePick,
    valuePick,
    leaguePick,
    x2SafePick,
    x2ValuePick,
    x2AggressivePick,
  };
}
