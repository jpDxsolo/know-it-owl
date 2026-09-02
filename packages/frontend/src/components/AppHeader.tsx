/**
 * The bar at the top of every in-game screen: the owl on the left, and an
 * honest statement of whether this screen is actually live on the right.
 *
 * The connection pill is not decoration. Everything here arrives by
 * subscription, so a player looking at a stale lobby has no other way to tell
 * the difference between "nobody has joined yet" and "my phone fell off the
 * wifi". Showing it costs a corner of the header and saves a lot of confusion.
 */
import type { RealtimeStatus } from "../services/realtime";
import { Logo } from "./Logo";
import "./AppHeader.css";

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  live: "Live",
  connecting: "Connecting",
  offline: "Offline",
};

export interface AppHeaderProps {
  /** Omit on screens with no live subscription — the pill is then hidden. */
  realtime?: RealtimeStatus;
}

export function AppHeader({ realtime }: AppHeaderProps) {
  return (
    <header className="kio-header">
      <Logo size={128} />
      {realtime && (
        <p className={`kio-status kio-status--${realtime}`}>
          <span className="kio-status__dot" aria-hidden="true" />
          {/* Announced politely: worth knowing, never worth interrupting. */}
          <span role="status">{STATUS_LABEL[realtime]}</span>
        </p>
      )}
    </header>
  );
}
