import { GROUP_STAGE_EDITIONS } from '../data/groupStage/groupStageEditions';
import type { GroupStakePredictionAdjustment, MatchResult, ModelSettings, MatchPrediction } from '../types/football';
import { predictScoreDistribution } from './predictionModel';
import type {
  GroupMatchContext,
  GroupMatchProfile,
  GroupStageBuildWarning,
  GroupStageDatabase,
  GroupStageEdition,
  GroupStandingRow,
  GroupStakeCoefficientReport,
  GroupStakeCoefficientRow,
  GroupStakeResidualReport,
  GroupStakeResidualRow,
  GroupStakeProfileKey,
  FirstMatchEffectProfileKey,
  FirstMatchEffectReport,
  FirstMatchEffectRow,
  HistoricalContextBacktestMetrics,
  HistoricalContextBacktestReport,
  HistoricalContextBacktestRow,
  TeamIncentiveContext,
} from '../types/groupStage';

function normalizeKey(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getExpectedGroupSizes(edition: GroupStageEdition): number[] {
  if (edition.groupTeamCounts && edition.groupTeamCounts.length > 0) {
    return edition.groupTeamCounts;
  }

  return Array.from({ length: edition.groupCount }, () => edition.teamsPerGroup);
}

function getRoundRobinLegs(edition: GroupStageEdition): number {
  return Math.max(1, edition.roundRobinLegs ?? 1);
}

function getGroupGamesPerTeam(edition: GroupStageEdition, groupSize: number): number {
  return Math.max(0, groupSize - 1) * getRoundRobinLegs(edition);
}

function expectedGroupMatchCount(edition: GroupStageEdition): number {
  if (edition.reconstructionMode === 'inferred_qualification') {
    return 0;
  }

  return getExpectedGroupSizes(edition).reduce(
    (sum, groupSize) => sum + ((groupSize * (groupSize - 1)) / 2) * getRoundRobinLegs(edition),
    0
  );
}

function arraysHaveSameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;

  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);

  return sortedA.every((value, index) => value === sortedB[index]);
}

function isMatchInEdition(match: MatchResult, edition: GroupStageEdition): boolean {
  const tournament = normalizeKey(match.tournament);
  const isTournament = edition.tournamentAliases.some(
    (alias) => normalizeKey(alias) === tournament
  );

  return (
    isTournament &&
    match.date >= edition.startDate &&
    match.date <= edition.endDate
  );
}

function compareMatches(a: MatchResult, b: MatchResult): number {
  const dateCompare = a.date.localeCompare(b.date);
  if (dateCompare !== 0) return dateCompare;
  const homeCompare = a.homeTeam.localeCompare(b.homeTeam);
  if (homeCompare !== 0) return homeCompare;
  return a.awayTeam.localeCompare(b.awayTeam);
}

function getInitialRows(teams: string[]): Map<string, Omit<GroupStandingRow, 'rank' | 'maxPoints'>> {
  const rows = new Map<string, Omit<GroupStandingRow, 'rank' | 'maxPoints'>>();

  for (const team of teams) {
    rows.set(team, {
      team,
      played: 0,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
    });
  }

  return rows;
}

function rankRows(
  rows: Map<string, Omit<GroupStandingRow, 'rank' | 'maxPoints'>>,
  groupGamesPerTeam: number
): GroupStandingRow[] {
  const ranked = [...rows.values()]
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      maxPoints: row.points + Math.max(0, groupGamesPerTeam - row.played) * 3,
      rank: 0,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) {
        return b.goalDifference - a.goalDifference;
      }
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.team.localeCompare(b.team);
    });

  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyMatchToRows(
  rows: Map<string, Omit<GroupStandingRow, 'rank' | 'maxPoints'>>,
  match: MatchResult
): void {
  const home = rows.get(match.homeTeam);
  const away = rows.get(match.awayTeam);
  if (!home || !away) return;

  home.played += 1;
  away.played += 1;
  home.goalsFor += match.homeScore;
  home.goalsAgainst += match.awayScore;
  away.goalsFor += match.awayScore;
  away.goalsAgainst += match.homeScore;
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;

  if (match.homeScore > match.awayScore) {
    home.wins += 1;
    away.losses += 1;
    home.points += 3;
  } else if (match.homeScore < match.awayScore) {
    away.wins += 1;
    home.losses += 1;
    away.points += 3;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.points += 1;
    away.points += 1;
  }
}

function collectPairKey(teamA: string, teamB: string): string {
  return [teamA, teamB].sort((a, b) => a.localeCompare(b)).join('|||');
}

function getComponentsFromAdjacency(adjacency: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const team of adjacency.keys()) {
    if (seen.has(team)) continue;

    const stack = [team];
    const component: string[] = [];
    seen.add(team);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      component.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        stack.push(neighbor);
      }
    }

    components.push(component.sort((a, b) => a.localeCompare(b)));
  }

  return components.sort((a, b) => a[0].localeCompare(b[0]));
}

function findComponents(matches: MatchResult[]): string[][] {
  const adjacency = new Map<string, Set<string>>();

  for (const match of matches) {
    if (!adjacency.has(match.homeTeam)) adjacency.set(match.homeTeam, new Set());
    if (!adjacency.has(match.awayTeam)) adjacency.set(match.awayTeam, new Set());
    adjacency.get(match.homeTeam)?.add(match.awayTeam);
    adjacency.get(match.awayTeam)?.add(match.homeTeam);
  }

  return getComponentsFromAdjacency(adjacency);
}

function findQualificationComponents(
  matches: MatchResult[],
  edition: GroupStageEdition
): string[][] {
  const rawAdjacency = new Map<string, Set<string>>();
  const pairCounts = new Map<string, number>();
  const teams = new Set<string>();

  for (const match of matches) {
    teams.add(match.homeTeam);
    teams.add(match.awayTeam);
    if (!rawAdjacency.has(match.homeTeam)) rawAdjacency.set(match.homeTeam, new Set());
    if (!rawAdjacency.has(match.awayTeam)) rawAdjacency.set(match.awayTeam, new Set());
    rawAdjacency.get(match.homeTeam)?.add(match.awayTeam);
    rawAdjacency.get(match.awayTeam)?.add(match.homeTeam);

    const pairKey = collectPairKey(match.homeTeam, match.awayTeam);
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
  }

  const minGroupSize = edition.minGroupSize ?? 3;
  const maxGroupSize = edition.maxGroupSize ?? 10;
  const minCommonOpponents = Math.max(1, Math.min(3, minGroupSize - 2));
  const expectedLegs = getRoundRobinLegs(edition);
  const prunedAdjacency = new Map<string, Set<string>>();

  for (const team of teams) {
    prunedAdjacency.set(team, new Set());
  }

  for (const [pairKey, pairCount] of pairCounts.entries()) {
    const [teamA, teamB] = pairKey.split('|||');
    const neighborsA = rawAdjacency.get(teamA) ?? new Set<string>();
    const neighborsB = rawAdjacency.get(teamB) ?? new Set<string>();
    let commonOpponents = 0;

    for (const neighbor of neighborsA) {
      if (neighbor !== teamB && neighborsB.has(neighbor)) {
        commonOpponents += 1;
      }
    }

    // Les qualifications contiennent souvent des barrages aller-retour en fin de cycle.
    // Un barrage ressemble à un vrai match de qualification dans results.csv, mais il crée
    // une arête artificielle entre deux groupes. On garde donc les arêtes qui ressemblent à
    // de vraies arêtes de poule : les deux équipes partagent plusieurs adversaires communs.
    const looksLikeGroupEdge =
      pairCount >= Math.min(expectedLegs, 2) && commonOpponents >= minCommonOpponents;

    if (!looksLikeGroupEdge) continue;

    prunedAdjacency.get(teamA)?.add(teamB);
    prunedAdjacency.get(teamB)?.add(teamA);
  }

  return getComponentsFromAdjacency(prunedAdjacency)
    .filter((component) => component.length >= minGroupSize && component.length <= maxGroupSize)
    .filter((component) => {
      const groupTeamSet = new Set(component);
      const groupMatches = matches.filter(
        (match) => groupTeamSet.has(match.homeTeam) && groupTeamSet.has(match.awayTeam)
      );
      const appearances = new Map<string, number>();
      for (const team of component) appearances.set(team, 0);
      for (const match of groupMatches) {
        appearances.set(match.homeTeam, (appearances.get(match.homeTeam) ?? 0) + 1);
        appearances.set(match.awayTeam, (appearances.get(match.awayTeam) ?? 0) + 1);
      }

      const minAppearances = Math.min(...Array.from(appearances.values()));
      const theoreticalMinimum = Math.floor((component.length * (component.length - 1)) / 2);
      return minAppearances >= Math.min(2, component.length - 1) && groupMatches.length >= theoreticalMinimum;
    });
}

