import type { ModelSettings as ModelSettingsType } from '../types/football';

type ModelSettingsProps = {
  settings: ModelSettingsType;
  onChange: (settings: ModelSettingsType) => void;
};

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function ModelSettings({ settings, onChange }: ModelSettingsProps) {
  const update = (patch: Partial<ModelSettingsType>) => onChange({ ...settings, ...patch });
  const dixonColesEnabled = settings.useDixonColes ?? true;

  return (
    <section className="card">
      <div className="section-title">
        <p className="eyebrow">Modèle</p>
        <h2>Paramètres</h2>
      </div>

      <div className="grid two-columns">
        <NumberField label="Année de départ" value={settings.startYear} min={1872} max={2026} onChange={(value) => update({ startYear: value })} />
        <NumberField label="Derniers matchs pris en compte" value={settings.recentMatchCount} min={1} max={50} onChange={(value) => update({ recentMatchCount: value })} />
        <NumberField label="Poids forme récente" value={settings.recentFormWeight} min={0} max={1} step={0.05} onChange={(value) => update({ recentFormWeight: value })} />
        <NumberField label="Poids matchs officiels" value={settings.officialMatchWeight} min={1} max={4} step={0.1} onChange={(value) => update({ officialMatchWeight: value })} />
        <NumberField label="Avantage domicile en buts" value={settings.homeAdvantage} min={0} max={1} step={0.05} onChange={(value) => update({ homeAdvantage: value })} />
        <NumberField label="Score max généré" value={settings.maxGoals} min={3} max={12} onChange={(value) => update({ maxGoals: value })} />
        <NumberField label="Impact Elo externe/interne" value={settings.externalEloImpact ?? 0.35} min={0} max={1.5} step={0.05} onChange={(value) => update({ externalEloImpact: value, internalEloImpact: value })} />
        <NumberField label="Température scores" value={settings.scoreTemperature ?? 1} min={0.75} max={1.4} step={0.05} onChange={(value) => update({ scoreTemperature: value })} />
      </div>

      <div className="section-title" style={{ marginTop: '1.25rem' }}>
        <p className="eyebrow">Qualité statistique</p>
        <h2>Pondération des données et contrôle des favoris</h2>
      </div>

      <div className="grid two-columns">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.advancedCompetitionWeights ?? true}
            onChange={(event) => update({ advancedCompetitionWeights: event.target.checked })}
          />
          Pondération avancée des compétitions : gros poids aux vrais matchs officiels, petit poids aux tournois secondaires
        </label>

        <label className="field">
          Calibration score par score
          <select
            value={settings.scoreCalibration ?? 'classic_top1'}
            onChange={(event) =>
              update({
                scoreCalibration: event.target.value as ModelSettingsType['scoreCalibration'],
              })
            }
          >
            <option value="none">Aucune calibration</option>
            <option value="conservative">Conservatrice</option>
            <option value="classic_top1">Classiques Top 1</option>
            <option value="worldcup_prudent">Coupe du Monde prudente</option>
          </select>
        </label>

        <NumberField
          label="Ajustement adversaire Elo"
          value={settings.opponentEloAdjustmentWeight ?? 0.45}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(value) => update({ opponentEloAdjustmentWeight: value })}
        />

        <NumberField
          label="Prudence données faibles"
          value={settings.dataConfidenceWeight ?? 1.2}
          min={0.5}
          max={2.4}
          step={0.05}
          onChange={(value) => update({ dataConfidenceWeight: value })}
        />

        <NumberField
          label="Contrôle favoris"
          value={settings.favoriteControlWeight ?? 0.18}
          min={0}
          max={1.2}
          step={0.05}
          onChange={(value) => update({ favoriteControlWeight: value })}
        />
      </div>

      <p className="help-text">
        Cette partie agit en amont du choix MPP : elle pondère mieux les compétitions, ajuste les performances
        selon le niveau Elo de l’adversaire, évite de sur-interpréter les équipes avec peu d’historique et
        applique une petite calibration aux scores classiques comme 1-0, 1-1 ou 2-1.
      </p>

      <div className="section-title" style={{ marginTop: '1.25rem' }}>
        <p className="eyebrow">Calibration des nuls</p>
        <h2>Corriger le biais observé sur les matchs nuls</h2>
      </div>

      <div className="grid two-columns">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.smartDrawBoost ?? true}
            onChange={(event) => update({ smartDrawBoost: event.target.checked })}
          />
          Activer le Smart Draw Boost : boost des nuls seulement si le match est serré/fermé
        </label>

        <NumberField
          label="Multiplicateur global des nuls"
          value={settings.drawMultiplier ?? 1.06}
          min={0.85}
          max={1.8}
          step={0.01}
          onChange={(value) => update({ drawMultiplier: value })}
        />

        <NumberField
          label="Bonus 0-0 / 1-1"
          value={settings.lowScoreDrawBoost ?? 0.06}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(value) => update({ lowScoreDrawBoost: value })}
        />

        <NumberField
          label="Boost nul match serré"
          value={settings.drawBoostCloseMatch ?? 0.04}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(value) => update({ drawBoostCloseMatch: value })}
        />

        <NumberField
          label="Boost nul match fermé"
          value={settings.drawBoostLowTotal ?? 0.03}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(value) => update({ drawBoostLowTotal: value })}
        />

        <NumberField
          label="Pénalité favori clair"
          value={settings.smartDrawFavoritePenalty ?? 0.75}
          min={0}
          max={1.25}
          step={0.05}
          onChange={(value) => update({ smartDrawFavoritePenalty: value })}
        />

        <NumberField
          label="Plafond Smart Draw"
          value={settings.smartDrawMaxBoost ?? 1.22}
          min={1}
          max={2.2}
          step={0.05}
          onChange={(value) => update({ smartDrawMaxBoost: value, drawBoostMax: Math.max(settings.drawBoostMax ?? 1.22, value) })}
        />

        <NumberField
          label="Plafond boost nul classique"
          value={settings.drawBoostMax ?? 1.22}
          min={1}
          max={2.2}
          step={0.05}
          onChange={(value) => update({ drawBoostMax: value })}
        />
      </div>

      <p className="help-text">
        Le backtest montrait environ 24 % de nuls réels mais seulement 4 % de nuls prédits en Top 1.
        Le Smart Draw Boost évite le problème du boost global : il augmente les nuls surtout quand le match est serré,
        fermé et sans favori clair. L’objectif est de réduire le biais des nuls sans transformer trop de victoires en nuls.
      </p>

      <div className="section-title" style={{ marginTop: '1.25rem' }}>
        <p className="eyebrow">Distribution de scores</p>
        <h2>Choisir le moteur de probabilités</h2>
      </div>

      <label className="field">
        Modèle de score exact
        <select
          value={settings.scoreModel ?? 'hybrid_dc_bivariate'}
          onChange={(event) =>
            update({
              scoreModel: event.target.value as ModelSettingsType['scoreModel'],
            })
          }
        >
          <option value="independent_poisson">Poisson indépendant simple</option>
          <option value="dixon_coles">Dixon-Coles pur</option>
          <option value="bivariate_poisson">Bivariate Poisson</option>
          <option value="hybrid_dc_bivariate">Hybride Dixon-Coles + Bivariate</option>
        </select>
      </label>

      <p className="help-text">
        Le modèle hybride combine la robustesse Dixon-Coles sur les faibles scores avec une corrélation
        Bivariate Poisson pour mieux représenter les nuls et les matchs fermés.
      </p>

      <div className="section-title" style={{ marginTop: '1.25rem' }}>
        <p className="eyebrow">Dixon-Coles</p>
        <h2>Correction des faibles scores</h2>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={dixonColesEnabled}
          onChange={(event) => update({ useDixonColes: event.target.checked })}
        />
        Activer le vrai correctif Dixon-Coles sur 0-0, 1-0, 0-1 et 1-1
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.adaptiveDixonColes ?? true}
          onChange={(event) => update({ adaptiveDixonColes: event.target.checked })}
        />
        Adapter automatiquement rho selon le profil du match
      </label>

      <div className="grid two-columns">
        <NumberField
          label="Rho Dixon-Coles"
          value={settings.dixonColesRho ?? -0.08}
          min={-0.35}
          max={0.25}
          step={0.01}
          onChange={(value) => update({ dixonColesRho: value })}
        />

        <NumberField
          label="Intensité Dixon-Coles"
          value={settings.dixonColesWeight ?? 1}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(value) => update({ dixonColesWeight: value })}
        />
      </div>

      <div className="section-title" style={{ marginTop: '1.25rem' }}>
        <p className="eyebrow">Bivariate Poisson</p>
        <h2>Corrélation entre les buts</h2>
      </div>

      <div className="grid two-columns">
        <NumberField
          label="Lambda commun bivarié"
          value={settings.bivariateSharedLambda ?? 0.08}
          min={0}
          max={0.45}
          step={0.01}
          onChange={(value) => update({ bivariateSharedLambda: value })}
        />

        <NumberField
          label="Poids bivarié dans l'hybride"
          value={settings.bivariateBlendWeight ?? 0.25}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => update({ bivariateBlendWeight: value })}
        />
      </div>

      <p className="help-text">
        Version actuelle : Poisson renforcé avec forces offensives/défensives ajustées par adversaire, récence,
        compétitions officielles, Elo, température, Dixon-Coles adaptatif et Bivariate Poisson.
      </p>
    </section>
  );
}
