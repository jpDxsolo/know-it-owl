import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { Logo } from "./components/Logo";
import { DevHarness } from "./screens/DevHarness";
import { GmDashboard } from "./screens/GmDashboard";
import { GmGrading } from "./screens/GmGrading";
import { Join } from "./screens/Join";
import { Lobby } from "./screens/Lobby";
import { RoundReveal } from "./screens/RoundReveal";
import { Standings } from "./screens/Standings";
import { TeamRound } from "./screens/TeamRound";

export function App() {
  return (
    <BrowserRouter>
      {/* One header for every screen, so the mark lives in a single place
          until the designed screens replace these placeholders. */}
      <header>
        <Link to="/" aria-label="Know It Owl home">
          <Logo />
        </Link>
      </header>
      <Routes>
        <Route path="/" element={<Join />} />
        <Route path="/game/:gameId/lobby" element={<Lobby />} />
        <Route path="/game/:gameId/round" element={<TeamRound />} />
        <Route path="/game/:gameId/reveal" element={<RoundReveal />} />
        <Route path="/game/:gameId/standings" element={<Standings />} />
        <Route path="/game/:gameId/gm" element={<GmDashboard />} />
        <Route path="/game/:gameId/gm/grading" element={<GmGrading />} />
        <Route path="/dev" element={<DevHarness />} />
      </Routes>
    </BrowserRouter>
  );
}
