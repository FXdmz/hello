const express = require('express');
const { version } = require('./package.json');
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.json({
    version,
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({ version });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Express Health Check Server',
    version,
    endpoints: {
      health: '/healthz',
      version: '/version'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;