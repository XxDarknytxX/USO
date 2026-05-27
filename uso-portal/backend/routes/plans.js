// routes/plans.js (unchanged)
const express = require('express');
const router = express.Router();
const plansController = require('../controllers/plansController');

// Plans routes
router.get('/plans', plansController.getAllPlans);
router.get('/plans/:id', plansController.getPlanById);
router.get('/plans/category/:cat', plansController.getPlansByCategory);
router.get('/categories', plansController.getCategories);

module.exports = router;