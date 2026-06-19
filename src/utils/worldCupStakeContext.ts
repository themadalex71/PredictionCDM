import { worldCup2026Fixtures } from '../data/worldcup2026/fixtures';
import type { GroupStakePredictionAdjustment } from '../types/football';
import type { WorldCupMatch } from '../types/worldcup';
import type { MppRecordsByKey } from './mppWorldCupStorage';
import { getMppRecordForFixture, hasActualScore, parseMppNumber } from './mppWorldCupStorage';

type MatchLike = {
  id?: string;
  matchKey?: string;
  date: string;
  kickoffTime?: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  neutral?: boolean;
  homeScore?: number;
  awayScore?: number;
  actualHomeScore?: number;
  actualAwayScore?: number;
};

type StandingRow = {
  team: string;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  rank: number;
  maxPoints: number;
};

function sortKey(match: MatchLike): string {
  return `${match.date} ${match.kickoffTime ?? '12:00'} ${match.homeTeam} ${match.awayTeam}`;
}

function getScoreFromFixture(match: WorldCupMatch, records?: MppRecordsByKey) {
  const record = records ? getMppRecordForFixture(records, match) : undefined;

  if (hasActualScore(record)) {
    return {
      home: parseMppNumber(record!.actualHomeScore),
      away: parseMppNumber(record!.actualAwayScore),
    };
  }

  if (Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)) {
    return { home: match.homeScore as number, away: match.awayScore as number };
  }

  return null;
}

function getScoreFromInput(match: MatchLike) {
  if (Number.isFinite(match.actualHomeScore) && Number.isFinite(match.actualAwayScore)) {
    return { home: match.actualHomeScore as number, away: match.actualAwayScore as number };
  }

  if (Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)) {
    return { home: match.homeScore as number, away: match.awayScore as number };
  }

  return null;
}

