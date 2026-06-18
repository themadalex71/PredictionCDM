import { useMemo, useState } from 'react';
import type { MatchResult, ModelSettings } from '../types/football';
import {
  buildCalibrationSearchResult,
  createCalibrationSearchRow,
  formatOutcomeLabel,
  modelCalibrationCandidates,
  runBacktest,
  type BacktestOptions,
  type BacktestResult,
  type BacktestRow,
  type CalibrationSearchResult,
  type CalibrationSearchRow,
  type MatchOutcome,
  type ModelCalibrationCandidate,
} from '../utils/backtestModel';

type BacktestPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
  onSettingsChange?: (settings: ModelSettings) => void;
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

const ROBUST_CALIBRATION_WINDOWS = [150, 300, 500] as const;

type RobustCalibrationWindow = {
  maxMatches: number;
  row: CalibrationSearchRow;
};

type RobustCalibrationRow = {
  id: string;
  name: string;
  description: string;
  settings: ModelSettings;
  windows: RobustCalibrationWindow[];
  averageGlobalScore: number;
  averageResultScore: number;
  averageExactScore: number;
  averageDrawBalanceScore: number;
  averageOutcomeAccuracy: number;
  averageTop1Accuracy: number;
  averageTop5Accuracy: number;
  averageResultLogLoss: number;
  averageBrierScore: number;
  averagePredictedDrawShare: number;
  averageDrawGap: number;
  globalScoreRange: number;
  globalScoreStdDev: number;
  stabilityScore: number;
  robustScore: number;
};

type RobustCalibrationResult = {
  rows: RobustCalibrationRow[];
  bestByRobustScore?: RobustCalibrationRow;
  bestByAverageGlobalScore?: RobustCalibrationRow;
  bestByStability?: RobustCalibrationRow;
  bestByOutcome?: RobustCalibrationRow;
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

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;

  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));

  return Math.sqrt(variance);
}

function range(values: number[]): number {
  if (values.length === 0) return 0;

  return Math.max(...values) - Math.min(...values);
}

function buildRobustCalibrationRow(
  candidate: ModelCalibrationCandidate,
  settings: ModelSettings,
  windows: RobustCalibrationWindow[]
): RobustCalibrationRow {
  const globalScores = windows.map((window) => window.row.globalScore);
  const globalScoreRange = range(globalScores);
  const globalScoreStdDev = standardDeviation(globalScores);
  const stabilityScore = Math.max(0, 100 - globalScoreStdDev * 5 - globalScoreRange * 1.5);
  const averageGlobalScore = average(globalScores);

  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    settings,
    windows,
    averageGlobalScore,
    averageResultScore: average(windows.map((window) => window.row.resultScore)),
    averageExactScore: average(windows.map((window) => window.row.exactScore)),
    averageDrawBalanceScore: average(
      windows.map((window) => window.row.drawBalanceScore)
    ),
    averageOutcomeAccuracy: average(
      windows.map((window) => window.row.summary.outcomeAccuracy)
    ),
    averageTop1Accuracy: average(
      windows.map((window) => window.row.summary.exactTop1Accuracy)
    ),
    averageTop5Accuracy: average(
      windows.map((window) => window.row.summary.exactTop5Accuracy)
    ),
    averageResultLogLoss: average(
      windows.map((window) => window.row.summary.averageResultLogLoss)
    ),
    averageBrierScore: average(
      windows.map((window) => window.row.summary.averageBrierScore)
    ),
    averagePredictedDrawShare: average(
      windows.map((window) => window.row.summary.predictedDrawShare)
    ),
    averageDrawGap: average(
      windows.map((window) => window.row.summary.absoluteDrawPredictionGap)
    ),
    globalScoreRange,
    globalScoreStdDev,
    stabilityScore,
    robustScore:
      averageGlobalScore * 0.7 +
      Math.min(...globalScores) * 0.2 +
      stabilityScore * 0.1,
  };
}

