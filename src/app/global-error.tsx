"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <h1>Something went wrong</h1>
        <p>If you were saving something, check the list before trying again so nothing is entered twice.</p>
        <button onClick={reset} style={{ padding: "10px 16px", minHeight: 44 }}>Try again</button>
      </body>
    </html>
  );
}
