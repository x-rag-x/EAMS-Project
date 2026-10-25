const express = require('express');
const router = express.Router();

const metaRoutes = require('./meta.routes');
const eventsRoutes = require('./events.routes');
const batchesRoutes = require('./batches.routes');
const uploadRoutes = require('./upload.routes');
const reviewRoutes = require('./review.routes');
const grievancesRoutes = require('./grievances.routes');
const manageRoutes = require('./manage.routes');

// Route-order rule: Register literal endpoints before parameterized /batches/:id routes
router.use('/', metaRoutes);
router.use('/', eventsRoutes);
router.use('/', uploadRoutes);
router.use('/', reviewRoutes);
router.use('/', grievancesRoutes);
router.use('/', manageRoutes);
router.use('/', batchesRoutes);

module.exports = router;
