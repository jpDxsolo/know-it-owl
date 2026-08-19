import { BrowserRouter, Route, Routes } from "react-router-dom";
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
      <Routes>
        <Route path="/" element={<Join />} />
        <Route path="/game/:gameId/lobby" element={<Lobby />} />
        <Route path="/game/:gameId/round" element={<TeamRound />} />
        <Route path="/game/:gameId/reveal" element={<RoundReveal />} />
        <Route path="/game/:gameId/standings" element={<Standings />} />
        <Route path="/game/:gameId/gm" element={<GmDashboard />} />
        <Route path="/game/:gameId/gm/grading" element={<GmGrading />} />
      </Routes>
    </BrowserRouter>
  );
}
