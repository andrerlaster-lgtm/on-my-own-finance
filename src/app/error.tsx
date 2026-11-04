"use client";

/** Shown when something fails while loading or saving. It never shows the error text, so no values or queries can leak onto the screen. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <div className="card">
        <p>The page could not finish. If you were saving something, it may or may not have been saved: check the list before trying again, so nothing is entered twice.</p>
        <div className="row"><button className="btn" onClick={reset}>Try again</button><a className="btn secondary" href="/">Home</a></div>
      </div>
    </main>
  );
}
