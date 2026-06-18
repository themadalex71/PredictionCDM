import { useMemo, useState } from 'react';
import type { MatchResult, ModelSettings } from '../types/football';
import {
  calibrationPresets,
  eloImpactPresets,
  formatOutcomeLabel,
  runBacktest,
  temperaturePresets,
  type BacktestOptions,
  type BacktestResult,
  type BacktestRow,
  type CalibrationSearchResult,
  type CalibrationSearchRow,
  type MatchOutcome,
} from '../utils/backtestModel';

type BacktestPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
};

type OutcomeBreakdown = {
  outcome: MatchOutcome;
  label: string;
  actualCount: number;
  predictedCount: number;
  correctCount: number;
  actualShare: number;
  predictedShare: number;
  accuracyWhenActual: number;
};

type TournamentBreakdown = {
  tournament: string;
  matches: number;
  outcomeAccuracy: number;
  top1Accuracy: number;
  top5Accuracy: number;
  averageResultLogLoss: number;
  averageBrierScore: number;
};

type CalibrationProgress = {
  current: number;
  total: number;
  currentLabel: string;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(2)} %`;
}

function getHitLabel(value: boolean): string {
  return value ? 'OK' : 'Raté';
}

function getHitClass(value: boolean): string {
  return value ? 'diagnostic-pill ok' : 'diagnostic-pill danger';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function waitForUiUpdate(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 20);
  });
}

function getOutcomeBreakdown(rows: BacktestRow[]): OutcomeBreakdown[] {
  const outcomes: MatchOutcome[] = ['teamA', 'draw', 'teamB'];
  const total = rows.length || 1;

  return outcomes.map((outcome) => {
    const actualRows = rows.filter((row) => row.actualOutcome === outcome);
    const predictedRows = rows.filter(
      (row) => row.predictedOutcome === outcome
    );
    const correctRows = actualRows.filter((row) => row.correctOutcomeHit);

    return {
      outcome,
      label: formatOutcomeLabel(outcome),
      actualCount: actualRows.length,
      predictedCount: predictedRows.length,
      correctCount: correctRows.length,
      actualShare: actualRows.length / total,
      predictedShare: predictedRows.length / total,
      accuracyWhenActual:
        actualRows.length > 0 ? correctRows.length / actualRows.length : 0,
    };
  });
}

function getConfusionCell(
  rows: BacktestRow[],
  actualOutcome: MatchOutcome,
  predictedOutcome: MatchOutcome
): number {
  return rows.filter(
    (row) =>
      row.actualOutcome === actualOutcome &&
      row.predictedOutcome === predictedOutcome
  ).length;
}

function getTournamentBreakdown(rows: BacktestRow[]): TournamentBreakdown[] {
  const grouped = new Map<string, BacktestRow[]>();

  for (const row of rows) {
    const key = row.tournament || 'Unknown';

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key)!.push(row);
  }

  return Array.from(grouped.entries())
    .map(([tournament, tournamentRows]) => {
      const matches = tournamentRows.length;

      return {
        tournament,
        matches,
        outcomeAccuracy:
          tournamentRows.filter((row) => row.correctOutcomeHit).length /
          matches,
        top1Accuracy:
          tournamentRows.filter((row) => row.exactTop1Hit).length / matches,
        top5Accuracy:
          tournamentRows.filter((row) => row.exactTop5Hit).length / matches,
        averageResultLogLoss: average(
          tournamentRows.map((row) => row.resultLogLoss)
        ),
        averageBrierScore: average(tournamentRows.map((row) => row.brierScore)),
      };
    })
    .sort((a, b) => b.matches - a.matches);
}

function getWorstRows(rows: BacktestRow[]): BacktestRow[] {
  return [...rows]
    .sort((a, b) => {
      if (b.resultLogLoss !== a.resultLogLoss) {
        return b.resultLogLoss - a.resultLogLoss;
      }

      return a.actualScoreProbability - b.actualScoreProbability;
    })
    .slice(0, 20);
}

function getBestRows(rows: BacktestRow[]): BacktestRow[] {
  return [...rows]
    .sort((a, b) => b.actualScoreProbability - a.actualScoreProbability)
    .slice(0, 20);
}

function buildCalibrationSearchResult(
  rows: CalibrationSearchRow[]
): CalibrationSearchResult {
  const byLogLoss = [...rows].sort(
    (a, b) => a.summary.averageResultLogLoss - b.summary.averageResultLogLoss
  );

  const byBrier = [...rows].sort(
    (a, b) => a.summary.averageBrierScore - b.summary.averageBrierScore
  );

  const byOutcome = [...rows].sort(
    (a, b) => b.summary.outcomeAccuracy - a.summary.outcomeAccuracy
  );

  const byTop5 = [...rows].sort(
    (a, b) => b.summary.exactTop5Accuracy - a.summary.exactTop5Accuracy
  );

  return {
    rows,
    bestByLogLoss: byLogLoss[0],
    bestByBrier: byBrier[0],
    bestByOutcome: byOutcome[0],
    bestByTop5: byTop5[0],
  };
}

export function BacktestPage({ matches, settings }: BacktestPageProps) {
  const [options, setOptions] = useState<BacktestOptions>({
    testStartDate: '2024-01-01',
    testEndDate: '2026-06-15',
    maxMatches: 150,
    includeFriendlies: false,
    minPriorMatchesPerTeam: 10,
  });

  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(
    null
  );

  const [calibrationResult, setCalibrationResult] =
    useState<CalibrationSearchResult | null>(null);

  const [calibrationProgress, setCalibrationProgress] =
    useState<CalibrationProgress | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const eligibleMatchesCount = useMemo(() => {
    return matches.filter((match) => {
      if (match.date < options.testStartDate) return false;
      if (match.date > options.testEndDate) return false;

      if (
        !options.includeFriendlies &&
        match.tournament.toLowerCase().includes('friendly')
      ) {
        return false;
      }

      return (
        Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore)
      );
    }).length;
  }, [matches, options]);

  const outcomeBreakdown = useMemo(() => {
    return backtestResult ? getOutcomeBreakdown(backtestResult.rows) : [];
  }, [backtestResult]);

  const tournamentBreakdown = useMemo(() => {
    return backtestResult ? getTournamentBreakdown(backtestResult.rows) : [];
  }, [backtestResult]);

  const worstRows = useMemo(() => {
    return backtestResult ? getWorstRows(backtestResult.rows) : [];
  }, [backtestResult]);

  const bestRows = useMemo(() => {
    return backtestResult ? getBestRows(backtestResult.rows) : [];
  }, [backtestResult]);

  const progressPercent = calibrationProgress
    ? Math.round(
        (calibrationProgress.current / calibrationProgress.total) * 100
      )
    : 0;

  function updateOption<K extends keyof BacktestOptions>(
    key: K,
    value: BacktestOptions[K]
  ) {
    setOptions((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function handleRunBacktest() {
    setIsRunning(true);

    window.setTimeout(() => {
      const result = runBacktest(matches, settings, options);
      setBacktestResult(result);
      setIsRunning(false);
    }, 50);
  }

  async function handleRunCalibrationSearch() {
    setIsCalibrating(true);
    setCalibrationResult(null);

    const total =
      calibrationPresets.length *
      eloImpactPresets.length *
      temperaturePresets.length;

    const rows: CalibrationSearchRow[] = [];
    let current = 0;

    setCalibrationProgress({
      current: 0,
      total,
      currentLabel: 'Préparation de la calibration...',
    });

    await waitForUiUpdate();

    for (const calibrationPreset of calibrationPresets) {
      for (const eloImpactPreset of eloImpactPresets) {
        for (const temperaturePreset of temperaturePresets) {
          const label = `${calibrationPreset.name} · ${eloImpactPreset.label} · ${temperaturePreset.label}`;

          setCalibrationProgress({
            current,
            total,
            currentLabel: `Calcul en cours : ${label}`,
          });

          await waitForUiUpdate();

          const calibratedSettings: ModelSettings = {
            ...settings,
            ...calibrationPreset.settingsPatch,
            externalEloImpact: eloImpactPreset.value,
            internalEloImpact: eloImpactPreset.value,
            scoreTemperature: temperaturePreset.value,
          };

          const result = runBacktest(matches, calibratedSettings, options);

          rows.push({
            id: `${calibrationPreset.id}_${eloImpactPreset.id}_${temperaturePreset.id}`,
            name: label,
            description: `${calibrationPreset.description} ${eloImpactPreset.description} ${temperaturePreset.description}`,
            eloImpactLabel: eloImpactPreset.label,
            eloImpactValue: eloImpactPreset.value,
            temperatureLabel: temperaturePreset.label,
            temperatureValue: temperaturePreset.value,
            settings: calibratedSettings,
            summary: result.summary,
          });

          current += 1;

          setCalibrationProgress({
            current,
            total,
            currentLabel: `Terminé : ${label}`,
          });

          await waitForUiUpdate();
        }
      }
    }

    setCalibrationResult(buildCalibrationSearchResult(rows));
    setIsCalibrating(false);

    setCalibrationProgress({
      current: total,
      total,
      currentLabel: 'Calibration terminée.',
    });
  }

  return (
    <div className="page-stack">
      <section className="card hero">
        <p className="eyebrow">Évaluation du modèle</p>
        <h1>Backtest des prédictions</h1>

        <p>
          Le backtest prend des matchs déjà joués, fait comme si on était avant
          le match, lance le modèle, puis compare la prédiction au score réel.
        </p>

        <p>
          Important : pour chaque match testé, le modèle utilise uniquement les
          matchs joués avant la date du match. Cela évite la fuite de données.
        </p>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Paramètres du backtest</p>
          <h2>Choisir la période testée</h2>
        </div>

        <div className="grid two-columns">
          <label className="settings-label">
            Date de début du test
            <input
              type="date"
              value={options.testStartDate}
              onChange={(event) =>
                updateOption('testStartDate', event.target.value)
              }
            />
          </label>

          <label className="settings-label">
            Date de fin du test
            <input
              type="date"
              value={options.testEndDate}
              onChange={(event) =>
                updateOption('testEndDate', event.target.value)
              }
            />
          </label>

          <label className="settings-label">
            Nombre maximum de matchs testés
            <input
              type="number"
              min={10}
              max={1000}
              value={options.maxMatches}
              onChange={(event) =>
                updateOption('maxMatches', Number(event.target.value))
              }
            />
          </label>

          <label className="settings-label">
            Minimum de matchs précédents par équipe
            <input
              type="number"
              min={0}
              max={100}
              value={options.minPriorMatchesPerTeam}
              onChange={(event) =>
                updateOption(
                  'minPriorMatchesPerTeam',
                  Number(event.target.value)
                )
              }
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={options.includeFriendlies}
              onChange={(event) =>
                updateOption('includeFriendlies', event.target.checked)
              }
            />
            Inclure les matchs amicaux
          </label>
        </div>

        <p className="import-status">
          {eligibleMatchesCount.toLocaleString('fr-FR')} matchs candidats sur la
          période. Le backtest en testera au maximum{' '}
          {options.maxMatches.toLocaleString('fr-FR')}.
        </p>

        <div className="grid two-columns">
          <button
            className="primary-button"
            type="button"
            onClick={handleRunBacktest}
            disabled={isRunning || isCalibrating}
          >
            {isRunning ? 'Backtest en cours...' : 'Lancer le backtest'}
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleRunCalibrationSearch}
            disabled={isRunning || isCalibrating}
          >
            {isCalibrating
              ? `Calibration en cours... ${progressPercent} %`
              : 'Tester plusieurs calibrations'}
          </button>
        </div>

        {(isCalibrating || calibrationProgress) && (
          <div
            className="card"
            style={{
              marginTop: '1rem',
              padding: '1rem',
              background: 'rgba(255, 255, 255, 0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1rem',
                marginBottom: '0.5rem',
              }}
            >
              <strong>Progression calibration</strong>
              <span>
                {calibrationProgress?.current ?? 0} /{' '}
                {calibrationProgress?.total ?? 0} modèles — {progressPercent} %
              </span>
            </div>

            <div
              style={{
                width: '100%',
                height: '14px',
                borderRadius: '999px',
                overflow: 'hidden',
                background: 'rgba(255, 255, 255, 0.12)',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  borderRadius: '999px',
                  background: 'linear-gradient(90deg, #60a5fa, #22c55e)',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>

            <p className="muted-text" style={{ marginTop: '0.5rem' }}>
              {calibrationProgress?.currentLabel}
            </p>
          </div>
        )}
      </section>

      {calibrationResult && (
        <section className="card">
          <div className="section-title">
            <p className="eyebrow">Calibration automatique</p>
            <h2>Comparaison des réglages du modèle</h2>
          </div>

          <p>
            Le tableau teste plusieurs réglages de correction des nuls, d’impact
            Elo et de température de distribution.
          </p>

          <div className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Meilleur log loss</p>
              <h2>{calibrationResult.bestByLogLoss?.name}</h2>
              <p>
                {calibrationResult.bestByLogLoss?.summary.averageResultLogLoss.toFixed(
                  3
                )}
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur Brier</p>
              <h2>{calibrationResult.bestByBrier?.name}</h2>
              <p>
                {calibrationResult.bestByBrier?.summary.averageBrierScore.toFixed(
                  3
                )}
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur résultat</p>
              <h2>{calibrationResult.bestByOutcome?.name}</h2>
              <p>
                {calibrationResult.bestByOutcome
                  ? formatPercent(
                      calibrationResult.bestByOutcome.summary.outcomeAccuracy
                    )
                  : '-'}
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur Top 5</p>
              <h2>{calibrationResult.bestByTop5?.name}</h2>
              <p>
                {calibrationResult.bestByTop5
                  ? formatPercent(
                      calibrationResult.bestByTop5.summary.exactTop5Accuracy
                    )
                  : '-'}
              </p>
            </article>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Calibration</th>
                  <th>Bon résultat</th>
                  <th>Top 1</th>
                  <th>Top 5</th>
                  <th>Log loss</th>
                  <th>Brier</th>
                  <th>Nuls réels</th>
                  <th>Nuls prédits</th>
                  <th>Proba score réel</th>
                  <th>Proba résultat réel</th>
                </tr>
              </thead>

              <tbody>
                {[...calibrationResult.rows]
                  .sort(
                    (a, b) =>
                      a.summary.averageResultLogLoss -
                      b.summary.averageResultLogLoss
                  )
                  .map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        <br />
                        <span className="muted-text">{row.description}</span>
                      </td>

                      <td>{formatPercent(row.summary.outcomeAccuracy)}</td>
                      <td>{formatPercent(row.summary.exactTop1Accuracy)}</td>
                      <td>{formatPercent(row.summary.exactTop5Accuracy)}</td>
                      <td>{row.summary.averageResultLogLoss.toFixed(3)}</td>
                      <td>{row.summary.averageBrierScore.toFixed(3)}</td>
                      <td>{formatPercent(row.summary.actualDrawShare)}</td>
                      <td>{formatPercent(row.summary.predictedDrawShare)}</td>
                      <td>
                        {formatProbability(
                          row.summary.averageActualScoreProbability
                        )}
                      </td>
                      <td>
                        {formatProbability(
                          row.summary.averageActualOutcomeProbability
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {backtestResult && (
        <>
          <section className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Matchs testés</p>
              <h2>
                {backtestResult.summary.testedMatches.toLocaleString('fr-FR')}
              </h2>
              <p>
                {backtestResult.summary.skippedMatches.toLocaleString('fr-FR')}{' '}
                matchs ignorés faute d’historique.
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Bon résultat</p>
              <h2>{formatPercent(backtestResult.summary.outcomeAccuracy)}</h2>
              <p>Victoire / nul / défaite correctement prédits.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Score exact Top 1</p>
              <h2>{formatPercent(backtestResult.summary.exactTop1Accuracy)}</h2>
              <p>Le score le plus probable était le bon.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Score exact Top 5</p>
              <h2>{formatPercent(backtestResult.summary.exactTop5Accuracy)}</h2>
              <p>Le score réel était dans les 5 premiers.</p>
            </article>
          </section>

          <section className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Proba score réel</p>
              <h2>
                {formatProbability(
                  backtestResult.summary.averageActualScoreProbability
                )}
              </h2>
              <p>Probabilité moyenne donnée au score exact réel.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Proba résultat réel</p>
              <h2>
                {formatProbability(
                  backtestResult.summary.averageActualOutcomeProbability
                )}
              </h2>
              <p>Probabilité moyenne donnée au bon résultat.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Log loss résultat</p>
              <h2>{backtestResult.summary.averageResultLogLoss.toFixed(3)}</h2>
              <p>Plus c’est bas, mieux c’est.</p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Brier score</p>
              <h2>{backtestResult.summary.averageBrierScore.toFixed(3)}</h2>
              <p>Plus c’est bas, mieux c’est.</p>
            </article>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Biais du modèle</p>
              <h2>Résultats réels vs résultats prédits</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Résultat</th>
                    <th>Réel</th>
                    <th>Réel %</th>
                    <th>Prédit</th>
                    <th>Prédit %</th>
                    <th>Précision quand réel</th>
                  </tr>
                </thead>

                <tbody>
                  {outcomeBreakdown.map((row) => (
                    <tr key={row.outcome}>
                      <td>
                        <strong>{row.label}</strong>
                      </td>
                      <td>{row.actualCount}</td>
                      <td>{formatPercent(row.actualShare)}</td>
                      <td>{row.predictedCount}</td>
                      <td>{formatPercent(row.predictedShare)}</td>
                      <td>{formatPercent(row.accuracyWhenActual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Matrice de confusion</p>
              <h2>Ce que le modèle confond</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Réel \ Prédit</th>
                    <th>Victoire A</th>
                    <th>Nul</th>
                    <th>Victoire B</th>
                  </tr>
                </thead>

                <tbody>
                  {(['teamA', 'draw', 'teamB'] as MatchOutcome[]).map(
                    (actualOutcome) => (
                      <tr key={actualOutcome}>
                        <td>
                          <strong>{formatOutcomeLabel(actualOutcome)}</strong>
                        </td>
                        {(['teamA', 'draw', 'teamB'] as MatchOutcome[]).map(
                          (predictedOutcome) => (
                            <td key={predictedOutcome}>
                              {getConfusionCell(
                                backtestResult.rows,
                                actualOutcome,
                                predictedOutcome
                              )}
                            </td>
                          )
                        )}
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Par compétition</p>
              <h2>Où le modèle marche le mieux ou le moins bien</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Compétition</th>
                    <th>Matchs</th>
                    <th>Bon résultat</th>
                    <th>Top 1 score</th>
                    <th>Top 5 score</th>
                    <th>Log loss</th>
                    <th>Brier</th>
                  </tr>
                </thead>

                <tbody>
                  {tournamentBreakdown.map((row) => (
                    <tr key={row.tournament}>
                      <td>
                        <strong>{row.tournament}</strong>
                      </td>
                      <td>{row.matches}</td>
                      <td>{formatPercent(row.outcomeAccuracy)}</td>
                      <td>{formatPercent(row.top1Accuracy)}</td>
                      <td>{formatPercent(row.top5Accuracy)}</td>
                      <td>{row.averageResultLogLoss.toFixed(3)}</td>
                      <td>{row.averageBrierScore.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Pires erreurs</p>
              <h2>
                Les matchs où le modèle était le moins confiant sur le réel
              </h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Match</th>
                    <th>Réel</th>
                    <th>Prédit</th>
                    <th>Proba score réel</th>
                    <th>Proba résultat réel</th>
                    <th>Résultat prédit / réel</th>
                  </tr>
                </thead>

                <tbody>
                  {worstRows.map((row) => (
                    <tr key={`worst-${row.id}`}>
                      <td>{row.date}</td>

                      <td>
                        <strong>{row.homeTeam}</strong> vs{' '}
                        <strong>{row.awayTeam}</strong>
                      </td>

                      <td>
                        {row.actualHomeGoals} - {row.actualAwayGoals}
                      </td>

                      <td>
                        {row.predictedHomeGoals} - {row.predictedAwayGoals}
                      </td>

                      <td>{formatProbability(row.actualScoreProbability)}</td>

                      <td>{formatProbability(row.actualOutcomeProbability)}</td>

                      <td>
                        {formatOutcomeLabel(row.predictedOutcome)} / réel :{' '}
                        {formatOutcomeLabel(row.actualOutcome)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Meilleures prédictions</p>
              <h2>
                Les matchs où le modèle donnait une forte proba au score réel
              </h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Match</th>
                    <th>Réel</th>
                    <th>Prédit</th>
                    <th>Proba score réel</th>
                    <th>Rang score réel</th>
                    <th>Compétition</th>
                  </tr>
                </thead>

                <tbody>
                  {bestRows.map((row) => (
                    <tr key={`best-${row.id}`}>
                      <td>{row.date}</td>

                      <td>
                        <strong>{row.homeTeam}</strong> vs{' '}
                        <strong>{row.awayTeam}</strong>
                      </td>

                      <td>
                        {row.actualHomeGoals} - {row.actualAwayGoals}
                      </td>

                      <td>
                        {row.predictedHomeGoals} - {row.predictedAwayGoals}
                      </td>

                      <td>{formatProbability(row.actualScoreProbability)}</td>

                      <td>{row.actualScoreRank ?? 'Hors grille'}</td>

                      <td>{row.tournament}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
