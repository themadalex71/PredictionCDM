import type { MatchResult } from '../types/football';

// Jeu de données volontairement petit et illustratif pour tester l'interface.
// Remplace-le ensuite par un vrai fichier results.csv importé depuis la page Base de données.
export const sampleMatches: MatchResult[] = [
  { date: '2022-11-22', homeTeam: 'France', awayTeam: 'Australia', homeScore: 4, awayScore: 1, tournament: 'FIFA World Cup', city: 'Al Wakrah', country: 'Qatar', neutral: true },
  { date: '2022-11-26', homeTeam: 'France', awayTeam: 'Denmark', homeScore: 2, awayScore: 1, tournament: 'FIFA World Cup', city: 'Doha', country: 'Qatar', neutral: true },
  { date: '2022-12-04', homeTeam: 'France', awayTeam: 'Poland', homeScore: 3, awayScore: 1, tournament: 'FIFA World Cup', city: 'Doha', country: 'Qatar', neutral: true },
  { date: '2022-12-10', homeTeam: 'England', awayTeam: 'France', homeScore: 1, awayScore: 2, tournament: 'FIFA World Cup', city: 'Al Khor', country: 'Qatar', neutral: true },
  { date: '2022-12-14', homeTeam: 'France', awayTeam: 'Morocco', homeScore: 2, awayScore: 0, tournament: 'FIFA World Cup', city: 'Al Khor', country: 'Qatar', neutral: true },
  { date: '2022-12-18', homeTeam: 'Argentina', awayTeam: 'France', homeScore: 3, awayScore: 3, tournament: 'FIFA World Cup', city: 'Lusail', country: 'Qatar', neutral: true },

  { date: '2022-11-21', homeTeam: 'Senegal', awayTeam: 'Netherlands', homeScore: 0, awayScore: 2, tournament: 'FIFA World Cup', city: 'Doha', country: 'Qatar', neutral: true },
  { date: '2022-11-25', homeTeam: 'Qatar', awayTeam: 'Senegal', homeScore: 1, awayScore: 3, tournament: 'FIFA World Cup', city: 'Doha', country: 'Qatar', neutral: false },
  { date: '2022-11-29', homeTeam: 'Ecuador', awayTeam: 'Senegal', homeScore: 1, awayScore: 2, tournament: 'FIFA World Cup', city: 'Al Rayyan', country: 'Qatar', neutral: true },
  { date: '2022-12-04', homeTeam: 'England', awayTeam: 'Senegal', homeScore: 3, awayScore: 0, tournament: 'FIFA World Cup', city: 'Al Khor', country: 'Qatar', neutral: true },

  { date: '2022-11-22', homeTeam: 'Argentina', awayTeam: 'Saudi Arabia', homeScore: 1, awayScore: 2, tournament: 'FIFA World Cup', city: 'Lusail', country: 'Qatar', neutral: true },
  { date: '2022-11-26', homeTeam: 'Argentina', awayTeam: 'Mexico', homeScore: 2, awayScore: 0, tournament: 'FIFA World Cup', city: 'Lusail', country: 'Qatar', neutral: true },
  { date: '2022-11-30', homeTeam: 'Poland', awayTeam: 'Argentina', homeScore: 0, awayScore: 2, tournament: 'FIFA World Cup', city: 'Doha', country: 'Qatar', neutral: true },
  { date: '2022-12-03', homeTeam: 'Argentina', awayTeam: 'Australia', homeScore: 2, awayScore: 1, tournament: 'FIFA World Cup', city: 'Al Rayyan', country: 'Qatar', neutral: true },
  { date: '2022-12-09', homeTeam: 'Netherlands', awayTeam: 'Argentina', homeScore: 2, awayScore: 2, tournament: 'FIFA World Cup', city: 'Lusail', country: 'Qatar', neutral: true },

  { date: '2024-03-23', homeTeam: 'France', awayTeam: 'Germany', homeScore: 0, awayScore: 2, tournament: 'Friendly', city: 'Lyon', country: 'France', neutral: false },
  { date: '2024-06-17', homeTeam: 'Austria', awayTeam: 'France', homeScore: 0, awayScore: 1, tournament: 'UEFA Euro', city: 'Dusseldorf', country: 'Germany', neutral: true },
  { date: '2024-06-21', homeTeam: 'Netherlands', awayTeam: 'France', homeScore: 0, awayScore: 0, tournament: 'UEFA Euro', city: 'Leipzig', country: 'Germany', neutral: true },
  { date: '2024-06-25', homeTeam: 'France', awayTeam: 'Poland', homeScore: 1, awayScore: 1, tournament: 'UEFA Euro', city: 'Dortmund', country: 'Germany', neutral: true },
  { date: '2024-07-05', homeTeam: 'Portugal', awayTeam: 'France', homeScore: 0, awayScore: 0, tournament: 'UEFA Euro', city: 'Hamburg', country: 'Germany', neutral: true },
];
