// routes/status.js
const express = require('express');
const router = express.Router();
const statusController = require('../controllers/statusController');

router.get('/voucher-status/:voucherCode', statusController.getVoucherStatus);
router.get('/voucher-by-mac/:mac', statusController.getVoucherByMac);
router.get('/latest-voucher', statusController.getLatestVoucher);

module.exports = router;