function rankRows(rows: Map<string, Omit<StandingRow, 'rank' | 'maxPoints'>>, groupSize: number): StandingRow[] {
  const gamesPerTeam = Math.max(0, groupSize - 1);

  return [...rows.values()]
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      maxPoints: row.points + Math.max(0, gamesPerTeam - row.played) * 3,
      rank: 0,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.team.localeCompare(b.team);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function applyScore(rows: Map<string, Omit<StandingRow, 'rank' | 'maxPoints'>>, match: MatchLike, score: { home: number; away: number }) {
  const home = rows.get(match.homeTeam);
  const away = rows.get(match.awayTeam);
  if (!home || !away) return;

  home.played += 1;
  away.played += 1;
  home.goalsFor += score.home;
  home.goalsAgainst += score.away;
  away.goalsFor += score.away;
  away.goalsAgainst += score.home;
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;

  if (score.home > score.away) {
    home.points += 3;
  } else if (score.away > score.home) {
    away.points += 3;
  } else {
    home.points += 1;
    away.points += 1;
  }
}

function initialRows(teams: string[]) {
  const rows = new Map<string, Omit<StandingRow, 'rank' | 'maxPoints'>>();
  for (const team of teams) {
    rows.set(team, {
      team,
      played: 0,
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
    });
  }
  return rows;
}

function getDefaultAdjustment(profileKey: string, confidence: GroupStakePredictionAdjustment['confidence']): Omit<GroupStakePredictionAdjustment, 'profileKey' | 'label' | 'active' | 'confidence' | 'reasons'> {
  const confidenceScale = confidence === 'high' ? 1 : confidence === 'medium' ? 0.75 : 0.45;
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

function makeAdjustment(profileKey: string, label: string, reasons: string[], confidence: GroupStakePredictionAdjustment['confidence']): GroupStakePredictionAdjustment {
  return {
    profileKey,
    label,
    active: profileKey !== 'not_final_day' && profileKey !== 'standard_final_day',
    confidence,
    reasons,
    ...getDefaultAdjustment(profileKey, confidence),
  };
}

function computeAdjustment(target: MatchLike, groupMatches: MatchLike[], getScore: (match: MatchLike) => { home: number; away: number } | null): GroupStakePredictionAdjustment | null {
  if (!target.group) return null;

  const teams = Array.from(new Set(groupMatches.flatMap((match) => [match.homeTeam, match.awayTeam]))).sort();
  if (teams.length < 3) return null;

  const sorted = [...groupMatches].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const targetKey = sortKey(target);
  const rows = initialRows(teams);

  for (const match of sorted) {
    if (sortKey(match) >= targetKey) break;
    const score = getScore(match);
    if (score) applyScore(rows, match, score);
  }

  const table = rankRows(rows, teams.length);
  const home = table.find((row) => row.team === target.homeTeam);
  const away = table.find((row) => row.team === target.awayTeam);
  if (!home || !away) return null;

  const matchday = Math.max(home.played, away.played) + 1;
  const finalMatchday = teams.length - 1;

  const earlyReasons = [
    `${target.homeTeam} : ${home.points} pts après ${home.played} match${home.played > 1 ? 's' : ''}`,
    `${target.awayTeam} : ${away.points} pts après ${away.played} match${away.played > 1 ? 's' : ''}`,
  ];

  // v4.5 : effet du résultat du premier match sur la 2e journée.
  // On n'applique cette couche que quand les deux équipes ont déjà exactement
  // un match de groupe connu avant la rencontre. Cela évite de contaminer les
  // J1 ou les calendriers irréguliers.
  if (matchday === 2 && finalMatchday > 2 && home.played === 1 && away.played === 1) {
    if (home.points === 3 && away.points === 3) {
      return makeAdjustment('j2_both_won', 'J2 : deux équipes ont gagné J1', earlyReasons, 'medium');
    }

    if (home.points === 1 && away.points === 1) {
      return makeAdjustment('j2_both_drew', 'J2 : deux équipes ont fait nul J1', earlyReasons, 'medium');
    }

    if (home.points === 0 && away.points === 0) {
      return makeAdjustment('j2_both_lost', 'J2 : deux équipes ont perdu J1', earlyReasons, 'medium');
    }

    if ((home.points === 3 && away.points === 0) || (home.points === 0 && away.points === 3)) {
      return makeAdjustment('j2_winner_vs_loser', 'J2 : gagnant J1 vs perdant J1', earlyReasons, 'high');
    }

    return makeAdjustment('not_final_day', 'J2 : contexte J1 sans signal fort', earlyReasons, 'high');
  }

  if (matchday < finalMatchday) {
    return makeAdjustment('not_final_day', 'Pas une journée contextualisée', ['Aucun ajustement d’enjeu appliqué.'], 'high');
  }

  const qualifiedLine = 2;
  const currentSecond = table[qualifiedLine - 1];
  const currentFirst = table[0];
  const othersHome = table.filter((row) => row.team !== home.team).sort((a, b) => b.maxPoints - a.maxPoints);
  const othersAway = table.filter((row) => row.team !== away.team).sort((a, b) => b.maxPoints - a.maxPoints);
  const homeGuaranteed = Boolean(othersHome[qualifiedLine - 1]) && home.points > othersHome[qualifiedLine - 1].maxPoints;
  const awayGuaranteed = Boolean(othersAway[qualifiedLine - 1]) && away.points > othersAway[qualifiedLine - 1].maxPoints;
  const homeEliminatedTop2 = Boolean(currentSecond) && home.maxPoints < currentSecond.points;
  const awayEliminatedTop2 = Boolean(currentSecond) && away.maxPoints < currentSecond.points;
  const homeMustWin = !homeGuaranteed && !homeEliminatedTop2 && Boolean(currentSecond) && home.points + 1 < currentSecond.points && home.points + 3 >= currentSecond.points;
  const awayMustWin = !awayGuaranteed && !awayEliminatedTop2 && Boolean(currentSecond) && away.points + 1 < currentSecond.points && away.points + 3 >= currentSecond.points;
  const homeDrawEnough = !homeGuaranteed && !homeEliminatedTop2 && Boolean(currentSecond) && home.points + 1 >= currentSecond.points;
  const awayDrawEnough = !awayGuaranteed && !awayEliminatedTop2 && Boolean(currentSecond) && away.points + 1 >= currentSecond.points;
  const homeCanStillWinGroup = Boolean(currentFirst) && home.maxPoints >= currentFirst.points;
  const awayCanStillWinGroup = Boolean(currentFirst) && away.maxPoints >= currentFirst.points;
  const homeRotation = homeGuaranteed && (!homeCanStillWinGroup || home.rank === 1);
  const awayRotation = awayGuaranteed && (!awayCanStillWinGroup || away.rank === 1);

  const reasons = [
    `${target.homeTeam} : ${home.points} pts, rang ${home.rank}`,
    `${target.awayTeam} : ${away.points} pts, rang ${away.rank}`,
  ];

  if ((homeGuaranteed && awayMustWin) || (awayGuaranteed && homeMustWin)) {
    return makeAdjustment('safe_vs_must_win', 'Déjà qualifié vs must-win', reasons, 'medium');
  }
  if (homeDrawEnough && awayDrawEnough) {
    return makeAdjustment('draw_suits_both', 'Nul utile aux deux', reasons, 'high');
  }
  if (homeMustWin && awayMustWin) {
    return makeAdjustment('both_need_result', 'Deux équipes sous pression', reasons, 'low');
  }
  if (homeMustWin || awayMustWin) {
    return makeAdjustment('one_team_must_win', 'Une équipe doit gagner', reasons, 'high');
  }
  if (homeRotation || awayRotation) {
    return makeAdjustment('rotation_risk', 'Risque rotation / relâchement', reasons, 'medium');
  }
  if ((homeGuaranteed && awayGuaranteed) || (homeEliminatedTop2 && awayEliminatedTop2)) {
    return makeAdjustment('dead_rubber', 'Match sans enjeu fort', reasons, 'medium');
  }

  return makeAdjustment('standard_final_day', 'Dernière journée standard', reasons, 'low');
}

export function getWorldCup2026StakeAdjustment(match: WorldCupMatch | null | undefined, records?: MppRecordsByKey): GroupStakePredictionAdjustment | null {
  if (!match || match.stage !== 'group' || !match.group) return null;

  const groupMatches = worldCup2026Fixtures.filter((fixture) => fixture.group === match.group);
  return computeAdjustment(match, groupMatches, (candidate) => getScoreFromFixture(candidate as WorldCupMatch, records));
}

export function getMppInputStakeAdjustment(input: MatchLike, allInputs: MatchLike[]): GroupStakePredictionAdjustment | null {
  if (!input.group) return null;

  const groupMatches = allInputs.filter((candidate) => candidate.group === input.group);
  return computeAdjustment(input, groupMatches, getScoreFromInput);
}
