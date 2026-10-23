import Link from "next/link";

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/" className="brand">Rave Run</Link>
      <Link href="/">Home</Link>
      <Link href="/compare">Compare</Link>
      <Link href="/tickets">Tickets</Link>
      <Link href="/events">Discover</Link>
      <Link href="/points">Points</Link>
      <Link href="/settings">Settings</Link>
      <Link href="/setup" className="nav-wide">Keys</Link>
    </nav>
  );
}