function buildRobustCalibrationResult(
  rows: RobustCalibrationRow[]
): RobustCalibrationResult {
  const byRobustScore = [...rows].sort((a, b) => b.robustScore - a.robustScore);
  const byAverageGlobalScore = [...rows].sort(
    (a, b) => b.averageGlobalScore - a.averageGlobalScore
  );
  const byStability = [...rows].sort((a, b) => {
    if (b.stabilityScore !== a.stabilityScore) {
      return b.stabilityScore - a.stabilityScore;
    }

    return b.averageGlobalScore - a.averageGlobalScore;
  });
  const byOutcome = [...rows].sort(
    (a, b) => b.averageOutcomeAccuracy - a.averageOutcomeAccuracy
  );

  return {
    rows,
    bestByRobustScore: byRobustScore[0],
    bestByAverageGlobalScore: byAverageGlobalScore[0],
    bestByStability: byStability[0],
    bestByOutcome: byOutcome[0],
  };
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

export function BacktestPage({ matches, settings, onSettingsChange }: BacktestPageProps) {
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

  const [robustCalibrationResult, setRobustCalibrationResult] =
    useState<RobustCalibrationResult | null>(null);

  const [calibrationProgress, setCalibrationProgress] =
    useState<CalibrationProgress | null>(null);

  const [appliedCalibrationLabel, setAppliedCalibrationLabel] = useState<string | null>(null);

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
    setRobustCalibrationResult(null);
    setAppliedCalibrationLabel(null);

    const total = modelCalibrationCandidates.length;
    const rows: CalibrationSearchRow[] = [];
    let current = 0;

    setCalibrationProgress({
      current: 0,
      total,
      currentLabel: 'Préparation de la calibration modèle...',
    });

    await waitForUiUpdate();

    for (const candidate of modelCalibrationCandidates) {
      const calibratedSettings: ModelSettings = {
        ...settings,
        ...candidate.settingsPatch,
      };

      setCalibrationProgress({
        current,
        total,
        currentLabel: `Calcul en cours : ${candidate.name}`,
      });

      await waitForUiUpdate();

      const result = runBacktest(matches, calibratedSettings, options);
      rows.push(
        createCalibrationSearchRow(
          candidate,
          calibratedSettings,
          result.summary
        )
      );

      current += 1;

      setCalibrationProgress({
        current,
        total,
        currentLabel: `Terminé : ${candidate.name}`,
      });

      await waitForUiUpdate();
    }

    setCalibrationResult(buildCalibrationSearchResult(rows));
    setIsCalibrating(false);

    setCalibrationProgress({
      current: total,
      total,
      currentLabel: 'Calibration terminée.',
    });
  }

  async function handleRunRobustCalibrationSearch() {
    setIsCalibrating(true);
    setCalibrationResult(null);
    setRobustCalibrationResult(null);
    setAppliedCalibrationLabel(null);

    const windows = ROBUST_CALIBRATION_WINDOWS.map((maxMatches) => ({
      ...options,
      maxMatches,
    }));
    const total = modelCalibrationCandidates.length * windows.length;
    const robustRows: RobustCalibrationRow[] = [];
    let current = 0;

    setCalibrationProgress({
      current: 0,
      total,
      currentLabel: 'Préparation de la calibration robuste 150 / 300 / 500...',
    });

    await waitForUiUpdate();

    for (const candidate of modelCalibrationCandidates) {
      const calibratedSettings: ModelSettings = {
        ...settings,
        ...candidate.settingsPatch,
      };
      const windowResults: RobustCalibrationWindow[] = [];

      for (const windowOptions of windows) {
        setCalibrationProgress({
          current,
          total,
          currentLabel: `Calcul : ${candidate.name} · ${windowOptions.maxMatches} matchs`,
        });

        await waitForUiUpdate();

        const result = runBacktest(matches, calibratedSettings, windowOptions);
        const row = createCalibrationSearchRow(
          candidate,
          calibratedSettings,
          result.summary
        );

        windowResults.push({
          maxMatches: windowOptions.maxMatches,
          row,
        });

        current += 1;

        setCalibrationProgress({
          current,
          total,
          currentLabel: `Terminé : ${candidate.name} · ${windowOptions.maxMatches} matchs`,
        });

        await waitForUiUpdate();
      }

      robustRows.push(
        buildRobustCalibrationRow(candidate, calibratedSettings, windowResults)
      );
    }

    setRobustCalibrationResult(buildRobustCalibrationResult(robustRows));
    setIsCalibrating(false);

    setCalibrationProgress({
      current: total,
      total,
      currentLabel: 'Calibration robuste terminée.',
    });
  }

  function applyCalibratedSettings(
    nextSettings: ModelSettings,
    label: string,
    source: 'calibration' | 'robust_calibration'
  ) {
    if (!onSettingsChange) return;

    const savedSettings: ModelSettings = {
      ...nextSettings,
      activePresetName: label,
      activePresetAppliedAt: new Date().toISOString(),
      activePresetSource: source,
    };

    onSettingsChange(savedSettings);
    setAppliedCalibrationLabel(label);

    // Très important pour l'UX : après un clic sur Appliquer, on relance
    // immédiatement le backtest avec les nouveaux coefficients. Comme ça,
    // l'utilisateur voit directement que le modèle actif a changé.
    const result = runBacktest(matches, savedSettings, options);
    setBacktestResult(result);
  }

  function handleApplyCalibration(row: CalibrationSearchRow) {
    applyCalibratedSettings(row.settings, row.name, 'calibration');
  }

  function handleApplyRobustCalibration(row: RobustCalibrationRow) {
    applyCalibratedSettings(
      row.settings,
      `${row.name} · robuste`,
      'robust_calibration'
    );
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

          <button
            className="secondary-button"
            type="button"
            onClick={handleRunRobustCalibrationSearch}
            disabled={isRunning || isCalibrating}
          >
            {isCalibrating
              ? `Robustesse en cours... ${progressPercent} %`
              : 'Tester robustesse 150 / 300 / 500'}
          </button>
        </div>

        {(appliedCalibrationLabel || settings.activePresetName) && (
          <div
            className="card"
            style={{
              marginTop: '1rem',
              padding: '1rem',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              background: 'rgba(34, 197, 94, 0.08)',
            }}
          >
            <p className="eyebrow">Preset modèle actif</p>
            <h3 style={{ margin: '0.25rem 0' }}>
              {appliedCalibrationLabel ?? settings.activePresetName}
            </h3>
            <p className="muted-text">
              Ce preset est sauvegardé dans le navigateur. Après un clic sur Appliquer,
              le backtest affiché en bas est relancé automatiquement avec les nouveaux coefficients.
            </p>
          </div>
        )}

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

      {robustCalibrationResult && (
        <section className="card">
          <div className="section-title">
            <p className="eyebrow">Calibration robuste du modèle</p>
            <h2>Comparer les coefficients sur 150, 300 et 500 matchs</h2>
          </div>

          <p>
            Cette vue évite de choisir un preset qui marche seulement sur une
            seule fenêtre. Chaque réglage est testé sur 150, 300 et 500 matchs.
            Le score robuste combine la moyenne, le pire résultat et la stabilité
            entre les trois fenêtres.
          </p>

          {appliedCalibrationLabel && (
            <p className="import-status">
              Réglage appliqué aux paramètres : <strong>{appliedCalibrationLabel}</strong>.
              Tu peux maintenant relancer le backtest modèle ou aller dans Prédictions / Backtest MPP.
            </p>
          )}

          <div className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Meilleur robuste</p>
              <h2>{robustCalibrationResult.bestByRobustScore?.name}</h2>
              <p>
                Score robuste :{' '}
                {robustCalibrationResult.bestByRobustScore?.robustScore.toFixed(1)} / 100
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleure moyenne</p>
              <h2>{robustCalibrationResult.bestByAverageGlobalScore?.name}</h2>
              <p>
                Moyenne globale :{' '}
                {robustCalibrationResult.bestByAverageGlobalScore?.averageGlobalScore.toFixed(1)} / 100
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Plus stable</p>
              <h2>{robustCalibrationResult.bestByStability?.name}</h2>
              <p>
                Stabilité :{' '}
                {robustCalibrationResult.bestByStability?.stabilityScore.toFixed(1)} / 100
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur résultat moyen</p>
              <h2>{robustCalibrationResult.bestByOutcome?.name}</h2>
              <p>
                Bon résultat moyen :{' '}
                {formatPercent(robustCalibrationResult.bestByOutcome?.averageOutcomeAccuracy ?? 0)}
              </p>
            </article>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Réglage</th>
                  <th>Score robuste</th>
                  <th>Moyenne globale</th>
                  <th>Stabilité</th>
                  <th>Bon résultat moyen</th>
                  <th>Top 1 moyen</th>
                  <th>Top 5 moyen</th>
                  <th>Log loss</th>
                  <th>Brier</th>
                  <th>Écart nul moyen</th>
                  <th>Détail 150 / 300 / 500</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {[...robustCalibrationResult.rows]
                  .sort((a, b) => b.robustScore - a.robustScore)
                  .map((row, index) => (
                    <tr key={`robust-${row.id}`}>
                      <td>{index + 1}</td>

                      <td>
                        <strong>{row.name}</strong>
                        <br />
                        <span className="muted-text">{row.description}</span>
                      </td>

                      <td>
                        <strong>{row.robustScore.toFixed(1)}</strong> / 100
                        <br />
                        <span className="muted-text">
                          Pire fenêtre :{' '}
                          {Math.min(...row.windows.map((window) => window.row.globalScore)).toFixed(1)}
                        </span>
                      </td>

                      <td>{row.averageGlobalScore.toFixed(1)} / 100</td>

                      <td>
                        {row.stabilityScore.toFixed(1)} / 100
                        <br />
                        <span className="muted-text">
                          Écart : {row.globalScoreRange.toFixed(1)} pts
                        </span>
                      </td>

                      <td>{formatPercent(row.averageOutcomeAccuracy)}</td>
                      <td>{formatPercent(row.averageTop1Accuracy)}</td>
                      <td>{formatPercent(row.averageTop5Accuracy)}</td>
                      <td>{row.averageResultLogLoss.toFixed(3)}</td>
                      <td>{row.averageBrierScore.toFixed(3)}</td>
                      <td>{formatPercent(row.averageDrawGap)}</td>

                      <td>
                        {row.windows.map((window) => (
                          <span key={`${row.id}-${window.maxMatches}`} className="muted-text">
                            {window.maxMatches} : {window.row.globalScore.toFixed(1)} global ·{' '}
                            {formatPercent(window.row.summary.outcomeAccuracy)} résultat
                            <br />
                          </span>
                        ))}
                      </td>

                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleApplyRobustCalibration(row)}
                          disabled={!onSettingsChange}
                        >
                          Appliquer + relancer
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {calibrationResult && (
        <section className="card">
          <div className="section-title">
            <p className="eyebrow">Calibration automatique du modèle</p>
            <h2>Choisir les meilleurs coefficients dans le backtest modèle</h2>
          </div>

          <p>
            Cette calibration ne regarde pas les points MPP. Elle teste des
            coefficients du moteur statistique sur les matchs historiques, puis
            classe les réglages selon un score global : bons résultats, log loss,
            Brier score, Top 1 / Top 5 score exact, probabilité donnée au score
            réel et équilibre des nuls.
          </p>

          {appliedCalibrationLabel && (
            <p className="import-status">
              Réglage appliqué aux paramètres : <strong>{appliedCalibrationLabel}</strong>.
              Tu peux maintenant relancer le backtest modèle ou aller dans Prédictions / Backtest MPP.
            </p>
          )}

          <div className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Meilleur compromis</p>
              <h2>{calibrationResult.bestByGlobalScore?.name}</h2>
              <p>
                Score global :{' '}
                {calibrationResult.bestByGlobalScore?.globalScore.toFixed(1)} / 100
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur résultat 1/N/2</p>
              <h2>{calibrationResult.bestByResultScore?.name}</h2>
              <p>
                Score résultat :{' '}
                {calibrationResult.bestByResultScore?.resultScore.toFixed(1)} / 100
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur score exact</p>
              <h2>{calibrationResult.bestByExactScore?.name}</h2>
              <p>
                Score exact :{' '}
                {calibrationResult.bestByExactScore?.exactScore.toFixed(1)} / 100
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleur équilibre nuls</p>
              <h2>{calibrationResult.bestByDrawBalance?.name}</h2>
              <p>
                Score nuls :{' '}
                {calibrationResult.bestByDrawBalance?.drawBalanceScore.toFixed(1)} / 100
              </p>
            </article>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Réglage</th>
                  <th>Scores calibration</th>
                  <th>Bon résultat</th>
                  <th>Top 1</th>
                  <th>Top 5</th>
                  <th>Log loss</th>
                  <th>Brier</th>
                  <th>Nuls prédits</th>
                  <th>Écart nul</th>
                  <th>Coefficients clés</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {[...calibrationResult.rows]
                  .sort((a, b) => b.globalScore - a.globalScore)
                  .map((row, index) => (
                    <tr key={row.id}>
                      <td>{index + 1}</td>

                      <td>
                        <strong>{row.name}</strong>
                        <br />
                        <span className="muted-text">{row.description}</span>
                      </td>

                      <td>
                        <strong>{row.globalScore.toFixed(1)}</strong> global
                        <br />
                        <span className="muted-text">
                          Résultat {row.resultScore.toFixed(1)} · Exact{' '}
                          {row.exactScore.toFixed(1)} · Nuls{' '}
                          {row.drawBalanceScore.toFixed(1)}
                        </span>
                      </td>

                      <td>{formatPercent(row.summary.outcomeAccuracy)}</td>
                      <td>{formatPercent(row.summary.exactTop1Accuracy)}</td>
                      <td>{formatPercent(row.summary.exactTop5Accuracy)}</td>
                      <td>{row.summary.averageResultLogLoss.toFixed(3)}</td>
                      <td>{row.summary.averageBrierScore.toFixed(3)}</td>
                      <td>{formatPercent(row.summary.predictedDrawShare)}</td>
                      <td>{formatPercent(row.summary.absoluteDrawPredictionGap)}</td>

                      <td>
                        <span className="muted-text">
                          {row.scoreModelLabel} · {row.temperatureLabel} ·{' '}
                          {row.eloImpactLabel} · {row.dixonColesRhoLabel} ·{' '}
                          {row.drawTuningLabel}
                        </span>
                      </td>

                      <td>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => handleApplyCalibration(row)}
                          disabled={!onSettingsChange}
                        >
                          Appliquer + relancer
                        </button>
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

            <article className="card mini-card">
              <p className="eyebrow">Écart nuls</p>
              <h2>{formatPercent(backtestResult.summary.absoluteDrawPredictionGap)}</h2>
              <p>Écart absolu entre la part de nuls réels et celle des nuls prédits.</p>
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
