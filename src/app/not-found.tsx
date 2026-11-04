import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <div className="card"><p>That page or record does not exist.</p><Link className="btn" href="/">Home</Link></div>
    </main>
  );
}
