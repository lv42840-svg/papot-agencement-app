"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="errorPage">
      <section className="panel errorPanel">
        <h1>Un problème est survenu</h1>
        <p className="muted">
          L’action n’a pas été terminée. Vous pouvez réessayer sans recharger toute l’application.
        </p>
        <button className="primaryButton" type="button" onClick={reset}>
          Réessayer
        </button>
      </section>
    </main>
  );
}
