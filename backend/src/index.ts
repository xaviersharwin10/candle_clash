import 'dotenv/config'; // Load environment variables from .env file
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { reportPnlForDuel } from "./referee.js";
import photonRoutes from "./photonRoutes.js";
import leaderboardRoutes from "./leaderboardRoutes.js";

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(bodyParser.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Referee routes
app.post("/duels/:id/report-pnl", async (req, res) => {
  const duelId = Number(req.params.id);
  const { playerAddress, pnlPercent } = req.body ?? {};

  if (!playerAddress || typeof pnlPercent !== "number") {
    return res.status(400).json({ ok: false, error: "Invalid payload" });
  }

  try {
    await reportPnlForDuel(duelId, playerAddress, pnlPercent);
    res.json({ ok: true });
  } catch (e) {
    console.error("Error reporting PnL", e);
    res.status(500).json({ ok: false, error: "Internal error" });
  }
});

// Photon routes
app.use("/photon", photonRoutes);

// Leaderboard routes
app.use("/leaderboard", leaderboardRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Candle Clash backend listening on port ${PORT}`);
});


