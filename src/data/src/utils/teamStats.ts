import type { MatchResult, ModelSettings, TeamStats } from '../types/football';

const OFFICIAL_TOURNAMENT_KEYWORDS = [
  'world cup',
  'qualification',
  'qualifiers',
  'euro',
  'copa america',
  'africa cup',
  'can',
  'gold cup',
  'asian cup',
  'nations league',
  'confederations',
];

export function getTeams(matches: MatchResult[]): string[] {
  return Array.from(new Set(matches.flatMap((match) => [match.homeTeam, match.awayTeam]))).sort((a, b) => a.localeCompare(b));
}

export function filterMatchesByYear(matches: MatchResult[], startYear: number): MatchResult[] {
  return matches.filter((match) => new Date(match.date).getFullYear() >= startYear);
}

export function filterMatchesByTeams(matches: MatchResult[], teams: string[]): MatchResult[] {
  const allowedTeams = new Set(teams);
  return matches.filter((match) => allowedTeams.has(match.homeTeam) || allowedTeams.has(match.awayTeam));
}

export function getCompetitionWeight(tournament: string, officialMatchWeight: number): number {
  const lower = tournament.toLowerCase();
  const isOfficial = OFFICIAL_TOURNAMENT_KEYWORDS.some((keyword) => lower.includes(keyword));
  return isOfficial ? officialMatchWeight : 1;
}

export function getRecencyWeight(matchDate: string, referenceDate: Date): number {
  const date = new Date(matchDate);
  const ageInDays = Math.max(0, (referenceDate.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  const halfLifeInDays = 720;
  return 0.25 + 0.75 * Math.exp(-ageInDays / halfLifeInDays);
}

export function getReferenceDate(matches: MatchResult[]): Date {
  const latestTime = Math.max(...matches.map((match) => new Date(match.date).getTime()));
  return Number.isFinite(latestTime) ? new Date(latestTime) : new Date();
}

export function computeTeamStats(matches: MatchResult[], teamName: string, settings?: ModelSettings): TeamStats {
  const filteredMatches = settings ? filterMatchesByYear(matches, settings.startYear) : matches;
  const teamMatches = filteredMatches
    .filter((match) => match.homeTeam === teamName || match.awayTeam === teamName)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let recentPoints = 0;

  const recentLimit = settings?.recentMatchCount ?? 10;

  teamMatches.forEach((match, index) => {
    const isHome = match.homeTeam === teamName;
    const gf = isHome ? match.homeScore : match.awayScore;
    const ga = isHome ? match.awayScore : match.homeScore;

    goalsFor += gf;
    goalsAgainst += ga;

    if (gf > ga) wins += 1;
    else if (gf === ga) draws += 1;
    else losses += 1;

    if (index < recentLimit) {
      recentPoints += gf > ga ? 3 : gf === ga ? 1 : 0;
    }
  });

  const matchesCount = teamMatches.length;
  const recentFormScore = recentLimit > 0 ? recentPoints / (Math.min(recentLimit, matchesCount) * 3 || 1) : 0;
  const avgGoalsFor = matchesCount > 0 ? goalsFor / matchesCount : 0;
  const avgGoalsAgainst = matchesCount > 0 ? goalsAgainst / matchesCount : 0;

  return {
    team: teamName,
    matches: matchesCount,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    avgGoalsFor,
    avgGoalsAgainst,
    recentFormScore,
    attackStrength: avgGoalsFor,
    defenseStrength: avgGoalsAgainst,
  };
}
