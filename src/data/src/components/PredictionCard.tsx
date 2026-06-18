import type { MatchPrediction } from '../types/football';
import { formatPercent } from '../utils/formatters';

type PredictionCardProps = {
  prediction: MatchPrediction;
};

export function PredictionCard({ prediction }: PredictionCardProps) {
  const mostLikelyScore = prediction.topScores[0];

  return (
    <section className="card highlight-card">
      <div className="section-title">
        <p className="eyebrow">Prédiction</p>
        <h2>
          {prediction.teamA} vs {prediction.teamB}
        </h2>
      </div>

      <div className="expected-goals">
        <div>
          <span>{prediction.teamA}</span>
          <strong>{prediction.expectedGoalsA.toFixed(2)} xG</strong>
        </div>
        <div>
          <span>{prediction.teamB}</span>
          <strong>{prediction.expectedGoalsB.toFixed(2)} xG</strong>
        </div>
      </div>

      {mostLikelyScore && (
        <div className="main-score">
          Score exact le plus probable :{' '}
          <strong>
            {prediction.teamA} {mostLikelyScore.homeGoals} - {mostLikelyScore.awayGoals} {prediction.teamB}
          </strong>{' '}
          ({formatPercent(mostLikelyScore.probability)})
        </div>
      )}

      <div className="stats-grid">
        <div>
          <span>Victoire {prediction.teamA}</span>
          <strong>{formatPercent(prediction.outcomes.teamAWin)}</strong>
        </div>
        <div>
          <span>Nul</span>
          <strong>{formatPercent(prediction.outcomes.draw)}</strong>
        </div>
        <div>
          <span>Victoire {prediction.teamB}</span>
          <strong>{formatPercent(prediction.outcomes.teamBWin)}</strong>
        </div>
        <div>
          <span>Over 1.5</span>
          <strong>{formatPercent(prediction.outcomes.over15)}</strong>
        </div>
        <div>
          <span>Over 2.5</span>
          <strong>{formatPercent(prediction.outcomes.over25)}</strong>
        </div>
        <div>
          <span>Clean sheet {prediction.teamA}</span>
          <strong>{formatPercent(prediction.outcomes.teamACleanSheet)}</strong>
        </div>
      </div>
    </section>
  );
}
