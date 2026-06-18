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
        <NumberField label="Score max généré" value={settings.maxGoals} min={3} max={10} onChange={(value) => update({ maxGoals: value })} />
      </div>

      <p className="help-text">
        Version actuelle : modèle Poisson indépendant avec moyennes offensives/défensives, pondération par récence,
        surpoids des compétitions officielles et avantage domicile simple.
      </p>
    </section>
  );
}
