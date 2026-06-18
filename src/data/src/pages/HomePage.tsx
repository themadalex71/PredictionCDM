export function HomePage() {
  return (
    <div className="page-stack">
      <section className="hero card">
        <p className="eyebrow">Mon Petit Prono / Coupe du Monde 2026</p>
        <h1>Optimise tes scores exacts avec un modèle clair et améliorable.</h1>
        <p>
          Cette première version sert de socle : tu importes ou utilises une base de matchs, tu règles le modèle,
          puis tu obtiens une distribution de scores exacts avec des probabilités.
        </p>
      </section>

      <section className="grid three-columns">
        <article className="card mini-card">
          <h3>1. Données</h3>
          <p>Import CSV local, nettoyage des équipes et stockage local dans le navigateur.</p>
        </article>
        <article className="card mini-card">
          <h3>2. Prédiction</h3>
          <p>Modèle Poisson simple basé sur attaque, défense, forme récente et contexte du match.</p>
        </article>
        <article className="card mini-card">
          <h3>3. MPP</h3>
          <p>Architecture prête pour calculer l'espérance de points et des stratégies de ligue.</p>
        </article>
      </section>
    </div>
  );
}
