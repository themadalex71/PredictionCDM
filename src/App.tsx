import { useEffect, useMemo, useState } from 'react';
import { sampleMatches } from './data/sampleMatches';
import { BacktestPage } from './pages/BacktestPage';
import { DatabasePage } from './pages/DatabasePage';
import { HomePage } from './pages/HomePage';
import { MppBacktestPage } from './pages/MppBacktestPage';
import { MppSimulationPage } from './pages/MppSimulationPage';
import { PredictionsPage } from './pages/PredictionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { WorldCupPage } from './pages/WorldCupPage';
import type {
  MatchResult,
  ModelSettings,
  PredictionContext,
} from './types/football';
import type { WorldCupMatch } from './types/worldcup';
import { saveMatchesToLocalStorage } from './utils/csvParser';
import {
  loadMatchesFromIndexedDb,
  saveMatchesToIndexedDb,
} from './utils/indexedDbStorage';

type Page =
  | 'home'
  | 'worldcup'
  | 'database'
  | 'predictions'
  | 'settings'
  | 'backtest'
  | 'mpp'
  | 'mppBacktest';

const defaultSettings: ModelSettings = {
  startYear: 2018,
  recentMatchCount: 10,
  recentFormWeight: 0.35,
  officialMatchWeight: 1.7,
  homeAdvantage: 0.18,
  maxGoals: 6,

  favoriteShrinkBase: 1,
  favoriteShrinkClose: 1,
  favoriteShrinkMedium: 1,

  drawBoostBase: 1,
  drawBoostCloseMatch: 0,
  drawBoostLowTotal: 0,
  drawBoostMax: 1,

  externalEloImpact: 0.35,
  internalEloImpact: 0.35,

  scoreTemperature: 1,
};

const navItems: { id: Page; label: string }[] = [
  { id: 'home', label: 'Accueil' },
  { id: 'worldcup', label: 'Coupe du Monde 2026' },
  { id: 'database', label: 'Base de données' },
  { id: 'predictions', label: 'Prédictions' },
  { id: 'settings', label: 'Paramètres' },
  { id: 'backtest', label: 'Backtest modèle' },
  { id: 'mpp', label: 'Simulation MPP' },
  { id: 'mppBacktest', label: 'Backtest MPP' },
];

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [matches, setMatches] = useState<MatchResult[]>(sampleMatches);
  const [isDatabaseLoading, setIsDatabaseLoading] = useState(true);
  const [settings, setSettings] = useState<ModelSettings>(defaultSettings);
  const [selectedWorldCupMatch, setSelectedWorldCupMatch] =
    useState<WorldCupMatch | null>(null);

  const pageTitle = useMemo(
    () => navItems.find((item) => item.id === page)?.label ?? 'Accueil',
    [page]
  );

  const initialPredictionContext: PredictionContext = useMemo(
    () => ({
      neutral: selectedWorldCupMatch?.neutral ?? true,
      teamAIsHome: selectedWorldCupMatch
        ? !selectedWorldCupMatch.neutral
        : true,
      tournament: 'FIFA World Cup',
      predictionDate: selectedWorldCupMatch?.date,
    }),
    [selectedWorldCupMatch]
  );

  useEffect(() => {
    async function loadStoredMatches() {
      try {
        const storedMatches = await loadMatchesFromIndexedDb();

        if (storedMatches && storedMatches.length > 0) {
          setMatches(storedMatches);
        }
      } catch (error) {
        console.warn(
          'Impossible de charger IndexedDB, retour aux données exemple.',
          error
        );
      } finally {
        setIsDatabaseLoading(false);
      }
    }

    loadStoredMatches();
  }, []);

  async function handleMatchesChange(nextMatches: MatchResult[]) {
    setMatches(nextMatches);

    try {
      await saveMatchesToIndexedDb(nextMatches);
      console.info(`${nextMatches.length} matchs sauvegardés dans IndexedDB.`);
    } catch (error) {
      console.warn(
        'Impossible de sauvegarder les matchs dans IndexedDB.',
        error
      );

      try {
        saveMatchesToLocalStorage(nextMatches);
      } catch {
        alert(
          'Le CSV a bien été importé, mais il n’a pas pu être sauvegardé. Les données resteront disponibles tant que tu ne rafraîchis pas la page.'
        );
      }
    }
  }

  function resetToSample() {
    setMatches(sampleMatches);
  }

  function handlePredictWorldCupMatch(match: WorldCupMatch) {
    setSelectedWorldCupMatch(match);
    setPage('predictions');
  }

  function handleNavigation(nextPage: Page) {
    setPage(nextPage);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo-mark">MPP</span>
          <div>
            <strong>World Cup Predictor</strong>
            <small>Version Poisson v0.8 · MPP backtest</small>
          </div>
        </div>

        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'nav-button active' : 'nav-button'}
              onClick={() => handleNavigation(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Projet prédiction Coupe du Monde 2026</p>
            <h1>{pageTitle}</h1>
          </div>

          <div className="database-pill">
            {isDatabaseLoading
              ? 'Chargement...'
              : `${matches.length.toLocaleString('fr-FR')} matchs historiques`}
          </div>
        </header>

        {page === 'home' && <HomePage />}

        {page === 'worldcup' && (
          <WorldCupPage onPredictMatch={handlePredictWorldCupMatch} />
        )}

        {page === 'database' && (
          <DatabasePage
            matches={matches}
            onMatchesChange={handleMatchesChange}
            onResetToSample={resetToSample}
          />
        )}

        {page === 'predictions' && (
          <PredictionsPage
            matches={matches}
            settings={settings}
            initialTeamA={selectedWorldCupMatch?.homeTeam}
            initialTeamB={selectedWorldCupMatch?.awayTeam}
            initialContext={initialPredictionContext}
          />
        )}

        {page === 'settings' && (
          <SettingsPage settings={settings} onSettingsChange={setSettings} />
        )}

        {page === 'backtest' && (
          <BacktestPage matches={matches} settings={settings} />
        )}

        {page === 'mpp' && (
          <MppSimulationPage
            matches={matches}
            settings={settings}
            initialTeamA={selectedWorldCupMatch?.homeTeam}
            initialTeamB={selectedWorldCupMatch?.awayTeam}
            initialContext={initialPredictionContext}
          />
        )}

        {page === 'mppBacktest' && (
          <MppBacktestPage matches={matches} settings={settings} />
        )}
      </main>
    </div>
  );
}
