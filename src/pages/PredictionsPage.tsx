import { useEffect, useMemo, useState } from 'react';
import type {
  MatchPrediction,
  MatchResult,
  ModelSettings,
  PredictionContext,
} from '../types/football';
import type { MppOdds, MppScoreAdvice } from '../types/mpp';
import type { WorldCupMatch } from '../types/worldcup';
import { analyzeMppPrediction } from '../utils/mppScoring';
import type { MppRecordsByKey } from '../utils/mppWorldCupStorage';
import {
  getMppRecordForFixture,
  hasMppPoints,
  upsertMppRecordForFixture,
} from '../utils/mppWorldCupStorage';
import { predictScoreDistribution } from '../utils/predictionModel';

type PredictionsPageProps = {
  matches: MatchResult[];
  settings: ModelSettings;
  initialTeamA?: string;
  initialTeamB?: string;
  initialContext?: PredictionContext;
  initialWorldCupMatch?: WorldCupMatch;
  mppRecords?: MppRecordsByKey;
  onMppRecordsChange?: (records: MppRecordsByKey) => void;
};

function parseDecimalInput(value: string): number {
  const normalized = value.replace(',', '.').trim();

  if (normalized === '') {
    return 0;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return '-';

  const sign = value > 0 ? '+' : '';

  return `${sign}${(value * 100).toFixed(1)} pts`;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function getEdgeClass(edge: number | null): string {
  if (edge === null) return 'diagnostic-pill warning';
  if (edge >= 0.04) return 'diagnostic-pill ok';
  if (edge <= -0.04) return 'diagnostic-pill danger';

  return 'diagnostic-pill warning';
}

function PickCard({ title, pick }: { title: string; pick?: MppScoreAdvice }) {
  if (!pick) {
    return (
      <article className="card mini-card">
        <p className="eyebrow">{title}</p>
        <h2>-</h2>
        <p className="muted-text">
          Aucune recommandation disponible pour ce bloc.
        </p>
      </article>
    );
  }

  return (
    <article className="card mini-card">
      <p className="eyebrow">{title}</p>
      <h2>{pick.scoreLabel}</h2>

      <p>
        <strong>{pick.outcomeLabel}</strong>
      </p>

      <p>
        Proba score exact :{' '}
        <strong>{formatPercent(pick.exactProbability)}</strong>
        <br />
        Proba résultat :{' '}
        <strong>{formatPercent(pick.outcomeProbability)}</strong>
        <br />
        Points si bon résultat :{' '}
        <strong>{pick.outcomePoints.toFixed(0)} pts</strong>
        <br />
        Points si score exact :{' '}
        <strong>{pick.exactScoreTotalPoints.toFixed(0)} pts</strong>
      </p>

      <p>
        Espérance : <strong>{formatNumber(pick.expectedPoints)} pts</strong>
        <br />
        Risque : <strong>{pick.riskLabel}</strong>
        <br />
        Lecture : <strong>{pick.readingLabel}</strong>
      </p>

      <p className="muted-text">{pick.reason}</p>
    </article>
  );
}

export function PredictionsPage({
  matches,
  settings,
  initialTeamA,
  initialTeamB,
  initialContext,
  initialWorldCupMatch,
  mppRecords = {},
  onMppRecordsChange,
}: PredictionsPageProps) {
  const [teamA, setTeamA] = useState(initialTeamA ?? 'France');
  const [teamB, setTeamB] = useState(initialTeamB ?? 'Senegal');

  const [teamAOdds, setTeamAOdds] = useState('22');
  const [drawOdds, setDrawOdds] = useState('166');
  const [teamBOdds, setTeamBOdds] = useState('189');

  function saveOddsForSelectedWorldCupMatch(patch: {
    homeMppPoints?: string;
    drawMppPoints?: string;
    awayMppPoints?: string;
  }) {
    if (!initialWorldCupMatch || !onMppRecordsChange) {
      return;
    }

    const nextRecords = upsertMppRecordForFixture(
      mppRecords,
      initialWorldCupMatch,
      patch
    );

    onMppRecordsChange(nextRecords);
  }

  useEffect(() => {
    if (initialTeamA) {
      setTeamA(initialTeamA);
    }

    if (initialTeamB) {
      setTeamB(initialTeamB);
    }
  }, [initialTeamA, initialTeamB]);

  useEffect(() => {
    if (!initialWorldCupMatch) {
      return;
    }

    const storedRecord = getMppRecordForFixture(
      mppRecords,
      initialWorldCupMatch
    );

    if (!hasMppPoints(storedRecord)) {
      return;
    }

    setTeamAOdds(storedRecord!.homeMppPoints);
    setDrawOdds(storedRecord!.drawMppPoints);
    setTeamBOdds(storedRecord!.awayMppPoints);
  }, [initialWorldCupMatch, mppRecords]);

  const context: PredictionContext = useMemo(
    () => ({
      neutral: initialContext?.neutral ?? true,
      teamAIsHome: initialContext?.teamAIsHome ?? true,
      tournament: initialContext?.tournament ?? 'FIFA World Cup',
      predictionDate: initialContext?.predictionDate,
    }),
    [initialContext]
  );

  const odds: MppOdds = useMemo(
    () => ({
      teamAWin: parseDecimalInput(teamAOdds),
      draw: parseDecimalInput(drawOdds),
      teamBWin: parseDecimalInput(teamBOdds),
    }),
    [teamAOdds, drawOdds, teamBOdds]
  );

  const prediction: MatchPrediction | null = useMemo(() => {
    if (!teamA.trim() || !teamB.trim()) {
      return null;
    }

    return predictScoreDistribution(
      teamA.trim(),
      teamB.trim(),
      matches,
      settings,
      context
    );
  }, [teamA, teamB, matches, settings, context]);

  const analysis = useMemo(() => {
    if (!prediction) {
      return null;
    }

    return analyzeMppPrediction(prediction, odds);
  }, [prediction, odds]);

  const topRawScores = prediction?.topScores ?? [];
  const scoreAdvices = analysis?.scoreAdvices.slice(0, 18) ?? [];

  return (
    <div className="page-stack">
      <section className="card hero">
        <p className="eyebrow">Prédiction + stratégie MPP</p>
        <h1>Prédire le match et choisir le meilleur score à jouer</h1>

        <p>
          Cette page combine le modèle de prédiction et les points MPP. Le
          conseil ne dépend plus de ton classement : il cherche le meilleur
          équilibre entre espérance de points et risque réel.
        </p>

        {context.predictionDate ? (
          <p>
            Pour éviter toute fuite de données, le modèle utilise uniquement les
            matchs joués avant le <strong>{context.predictionDate}</strong>.
          </p>
        ) : (
          <p>
            Mode prédiction manuelle : aucune date limite spécifique n’est
            appliquée au match.
          </p>
        )}
      </section>

      <section className="card">
        <div className="section-title">
          <p className="eyebrow">Entrées</p>
          <h2>Match et points MPP</h2>
        </div>

        <div className="grid two-columns">
          <label className="settings-label">
            Équipe A
            <input
              value={teamA}
              onChange={(event) => setTeamA(event.target.value)}
              placeholder="France"
            />
          </label>

          <label className="settings-label">
            Équipe B
            <input
              value={teamB}
              onChange={(event) => setTeamB(event.target.value)}
              placeholder="Iraq"
            />
          </label>

          <label className="settings-label">
            Points MPP si victoire {teamA || 'équipe A'}
            <input
              value={teamAOdds}
              onChange={(event) => {
                setTeamAOdds(event.target.value);
                saveOddsForSelectedWorldCupMatch({
                  homeMppPoints: event.target.value,
                });
              }}
              placeholder="22"
            />
          </label>

          <label className="settings-label">
            Points MPP si match nul
            <input
              value={drawOdds}
              onChange={(event) => {
                setDrawOdds(event.target.value);
                saveOddsForSelectedWorldCupMatch({
                  drawMppPoints: event.target.value,
                });
              }}
              placeholder="166"
            />
          </label>

          <label className="settings-label">
            Points MPP si victoire {teamB || 'équipe B'}
            <input
              value={teamBOdds}
              onChange={(event) => {
                setTeamBOdds(event.target.value);
                saveOddsForSelectedWorldCupMatch({
                  awayMppPoints: event.target.value,
                });
              }}
              placeholder="189"
            />
          </label>
        </div>

        {initialWorldCupMatch && hasMppPoints(getMppRecordForFixture(mppRecords, initialWorldCupMatch)) && (
          <p className="import-status">
            Points MPP préremplis depuis Backtest MPP et sauvegardés automatiquement.
          </p>
        )}

        <p className="import-status">
          Barème utilisé : si tu trouves le bon résultat, tu gagnes les points
          MPP indiqués. Si tu trouves le score exact, tu gagnes ces points + un
          bonus de rareté estimé automatiquement : +20, +30, +50, +70 ou +100
          points. Si le résultat est faux, tu gagnes 0 point.
        </p>
      </section>

      {prediction && analysis && (
        <>
          <section className="stats-summary-grid">
            <article className="card mini-card">
              <p className="eyebrow">Conseil final</p>
              <h2>{analysis.recommendedPick.scoreLabel}</h2>
              <p>
                {analysis.recommendedPick.outcomeLabel}
                <br />
                Espérance :{' '}
                <strong>
                  {formatNumber(analysis.recommendedPick.expectedPoints)} pts
                </strong>
                <br />
                {analysis.recommendedPick.riskLabel}
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Meilleure espérance brute</p>
              <h2>{analysis.bestExpectedPick.scoreLabel}</h2>
              <p>
                {formatNumber(analysis.bestExpectedPick.expectedPoints)} pts en
                moyenne.
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">xG modèle</p>
              <h2>
                {prediction.expectedGoalsA.toFixed(2)} -{' '}
                {prediction.expectedGoalsB.toFixed(2)}
              </h2>
              <p>
                {prediction.teamA} vs {prediction.teamB}
              </p>
            </article>

            <article className="card mini-card">
              <p className="eyebrow">Probabilités 1N2</p>
              <h2>1 : {formatPercent(prediction.outcomes.teamAWin)}</h2>
              <p>
                N : {formatPercent(prediction.outcomes.draw)} · 2 :{' '}
                {formatPercent(prediction.outcomes.teamBWin)}
              </p>
            </article>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Lecture risque / rendement</p>
              <h2>{analysis.analysisLabel}</h2>
            </div>

            <p>{analysis.analysisExplanation}</p>

            <div className="stats-summary-grid">
              <PickCard title="Choix le plus sûr" pick={analysis.safestPick} />
              <PickCard
                title="Meilleure espérance"
                pick={analysis.bestExpectedPick}
              />
              <PickCard
                title="Score différenciant"
                pick={analysis.upsidePick}
              />
              <PickCard title="Conseil final" pick={analysis.recommendedPick} />
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Points MPP</p>
              <h2>Comparaison modèle vs points proposés</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Points MPP</th>
                    <th>Proba modèle</th>
                    <th>Popularité marché estimée</th>
                    <th>Écart</th>
                    <th>Lecture</th>
                    <th>Score le plus probable</th>
                  </tr>
                </thead>

                <tbody>
                  {analysis.outcomeAdvices.map((advice) => (
                    <tr key={advice.outcome}>
                      <td>
                        <strong>{advice.label}</strong>
                      </td>

                      <td>
                        {advice.mppPoints
                          ? `${advice.mppPoints.toFixed(0)} pts`
                          : '-'}
                      </td>

                      <td>{formatPercent(advice.modelProbability)}</td>

                      <td>
                        {advice.normalizedMarketProbability === null
                          ? '-'
                          : formatPercent(advice.normalizedMarketProbability)}
                      </td>

                      <td>{formatSignedPercent(advice.edge)}</td>

                      <td>
                        <span className={getEdgeClass(advice.edge)}>
                          {advice.edgeLabel}
                        </span>
                      </td>

                      <td>
                        {advice.bestScoreLabel} ·{' '}
                        {formatPercent(advice.bestScoreProbability)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Scores MPP</p>
              <h2>Classement des scores par espérance et risque</h2>
            </div>

            {scoreAdvices.length === 0 ? (
              <p className="import-status">
                Aucun score MPP n’a pu être calculé pour ce match.
              </p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Score</th>
                      <th>Lecture</th>
                      <th>Résultat</th>
                      <th>Proba score</th>
                      <th>Proba résultat</th>
                      <th>Risque</th>
                      <th>Points résultat</th>
                      <th>Bonus exact</th>
                      <th>Points score exact</th>
                      <th>Espérance</th>
                      <th>Détail EV</th>
                      <th>Pourquoi</th>
                    </tr>
                  </thead>

                  <tbody>
                    {scoreAdvices.map((score, index) => (
                      <tr key={`${score.scoreLabel}-${index}`}>
                        <td>
                          <strong>{score.scoreLabel}</strong>
                        </td>

                        <td>
                          <span className="diagnostic-pill warning">
                            {score.readingLabel}
                          </span>
                        </td>

                        <td>{score.outcomeLabel}</td>

                        <td>{formatPercent(score.exactProbability)}</td>

                        <td>{formatPercent(score.outcomeProbability)}</td>

                        <td>{score.riskLabel}</td>

                        <td>{score.outcomePoints.toFixed(0)} pts</td>

                        <td>+{score.exactBonusPoints}</td>

                        <td>
                          <strong>
                            {score.exactScoreTotalPoints.toFixed(0)} pts
                          </strong>
                        </td>

                        <td>
                          <strong>
                            {formatNumber(score.expectedPoints)} pts
                          </strong>
                        </td>

                        <td>
                          Résultat : {formatNumber(score.baseExpectedPoints)} ·
                          Bonus : {formatNumber(score.exactBonusExpectedPoints)}
                        </td>

                        <td>{score.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-title">
              <p className="eyebrow">Modèle brut</p>
              <h2>Top scores exacts du modèle</h2>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Probabilité</th>
                  </tr>
                </thead>

                <tbody>
                  {topRawScores.map((score) => (
                    <tr key={`${score.homeGoals}-${score.awayGoals}`}>
                      <td>
                        <strong>
                          {score.homeGoals}-{score.awayGoals}
                        </strong>
                      </td>
                      <td>{formatPercent(score.probability)}</td>
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
