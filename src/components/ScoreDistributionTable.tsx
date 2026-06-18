import type { MatchPrediction } from '../types/football';
import { formatPercent } from '../utils/formatters';

type ScoreDistributionTableProps = {
  prediction: MatchPrediction;
};

export function ScoreDistributionTable({ prediction }: ScoreDistributionTableProps) {
  return (
    <section className="card">
      <div className="section-title">
        <p className="eyebrow">Scores exacts</p>
        <h2>Top pronostics</h2>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Score</th>
              <th>Probabilité</th>
            </tr>
          </thead>
          <tbody>
            {prediction.topScores.map((score, index) => (
              <tr key={`${score.homeGoals}-${score.awayGoals}`}>
                <td>{index + 1}</td>
                <td>
                  {prediction.teamA} {score.homeGoals} - {score.awayGoals} {prediction.teamB}
                </td>
                <td>{formatPercent(score.probability)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
