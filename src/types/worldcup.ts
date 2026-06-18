export type Confederation =
  | 'UEFA'
  | 'CONMEBOL'
  | 'CONCACAF'
  | 'CAF'
  | 'AFC'
  | 'OFC';

export type WorldCupGroup =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L';

export type WorldCupTeam = {
  id: string;
  name: string;
  fifaCode: string;
  group: WorldCupGroup;
  confederation: Confederation;

  /**
   * Sert à faire le lien avec les bases de données externes.
   * Exemple : FIFA peut utiliser "Korea Republic",
   * alors qu'une autre base utilise "South Korea".
   */
  aliases?: string[];

  fifaRanking?: number;
  eloRating?: number;
};

export type WorldCupMatchStatus = 'scheduled' | 'live' | 'finished';

export type WorldCupStage =
  | 'group'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter_final'
  | 'semi_final'
  | 'third_place'
  | 'final';

export type WorldCupMatch = {
  id: string;
  date: string;
  kickoffTime?: string;
  stage: WorldCupStage;
  group?: WorldCupGroup;

  homeTeam: string;
  awayTeam: string;

  stadium?: string;
  city?: string;
  country?: string;

  status: WorldCupMatchStatus;

  homeScore?: number;
  awayScore?: number;

  neutral: boolean;
};

export type WorldCupPlayerPosition = 'GK' | 'DF' | 'MF' | 'FW';

export type WorldCupPlayer = {
  id: string;
  team: string;
  fifaCode: string;

  name: string;
  position: WorldCupPlayerPosition;

  club?: string;
  dateOfBirth?: string;
  heightCm?: number;

  caps?: number;
  goals?: number;
};
