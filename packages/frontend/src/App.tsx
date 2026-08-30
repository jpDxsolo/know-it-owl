import { BrowserRouter, Route, Routes } from "react-router-dom";
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
      {/* No global header: Join shows the owl as its hero, and the in-game
          screens render AppHeader themselves so they can pass their own live
          connection state to it. */}
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
