import express from 'express';
import cors from 'cors';
import projectRoutes from './routes/projects.js';
import settingsRoutes from './routes/settings.js';
import assetRoutes from './routes/assets.js';
import generateRoutes from './routes/generate.js';
import shotRoutes from './routes/shots.js';
import exportRoutes from './routes/export.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/projects', projectRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/projects/:id/assets', assetRoutes);
app.use('/api/projects/:id', generateRoutes);
app.use('/api/projects/:id/shots', shotRoutes);
app.use('/api/projects/:id', exportRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[video-pipeline] API server running on http://localhost:${PORT}`);
});