function getGroupLabel(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

function makeTeamIncentive(
  team: string,
  table: GroupStandingRow[],
  edition: GroupStageEdition,
  groupSize: number,
  groupGamesPerTeam: number,
  isFinalGroupMatchday: boolean
): TeamIncentiveContext {
  const row = table.find((item) => item.team === team);
  if (!row) {
    throw new Error(`Equipe absente du classement de groupe : ${team}`);
  }

  const others = table.filter((item) => item.team !== team);
  const qualifiedLine = edition.qualifiedPerGroup;
  const sortedByMax = [...others].sort((a, b) => b.maxPoints - a.maxPoints);
  const strongestChaser = sortedByMax[qualifiedLine - 1];
  const currentSecond = table[qualifiedLine - 1];
  const currentFirst = table[0];

  const guaranteedTopGroupQualification =
    Boolean(strongestChaser) && row.points > strongestChaser.maxPoints;

  const eliminatedFromTopGroupQualification =
    Boolean(currentSecond) && row.maxPoints < currentSecond.points;

  const pointsWithDraw = row.points + 1;
  const pointsWithWin = row.points + 3;

  const mustWinForTopGroupQualification =
    isFinalGroupMatchday &&
    !guaranteedTopGroupQualification &&
    !eliminatedFromTopGroupQualification &&
    Boolean(currentSecond) &&
    pointsWithDraw < currentSecond.points &&
    pointsWithWin >= currentSecond.points;

  const drawLikelyEnoughForTopGroupQualification =
    isFinalGroupMatchday &&
    !guaranteedTopGroupQualification &&
    !eliminatedFromTopGroupQualification &&
    Boolean(currentSecond) &&
    pointsWithDraw >= currentSecond.points;

  const canStillWinGroup = Boolean(currentFirst) && row.maxPoints >= currentFirst.points;

  const notes: string[] = [];
  if (guaranteedTopGroupQualification) notes.push('Qualification top groupe déjà sécurisée');
  if (eliminatedFromTopGroupQualification) notes.push('Top 2 impossible selon les points actuels');
  if (mustWinForTopGroupQualification) notes.push('Victoire probablement nécessaire pour le top 2');
  if (drawLikelyEnoughForTopGroupQualification) notes.push('Nul potentiellement suffisant pour le top 2');
  if (edition.bestThirdCount > 0 && !guaranteedTopGroupQualification) {
    notes.push('Voie meilleur troisième possible selon le format');
  }

  let urgency: TeamIncentiveContext['urgency'] = 'low';
  if (guaranteedTopGroupQualification) urgency = 'none';
  else if (mustWinForTopGroupQualification) urgency = 'must_win';
  else if (eliminatedFromTopGroupQualification) urgency = 'medium';
  else if (drawLikelyEnoughForTopGroupQualification) urgency = 'medium';
  else if (isFinalGroupMatchday) urgency = 'high';

  let likelyRotationRisk: TeamIncentiveContext['likelyRotationRisk'] = 'low';
  if (guaranteedTopGroupQualification && row.rank === 1 && !canStillWinGroup) {
    likelyRotationRisk = 'high';
  } else if (guaranteedTopGroupQualification) {
    likelyRotationRisk = 'medium';
  }

  return {
    team,
    pointsBefore: row.points,
    rankBefore: row.rank,
    matchesPlayedBefore: row.played,
    matchesRemainingBefore: Math.max(0, groupGamesPerTeam - row.played),
    guaranteedTopGroupQualification,
    eliminatedFromTopGroupQualification,
    mustWinForTopGroupQualification,
    drawLikelyEnoughForTopGroupQualification,
    canStillWinGroup,
    likelyRotationRisk,
    urgency,
    notes,
  };
}

function makeMatchProfile(
  home: TeamIncentiveContext,
  away: TeamIncentiveContext
): GroupMatchProfile {
  const bothAlreadySafe =
    home.guaranteedTopGroupQualification && away.guaranteedTopGroupQualification;
  const oneAlreadySafeOneMustWin =
    (home.guaranteedTopGroupQualification && away.mustWinForTopGroupQualification) ||
    (away.guaranteedTopGroupQualification && home.mustWinForTopGroupQualification);
  const bothNeedResult =
    ['high', 'must_win'].includes(home.urgency) &&
    ['high', 'must_win'].includes(away.urgency);
  const drawCouldSuitBoth =
    home.drawLikelyEnoughForTopGroupQualification &&
    away.drawLikelyEnoughForTopGroupQualification;
  const deadRubberRisk =
    bothAlreadySafe ||
    (home.eliminatedFromTopGroupQualification && away.eliminatedFromTopGroupQualification);

  return {
    bothAlreadySafe,
    oneAlreadySafeOneMustWin,
    bothNeedResult,
    drawCouldSuitBoth,
    deadRubberRisk,
    upsetRiskBoost: oneAlreadySafeOneMustWin || deadRubberRisk ? 0.08 : 0,
    drawIncentiveBoost: drawCouldSuitBoth ? 0.08 : bothNeedResult ? -0.03 : 0,
    openGameBoost:
      home.mustWinForTopGroupQualification || away.mustWinForTopGroupQualification ? 0.08 : 0,
    favoriteMotivationPenalty:
      home.likelyRotationRisk === 'high' || away.likelyRotationRisk === 'high'
        ? 0.08
        : home.likelyRotationRisk === 'medium' || away.likelyRotationRisk === 'medium'
          ? 0.04
          : 0,
  };
}

export function buildGroupStageDatabase(matches: MatchResult[]): GroupStageDatabase {
  const contexts: GroupMatchContext[] = [];
  const warnings: GroupStageBuildWarning[] = [];

  const activeEditions = GROUP_STAGE_EDITIONS.filter(
    (edition) => edition.stageCategory !== 'qualification'
  );

  for (const edition of activeEditions) {
    const editionMatches = matches
      .filter((match) => isMatchInEdition(match, edition))
      .sort(compareMatches);

    const expectedMatches = expectedGroupMatchCount(edition);
    const isQualificationInferred = edition.reconstructionMode === 'inferred_qualification';

    if (!isQualificationInferred && editionMatches.length < expectedMatches) {
      warnings.push({
        editionId: edition.id,
        message: `Seulement ${editionMatches.length} matchs trouvés pour ${expectedMatches} matchs de groupe attendus.`,
      });
      continue;
    }

    const groupStageMatches = isQualificationInferred
      ? editionMatches
      : editionMatches.slice(0, expectedMatches);

    let components = isQualificationInferred
      ? findQualificationComponents(groupStageMatches, edition)
      : findComponents(groupStageMatches);

    if (!isQualificationInferred) {
      if (components.length !== edition.groupCount) {
        warnings.push({
          editionId: edition.id,
          message: `${components.length} groupes reconstruits au lieu de ${edition.groupCount}. Vérifier le nom du tournoi ou les dates.`,
        });
      }

      const expectedGroupSizes = getExpectedGroupSizes(edition);
      const actualGroupSizes = components.map((teams) => teams.length);

      if (!arraysHaveSameNumbers(actualGroupSizes, expectedGroupSizes)) {
        warnings.push({
          editionId: edition.id,
          message: `Tailles de groupes reconstruites ${actualGroupSizes.join('/')} au lieu de ${expectedGroupSizes.join('/')}. Vérifier les dates, les exceptions de format ou les noms du tournoi.`,
        });
      }
    }

    if (isQualificationInferred && components.length === 0 && editionMatches.length > 0) {
      warnings.push({
        editionId: edition.id,
        message: `${editionMatches.length} matchs trouvés, mais aucun groupe de qualification exploitable reconstruit.`,
      });
    }

    components.forEach((teams, groupIndex) => {
      const groupSize = teams.length;
      const expectedGroupSizes = getExpectedGroupSizes(edition);
      const isExpectedSize = isQualificationInferred || expectedGroupSizes.includes(groupSize);

      if (!isExpectedSize) {
        warnings.push({
          editionId: edition.id,
          message: `Groupe ${getGroupLabel(groupIndex)} : ${groupSize} équipes, taille non prévue pour cette édition. Tailles attendues : ${expectedGroupSizes.join('/')}.`,
        });
      }

      const group = getGroupLabel(groupIndex);
      const groupMatches = groupStageMatches
        .filter(
          (match) =>
            teams.includes(match.homeTeam) && teams.includes(match.awayTeam)
        )
        .sort(compareMatches);
      const rows = getInitialRows(teams);
      const groupGamesPerTeam = getGroupGamesPerTeam(edition, groupSize);

      for (const match of groupMatches) {
        const tableBefore = rankRows(rows, groupGamesPerTeam);
        const homeBefore = tableBefore.find((row) => row.team === match.homeTeam);
        const awayBefore = tableBefore.find((row) => row.team === match.awayTeam);

        if (!homeBefore || !awayBefore) continue;

        const matchday = Math.max(homeBefore.played, awayBefore.played) + 1;
        const isFinalGroupMatchday = matchday >= groupGamesPerTeam;
        const homeIncentive = makeTeamIncentive(
          match.homeTeam,
          tableBefore,
          edition,
          groupSize,
          groupGamesPerTeam,
          isFinalGroupMatchday
        );
        const awayIncentive = makeTeamIncentive(
          match.awayTeam,
          tableBefore,
          edition,
          groupSize,
          groupGamesPerTeam,
          isFinalGroupMatchday
        );

        contexts.push({
          editionId: edition.id,
          competition: edition.competition,
          edition: edition.edition,
          stageCategory: edition.stageCategory ?? 'final_tournament',
          group,
          matchday,
          isFinalGroupMatchday,
          date: match.date,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          homeBefore,
          awayBefore,
          groupTableBefore: tableBefore,
          homeIncentive,
          awayIncentive,
          matchProfile: makeMatchProfile(homeIncentive, awayIncentive),
          sourceMatch: match,
        });

        applyMatchToRows(rows, match);
      }
    });
  }

  return {
    editions: activeEditions,
    contexts: contexts.sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function exportGroupStageContextsCsv(contexts: GroupMatchContext[]): string {
  const headers = [
    'competition',
    'edition',
    'stage_category',
    'group',
    'matchday',
    'is_final_group_matchday',
    'date',
    'home_team',
    'away_team',
    'score',
    'home_points_before',
    'away_points_before',
    'home_rank_before',
    'away_rank_before',
    'home_urgency',
    'away_urgency',
    'home_guaranteed',
    'away_guaranteed',
    'home_must_win',
    'away_must_win',
    'draw_could_suit_both',
    'one_safe_one_must_win',
    'dead_rubber_risk',
    'upset_risk_boost',
    'draw_incentive_boost',
    'open_game_boost',
    'favorite_motivation_penalty',
  ];

  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = contexts.map((context) => [
    context.competition,
    context.edition,
    context.stageCategory ?? 'final_tournament',
    context.group,
    context.matchday,
    context.isFinalGroupMatchday,
    context.date,
    context.homeTeam,
    context.awayTeam,
    `${context.homeScore}-${context.awayScore}`,
    context.homeBefore.points,
    context.awayBefore.points,
    context.homeBefore.rank,
    context.awayBefore.rank,
    context.homeIncentive.urgency,
    context.awayIncentive.urgency,
    context.homeIncentive.guaranteedTopGroupQualification,
    context.awayIncentive.guaranteedTopGroupQualification,
    context.homeIncentive.mustWinForTopGroupQualification,
    context.awayIncentive.mustWinForTopGroupQualification,
    context.matchProfile.drawCouldSuitBoth,
    context.matchProfile.oneAlreadySafeOneMustWin,
    context.matchProfile.deadRubberRisk,
    context.matchProfile.upsetRiskBoost,
    context.matchProfile.drawIncentiveBoost,
    context.matchProfile.openGameBoost,
    context.matchProfile.favoriteMotivationPenalty,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
}


type OutcomeMetricsAccumulator = {
  profileKey: GroupStakeProfileKey;
  label: string;
  description: string;
  matches: GroupMatchContext[];
};

type RawOutcomeMetrics = {
  sampleSize: number;
  favoriteSampleSize: number;
  drawRate: number;
  goalsPerMatch: number;
  over25Rate: number;
  favoriteWinRate: number | null;
  upsetRate: number | null;
};

const PROFILE_METADATA: Record<GroupStakeProfileKey, { label: string; description: string }> = {
  baseline_non_final: {
    label: 'Référence J1/J2',
    description: 'Matchs de phase de groupe avant la dernière journée. Sert de base de comparaison.',
  },
  standard_final_day: {
    label: 'Dernière journée standard',
    description: 'Dernière journée sans signal fort : ni must-win évident, ni rotation, ni nul arrangeant.',
  },
  one_team_must_win: {
    label: 'Une équipe doit gagner',
    description: 'Une seule équipe a probablement besoin de la victoire pour viser la qualification directe.',
  },
  both_need_result: {
    label: 'Deux équipes sous pression',
    description: 'Les deux équipes ont un niveau d’urgence élevé ou must-win.',
  },
  draw_suits_both: {
    label: 'Nul utile aux deux',
    description: 'Le nul peut suffire aux deux équipes selon le classement avant match.',
  },
  safe_vs_must_win: {
    label: 'Déjà qualifié vs must-win',
    description: 'Une équipe est déjà sécurisée tandis que l’autre doit aller chercher un résultat.',
  },
  rotation_risk: {
    label: 'Risque rotation / relâchement',
    description: 'Au moins une équipe est déjà qualifiée ou présente un risque de rotation.',
  },
  dead_rubber: {
    label: 'Match sans enjeu fort',
    description: 'Les deux équipes sont déjà sécurisées ou les deux ont un top 2 impossible selon les points.',
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getProfileKey(context: GroupMatchContext): GroupStakeProfileKey {
  if (!context.isFinalGroupMatchday) return 'baseline_non_final';
  if (context.matchProfile.deadRubberRisk) return 'dead_rubber';
  if (context.matchProfile.oneAlreadySafeOneMustWin) return 'safe_vs_must_win';
  if (context.matchProfile.drawCouldSuitBoth) return 'draw_suits_both';
  if (context.matchProfile.bothNeedResult) return 'both_need_result';
  if (
    context.homeIncentive.mustWinForTopGroupQualification ||
    context.awayIncentive.mustWinForTopGroupQualification
  ) {
    return 'one_team_must_win';
  }
  if (
    context.homeIncentive.likelyRotationRisk !== 'low' ||
    context.awayIncentive.likelyRotationRisk !== 'low'
  ) {
    return 'rotation_risk';
  }
  return 'standard_final_day';
}

function getPreMatchFavorite(context: GroupMatchContext): 'home' | 'away' | null {
  const pointsDiff = context.homeBefore.points - context.awayBefore.points;
  if (Math.abs(pointsDiff) >= 2) return pointsDiff > 0 ? 'home' : 'away';

  const goalDiffDiff = context.homeBefore.goalDifference - context.awayBefore.goalDifference;
  if (Math.abs(goalDiffDiff) >= 2) return goalDiffDiff > 0 ? 'home' : 'away';

  const goalsForDiff = context.homeBefore.goalsFor - context.awayBefore.goalsFor;
  if (Math.abs(goalsForDiff) >= 2) return goalsForDiff > 0 ? 'home' : 'away';

  // Si les deux équipes sont trop proches au classement, on ne force pas un favori.
  return null;
}

function computeRawOutcomeMetrics(matches: GroupMatchContext[]): RawOutcomeMetrics {
  if (matches.length === 0) {
    return {
      sampleSize: 0,
      favoriteSampleSize: 0,
      drawRate: 0,
      goalsPerMatch: 0,
      over25Rate: 0,
      favoriteWinRate: null,
      upsetRate: null,
    };
  }

  let draws = 0;
  let goals = 0;
  let over25 = 0;
  let favoriteSample = 0;
  let favoriteWins = 0;
  let upsets = 0;

  for (const context of matches) {
    const totalGoals = context.homeScore + context.awayScore;
    goals += totalGoals;
    if (totalGoals > 2.5) over25 += 1;
    if (context.homeScore === context.awayScore) draws += 1;

    const favorite = getPreMatchFavorite(context);
    if (!favorite) continue;

    favoriteSample += 1;
    const homeWin = context.homeScore > context.awayScore;
    const awayWin = context.awayScore > context.homeScore;

    if ((favorite === 'home' && homeWin) || (favorite === 'away' && awayWin)) {
      favoriteWins += 1;
    }
    if ((favorite === 'home' && awayWin) || (favorite === 'away' && homeWin)) {
      upsets += 1;
    }
  }

  return {
    sampleSize: matches.length,
    favoriteSampleSize: favoriteSample,
    drawRate: draws / matches.length,
    goalsPerMatch: goals / matches.length,
    over25Rate: over25 / matches.length,
    favoriteWinRate: favoriteSample > 0 ? favoriteWins / favoriteSample : null,
    upsetRate: favoriteSample > 0 ? upsets / favoriteSample : null,
  };
}

function getConfidence(sampleSize: number): GroupStakeCoefficientRow['confidence'] {
  if (sampleSize >= 80) return 'high';
  if (sampleSize >= 30) return 'medium';
  return 'low';
}

function makeRecommendation(row: Omit<GroupStakeCoefficientRow, 'recommendation'>): string {
  const pieces: string[] = [];

  if (row.drawCoefficient >= 1.1) pieces.push('augmenter légèrement les nuls');
  if (row.drawCoefficient <= 0.92) pieces.push('réduire les nuls');
  if (row.openGameCoefficient >= 1.08) pieces.push('matchs plus ouverts');
  if (row.openGameCoefficient <= 0.92) pieces.push('matchs plus fermés');
  if (row.upsetCoefficient >= 1.12) pieces.push('hausse du risque surprise');
  if (row.favoriteMotivationPenalty >= 0.04) pieces.push('pénaliser le favori motivé faiblement');

  if (pieces.length === 0) return 'Effet faible : garder le modèle presque neutre.';
  return `${pieces.join(' · ')}.`;
}

function buildCoefficientRow(
  profileKey: GroupStakeProfileKey,
  matches: GroupMatchContext[],
  baselineMetrics: RawOutcomeMetrics
): GroupStakeCoefficientRow {
  const metadata = PROFILE_METADATA[profileKey];
  const metrics = computeRawOutcomeMetrics(matches);

  const drawCoefficient = clamp(
    (metrics.drawRate + 0.02) / Math.max(0.02, baselineMetrics.drawRate + 0.02),
    0.72,
    1.38
  );
  const openGameCoefficient = clamp(
    metrics.goalsPerMatch / Math.max(0.1, baselineMetrics.goalsPerMatch),
    0.78,
    1.32
  );
  const upsetCoefficient = clamp(
    ((metrics.upsetRate ?? 0) + 0.02) / Math.max(0.02, (baselineMetrics.upsetRate ?? 0) + 0.02),
    0.72,
    1.45
  );

  const favoriteWinDrop =
    baselineMetrics.favoriteWinRate !== null && metrics.favoriteWinRate !== null
      ? baselineMetrics.favoriteWinRate - metrics.favoriteWinRate
      : 0;

  const rowWithoutRecommendation: Omit<GroupStakeCoefficientRow, 'recommendation'> = {
    profileKey,
    label: metadata.label,
    description: metadata.description,
    sampleSize: metrics.sampleSize,
    favoriteSampleSize: metrics.favoriteSampleSize,
    drawRate: metrics.drawRate,
    baselineDrawRate: baselineMetrics.drawRate,
    goalsPerMatch: metrics.goalsPerMatch,
    baselineGoalsPerMatch: baselineMetrics.goalsPerMatch,
    over25Rate: metrics.over25Rate,
    baselineOver25Rate: baselineMetrics.over25Rate,
    favoriteWinRate: metrics.favoriteWinRate,
    baselineFavoriteWinRate: baselineMetrics.favoriteWinRate,
    upsetRate: metrics.upsetRate,
    baselineUpsetRate: baselineMetrics.upsetRate,
    drawCoefficient,
    openGameCoefficient,
    upsetCoefficient,
    favoriteMotivationPenalty: clamp(favoriteWinDrop, 0, 0.16),
    confidence: getConfidence(metrics.sampleSize),
  };

  return {
    ...rowWithoutRecommendation,
    recommendation: makeRecommendation(rowWithoutRecommendation),
  };
}

export function buildGroupStakeCoefficientReport(
  contexts: GroupMatchContext[]
): GroupStakeCoefficientReport {
  const stakeContexts = contexts.filter((context) => context.stageCategory !== 'qualification');
  const groups = new Map<GroupStakeProfileKey, OutcomeMetricsAccumulator>();

  for (const profileKey of Object.keys(PROFILE_METADATA) as GroupStakeProfileKey[]) {
    const metadata = PROFILE_METADATA[profileKey];
    groups.set(profileKey, {
      profileKey,
      label: metadata.label,
      description: metadata.description,
      matches: [],
    });
  }

  for (const context of stakeContexts) {
    const key = getProfileKey(context);
    groups.get(key)?.matches.push(context);
  }

  const baselineMatches = groups.get('baseline_non_final')?.matches ?? [];
  const fallbackBaselineMatches = stakeContexts.filter((context) => !context.isFinalGroupMatchday);
  const baselineMetrics = computeRawOutcomeMetrics(
    baselineMatches.length > 0 ? baselineMatches : fallbackBaselineMatches
  );

  const baseline = buildCoefficientRow(
    'baseline_non_final',
    baselineMatches.length > 0 ? baselineMatches : fallbackBaselineMatches,
    baselineMetrics
  );

  const rows = (Object.keys(PROFILE_METADATA) as GroupStakeProfileKey[])
    .filter((key) => key !== 'baseline_non_final')
    .map((key) => buildCoefficientRow(key, groups.get(key)?.matches ?? [], baselineMetrics))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  return {
    generatedAt: new Date().toISOString(),
    baseline,
    rows,
  };
}

export function exportGroupStakeCoefficientsCsv(report: GroupStakeCoefficientReport): string {
  const headers = [
    'profile_key',
    'label',
    'sample_size',
    'favorite_sample_size',
    'confidence',
    'draw_rate',
    'baseline_draw_rate',
    'draw_coefficient',
    'goals_per_match',
    'baseline_goals_per_match',
    'open_game_coefficient',
    'over25_rate',
    'baseline_over25_rate',
    'favorite_win_rate',
    'baseline_favorite_win_rate',
    'upset_rate',
    'baseline_upset_rate',
    'upset_coefficient',
    'favorite_motivation_penalty',
    'recommendation',
  ];

  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = [report.baseline, ...report.rows].map((row) => [
    row.profileKey,
    row.label,
    row.sampleSize,
    row.favoriteSampleSize,
    row.confidence,
    row.drawRate,
    row.baselineDrawRate,
    row.drawCoefficient,
    row.goalsPerMatch,
    row.baselineGoalsPerMatch,
    row.openGameCoefficient,
    row.over25Rate,
    row.baselineOver25Rate,
    row.favoriteWinRate ?? '',
    row.baselineFavoriteWinRate ?? '',
    row.upsetRate ?? '',
    row.baselineUpsetRate ?? '',
    row.upsetCoefficient,
    row.favoriteMotivationPenalty,
    row.recommendation,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
}

type ResidualAccumulator = {
  profileKey: GroupStakeProfileKey;
  contexts: GroupMatchContext[];
};

type ResidualRawMetrics = {
  sampleSize: number;
  favoriteSampleSize: number;
  predictedHomeWinRate: number;
  actualHomeWinRate: number;
  predictedDrawRate: number;
  actualDrawRate: number;
  predictedAwayWinRate: number;
  actualAwayWinRate: number;
  predictedFavoriteWinRate: number | null;
  actualFavoriteWinRate: number | null;
  predictedOutsiderWinRate: number | null;
  actualOutsiderWinRate: number | null;
  predictedOutsiderPointRate: number | null;
  actualOutsiderPointRate: number | null;
  predictedGoalsPerMatch: number;
  actualGoalsPerMatch: number;
  predictedOver25Rate: number;
  actualOver25Rate: number;
};

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function safeNullableRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function computeResidualRawMetrics(
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings
): ResidualRawMetrics {
  if (contexts.length === 0) {
    return {
      sampleSize: 0,
      favoriteSampleSize: 0,
      predictedHomeWinRate: 0,
      actualHomeWinRate: 0,
      predictedDrawRate: 0,
      actualDrawRate: 0,
      predictedAwayWinRate: 0,
      actualAwayWinRate: 0,
      predictedFavoriteWinRate: null,
      actualFavoriteWinRate: null,
      predictedOutsiderWinRate: null,
      actualOutsiderWinRate: null,
      predictedOutsiderPointRate: null,
      actualOutsiderPointRate: null,
      predictedGoalsPerMatch: 0,
      actualGoalsPerMatch: 0,
      predictedOver25Rate: 0,
      actualOver25Rate: 0,
    };
  }

  let predictedHomeWin = 0;
  let predictedDraw = 0;
  let predictedAwayWin = 0;
  let actualHomeWin = 0;
  let actualDraw = 0;
  let actualAwayWin = 0;

  let predictedGoals = 0;
  let actualGoals = 0;
  let predictedOver25 = 0;
  let actualOver25 = 0;

  let favoriteSample = 0;
  let predictedFavoriteWin = 0;
  let actualFavoriteWin = 0;
  let predictedOutsiderWin = 0;
  let actualOutsiderWin = 0;
  let predictedOutsiderPoint = 0;
  let actualOutsiderPoint = 0;

  for (const context of contexts) {
    const prediction = predictScoreDistribution(
      context.homeTeam,
      context.awayTeam,
      allMatches,
      settings,
      {
        neutral: context.sourceMatch.neutral,
        teamAIsHome: true,
        tournament: context.sourceMatch.tournament,
        predictionDate: context.date,
      }
    );

    const homeWinProbability = prediction.outcomes.teamAWin;
    const drawProbability = prediction.outcomes.draw;
    const awayWinProbability = prediction.outcomes.teamBWin;

    predictedHomeWin += homeWinProbability;
    predictedDraw += drawProbability;
    predictedAwayWin += awayWinProbability;

    const homeWon = context.homeScore > context.awayScore;
    const awayWon = context.awayScore > context.homeScore;
    const isDraw = context.homeScore === context.awayScore;

    if (homeWon) actualHomeWin += 1;
    else if (awayWon) actualAwayWin += 1;
    else actualDraw += 1;

    predictedGoals += prediction.expectedGoalsA + prediction.expectedGoalsB;
    actualGoals += context.homeScore + context.awayScore;
    predictedOver25 += prediction.outcomes.over25;
    if (context.homeScore + context.awayScore > 2.5) actualOver25 += 1;

    const nonDrawGap = Math.abs(homeWinProbability - awayWinProbability);
    if (nonDrawGap >= 0.035) {
      favoriteSample += 1;
      const favoriteIsHome = homeWinProbability >= awayWinProbability;
      const favoriteWinProbability = favoriteIsHome ? homeWinProbability : awayWinProbability;
      const outsiderWinProbability = favoriteIsHome ? awayWinProbability : homeWinProbability;

      predictedFavoriteWin += favoriteWinProbability;
      predictedOutsiderWin += outsiderWinProbability;
      predictedOutsiderPoint += outsiderWinProbability + drawProbability;

      const favoriteWon = favoriteIsHome ? homeWon : awayWon;
      const outsiderWon = favoriteIsHome ? awayWon : homeWon;

      if (favoriteWon) actualFavoriteWin += 1;
      if (outsiderWon) actualOutsiderWin += 1;
      if (outsiderWon || isDraw) actualOutsiderPoint += 1;
    }
  }

  return {
    sampleSize: contexts.length,
    favoriteSampleSize: favoriteSample,
    predictedHomeWinRate: predictedHomeWin / contexts.length,
    actualHomeWinRate: actualHomeWin / contexts.length,
    predictedDrawRate: predictedDraw / contexts.length,
    actualDrawRate: actualDraw / contexts.length,
    predictedAwayWinRate: predictedAwayWin / contexts.length,
    actualAwayWinRate: actualAwayWin / contexts.length,
    predictedFavoriteWinRate: safeNullableRate(predictedFavoriteWin, favoriteSample),
    actualFavoriteWinRate: safeNullableRate(actualFavoriteWin, favoriteSample),
    predictedOutsiderWinRate: safeNullableRate(predictedOutsiderWin, favoriteSample),
    actualOutsiderWinRate: safeNullableRate(actualOutsiderWin, favoriteSample),
    predictedOutsiderPointRate: safeNullableRate(predictedOutsiderPoint, favoriteSample),
    actualOutsiderPointRate: safeNullableRate(actualOutsiderPoint, favoriteSample),
    predictedGoalsPerMatch: predictedGoals / contexts.length,
    actualGoalsPerMatch: actualGoals / contexts.length,
    predictedOver25Rate: predictedOver25 / contexts.length,
    actualOver25Rate: actualOver25 / contexts.length,
  };
}

function nullableResidual(actual: number | null, predicted: number | null): number | null {
  if (actual === null || predicted === null) return null;
  return actual - predicted;
}

function nullableMinus(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

function buildResidualRecommendation(row: GroupStakeResidualRow): string {
  const pieces: string[] = [];

  if ((row.outsiderPointResidualVsBaseline ?? 0) >= 0.07) {
    pieces.push('booster l’outsider qui accroche');
  } else if ((row.outsiderPointResidualVsBaseline ?? 0) <= -0.07) {
    pieces.push('réduire l’outsider qui accroche');
  }

  if ((row.favoriteWinResidualVsBaseline ?? 0) <= -0.06) {
    pieces.push('pénaliser le favori');
  } else if ((row.favoriteWinResidualVsBaseline ?? 0) >= 0.06) {
    pieces.push('renforcer le favori');
  }

  if (row.drawResidualVsBaseline >= 0.055) {
    pieces.push('augmenter les nuls par rapport au modèle');
  } else if (row.drawResidualVsBaseline <= -0.055) {
    pieces.push('réduire les nuls par rapport au modèle');
  }

  if (row.goalsResidualVsBaseline >= 0.28) {
    pieces.push('ouvrir les scores');
  } else if (row.goalsResidualVsBaseline <= -0.28) {
    pieces.push('fermer les scores');
  }

  if (row.over25ResidualVsBaseline >= 0.08) {
    pieces.push('augmenter la variance offensive');
  }

  if (pieces.length === 0) {
    return 'Écart résiduel faible : ne pas corriger fortement ce profil.';
  }

  return `${pieces.join(' · ')}.`;
}

function buildResidualRow(
  profileKey: GroupStakeProfileKey,
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings,
  baselineRaw?: ResidualRawMetrics
): GroupStakeResidualRow {
  const metadata = PROFILE_METADATA[profileKey];
  const raw = computeResidualRawMetrics(contexts, allMatches, settings);

  const homeWinResidual = raw.actualHomeWinRate - raw.predictedHomeWinRate;
  const drawResidual = raw.actualDrawRate - raw.predictedDrawRate;
  const awayWinResidual = raw.actualAwayWinRate - raw.predictedAwayWinRate;
  const favoriteWinResidual = nullableResidual(
    raw.actualFavoriteWinRate,
    raw.predictedFavoriteWinRate
  );
  const outsiderWinResidual = nullableResidual(
    raw.actualOutsiderWinRate,
    raw.predictedOutsiderWinRate
  );
  const outsiderPointResidual = nullableResidual(
    raw.actualOutsiderPointRate,
    raw.predictedOutsiderPointRate
  );
  const goalsResidual = raw.actualGoalsPerMatch - raw.predictedGoalsPerMatch;
  const over25Residual = raw.actualOver25Rate - raw.predictedOver25Rate;

  const baselineDrawResidual = baselineRaw
    ? baselineRaw.actualDrawRate - baselineRaw.predictedDrawRate
    : drawResidual;
  const baselineFavoriteWinResidual = baselineRaw
    ? nullableResidual(baselineRaw.actualFavoriteWinRate, baselineRaw.predictedFavoriteWinRate)
    : favoriteWinResidual;
  const baselineOutsiderWinResidual = baselineRaw
    ? nullableResidual(baselineRaw.actualOutsiderWinRate, baselineRaw.predictedOutsiderWinRate)
    : outsiderWinResidual;
  const baselineOutsiderPointResidual = baselineRaw
    ? nullableResidual(baselineRaw.actualOutsiderPointRate, baselineRaw.predictedOutsiderPointRate)
    : outsiderPointResidual;
  const baselineGoalsResidual = baselineRaw
    ? baselineRaw.actualGoalsPerMatch - baselineRaw.predictedGoalsPerMatch
    : goalsResidual;
  const baselineOver25Residual = baselineRaw
    ? baselineRaw.actualOver25Rate - baselineRaw.predictedOver25Rate
    : over25Residual;

  const favoriteWinResidualVsBaseline = nullableMinus(
    favoriteWinResidual,
    baselineFavoriteWinResidual
  );
  const outsiderWinResidualVsBaseline = nullableMinus(
    outsiderWinResidual,
    baselineOutsiderWinResidual
  );
  const outsiderPointResidualVsBaseline = nullableMinus(
    outsiderPointResidual,
    baselineOutsiderPointResidual
  );

  const favoritePenaltyCorrection = clamp(
    -(favoriteWinResidualVsBaseline ?? 0),
    -0.12,
    0.18
  );
  const outsiderPointBoostCorrection = clamp(
    ((outsiderPointResidualVsBaseline ?? 0) + 0.02) / 0.12,
    -0.35,
    0.65
  );
  const drawCorrection = clamp(drawResidual - baselineDrawResidual, -0.12, 0.14);
  const goalsMultiplierCorrection = clamp(
    raw.predictedGoalsPerMatch > 0
      ? raw.actualGoalsPerMatch / raw.predictedGoalsPerMatch
      : 1,
    0.82,
    1.25
  );
  const varianceBoostCorrection = clamp(
    over25Residual - baselineOver25Residual,
    -0.16,
    0.22
  );

  const row: GroupStakeResidualRow = {
    profileKey,
    label: metadata.label,
    description: metadata.description,
    sampleSize: raw.sampleSize,
    favoriteSampleSize: raw.favoriteSampleSize,
    confidence: getConfidence(raw.sampleSize),
    predictedHomeWinRate: raw.predictedHomeWinRate,
    actualHomeWinRate: raw.actualHomeWinRate,
    homeWinResidual,
    predictedDrawRate: raw.predictedDrawRate,
    actualDrawRate: raw.actualDrawRate,
    drawResidual,
    drawResidualVsBaseline: drawResidual - baselineDrawResidual,
    predictedAwayWinRate: raw.predictedAwayWinRate,
    actualAwayWinRate: raw.actualAwayWinRate,
    awayWinResidual,
    predictedFavoriteWinRate: raw.predictedFavoriteWinRate,
    actualFavoriteWinRate: raw.actualFavoriteWinRate,
    favoriteWinResidual,
    favoriteWinResidualVsBaseline,
    predictedOutsiderWinRate: raw.predictedOutsiderWinRate,
    actualOutsiderWinRate: raw.actualOutsiderWinRate,
    outsiderWinResidual,
    outsiderWinResidualVsBaseline,
    predictedOutsiderPointRate: raw.predictedOutsiderPointRate,
    actualOutsiderPointRate: raw.actualOutsiderPointRate,
    outsiderPointResidual,
    outsiderPointResidualVsBaseline,
    predictedGoalsPerMatch: raw.predictedGoalsPerMatch,
    actualGoalsPerMatch: raw.actualGoalsPerMatch,
    goalsResidual,
    goalsResidualVsBaseline: goalsResidual - baselineGoalsResidual,
    predictedOver25Rate: raw.predictedOver25Rate,
    actualOver25Rate: raw.actualOver25Rate,
    over25Residual,
    over25ResidualVsBaseline: over25Residual - baselineOver25Residual,
    favoritePenaltyCorrection,
    outsiderPointBoostCorrection,
    drawCorrection,
    goalsMultiplierCorrection,
    varianceBoostCorrection,
    recommendation: '',
  };

  return {
    ...row,
    recommendation: buildResidualRecommendation(row),
  };
}

export function buildGroupStakeResidualReport(
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings
): GroupStakeResidualReport {
  const stakeContexts = contexts.filter((context) => context.stageCategory !== 'qualification');
  const groups = new Map<GroupStakeProfileKey, ResidualAccumulator>();

  for (const profileKey of Object.keys(PROFILE_METADATA) as GroupStakeProfileKey[]) {
    groups.set(profileKey, {
      profileKey,
      contexts: [],
    });
  }

  for (const context of stakeContexts) {
    const key = getProfileKey(context);
    groups.get(key)?.contexts.push(context);
  }

  const baselineContexts = groups.get('baseline_non_final')?.contexts ?? [];
  const fallbackBaselineContexts = stakeContexts.filter((context) => !context.isFinalGroupMatchday);
  const effectiveBaselineContexts = baselineContexts.length > 0 ? baselineContexts : fallbackBaselineContexts;
  const baselineRaw = computeResidualRawMetrics(effectiveBaselineContexts, allMatches, settings);

  const baseline = buildResidualRow(
    'baseline_non_final',
    effectiveBaselineContexts,
    allMatches,
    settings
  );

  const rows = (Object.keys(PROFILE_METADATA) as GroupStakeProfileKey[])
    .filter((key) => key !== 'baseline_non_final')
    .map((key) =>
      buildResidualRow(key, groups.get(key)?.contexts ?? [], allMatches, settings, baselineRaw)
    )
    .sort((a, b) => {
      const aSignal = Math.abs(a.outsiderPointResidualVsBaseline ?? 0) + Math.abs(a.favoriteWinResidualVsBaseline ?? 0) + Math.abs(a.goalsResidualVsBaseline) / 4;
      const bSignal = Math.abs(b.outsiderPointResidualVsBaseline ?? 0) + Math.abs(b.favoriteWinResidualVsBaseline ?? 0) + Math.abs(b.goalsResidualVsBaseline) / 4;
      if (bSignal !== aSignal) return bSignal - aSignal;
      return b.sampleSize - a.sampleSize;
    });

  return {
    generatedAt: new Date().toISOString(),
    modelLabel: `${settings.scoreModel ?? 'modèle courant'} · ${settings.scoreTemperature ?? 1} temp`,
    baseline,
    rows,
  };
}

export function exportGroupStakeResidualsCsv(report: GroupStakeResidualReport): string {
  const headers = [
    'profile_key',
    'label',
    'sample_size',
    'favorite_sample_size',
    'confidence',
    'predicted_favorite_win_rate',
    'actual_favorite_win_rate',
    'favorite_win_residual',
    'favorite_win_residual_vs_baseline',
    'predicted_outsider_point_rate',
    'actual_outsider_point_rate',
    'outsider_point_residual',
    'outsider_point_residual_vs_baseline',
    'predicted_draw_rate',
    'actual_draw_rate',
    'draw_residual',
    'draw_residual_vs_baseline',
    'predicted_goals_per_match',
    'actual_goals_per_match',
    'goals_residual',
    'goals_residual_vs_baseline',
    'predicted_over25_rate',
    'actual_over25_rate',
    'over25_residual',
    'over25_residual_vs_baseline',
    'favorite_penalty_correction',
    'outsider_point_boost_correction',
    'draw_correction',
    'goals_multiplier_correction',
    'variance_boost_correction',
    'recommendation',
  ];

  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = [report.baseline, ...report.rows].map((row) => [
    row.profileKey,
    row.label,
    row.sampleSize,
    row.favoriteSampleSize,
    row.confidence,
    row.predictedFavoriteWinRate ?? '',
    row.actualFavoriteWinRate ?? '',
    row.favoriteWinResidual ?? '',
    row.favoriteWinResidualVsBaseline ?? '',
    row.predictedOutsiderPointRate ?? '',
    row.actualOutsiderPointRate ?? '',
    row.outsiderPointResidual ?? '',
    row.outsiderPointResidualVsBaseline ?? '',
    row.predictedDrawRate,
    row.actualDrawRate,
    row.drawResidual,
    row.drawResidualVsBaseline,
    row.predictedGoalsPerMatch,
    row.actualGoalsPerMatch,
    row.goalsResidual,
    row.goalsResidualVsBaseline,
    row.predictedOver25Rate,
    row.actualOver25Rate,
    row.over25Residual,
    row.over25ResidualVsBaseline,
    row.favoritePenaltyCorrection,
    row.outsiderPointBoostCorrection,
    row.drawCorrection,
    row.goalsMultiplierCorrection,
    row.varianceBoostCorrection,
    row.recommendation,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
}

const FIRST_MATCH_PROFILE_METADATA: Record<FirstMatchEffectProfileKey, { label: string; description: string }> = {
  all_j2: {
    label: 'Référence J2 globale',
    description: 'Tous les matchs de deuxième journée reconstruits. Sert de base pour isoler l’effet du résultat J1.',
  },
  winner_vs_loser: {
    label: 'Gagnant J1 vs perdant J1',
    description: 'Une équipe arrive avec 3 points, l’autre avec 0 point après le premier match.',
  },
  both_won_j1: {
    label: 'Deux équipes ont gagné J1',
    description: 'Les deux équipes ont commencé par une victoire et peuvent gérer leur avance.',
  },
  both_lost_j1: {
    label: 'Deux équipes ont perdu J1',
    description: 'Les deux équipes sont déjà sous pression après une défaite initiale.',
  },
  both_drew_j1: {
    label: 'Deux équipes ont fait nul J1',
    description: 'Les deux équipes sortent d’un nul et cherchent à se placer avant la dernière journée.',
  },
  favorite_won_j1: {
    label: 'Favori a gagné J1',
    description: 'Le favori du modèle arrive avec 3 points après son premier match.',
  },
  favorite_drew_j1: {
    label: 'Favori a fait nul J1',
    description: 'Le favori du modèle a seulement pris un point lors du premier match.',
  },
  favorite_lost_j1: {
    label: 'Favori a perdu J1',
    description: 'Le favori du modèle arrive sous pression après une défaite initiale.',
  },
  outsider_won_favorite_not_won: {
    label: 'Outsider en confiance vs favori accroché',
    description: 'L’outsider a gagné J1 tandis que le favori n’a pas gagné son premier match.',
  },
  at_least_one_zero_point: {
    label: 'Au moins une équipe à 0 point',
    description: 'Une équipe ou les deux arrivent avec une défaite initiale.',
  },
  at_least_one_three_point: {
    label: 'Au moins une équipe à 3 points',
    description: 'Une équipe ou les deux arrivent après une victoire initiale.',
  },
};

type FirstMatchStatus = 'won' | 'drawn' | 'lost';

type FirstMatchAccumulator = {
  profileKey: FirstMatchEffectProfileKey;
  contexts: GroupMatchContext[];
};

function getFirstMatchStatus(pointsBefore: number): FirstMatchStatus {
  if (pointsBefore >= 3) return 'won';
  if (pointsBefore === 1) return 'drawn';
  return 'lost';
}

function getPredictedFavoriteSide(
  context: GroupMatchContext,
  allMatches: MatchResult[],
  settings: ModelSettings
): 'home' | 'away' | null {
  const prediction = predictScoreDistribution(
    context.homeTeam,
    context.awayTeam,
    allMatches,
    settings,
    {
      neutral: context.sourceMatch.neutral,
      teamAIsHome: true,
      tournament: context.sourceMatch.tournament,
      predictionDate: context.date,
    }
  );

  const gap = Math.abs(prediction.outcomes.teamAWin - prediction.outcomes.teamBWin);
  if (gap < 0.035) return null;
  return prediction.outcomes.teamAWin >= prediction.outcomes.teamBWin ? 'home' : 'away';
}

function addFirstMatchContext(
  groups: Map<FirstMatchEffectProfileKey, FirstMatchAccumulator>,
  key: FirstMatchEffectProfileKey,
  context: GroupMatchContext
): void {
  groups.get(key)?.contexts.push(context);
}

function buildFirstMatchRecommendation(row: FirstMatchEffectRow): string {
  const pieces: string[] = [];

  if ((row.outsiderPointResidualVsBaseline ?? 0) >= 0.07) {
    pieces.push('outsider plus accrocheur que prévu après J1');
  } else if ((row.outsiderPointResidualVsBaseline ?? 0) <= -0.07) {
    pieces.push('outsider moins accrocheur que prévu après J1');
  }

  if ((row.favoriteWinResidualVsBaseline ?? 0) >= 0.06) {
    pieces.push('renforcer le favori sur ce profil J2');
  } else if ((row.favoriteWinResidualVsBaseline ?? 0) <= -0.06) {
    pieces.push('pénaliser le favori sur ce profil J2');
  }

  if (row.drawResidualVsBaseline >= 0.05) {
    pieces.push('augmenter les nuls');
  } else if (row.drawResidualVsBaseline <= -0.05) {
    pieces.push('réduire les nuls');
  }

  if (row.goalsResidualVsBaseline >= 0.22) {
    pieces.push('ouvrir les scores');
  } else if (row.goalsResidualVsBaseline <= -0.22) {
    pieces.push('fermer les scores');
  }

  if (row.over25ResidualVsBaseline >= 0.075) {
    pieces.push('plus de variance offensive');
  } else if (row.over25ResidualVsBaseline <= -0.075) {
    pieces.push('moins de variance offensive');
  }

  if (row.sampleSize < 20) {
    pieces.push('échantillon faible, correction prudente');
  }

  if (pieces.length === 0) {
    return 'Écart faible : le résultat du premier match ne justifie pas une grosse correction ici.';
  }

  return `${pieces.join(' · ')}.`;
}

function buildFirstMatchEffectRow(
  profileKey: FirstMatchEffectProfileKey,
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings,
  baselineRaw?: ResidualRawMetrics
): FirstMatchEffectRow {
  const metadata = FIRST_MATCH_PROFILE_METADATA[profileKey];
  const raw = computeResidualRawMetrics(contexts, allMatches, settings);

  const homeWinResidual = raw.actualHomeWinRate - raw.predictedHomeWinRate;
  const drawResidual = raw.actualDrawRate - raw.predictedDrawRate;
  const awayWinResidual = raw.actualAwayWinRate - raw.predictedAwayWinRate;
  const favoriteWinResidual = nullableResidual(
    raw.actualFavoriteWinRate,
    raw.predictedFavoriteWinRate
  );
  const outsiderWinResidual = nullableResidual(
    raw.actualOutsiderWinRate,
    raw.predictedOutsiderWinRate
  );
  const outsiderPointResidual = nullableResidual(
    raw.actualOutsiderPointRate,
    raw.predictedOutsiderPointRate
  );
  const goalsResidual = raw.actualGoalsPerMatch - raw.predictedGoalsPerMatch;
  const over25Residual = raw.actualOver25Rate - raw.predictedOver25Rate;

  const baselineDrawResidual = baselineRaw
    ? baselineRaw.actualDrawRate - baselineRaw.predictedDrawRate
    : drawResidual;
  const baselineFavoriteWinResidual = baselineRaw
    ? nullableResidual(baselineRaw.actualFavoriteWinRate, baselineRaw.predictedFavoriteWinRate)
    : favoriteWinResidual;
  const baselineOutsiderWinResidual = baselineRaw
    ? nullableResidual(baselineRaw.actualOutsiderWinRate, baselineRaw.predictedOutsiderWinRate)
    : outsiderWinResidual;
  const baselineOutsiderPointResidual = baselineRaw
    ? nullableResidual(baselineRaw.actualOutsiderPointRate, baselineRaw.predictedOutsiderPointRate)
    : outsiderPointResidual;
  const baselineGoalsResidual = baselineRaw
    ? baselineRaw.actualGoalsPerMatch - baselineRaw.predictedGoalsPerMatch
    : goalsResidual;
  const baselineOver25Residual = baselineRaw
    ? baselineRaw.actualOver25Rate - baselineRaw.predictedOver25Rate
    : over25Residual;

  const favoriteWinResidualVsBaseline = nullableMinus(
    favoriteWinResidual,
    baselineFavoriteWinResidual
  );
  const outsiderWinResidualVsBaseline = nullableMinus(
    outsiderWinResidual,
    baselineOutsiderWinResidual
  );
  const outsiderPointResidualVsBaseline = nullableMinus(
    outsiderPointResidual,
    baselineOutsiderPointResidual
  );

  const favoritePenaltyCorrection = clamp(
    -(favoriteWinResidualVsBaseline ?? 0),
    -0.1,
    0.14
  );
  const outsiderPointBoostCorrection = clamp(
    ((outsiderPointResidualVsBaseline ?? 0) + 0.015) / 0.14,
    -0.28,
    0.45
  );
  const drawCorrection = clamp(drawResidual - baselineDrawResidual, -0.1, 0.12);
  const goalsMultiplierCorrection = clamp(
    raw.predictedGoalsPerMatch > 0
      ? raw.actualGoalsPerMatch / raw.predictedGoalsPerMatch
      : 1,
    0.84,
    1.22
  );
  const varianceBoostCorrection = clamp(
    over25Residual - baselineOver25Residual,
    -0.14,
    0.18
  );

  const row: FirstMatchEffectRow = {
    profileKey,
    label: metadata.label,
    description: metadata.description,
    sampleSize: raw.sampleSize,
    favoriteSampleSize: raw.favoriteSampleSize,
    confidence: getConfidence(raw.sampleSize),
    predictedHomeWinRate: raw.predictedHomeWinRate,
    actualHomeWinRate: raw.actualHomeWinRate,
    homeWinResidual,
    predictedDrawRate: raw.predictedDrawRate,
    actualDrawRate: raw.actualDrawRate,
    drawResidual,
    drawResidualVsBaseline: drawResidual - baselineDrawResidual,
    predictedAwayWinRate: raw.predictedAwayWinRate,
    actualAwayWinRate: raw.actualAwayWinRate,
    awayWinResidual,
    predictedFavoriteWinRate: raw.predictedFavoriteWinRate,
    actualFavoriteWinRate: raw.actualFavoriteWinRate,
    favoriteWinResidual,
    favoriteWinResidualVsBaseline,
    predictedOutsiderWinRate: raw.predictedOutsiderWinRate,
    actualOutsiderWinRate: raw.actualOutsiderWinRate,
    outsiderWinResidual,
    outsiderWinResidualVsBaseline,
    predictedOutsiderPointRate: raw.predictedOutsiderPointRate,
    actualOutsiderPointRate: raw.actualOutsiderPointRate,
    outsiderPointResidual,
    outsiderPointResidualVsBaseline,
    predictedGoalsPerMatch: raw.predictedGoalsPerMatch,
    actualGoalsPerMatch: raw.actualGoalsPerMatch,
    goalsResidual,
    goalsResidualVsBaseline: goalsResidual - baselineGoalsResidual,
    predictedOver25Rate: raw.predictedOver25Rate,
    actualOver25Rate: raw.actualOver25Rate,
    over25Residual,
    over25ResidualVsBaseline: over25Residual - baselineOver25Residual,
    favoritePenaltyCorrection,
    outsiderPointBoostCorrection,
    drawCorrection,
    goalsMultiplierCorrection,
    varianceBoostCorrection,
    recommendation: '',
  };

  return {
    ...row,
    recommendation: buildFirstMatchRecommendation(row),
  };
}

export function buildFirstMatchEffectReport(
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings
): FirstMatchEffectReport {
  const finalContexts = contexts.filter((context) => context.stageCategory !== 'qualification');
  const j2Contexts = finalContexts.filter(
    (context) =>
      context.matchday === 2 &&
      context.homeBefore.played === 1 &&
      context.awayBefore.played === 1
  );

  const groups = new Map<FirstMatchEffectProfileKey, FirstMatchAccumulator>();
  for (const profileKey of Object.keys(FIRST_MATCH_PROFILE_METADATA) as FirstMatchEffectProfileKey[]) {
    groups.set(profileKey, { profileKey, contexts: [] });
  }

  for (const context of j2Contexts) {
    addFirstMatchContext(groups, 'all_j2', context);

    const homeStatus = getFirstMatchStatus(context.homeBefore.points);
    const awayStatus = getFirstMatchStatus(context.awayBefore.points);
    const statuses = [homeStatus, awayStatus];

    if (statuses.includes('won') && statuses.includes('lost')) {
      addFirstMatchContext(groups, 'winner_vs_loser', context);
    }
    if (homeStatus === 'won' && awayStatus === 'won') {
      addFirstMatchContext(groups, 'both_won_j1', context);
    }
    if (homeStatus === 'lost' && awayStatus === 'lost') {
      addFirstMatchContext(groups, 'both_lost_j1', context);
    }
    if (homeStatus === 'drawn' && awayStatus === 'drawn') {
      addFirstMatchContext(groups, 'both_drew_j1', context);
    }
    if (statuses.includes('lost')) {
      addFirstMatchContext(groups, 'at_least_one_zero_point', context);
    }
    if (statuses.includes('won')) {
      addFirstMatchContext(groups, 'at_least_one_three_point', context);
    }

    const favoriteSide = getPredictedFavoriteSide(context, allMatches, settings);
    if (!favoriteSide) continue;

    const favoriteStatus = favoriteSide === 'home' ? homeStatus : awayStatus;
    const outsiderStatus = favoriteSide === 'home' ? awayStatus : homeStatus;

    if (favoriteStatus === 'won') {
      addFirstMatchContext(groups, 'favorite_won_j1', context);
    } else if (favoriteStatus === 'drawn') {
      addFirstMatchContext(groups, 'favorite_drew_j1', context);
    } else {
      addFirstMatchContext(groups, 'favorite_lost_j1', context);
    }

    if (outsiderStatus === 'won' && favoriteStatus !== 'won') {
      addFirstMatchContext(groups, 'outsider_won_favorite_not_won', context);
    }
  }

  const baselineContexts = groups.get('all_j2')?.contexts ?? [];
  const baselineRaw = computeResidualRawMetrics(baselineContexts, allMatches, settings);
  const baseline = buildFirstMatchEffectRow('all_j2', baselineContexts, allMatches, settings);

  const rows = (Object.keys(FIRST_MATCH_PROFILE_METADATA) as FirstMatchEffectProfileKey[])
    .filter((key) => key !== 'all_j2')
    .map((key) =>
      buildFirstMatchEffectRow(key, groups.get(key)?.contexts ?? [], allMatches, settings, baselineRaw)
    )
    .sort((a, b) => {
      const aSignal =
        Math.abs(a.outsiderPointResidualVsBaseline ?? 0) +
        Math.abs(a.favoriteWinResidualVsBaseline ?? 0) +
        Math.abs(a.drawResidualVsBaseline) +
        Math.abs(a.goalsResidualVsBaseline) / 4;
      const bSignal =
        Math.abs(b.outsiderPointResidualVsBaseline ?? 0) +
        Math.abs(b.favoriteWinResidualVsBaseline ?? 0) +
        Math.abs(b.drawResidualVsBaseline) +
        Math.abs(b.goalsResidualVsBaseline) / 4;
      if (bSignal !== aSignal) return bSignal - aSignal;
      return b.sampleSize - a.sampleSize;
    });

  return {
    generatedAt: new Date().toISOString(),
    modelLabel: `${settings.scoreModel ?? 'modèle courant'} · ${settings.scoreTemperature ?? 1} temp`,
    baseline,
    rows,
  };
}

export function exportFirstMatchEffectReportCsv(report: FirstMatchEffectReport): string {
  const headers = [
    'profile_key',
    'label',
    'sample_size',
    'favorite_sample_size',
    'confidence',
    'predicted_favorite_win_rate',
    'actual_favorite_win_rate',
    'favorite_win_residual',
    'favorite_win_residual_vs_baseline_j2',
    'predicted_outsider_point_rate',
    'actual_outsider_point_rate',
    'outsider_point_residual',
    'outsider_point_residual_vs_baseline_j2',
    'predicted_draw_rate',
    'actual_draw_rate',
    'draw_residual',
    'draw_residual_vs_baseline_j2',
    'predicted_goals_per_match',
    'actual_goals_per_match',
    'goals_residual',
    'goals_residual_vs_baseline_j2',
    'predicted_over25_rate',
    'actual_over25_rate',
    'over25_residual',
    'over25_residual_vs_baseline_j2',
    'favorite_penalty_correction',
    'outsider_point_boost_correction',
    'draw_correction',
    'goals_multiplier_correction',
    'variance_boost_correction',
    'recommendation',
  ];

  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = [report.baseline, ...report.rows].map((row) => [
    row.profileKey,
    row.label,
    row.sampleSize,
    row.favoriteSampleSize,
    row.confidence,
    row.predictedFavoriteWinRate ?? '',
    row.actualFavoriteWinRate ?? '',
    row.favoriteWinResidual ?? '',
    row.favoriteWinResidualVsBaseline ?? '',
    row.predictedOutsiderPointRate ?? '',
    row.actualOutsiderPointRate ?? '',
    row.outsiderPointResidual ?? '',
    row.outsiderPointResidualVsBaseline ?? '',
    row.predictedDrawRate,
    row.actualDrawRate,
    row.drawResidual,
    row.drawResidualVsBaseline,
    row.predictedGoalsPerMatch,
    row.actualGoalsPerMatch,
    row.goalsResidual,
    row.goalsResidualVsBaseline,
    row.predictedOver25Rate,
    row.actualOver25Rate,
    row.over25Residual,
    row.over25ResidualVsBaseline,
    row.favoritePenaltyCorrection,
    row.outsiderPointBoostCorrection,
    row.drawCorrection,
    row.goalsMultiplierCorrection,
    row.varianceBoostCorrection,
    row.recommendation,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
}

type HistoricalBacktestOutcome = 'home' | 'draw' | 'away';

type HistoricalBacktestRowInternal = {
  context: GroupMatchContext;
  profileKey: string;
  profileLabel: string;
  basePrediction: MatchPrediction;
  contextualPrediction: MatchPrediction;
};

function safeLogLoss(probability: number): number {
  return -Math.log(Math.max(0.000001, probability));
}

function getContextBacktestOutcome(homeGoals: number, awayGoals: number): HistoricalBacktestOutcome {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

function getOutcomeProbabilityFromPrediction(prediction: MatchPrediction, outcome: HistoricalBacktestOutcome): number {
  if (outcome === 'home') return prediction.outcomes.teamAWin;
  if (outcome === 'away') return prediction.outcomes.teamBWin;
  return prediction.outcomes.draw;
}

function getPredictedOutcomeFromPrediction(prediction: MatchPrediction): HistoricalBacktestOutcome {
  const entries: Array<{ outcome: HistoricalBacktestOutcome; probability: number }> = [
    { outcome: 'home', probability: prediction.outcomes.teamAWin },
    { outcome: 'draw', probability: prediction.outcomes.draw },
    { outcome: 'away', probability: prediction.outcomes.teamBWin },
  ];

  return entries.sort((a, b) => b.probability - a.probability)[0].outcome;
}

function getActualScoreProbabilityFromPrediction(
  prediction: MatchPrediction,
  homeGoals: number,
  awayGoals: number
): number {
  return prediction.distribution.find(
    (score) => score.homeGoals === homeGoals && score.awayGoals === awayGoals
  )?.probability ?? 0;
}

function computeContextBrierScore(prediction: MatchPrediction, actualOutcome: HistoricalBacktestOutcome): number {
  const targets = {
    home: actualOutcome === 'home' ? 1 : 0,
    draw: actualOutcome === 'draw' ? 1 : 0,
    away: actualOutcome === 'away' ? 1 : 0,
  };

  return (
    (prediction.outcomes.teamAWin - targets.home) ** 2 +
    (prediction.outcomes.draw - targets.draw) ** 2 +
    (prediction.outcomes.teamBWin - targets.away) ** 2
  );
}

function buildHistoricalMetrics(
  rows: HistoricalBacktestRowInternal[],
  predictionSelector: (row: HistoricalBacktestRowInternal) => MatchPrediction
): HistoricalContextBacktestMetrics {
  if (rows.length === 0) {
    return {
      testedMatches: 0,
      outcomeAccuracy: 0,
      exactTop1Accuracy: 0,
      exactTop5Accuracy: 0,
      averageActualOutcomeProbability: 0,
      averageActualScoreProbability: 0,
      averageResultLogLoss: 0,
      averageBrierScore: 0,
      predictedDrawShare: 0,
      actualDrawShare: 0,
      drawPredictionGap: 0,
      predictedGoalsPerMatch: 0,
      actualGoalsPerMatch: 0,
      averageGoalsError: 0,
    };
  }

  let outcomeHits = 0;
  let exactTop1Hits = 0;
  let exactTop5Hits = 0;
  let actualOutcomeProbability = 0;
  let actualScoreProbability = 0;
  let resultLogLoss = 0;
  let brier = 0;
  let predictedDrawShare = 0;
  let actualDrawShare = 0;
  let predictedGoals = 0;
  let actualGoals = 0;
  let goalsError = 0;

  for (const row of rows) {
    const prediction = predictionSelector(row);
    const actualOutcome = getContextBacktestOutcome(row.context.homeScore, row.context.awayScore);
    const predictedOutcome = getPredictedOutcomeFromPrediction(prediction);
    const topScore = prediction.topScores[0];
    const actualOutcomeProb = getOutcomeProbabilityFromPrediction(prediction, actualOutcome);
    const actualScoreProb = getActualScoreProbabilityFromPrediction(
      prediction,
      row.context.homeScore,
      row.context.awayScore
    );
    const predictedGoalTotal = prediction.expectedGoalsA + prediction.expectedGoalsB;
    const actualGoalTotal = row.context.homeScore + row.context.awayScore;

    if (predictedOutcome === actualOutcome) outcomeHits += 1;
    if (topScore?.homeGoals === row.context.homeScore && topScore.awayGoals === row.context.awayScore) {
      exactTop1Hits += 1;
    }
    if (prediction.topScores.some((score) => score.homeGoals === row.context.homeScore && score.awayGoals === row.context.awayScore)) {
      exactTop5Hits += 1;
    }

    actualOutcomeProbability += actualOutcomeProb;
    actualScoreProbability += actualScoreProb;
    resultLogLoss += safeLogLoss(actualOutcomeProb);
    brier += computeContextBrierScore(prediction, actualOutcome);
    predictedDrawShare += prediction.outcomes.draw;
    if (actualOutcome === 'draw') actualDrawShare += 1;
    predictedGoals += predictedGoalTotal;
    actualGoals += actualGoalTotal;
    goalsError += Math.abs(predictedGoalTotal - actualGoalTotal);
  }

  const n = rows.length;

  return {
    testedMatches: n,
    outcomeAccuracy: outcomeHits / n,
    exactTop1Accuracy: exactTop1Hits / n,
    exactTop5Accuracy: exactTop5Hits / n,
    averageActualOutcomeProbability: actualOutcomeProbability / n,
    averageActualScoreProbability: actualScoreProbability / n,
    averageResultLogLoss: resultLogLoss / n,
    averageBrierScore: brier / n,
    predictedDrawShare: predictedDrawShare / n,
    actualDrawShare: actualDrawShare / n,
    drawPredictionGap: predictedDrawShare / n - actualDrawShare / n,
    predictedGoalsPerMatch: predictedGoals / n,
    actualGoalsPerMatch: actualGoals / n,
    averageGoalsError: goalsError / n,
  };
}

function getHistoricalAdjustmentDefaults(
  profileKey: string,
  confidence: GroupStakePredictionAdjustment['confidence']
): Omit<GroupStakePredictionAdjustment, 'profileKey' | 'label' | 'active' | 'confidence' | 'reasons'> {
  const confidenceScale = confidence === 'high' ? 1 : confidence === 'medium' ? 0.72 : 0.42;
  const scale = (value: number) => value * confidenceScale;

  switch (profileKey) {
    case 'j2_both_won':
      return {
        favoritePenaltyCorrection: scale(0.08),
        outsiderPointBoostCorrection: scale(0.16),
        drawCorrection: scale(0.08),
        goalsMultiplierCorrection: 1 - scale(0.07),
        varianceBoostCorrection: scale(-0.02),
      };
    case 'j2_both_drew':
      return {
        favoritePenaltyCorrection: scale(0.02),
        outsiderPointBoostCorrection: scale(0.02),
        drawCorrection: scale(0.10),
        goalsMultiplierCorrection: 1 - scale(0.02),
        varianceBoostCorrection: scale(-0.03),
      };
    case 'j2_both_lost':
      return {
        favoritePenaltyCorrection: 0,
        outsiderPointBoostCorrection: 0,
        drawCorrection: scale(-0.06),
        goalsMultiplierCorrection: 1 + scale(0.07),
        varianceBoostCorrection: scale(0.07),
      };
    case 'j2_winner_vs_loser':
      return {
        favoritePenaltyCorrection: 0,
        outsiderPointBoostCorrection: scale(-0.03),
        drawCorrection: 0,
        goalsMultiplierCorrection: 1 + scale(0.04),
        varianceBoostCorrection: scale(0.02),
      };
    case 'safe_vs_must_win':
      return {
        favoritePenaltyCorrection: scale(0.14),
        outsiderPointBoostCorrection: scale(0.42),
        drawCorrection: scale(-0.04),
        goalsMultiplierCorrection: 1,
        varianceBoostCorrection: scale(0.02),
      };
    case 'rotation_risk':
      return {
        favoritePenaltyCorrection: scale(0.10),
        outsiderPointBoostCorrection: scale(0.28),
        drawCorrection: scale(0.05),
        goalsMultiplierCorrection: 1 - scale(0.10),
        varianceBoostCorrection: scale(-0.06),
      };
    case 'draw_suits_both':
      return {
        favoritePenaltyCorrection: scale(0.08),
        outsiderPointBoostCorrection: scale(0.20),
        drawCorrection: scale(0.06),
        goalsMultiplierCorrection: 1 - scale(0.12),
        varianceBoostCorrection: scale(-0.05),
      };
    case 'one_team_must_win':
      return {
        favoritePenaltyCorrection: scale(0.01),
        outsiderPointBoostCorrection: scale(0.06),
        drawCorrection: scale(-0.08),
        goalsMultiplierCorrection: 1 + scale(0.14),
        varianceBoostCorrection: scale(0.10),
      };
    case 'both_need_result':
      return {
        favoritePenaltyCorrection: scale(-0.04),
        outsiderPointBoostCorrection: scale(-0.08),
        drawCorrection: scale(-0.05),
        goalsMultiplierCorrection: 1 + scale(0.14),
        varianceBoostCorrection: scale(0.10),
      };
    case 'dead_rubber':
      return {
        favoritePenaltyCorrection: scale(-0.05),
        outsiderPointBoostCorrection: scale(-0.18),
        drawCorrection: scale(-0.07),
        goalsMultiplierCorrection: 1 - scale(0.04),
        varianceBoostCorrection: 0,
      };
    default:
      return {
        favoritePenaltyCorrection: 0,
        outsiderPointBoostCorrection: 0,
        drawCorrection: 0,
        goalsMultiplierCorrection: 1,
        varianceBoostCorrection: 0,
      };
  }
}

function getHistoricalAdjustmentConfidence(profileKey: string): GroupStakePredictionAdjustment['confidence'] {
  if (profileKey === 'j2_winner_vs_loser' || profileKey === 'one_team_must_win' || profileKey === 'draw_suits_both') {
    return 'high';
  }
  if (profileKey === 'both_need_result' || profileKey === 'standard_final_day') {
    return 'low';
  }
  return 'medium';
}

function makeHistoricalPredictionAdjustment(
  profileKey: string,
  label: string,
  active: boolean,
  confidence: GroupStakePredictionAdjustment['confidence'],
  reasons: string[]
): GroupStakePredictionAdjustment {
  return {
    profileKey,
    label,
    active,
    confidence,
    reasons,
    ...getHistoricalAdjustmentDefaults(profileKey, confidence),
  };
}

function getHistoricalContextAdjustment(context: GroupMatchContext): GroupStakePredictionAdjustment | null {
  const reasons = [
    `${context.homeTeam} : ${context.homeBefore.points} pts avant match`,
    `${context.awayTeam} : ${context.awayBefore.points} pts avant match`,
  ];

  if (
    context.matchday === 2 &&
    !context.isFinalGroupMatchday &&
    context.homeBefore.played === 1 &&
    context.awayBefore.played === 1
  ) {
    const homePoints = context.homeBefore.points;
    const awayPoints = context.awayBefore.points;

    if (homePoints === 3 && awayPoints === 3) {
      return makeHistoricalPredictionAdjustment('j2_both_won', 'J2 : deux équipes ont gagné J1', true, 'medium', reasons);
    }
    if (homePoints === 1 && awayPoints === 1) {
      return makeHistoricalPredictionAdjustment('j2_both_drew', 'J2 : deux équipes ont fait nul J1', true, 'medium', reasons);
    }
    if (homePoints === 0 && awayPoints === 0) {
      return makeHistoricalPredictionAdjustment('j2_both_lost', 'J2 : deux équipes ont perdu J1', true, 'medium', reasons);
    }
    if ((homePoints === 3 && awayPoints === 0) || (homePoints === 0 && awayPoints === 3)) {
      return makeHistoricalPredictionAdjustment('j2_winner_vs_loser', 'J2 : gagnant J1 vs perdant J1', true, 'high', reasons);
    }

    return makeHistoricalPredictionAdjustment('j2_no_signal', 'J2 : contexte J1 sans signal fort', false, 'high', reasons);
  }

  if (!context.isFinalGroupMatchday) {
    return null;
  }

  const profileKey = getProfileKey(context);
  const metadata = PROFILE_METADATA[profileKey];
  const active = profileKey !== 'standard_final_day' && profileKey !== 'baseline_non_final';
  const confidence = getHistoricalAdjustmentConfidence(profileKey);

  return makeHistoricalPredictionAdjustment(profileKey, metadata.label, active, confidence, reasons);
}

function buildHistoricalBacktestInternalRows(
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings
): HistoricalBacktestRowInternal[] {
  const backtestSettings: ModelSettings = {
    ...settings,
    maxGoals: Math.max(settings.maxGoals ?? 6, 8),
  };

  return contexts
    .filter((context) => context.stageCategory !== 'qualification')
    .map((context) => {
      const adjustment = getHistoricalContextAdjustment(context);
      if (!adjustment) return null;

      const predictionContext = {
        neutral: context.sourceMatch.neutral,
        teamAIsHome: true,
        tournament: context.sourceMatch.tournament,
        predictionDate: context.date,
      };

      const basePrediction = predictScoreDistribution(
        context.homeTeam,
        context.awayTeam,
        allMatches,
        backtestSettings,
        predictionContext
      );

      const contextualPrediction = predictScoreDistribution(
        context.homeTeam,
        context.awayTeam,
        allMatches,
        backtestSettings,
        {
          ...predictionContext,
          groupStakeAdjustment: adjustment,
        }
      );

      return {
        context,
        profileKey: adjustment.profileKey,
        profileLabel: adjustment.label,
        basePrediction,
        contextualPrediction,
      };
    })
    .filter((row): row is HistoricalBacktestRowInternal => Boolean(row));
}

function getHistoricalContextScopeLabel(scopeKey: string): { label: string; description: string } {
  const labels: Record<string, { label: string; description: string }> = {
    all_context_matches: {
      label: 'Tous les matchs J2/J3 contextualisables',
      description: 'Tous les matchs où la couche contexte peut être évaluée : J2 avec résultat J1 ou dernière journée de poule.',
    },
    j2_context_matches: {
      label: 'Tous les matchs de J2',
      description: 'Deuxième journée de groupe : effet du résultat du premier match.',
    },
    j3_context_matches: {
      label: 'Toutes les dernières journées',
      description: 'Dernière journée de groupe : enjeux de qualification, rotation, must-win et nul utile.',
    },
    j2_both_won: {
      label: 'J2 : deux équipes ont gagné J1',
      description: 'Les deux équipes ont 3 points avant leur deuxième match.',
    },
    j2_both_drew: {
      label: 'J2 : deux équipes ont fait nul J1',
      description: 'Les deux équipes ont 1 point avant leur deuxième match.',
    },
    j2_both_lost: {
      label: 'J2 : deux équipes ont perdu J1',
      description: 'Les deux équipes ont 0 point avant leur deuxième match.',
    },
    j2_winner_vs_loser: {
      label: 'J2 : gagnant J1 vs perdant J1',
      description: 'Une équipe arrive avec 3 points, l’autre avec 0 point.',
    },
    j2_no_signal: {
      label: 'J2 : signal faible',
      description: 'Deuxième journée sans profil J1 suffisamment marqué.',
    },
  };

  if (labels[scopeKey]) return labels[scopeKey];
  if ((PROFILE_METADATA as Record<string, { label: string; description: string }>)[scopeKey]) {
    return (PROFILE_METADATA as Record<string, { label: string; description: string }>)[scopeKey];
  }

  return { label: scopeKey, description: 'Profil de contexte historique.' };
}

function buildHistoricalContextBacktestRow(
  scopeKey: string,
  rows: HistoricalBacktestRowInternal[]
): HistoricalContextBacktestRow {
  const { label, description } = getHistoricalContextScopeLabel(scopeKey);
  const baseline = buildHistoricalMetrics(rows, (row) => row.basePrediction);
  const contextual = buildHistoricalMetrics(rows, (row) => row.contextualPrediction);
  const deltaOutcomeAccuracy = contextual.outcomeAccuracy - baseline.outcomeAccuracy;
  const deltaTop1Accuracy = contextual.exactTop1Accuracy - baseline.exactTop1Accuracy;
  const deltaTop5Accuracy = contextual.exactTop5Accuracy - baseline.exactTop5Accuracy;
  const deltaActualOutcomeProbability = contextual.averageActualOutcomeProbability - baseline.averageActualOutcomeProbability;
  const deltaActualScoreProbability = contextual.averageActualScoreProbability - baseline.averageActualScoreProbability;
  const deltaResultLogLoss = contextual.averageResultLogLoss - baseline.averageResultLogLoss;
  const deltaBrierScore = contextual.averageBrierScore - baseline.averageBrierScore;
  const deltaDrawGapAbs = Math.abs(contextual.drawPredictionGap) - Math.abs(baseline.drawPredictionGap);
  const deltaGoalsErrorAbs = contextual.averageGoalsError - baseline.averageGoalsError;

  const score =
    deltaOutcomeAccuracy * 2.4 +
    deltaTop5Accuracy * 1.1 +
    deltaActualOutcomeProbability * 2 +
    (-deltaResultLogLoss) * 0.9 +
    (-deltaBrierScore) * 0.75 +
    (-deltaDrawGapAbs) * 0.4;

  let verdict: HistoricalContextBacktestRow['verdict'] = 'neutral';
  if (score > 0.015) verdict = 'improved';
  else if (score < -0.015) verdict = 'worse';
  else if (
    Math.sign(deltaOutcomeAccuracy) !== Math.sign(-deltaResultLogLoss) &&
    (Math.abs(deltaOutcomeAccuracy) > 0.005 || Math.abs(deltaResultLogLoss) > 0.005)
  ) {
    verdict = 'mixed';
  }

  const pieces: string[] = [];
  if (deltaOutcomeAccuracy >= 0.01) pieces.push('meilleur 1/N/2');
  else if (deltaOutcomeAccuracy <= -0.01) pieces.push('moins bon 1/N/2');
  if (deltaTop5Accuracy >= 0.01) pieces.push('meilleur Top 5 score');
  else if (deltaTop5Accuracy <= -0.01) pieces.push('Top 5 score en baisse');
  if (deltaResultLogLoss <= -0.01) pieces.push('meilleure calibration résultat');
  else if (deltaResultLogLoss >= 0.01) pieces.push('logloss moins bon');
  if (deltaDrawGapAbs <= -0.01) pieces.push('écart de nuls réduit');
  else if (deltaDrawGapAbs >= 0.01) pieces.push('écart de nuls augmenté');
  if (rows.length < 30) pieces.push('échantillon faible');
  if (pieces.length === 0) pieces.push('effet faible');

  return {
    scopeKey,
    label,
    description,
    sampleSize: rows.length,
    contextTypes: [...new Set(rows.map((row) => row.profileLabel))].sort(),
    baseline,
    contextual,
    deltaOutcomeAccuracy,
    deltaTop1Accuracy,
    deltaTop5Accuracy,
    deltaActualOutcomeProbability,
    deltaActualScoreProbability,
    deltaResultLogLoss,
    deltaBrierScore,
    deltaDrawGapAbs,
    deltaGoalsErrorAbs,
    verdict,
    recommendation: `${verdict === 'improved' ? 'À garder' : verdict === 'worse' ? 'À limiter' : verdict === 'mixed' ? 'À surveiller' : 'Effet neutre'} : ${pieces.join(' · ')}.`,
  };
}

export function buildHistoricalContextBacktestReport(
  contexts: GroupMatchContext[],
  allMatches: MatchResult[],
  settings: ModelSettings
): HistoricalContextBacktestReport {
  const rowsInternal = buildHistoricalBacktestInternalRows(contexts, allMatches, settings);
  const groups = new Map<string, HistoricalBacktestRowInternal[]>();
  const addToGroup = (scopeKey: string, row: HistoricalBacktestRowInternal) => {
    const list = groups.get(scopeKey) ?? [];
    list.push(row);
    groups.set(scopeKey, list);
  };

  for (const row of rowsInternal) {
    addToGroup('all_context_matches', row);
    if (row.context.matchday === 2 && !row.context.isFinalGroupMatchday) addToGroup('j2_context_matches', row);
    if (row.context.isFinalGroupMatchday) addToGroup('j3_context_matches', row);
    addToGroup(row.profileKey, row);
  }

  const preferredOrder = [
    'all_context_matches',
    'j2_context_matches',
    'j3_context_matches',
    'j2_both_won',
    'j2_both_drew',
    'j2_both_lost',
    'j2_winner_vs_loser',
    'one_team_must_win',
    'draw_suits_both',
    'safe_vs_must_win',
    'rotation_risk',
    'dead_rubber',
    'both_need_result',
    'standard_final_day',
  ];

  const scopedRows = preferredOrder
    .filter((scopeKey) => (groups.get(scopeKey)?.length ?? 0) > 0)
    .map((scopeKey) => buildHistoricalContextBacktestRow(scopeKey, groups.get(scopeKey) ?? []));

  const globalRow = scopedRows.find((row) => row.scopeKey === 'all_context_matches');
  const bestRow = scopedRows
    .filter((row) => !['all_context_matches', 'j2_context_matches', 'j3_context_matches'].includes(row.scopeKey))
    .sort((a, b) => {
      const scoreA = a.deltaOutcomeAccuracy * 2 - a.deltaResultLogLoss - a.deltaBrierScore;
      const scoreB = b.deltaOutcomeAccuracy * 2 - b.deltaResultLogLoss - b.deltaBrierScore;
      return scoreB - scoreA;
    })[0];

  return {
    generatedAt: new Date().toISOString(),
    modelLabel: `${settings.scoreModel ?? 'modèle courant'} · ${settings.scoreTemperature ?? 1} temp`,
    settingsWeight: settings.groupStakeAdjustmentWeight ?? 0.65,
    rows: scopedRows,
    bestRow,
    globalRow,
  };
}

export function exportHistoricalContextBacktestCsv(report: HistoricalContextBacktestReport): string {
  const headers = [
    'scope_key',
    'label',
    'sample_size',
    'verdict',
    'baseline_outcome_accuracy',
    'contextual_outcome_accuracy',
    'delta_outcome_accuracy',
    'baseline_top1_accuracy',
    'contextual_top1_accuracy',
    'delta_top1_accuracy',
    'baseline_top5_accuracy',
    'contextual_top5_accuracy',
    'delta_top5_accuracy',
    'baseline_actual_outcome_probability',
    'contextual_actual_outcome_probability',
    'delta_actual_outcome_probability',
    'baseline_result_logloss',
    'contextual_result_logloss',
    'delta_result_logloss',
    'baseline_brier',
    'contextual_brier',
    'delta_brier',
    'baseline_draw_gap',
    'contextual_draw_gap',
    'delta_abs_draw_gap',
    'baseline_goals_error',
    'contextual_goals_error',
    'delta_goals_error',
    'context_types',
    'recommendation',
  ];

  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = report.rows.map((row) => [
    row.scopeKey,
    row.label,
    row.sampleSize,
    row.verdict,
    row.baseline.outcomeAccuracy,
    row.contextual.outcomeAccuracy,
    row.deltaOutcomeAccuracy,
    row.baseline.exactTop1Accuracy,
    row.contextual.exactTop1Accuracy,
    row.deltaTop1Accuracy,
    row.baseline.exactTop5Accuracy,
    row.contextual.exactTop5Accuracy,
    row.deltaTop5Accuracy,
    row.baseline.averageActualOutcomeProbability,
    row.contextual.averageActualOutcomeProbability,
    row.deltaActualOutcomeProbability,
    row.baseline.averageResultLogLoss,
    row.contextual.averageResultLogLoss,
    row.deltaResultLogLoss,
    row.baseline.averageBrierScore,
    row.contextual.averageBrierScore,
    row.deltaBrierScore,
    row.baseline.drawPredictionGap,
    row.contextual.drawPredictionGap,
    row.deltaDrawGapAbs,
    row.baseline.averageGoalsError,
    row.contextual.averageGoalsError,
    row.deltaGoalsErrorAbs,
    row.contextTypes.join(' | '),
    row.recommendation,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
}
