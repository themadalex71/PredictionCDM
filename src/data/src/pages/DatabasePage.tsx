import { useMemo, useState } from 'react';
import type { MatchResult } from '../types/football';
import { clearStoredMatches, parseCsvResults } from '../utils/csvParser';
import { clearMatchesFromIndexedDb } from '../utils/indexedDbStorage';
import { worldCup2026Teams } from '../data/worldcup2026/teams';

type DatabasePageProps = {
  matches: MatchResult[];
  onMatchesChange: (matches: MatchResult[]) => void;
  onResetToSample: () => void;
};

type TeamDiagnostic = {
  team: string;
  fifaCode: string;
  group: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  lastMatchDate?: string;
  status: 'ok' | 'warning' | 'danger';
};

function getTeamDiagnostic(
  allMatches: MatchResult[],
  teamName: string,
  startYear: number
): Omit<TeamDiagnostic, 'team' | 'fifaCode' | 'group' | 'status'> {
  const filteredMatches = allMatches.filter((match) => {
    const year = new Date(match.date).getFullYear();

    if (Number.isNaN(year) || year < startYear) {
      return false;
    }

    return match.homeTeam === teamName || match.awayTeam === teamName;
  });

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const match of filteredMatches) {
    const isHome = match.homeTeam === teamName;

    const teamGoals = isHome ? match.homeScore : match.awayScore;
    const opponentGoals = isHome ? match.awayScore : match.homeScore;

    goalsFor += teamGoals;
    goalsAgainst += opponentGoals;

    if (teamGoals > opponentGoals) {
      wins += 1;
    } else if (teamGoals === opponentGoals) {
      draws += 1;
    } else {
      losses += 1;
    }
  }

  const lastMatch = [...filteredMatches].sort((a, b) =>
    b.date.localeCompare(a.date)
  )[0];

  return {
    matches: filteredMatches.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    lastMatchDate: lastMatch?.date,
  };
}

function getDiagnosticStatus(matches: number): TeamDiagnostic['status'] {
  if (matches >= 20) return 'ok';
  if (matches >= 5) return 'warning';
  return 'danger';
}

function getStatusLabel(status: TeamDiagnostic['status']): string {
  if (status === 'ok') return 'OK';
  if (status === 'warning') return 'Faible';
  return 'Problème';
}

export function DatabasePage({
  matches,
  onMatchesChange,
  onResetToSample,
}: DatabasePageProps) {
  const [importStatus, setImportStatus] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [diagnosticStartYear, setDiagnosticStartYear] = useState(2018);

  const diagnostics = useMemo<TeamDiagnostic[]>(() => {
    return worldCup2026Teams
      .map((team) => {
        const stats = getTeamDiagnostic(
          matches,
          team.name,
          diagnosticStartYear
        );
        const status = getDiagnosticStatus(stats.matches);

        return {
          team: team.name,
          fifaCode: team.fifaCode,
          group: team.group,
          status,
          ...stats,
        };
      })
      .sort((a, b) => {
        if (a.group !== b.group) return a.group.localeCompare(b.group);
        return a.team.localeCompare(b.team);
      });
  }, [matches, diagnosticStartYear]);

  const problematicTeams = diagnostics.filter((team) => team.status !== 'ok');

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setIsImporting(true);
    setImportStatus(`Import en cours : ${file.name}...`);

    try {
      const parsedMatches = await parseCsvResults(file);

      onMatchesChange(parsedMatches);

      setImportStatus(
        `${parsedMatches.length.toLocaleString(
          'fr-FR'
        )} matchs importés avec succès depuis ${file.name}.`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Erreur inconnue pendant l’import CSV.';

      setImportStatus(`Erreur : ${message}`);
      alert(message);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleClear() {
    clearStoredMatches();
    await clearMatchesFromIndexedDb();

    onResetToSample();
    setImportStatus('Retour aux données d’exemple.');
  }

  return (
    <div className="page-stack">
      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Base de données</p>
          <h2>Importer un fichier results.csv</h2>
        </div>

        <p>
          Format attendu :{' '}
          <code>
            date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
          </code>
        </p>

        <label className="file-input">
          <input
            type="file"
            accept=".csv,text/csv"
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            onChange={(event) =>
              handleFileChange(event.target.files?.[0] ?? null)
            }
          />
          {isImporting ? 'Import en cours...' : 'Choisir un CSV local'}
        </label>

        {importStatus && <p className="import-status">{importStatus}</p>}

        <button
          className="secondary-button"
          onClick={handleClear}
          type="button"
        >
          Revenir aux données d'exemple
        </button>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Résumé</p>
          <h2>{matches.length.toLocaleString('fr-FR')} matchs chargés</h2>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Match</th>
                <th>Score</th>
                <th>Compétition</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 12).map((match) => (
                <tr key={`${match.date}-${match.homeTeam}-${match.awayTeam}`}>
                  <td>{match.date}</td>
                  <td>
                    {match.homeTeam} vs {match.awayTeam}
                  </td>
                  <td>
                    {match.homeScore} - {match.awayScore}
                  </td>
                  <td>{match.tournament}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Diagnostic Coupe du Monde 2026</p>
          <h2>Vérification des équipes dans le CSV</h2>
        </div>

        <p>
          Ce tableau vérifie si les 48 équipes de la Coupe du Monde ont assez de
          matchs historiques dans la base importée.
        </p>

        <label className="settings-label">
          Année de départ du diagnostic
          <input
            type="number"
            value={diagnosticStartYear}
            onChange={(event) =>
              setDiagnosticStartYear(Number(event.target.value))
            }
          />
        </label>

        <div className="diagnostic-summary">
          <strong>{problematicTeams.length}</strong> équipes à surveiller sur
          48.
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Statut</th>
                <th>Groupe</th>
                <th>Équipe</th>
                <th>Matchs</th>
                <th>Bilan</th>
                <th>Buts</th>
                <th>Dernier match</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((team) => (
                <tr key={team.team}>
                  <td>
                    <span className={`diagnostic-pill ${team.status}`}>
                      {getStatusLabel(team.status)}
                    </span>
                  </td>
                  <td>{team.group}</td>
                  <td>
                    <strong>{team.team}</strong>{' '}
                    <span className="muted-text">({team.fifaCode})</span>
                  </td>
                  <td>{team.matches}</td>
                  <td>
                    {team.wins}V / {team.draws}N / {team.losses}D
                  </td>
                  <td>
                    {team.goalsFor} - {team.goalsAgainst}
                  </td>
                  <td>{team.lastMatchDate ?? 'Aucun'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
