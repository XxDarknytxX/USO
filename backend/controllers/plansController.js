// controllers/plansController.js
// Fetches plan data from Voucher Validation API (replaces hardcoded plans)
const vvClient = require('../services/voucherValidationClient');

const getAllPlans = async (req, res) => {
  try {
    const plans = await vvClient.fetchPlans();
    res.json(plans);
  } catch (err) {
    console.error('Failed to fetch plans:', err.message);
    res.status(503).json({ message: 'Plan service temporarily unavailable' });
  }
};

const getPlanById = async (req, res) => {
  try {
    const plans = await vvClient.fetchPlans();
    const plan = plans.find(p => p.id === req.params.id);
    res.json(plan || {});
  } catch (err) {
    console.error('Failed to fetch plan:', err.message);
    res.status(503).json({ message: 'Plan service temporarily unavailable' });
  }
};

const getPlansByCategory = async (req, res) => {
  try {
    const plans = await vvClient.fetchPlans();
    const categoryPlans = plans.filter(p => p.category === req.params.cat);

    if (categoryPlans.length > 0) {
      res.json(categoryPlans);
    } else {
      res.status(404).json({ message: 'No plans found' });
    }
  } catch (err) {
    console.error('Failed to fetch plans by category:', err.message);
    res.status(503).json({ message: 'Plan service temporarily unavailable' });
  }
};

const getCategories = async (req, res) => {
  try {
    const categories = await vvClient.fetchCategories();
    res.json(categories);
  } catch (err) {
    console.error('Failed to fetch categories:', err.message);
    res.status(503).json({ message: 'Plan service temporarily unavailable' });
  }
};

module.exports = {
  getAllPlans,
  getPlanById,
  getPlansByCategory,
  getCategories
};
