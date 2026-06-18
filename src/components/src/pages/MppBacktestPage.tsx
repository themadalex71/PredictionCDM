import { useEffect, useMemo, useState } from 'react';
import { worldCup2026Fixtures } from '../data/worldcup2026/fixtures';
import type { MatchResult, ModelSettings } from '../types/football';
import type { MppBacktestInput, MppBacktestResult } from '../utils/mppBacktest';
import { runMppBacktest } from '../utils/mppBacktest';

type MppBacktestPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
};

type FixtureLike = {
  id?: string | number;
  date: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  neutral?: boolean;
  homeScore?: number;
  awayScore?: number;
  time?: string;
  kickoffTime?: string;
};

type EditableMppRecord = {
  matchKey: string;
  date: string;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;

  homeMppPoints: string;
  drawMppPoints: string;
  awayMppPoints: string;

  actualHomeScore: string;
  actualAwayScore: string;
};

type MppModelCalibrationRow = {
  id: string;
  label: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
  summary: MppBacktestResult['summaries'][number] | null;
};

const STORAGE_KEY = 'mpp-worldcup-backtest-records-v1';

const MPP_MODEL_CALIBRATION_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  settingsPatch: Partial<ModelSettings>;
}> = [
  {
    id: 'current',
    label: 'Réglage actuel',
    description: 'Paramètres actuellement utilisés dans l’application.',
    settingsPatch: {},
  },
  {
    id: 'result_model_v1',
    label: 'Nouveau modèle résultat v1',
    description: 'Pondération compétition avancée + adversaire Elo + prudence données faibles + calibration scores classiques.',
    settingsPatch: {
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.2,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.18,
    },
  },
  {
    id: 'result_model_prudent',
    label: 'Modèle résultat prudent',
    description: 'Version plus prudente : davantage de shrink des données faibles et contrôle plus fort des favoris.',
    settingsPatch: {
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.55,
      dataConfidenceWeight: 1.35,
      scoreCalibration: 'worldcup_prudent',
      favoriteControlWeight: 0.28,
    },
  },
  {
    id: 'result_model_temp110',
    label: 'Temp 1.10 + modèle résultat v1',
    description: 'Nouveau moteur statistique avec distribution plus plate, à comparer au meilleur preset MPP actuel.',
    settingsPatch: {
      scoreTemperature: 1.1,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.2,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.18,
    },
  },
  {
    id: 'stable_no_draw',
    label: 'Stable sans boost nul',
    description: 'Témoin statistique : pas de boost supplémentaire des nuls.',
    settingsPatch: {
      smartDrawBoost: false,
      drawMultiplier: 1,
      lowScoreDrawBoost: 0,
      drawBoostCloseMatch: 0,
      drawBoostLowTotal: 0,
      drawBoostMax: 1.05,
      smartDrawMaxBoost: 1.05,
    },
  },
  {
    id: 'smart_draw_light',
    label: 'Smart Draw léger',
    description: 'Boost nul doux, uniquement quand le match paraît serré/fermé.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'smart_draw_medium',
    label: 'Smart Draw moyen',
    description: 'Réglage recommandé : corrige les nuls sans trop casser les victoires A/B.',
    settingsPatch: {
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
  {
    id: 'smart_draw_mpp',
    label: 'Temp 1.10 + Smart Draw MPP',
    description: 'Preset orienté MPP : distribution plus plate et boost intelligent des nuls.',
    settingsPatch: {
      scoreTemperature: 1.1,
      smartDrawBoost: true,
      drawMultiplier: 1.1,
      lowScoreDrawBoost: 0.09,
      drawBoostCloseMatch: 0.065,
      drawBoostLowTotal: 0.045,
      drawBoostMax: 1.32,
      smartDrawMaxBoost: 1.32,
      smartDrawFavoritePenalty: 0.72,
    },
  },
  {
    id: 'smart_draw_mpp_prudent',
    label: 'Temp 1.10 + Smart Draw prudent',
    description: 'Même logique MPP, mais pénalise plus fortement les nuls si un favori clair existe.',
    settingsPatch: {
      scoreTemperature: 1.1,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.24,
      smartDrawMaxBoost: 1.24,
      smartDrawFavoritePenalty: 0.95,
    },
  },
  {
    id: 'draw_medium_legacy',
    label: 'Temp 1.10 + nuls moyen classique',
    description: 'Ancien réglage qui avait marqué beaucoup de points MPP, conservé pour comparaison.',
    settingsPatch: {
      scoreTemperature: 1.1,
      smartDrawBoost: false,
      drawMultiplier: 1.12,
      lowScoreDrawBoost: 0.1,
      drawBoostCloseMatch: 0.06,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.75,
      smartDrawMaxBoost: 1.75,
    },
  },
  {
    id: 'elo65_smart_draw',
    label: 'Elo 65 % + Smart Draw moyen',
    description: 'Elo plus présent, avec correction intelligente des nuls.',
    settingsPatch: {
      externalEloImpact: 0.65,
      internalEloImpact: 0.65,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
  {
    id: 'v3_mpp_prudent',
    label: 'v3 MPP prudent',
    description: 'Elo dynamique + modèle 1/N/2 séparé + recalibrage score exact, orienté points MPP.',
    settingsPatch: {
      scoreModel: 'ensemble_v3',
      scoreTemperature: 1.08,
      enableDynamicElo: true,
      dynamicEloWeight: 0.5,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.58,
      drawModelWeight: 0.62,
      scoreOutcomeCalibrationWeight: 0.8,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.25,
      dataConfidenceWeight: 0.95,
      scoreCalibration: 'conservative',
      favoriteControlWeight: 0.08,
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'v3_mpp_result',
    label: 'v3 MPP résultat fort',
    description: 'Version v3 qui donne plus de poids au modèle 1/N/2 séparé.',
    settingsPatch: {
      scoreModel: 'hybrid_dc_bivariate',
      scoreTemperature: 1.06,
      enableDynamicElo: true,
      dynamicEloWeight: 0.55,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.72,
      drawModelWeight: 0.55,
      scoreOutcomeCalibrationWeight: 0.9,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.25,
      dataConfidenceWeight: 0.95,
      scoreCalibration: 'conservative',
      favoriteControlWeight: 0.08,
      smartDrawBoost: true,
      drawMultiplier: 1.05,
      lowScoreDrawBoost: 0.04,
      drawBoostCloseMatch: 0.035,
      drawBoostLowTotal: 0.025,
      drawBoostMax: 1.16,
      smartDrawMaxBoost: 1.16,
      smartDrawFavoritePenalty: 0.85,
    },
  },
  {
    id: 'v3_mpp_draw',
    label: 'v3 MPP nuls contrôlés',
    description: 'Version v3 avec modèle nul plus présent mais recalibrage plafonné.',
    settingsPatch: {
      scoreModel: 'ensemble_v3',
      scoreTemperature: 1.1,
      enableDynamicElo: true,
      dynamicEloWeight: 0.5,
      separateOutcomeModel: true,
      outcomeModelWeight: 0.55,
      drawModelWeight: 0.8,
      scoreOutcomeCalibrationWeight: 0.78,
      advancedCompetitionWeights: true,
      opponentEloAdjustmentWeight: 0.45,
      dataConfidenceWeight: 1.15,
      scoreCalibration: 'classic_top1',
      favoriteControlWeight: 0.15,
      smartDrawBoost: true,
      drawMultiplier: 1.08,
      lowScoreDrawBoost: 0.07,
      drawBoostCloseMatch: 0.055,
      drawBoostLowTotal: 0.04,
      drawBoostMax: 1.25,
      smartDrawMaxBoost: 1.25,
      smartDrawFavoritePenalty: 0.8,
    },
  },
];

function parseNumber(value: string): number {
  const normalized = value.replace(',', '.').trim();
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function formatPoints(value: number): string {
  return `${value.toFixed(0)} pts`;
}

function formatDecimal(value: number): string {
  return value.toFixed(2);
}

function getFixtureKey(fixture: FixtureLike): string {
  return String(
    fixture.id ?? `${fixture.date}-${fixture.homeTeam}-${fixture.awayTeam}`
  );
}

function getFixtureTime(fixture: FixtureLike): string {
  return fixture.time ?? fixture.kickoffTime ?? '';
}

function formatFixtureLabel(fixture: FixtureLike): string {
  const time = getFixtureTime(fixture);

  return `${fixture.date}${time ? ` ${time}` : ''} · Groupe ${
    fixture.group ?? '-'
  } · ${fixture.homeTeam} - ${fixture.awayTeam}`;
}

function buildRecordFromFixture(fixture: FixtureLike): EditableMppRecord {
  return {
    matchKey: getFixtureKey(fixture),
    date: fixture.date,
    group: fixture.group,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    neutral: fixture.neutral ?? true,

    homeMppPoints: '',
    drawMppPoints: '',
    awayMppPoints: '',

    actualHomeScore: Number.isFinite(fixture.homeScore)
      ? String(fixture.homeScore)
      : '',

    actualAwayScore: Number.isFinite(fixture.awayScore)
      ? String(fixture.awayScore)
      : '',
  };
}

function loadStoredRecords(): Record<string, EditableMppRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function saveStoredRecords(records: Record<string, EditableMppRecord>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function isRecordStarted(record: EditableMppRecord | undefined): boolean {
  if (!record) return false;

  return (
    record.homeMppPoints.trim() !== '' ||
    record.drawMppPoints.trim() !== '' ||
    record.awayMppPoints.trim() !== '' ||
    record.actualHomeScore.trim() !== '' ||
    record.actualAwayScore.trim() !== ''
  );
}

function isRecordComplete(record: EditableMppRecord): boolean {
  return (
    Number.isFinite(parseNumber(record.homeMppPoints)) &&
    Number.isFinite(parseNumber(record.drawMppPoints)) &&
    Number.isFinite(parseNumber(record.awayMppPoints)) &&
    Number.isFinite(parseNumber(record.actualHomeScore)) &&
    Number.isFinite(parseNumber(record.actualAwayScore))
  );
}

function getRecordStatus(
  record: EditableMppRecord | undefined
): 'empty' | 'started' | 'complete' {
  if (!record || !isRecordStarted(record)) {
    return 'empty';
  }

  if (isRecordComplete(record)) {
    return 'complete';
  }

  return 'started';
}

function getOptionPrefix(status: 'empty' | 'started' | 'complete'): string {
  if (status === 'complete') return '✅ ';
  if (status === 'started') return '🟠 ';

  return '';
}

function getOptionStyle(status: 'empty' | 'started' | 'complete') {
  if (status === 'complete') {
    return {
      backgroundColor: '#14532d',
      color: '#ffffff',
      fontWeight: 700,
    };
  }

  if (status === 'started') {
    return {
      backgroundColor: '#78350f',
      color: '#ffffff',
      fontWeight: 700,
    };
  }

  return undefined;
}

function convertRecordToInput(record: EditableMppRecord): MppBacktestInput {
  return {
    matchKey: record.matchKey,
    date: record.date,
    group: record.group,
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
    neutral: record.neutral,

    homeMppPoints: parseNumber(record.homeMppPoints),
    drawMppPoints: parseNumber(record.drawMppPoints),
    awayMppPoints: parseNumber(record.awayMppPoints),

    actualHomeScore: parseNumber(record.actualHomeScore),
    actualAwayScore: parseNumber(record.actualAwayScore),
  };
}

function getOutcomeHitLabel(value: boolean): string {
  return value ? 'OK' : 'Raté';
}

function getOutcomeHitClass(value: boolean): string {
  return value ? 'diagnostic-pill ok' : 'diagnostic-pill danger';
}

export function MppBacktestPage({ matches, settings }: MppBacktestPageProps) {
  const fixtures = worldCup2026Fixtures as FixtureLike[];

  const sortedFixtures = useMemo(() => {
    return [...fixtures].sort((a, b) => {
      const aValue = `${a.date}-${getFixtureTime(a)}-${a.homeTeam}`;
      const bValue = `${b.date}-${getFixtureTime(b)}-${b.homeTeam}`;

      return aValue.localeCompare(bValue);
    });
  }, [fixtures]);

  const [records, setRecords] = useState<Record<string, EditableMppRecord>>({});
  const [selectedMatchKey, setSelectedMatchKey] = useState<string>(
    sortedFixtures[0] ? getFixtureKey(sortedFixtures[0]) : ''
  );

  const selectedFixture = useMemo(() => {
    return sortedFixtures.find(
      (fixture) => getFixtureKey(fixture) === selectedMatchKey
    );
  }, [sortedFixtures, selectedMatchKey]);

  const selectedRecord = useMemo(() => {
    if (!selectedFixture) {
      return null;
    }

    return records[selectedMatchKey] ?? buildRecordFromFixture(selectedFixture);
  }, [records, selectedFixture, selectedMatchKey]);

  const completedRecords = useMemo(() => {
    return Object.values(records)
      .filter(isRecordComplete)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [records]);

  const startedRecords = useMemo(() => {
    return Object.values(records).filter(isRecordStarted);
  }, [records]);

  const incompleteStartedRecords = useMemo(() => {
    return startedRecords.filter((record) => !isRecordComplete(record));
  }, [startedRecords]);

  const [backtestResult, setBacktestResult] =
    useState<MppBacktestResult | null>(null);

  const [modelCalibrationRows, setModelCalibrationRows] =
    useState<MppModelCalibrationRow[]>([]);

  useEffect(() => {
    setRecords(loadStoredRecords());
  }, []);

  function updateSelectedRecord<K extends keyof EditableMppRecord>(
    key: K,
    value: EditableMppRecord[K]
  ) {
    if (!selectedRecord) {
      return;
    }

    const nextRecord: EditableMppRecord = {
      ...selectedRecord,
      [key]: value,
    };

    setRecords((previous) => ({
      ...previous,
      [nextRecord.matchKey]: nextRecord,
    }));
  }

  function handleSaveRecords(nextRecords: Record<string, EditableMppRecord>) {
    setRecords(nextRecords);
    saveStoredRecords(nextRecords);
  }

  function handleSaveSelectedRecord() {
    if (!selectedRecord) {
      return;
    }

    const nextRecords = {
      ...records,
      [selectedRecord.matchKey]: selectedRecord,
    };

    handleSaveRecords(nextRecords);
  }

  function handleDeleteSelectedRecord() {
    if (!selectedRecord) {
      return;
    }

    const nextRecords = { ...records };
    delete nextRecords[selectedRecord.matchKey];

    handleSaveRecords(nextRecords);
  }

  function handleUseFixtureScore() {
    if (!selectedFixture || !selectedRecord) {
      return;
    }

    const nextRecord: EditableMppRecord = {
      ...selectedRecord,
      actualHomeScore: Number.isFinite(selectedFixture.homeScore)
        ? String(selectedFixture.homeScore)
        : selectedRecord.actualHomeScore,
      actualAwayScore: Number.isFinite(selectedFixture.awayScore)
        ? String(selectedFixture.awayScore)
        : selectedRecord.actualAwayScore,
    };

    const nextRecords = {
      ...records,
      [nextRecord.matchKey]: nextRecord,
    };

    handleSaveRecords(nextRecords);
  }

  function handleRunBacktest() {
    const inputs = completedRecords.map(convertRecordToInput);
    const result = runMppBacktest(inputs, matches, settings);

    setBacktestResult(result);
  }

  function handleRunModelCalibration() {
    const inputs = completedRecords.map(convertRecordToInput);

    const rows = MPP_MODEL_CALIBRATION_PRESETS.map((preset) => {
      const calibratedSettings: ModelSettings = {
        ...settings,
        ...preset.settingsPatch,
      };

      const result = runMppBacktest(inputs, matches, calibratedSettings);
      const recommendedSummary =
        result.summaries.find((summary) => summary.strategyId === 'recommended') ??
        result.bestStrategy ??
        null;

      return {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        settingsPatch: preset.settingsPatch,
        summary: recommendedSummary,
      };
    }).sort((a, b) => (b.summary?.pointsWon ?? 0) - (a.summary?.pointsWon ?? 0));

    setModelCalibrationRows(rows);
  }

  function handleResetAll() {
    const confirmed = window.confirm(
      'Supprimer toutes les cotes/résultats MPP sauvegardés ?'
    );

    if (!confirmed) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setRecords({});
    setBacktestResult(null);
  }

  function handleExportJson() {
    const json = JSON.stringify(records, null, 2);
    navigator.clipboard.writeText(json);
    alert('Données copiées dans le presse-papiers.');
  }

  function handleImportJson() {
    const raw = window.prompt('Colle ici le JSON exporté précédemment :');

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') {
        alert('JSON invalide.');
        return;
      }

      handleSaveRecords(parsed);
    } catch {
      alert('Impossible de lire ce JSON.');
    }
  }

  return (
    <div className="page-stack">
      <section className="card hero">
        <p className="eyebrow">Backtest MPP Coupe du Monde</p>
        <h1>Tester les stratégies MPP sur les matchs déjà joués</h1>

        <p>
          Cette page sert à vérifier objectivement quelle stratégie aurait
          marqué le plus de points. Tu rentres les points MPP du 1 / N / 2 et le
          score réel, puis l’outil compare les choix possibles.
        </p>

        <p>
          Dans la liste des matchs : <strong>vert</strong> signifie complet et
          prêt pour le backtest, <strong>orange</strong> signifie commencé mais
          incomplet.
        </p>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Saisie</p>
          <h2>Ajouter les points MPP et le score réel</h2>
        </div>

        <label className="settings-label">
          Match
          <select
            value={selectedMatchKey}
            onChange={(event) => setSelectedMatchKey(event.target.value)}
          >
            {sortedFixtures.map((fixture) => {
              const key = getFixtureKey(fixture);
              const savedRecord = records[key];
              const status = getRecordStatus(savedRecord);

              return (
                <option key={key} value={key} style={getOptionStyle(status)}>
                  {getOptionPrefix(status)}
                  {formatFixtureLabel(fixture)}
                </option>
              );
            })}
          </select>
        </label>

        {selectedRecord && (
          <>
            <div className="grid two-columns">
              <label className="settings-label">
                Points MPP victoire {selectedRecord.homeTeam}
                <input
                  value={selectedRecord.homeMppPoints}
                  onChange={(event) =>
                    updateSelectedRecord('homeMppPoints', event.target.value)
                  }
                  placeholder="22"
                />
              </label>

              <label className="settings-label">
                Points MPP match nul
                <input
                  value={selectedRecord.drawMppPoints}
                  onChange={(event) =>
                    updateSelectedRecord('drawMppPoints', event.target.value)
                  }
                  placeholder="166"
                />
              </label>

              <label className="settings-label">
                Points MPP victoire {selectedRecord.awayTeam}
                <input
                  value={selectedRecord.awayMppPoints}
                  onChange={(event) =>
                    updateSelectedRecord('awayMppPoints', event.target.value)
                  }
                  placeholder="189"
                />
              </label>

              <label className="settings-label">
                Score réel {selectedRecord.homeTeam}
                <input
                  value={selectedRecord.actualHomeScore}
                  onChange={(event) =>
                    updateSelectedRecord('actualHomeScore', event.target.value)
                  }
                  placeholder="2"
                />
              </label>

              <label className="settings-label">
                Score réel {selectedRecord.awayTeam}
                <input
                  value={selectedRecord.actualAwayScore}
                  onChange={(event) =>
                    updateSelectedRecord('actualAwayScore', event.target.value)
                  }
                  placeholder="1"
                />
              </label>
            </div>

            <div className="grid two-columns">
              <button
                type="button"
                className="primary-button"
                onClick={handleSaveSelectedRecord}
              >
                Sauvegarder ce match
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={handleUseFixtureScore}
              >
                Reprendre le score du calendrier
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={handleDeleteSelectedRecord}
              >
                Supprimer ce match
              </button>
            </div>
          </>
        )}

        <p className="import-status">
          {completedRecords.length} matchs complets prêts pour le backtest.
          {incompleteStartedRecords.length > 0
            ? ` ${incompleteStartedRecords.length} matchs sont commencés mais incomplets.`
            : ''}
        </p>
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Backtest</p>
          <h2>Lancer la simulation</h2>
        </div>

        <div className="grid two-columns">
          <button
            className="primary-button"
            type="button"
            onClick={handleRunBacktest}
            disabled={completedRecords.length === 0}
          >
            Lancer le backtest MPP
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleRunModelCalibration}
            disabled={completedRecords.length === 0}
          >
            Tester les réglages modèle sur MPP
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleExportJson}
          >
            Exporter les données
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleImportJson}
          >
            Importer des données
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={handleResetAll}
          >
            Tout supprimer
          </button>
        </div>
      </section>

      {modelCalibrationRows.length > 0 && (
        <section className="card">
          <div className="section-title">
            <p className="eyebrow">Calibration modèle avec points MPP</p>
            <h2>Quel réglage du moteur rapporte le plus avec le Conseil final ?</h2>
          </div>

          <p>
            Ce tableau relance le backtest MPP avec plusieurs réglages du moteur de prédiction.
            Il garde la stratégie <strong>Conseil final</strong> et compare directement les points gagnés.
          </p>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Réglage modèle</th>
                  <th>Bons résultats</th>
                  <th>Scores exacts</th>
                  <th>Points gagnés</th>
                  <th>Max possible</th>
                  <th>Récupération</th>
                  <th>Description</th>
                </tr>
              </thead>

              <tbody>
                {modelCalibrationRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.label}</strong>
                    </td>
                    <td>
                      {row.summary
                        ? `${row.summary.correctOutcomes} / ${row.summary.matches} · ${formatPercent(row.summary.correctOutcomeRate)}`
                        : '-'}
                    </td>
                    <td>
                      {row.summary
                        ? `${row.summary.exactScores} / ${row.summary.matches} · ${formatPercent(row.summary.exactScoreRate)}`
                        : '-'}
                    </td>
                    <td>
                      <strong>{row.summary ? formatPoints(row.summary.pointsWon) : '-'}</strong>
                    </td>
                    <td>{row.summary ? formatPoints(row.summary.maxPossiblePoints) : '-'}</td>
                    <td>{row.summary ? formatPercent(row.summary.captureRate) : '-'}</td>
                    <td>{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {backtestResult && (
        <>
          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Résumé</p>
              <h2>Comparaison des stratégies</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Stratégie</th>
                    <th>Matchs</th>
                    <th>Bons résultats</th>
                    <th>Scores exacts</th>
                    <th>Points gagnés</th>
                    <th>Max possible</th>
                    <th>Points laissés</th>
                    <th>Récupération</th>
                  </tr>
                </thead>

                <tbody>
                  {backtestResult.summaries.map((summary) => (
                    <tr key={summary.strategyId}>
                      <td>
                        <strong>{summary.strategyLabel}</strong>
                      </td>
                      <td>{summary.matches}</td>
                      <td>
                        {summary.correctOutcomes} / {summary.matches} ·{' '}
                        {formatPercent(summary.correctOutcomeRate)}
                      </td>
                      <td>
                        {summary.exactScores} / {summary.matches} ·{' '}
                        {formatPercent(summary.exactScoreRate)}
                      </td>
                      <td>
                        <strong>{formatPoints(summary.pointsWon)}</strong>
                      </td>
                      <td>{formatPoints(summary.maxPossiblePoints)}</td>
                      <td>{formatPoints(summary.missedPoints)}</td>
                      <td>{formatPercent(summary.captureRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {backtestResult.bestStrategy && (
              <p className="import-status">
                Meilleure stratégie actuelle :{' '}
                <strong>{backtestResult.bestStrategy.strategyLabel}</strong>{' '}
                avec{' '}
                <strong>
                  {formatPoints(backtestResult.bestStrategy.pointsWon)}
                </strong>{' '}
                récupérés sur{' '}
                <strong>
                  {formatPoints(backtestResult.bestStrategy.maxPossiblePoints)}
                </strong>
                .
              </p>
            )}
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Détail par match</p>
              <h2>Voir où les points sont gagnés ou perdus</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Score réel</th>
                    <th>Points MPP 1/N/2</th>
                    <th>Max possible</th>
                    <th>Score le plus probable</th>
                    <th>Meilleure espérance</th>
                    <th>Conseil final</th>
                  </tr>
                </thead>

                <tbody>
                  {backtestResult.matches.map((match) => {
                    const topScore = match.strategyResults.find(
                      (result) => result.strategyId === 'model_top_score'
                    );

                    const bestExpected = match.strategyResults.find(
                      (result) => result.strategyId === 'best_expected'
                    );

                    const recommended = match.strategyResults.find(
                      (result) => result.strategyId === 'recommended'
                    );

                    return (
                      <tr key={match.matchKey}>
                        <td>
                          <strong>
                            {match.homeTeam} - {match.awayTeam}
                          </strong>
                          <br />
                          <span className="muted-text">
                            {match.date} · Groupe {match.group ?? '-'}
                          </span>
                        </td>

                        <td>
                          <strong>{match.actualScoreLabel}</strong>
                          <br />
                          <span className="muted-text">
                            {match.actualOutcomeLabel}
                          </span>
                        </td>

                        <td>
                          {formatPoints(match.homeMppPoints)} /{' '}
                          {formatPoints(match.drawMppPoints)} /{' '}
                          {formatPoints(match.awayMppPoints)}
                        </td>

                        <td>
                          <strong>
                            {formatPoints(match.maxPossiblePoints)}
                          </strong>
                        </td>

                        {[topScore, bestExpected, recommended].map(
                          (result, index) => (
                            <td key={index}>
                              {result ? (
                                <>
                                  <strong>{result.pickedScore}</strong>
                                  <br />
                                  <span
                                    className={getOutcomeHitClass(
                                      result.correctOutcome
                                    )}
                                  >
                                    Résultat{' '}
                                    {getOutcomeHitLabel(result.correctOutcome)}
                                  </span>
                                  <br />
                                  <span
                                    className={getOutcomeHitClass(
                                      result.exactScore
                                    )}
                                  >
                                    Exact{' '}
                                    {getOutcomeHitLabel(result.exactScore)}
                                  </span>
                                  <br />
                                  <span>
                                    {formatPoints(result.pointsWon)} gagnés
                                  </span>
                                </>
                              ) : (
                                '-'
                              )}
                            </td>
                          )
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Analyse complète</p>
              <h2>Toutes les stratégies par match</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Stratégie</th>
                    <th>Score joué</th>
                    <th>Résultat</th>
                    <th>Points gagnés</th>
                    <th>Points laissés</th>
                    <th>Espérance du choix</th>
                    <th>Risque</th>
                  </tr>
                </thead>

                <tbody>
                  {backtestResult.matches.flatMap((match) =>
                    match.strategyResults.map((result) => (
                      <tr key={`${match.matchKey}-${result.strategyId}`}>
                        <td>
                          <strong>
                            {match.homeTeam} - {match.awayTeam}
                          </strong>
                          <br />
                          <span className="muted-text">
                            Réel : {match.actualScoreLabel}
                          </span>
                        </td>

                        <td>{result.strategyLabel}</td>

                        <td>
                          <strong>{result.pickedScore}</strong>
                          <br />
                          <span className="muted-text">
                            {result.pickedOutcomeLabel}
                          </span>
                        </td>

                        <td>
                          <span
                            className={getOutcomeHitClass(
                              result.correctOutcome
                            )}
                          >
                            Résultat {getOutcomeHitLabel(result.correctOutcome)}
                          </span>
                          <br />
                          <span
                            className={getOutcomeHitClass(result.exactScore)}
                          >
                            Exact {getOutcomeHitLabel(result.exactScore)}
                          </span>
                        </td>

                        <td>
                          <strong>{formatPoints(result.pointsWon)}</strong>
                        </td>

                        <td>{formatPoints(result.missedPoints)}</td>

                        <td>
                          {formatDecimal(result.pickedExpectedPoints)} pts
                        </td>

                        <td>{result.pickedRiskLabel}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
