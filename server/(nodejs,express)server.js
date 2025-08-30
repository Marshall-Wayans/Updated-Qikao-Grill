require('dotenv').config();
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: '200kb' }));

const PORT = process.env.PORT || 3000;
const STORAGE_KEY = 'qikao_cart';

// Optional: connect MongoDB (for storing orders/payments)
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(()=> console.log('Mongo connected'))
    .catch(err => console.warn('Mongo connect failed', err));
}

// ----------------- Helpers -----------------
const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const SHORTCODE = process.env.SHORTCODE;
const PASSKEY = process.env.PASSKEY;
const CALLBACK_BASE = process.env.CALLBACK_BASE_URL;
const ENV = (process.env.ENV || 'sandbox').toLowerCase();

if(!CONSUMER_KEY || !CONSUMER_SECRET || !SHORTCODE || !PASSKEY || !CALLBACK_BASE) {
  console.warn('Missing required env vars. STK Push endpoints will fail until configured.');
}

/* OAuth token caching */
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 5000) return cachedToken;

  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const url = ENV === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const res = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });
  cachedToken = res.data.access_token;
  // token usually valid for 3600 seconds
  tokenExpiry = now + (res.data.expires_in || 3600) * 1000;
  return cachedToken;
}

function getTimestamp() {
  const d = new Date();
  const YYYY = d.getFullYear().toString();
  const MM = String(d.getMonth()+1).padStart(2,'0');
  const DD = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  const ss = String(d.getSeconds()).padStart(2,'0');
  return `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
}

function buildPassword(shortcode, passkey, timestamp) {
  const plain = `${shortcode}${passkey}${timestamp}`;
  return Buffer.from(plain).toString('base64');
}

// STK ProcessRequest URL (sandbox vs prod)
function stkUrl() {
  return ENV === 'production'
    ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
}

// ----------------- Optional Mongoose Models (basic) -----------------
/* If you want to persist orders/payments, create models like below and save states in the routes */

// Example minimal model — create file models/Order.js for larger apps
const { Schema } = mongoose;
const OrderSchema = new Schema({
  orderId: String,
  items: Array,
  amount: Number,
  phone: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

const PaymentSchema = new Schema({
  merchantRequestID: String,
  checkoutRequestID: String,
  mpesaReceiptNumber: String,
  resultCode: Number,
  resultDesc: String,
  amount: Number,
  phoneNumber: String,
  orderId: String,
  raw: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
const Payment = mongoose.models.Payment || mongoose.model('Payment', PaymentSchema);

// ----------------- Routes -----------------

/**
 * POST /api/mpesa/stkpush
 * body: { phone: "07xxxxxxxx", amount: 150, orderId: "abc123", accountReference: "Qikao-123", description: "Order payment" }
 */
app.post('/api/mpesa/stkpush', async (req, res) => {
  try {
    const { phone, amount, orderId, accountReference = 'QikaoOrder', description = 'Payment for order' } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });

    // server-side validation
    if (!/^0\d{8,9}$/.test(String(phone))) return res.status(400).json({ error: 'Invalid phone number format' });
    if (isNaN(amount) || Number(amount) <= 0) return res.status(400).json({ error: 'Invalid amount' });

    // (Optional) Create an order record in DB with status 'pending'
    let order;
    try {
      order = await Order.create({ orderId, items: [], amount, phone, status: 'pending' });
    } catch (err) { /* ignore if no DB available */ }

    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const password = buildPassword(SHORTCODE, PASSKEY, timestamp);

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)),
      PartyA: phone,                 // customer's MSISDN in format 07XXXXXXXX
      PartyB: SHORTCODE,             // till/shortcode receiving payment
      PhoneNumber: phone,
      CallBackURL: `${CALLBACK_BASE}/api/mpesa/callback`,
      AccountReference: accountReference,
      TransactionDesc: description
    };

    const stkResponse = await axios.post(stkUrl(), payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Save checkpoint: store CheckoutRequestID/MerchantRequestID with order if available
    const data = stkResponse.data;
    // Example fields: MerchantRequestID, CheckoutRequestID, ResponseCode, ResponseDescription
    if (order) {
      order.meta = data;
      await order.save();
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('STK Push error', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'STK push failed', details: err.response ? err.response.data : err.message });
  }
});

/**
 * POST /api/mpesa/callback
 * This endpoint is called by Safaricom asynchronously when the customer completes or fails the payment.
 * The callback has a structure with Body.stkCallback (see docs).
 */
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    const body = req.body;
    // Save raw callback for audit
    console.log('MPESA CALLBACK:', JSON.stringify(body).slice(0, 1000));

    // Extract callback info safely
    const stkCallback = body?.Body?.stkCallback;
    if (!stkCallback) {
      // Acknowledge
      return res.status(200).send({ ResultCode: 0, ResultDesc: 'Received' });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = stkCallback;

    // Build metadata dictionary (amount, MpesaReceiptNumber, phone)
    let amount = null, mpesaReceipt = null, phone = null;
    if (CallbackMetadata && Array.isArray(CallbackMetadata.Item)) {
      for (const it of CallbackMetadata.Item) {
        if (it.Name === 'Amount') amount = it.Value;
        if (it.Name === 'MpesaReceiptNumber') mpesaReceipt = it.Value;
        if (it.Name === 'PhoneNumber') phone = it.Value;
      }
    }

    // Persist payment to DB if available
    try {
      await Payment.create({
        merchantRequestID: MerchantRequestID,
        checkoutRequestID: CheckoutRequestID,
        mpesaReceiptNumber: mpesaReceipt,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
        amount,
        phoneNumber: phone,
        raw: body
      });

      // You should also update your order status (matching with MerchantRequestID or a stored CheckoutRequestID)
      // Example: find order by meta.MerchantRequestID and update status
      const order = await Order.findOne({ 'meta.MerchantRequestID': MerchantRequestID });
      if (order) {
        if (ResultCode === 0) {
          order.status = 'paid';
        } else {
          order.status = 'failed';
        }
        await order.save();
      }
    } catch (dbErr) {
      console.warn('Could not persist callback to DB (maybe no DB configured):', dbErr.message);
    }

    // Important: respond HTTP 200 quickly to acknowledge receipt
    return res.status(200).send({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (err) {
    console.error('Callback handling error', err);
    return res.status(500).send({ ResultCode: 1, ResultDesc: 'Server error' });
  }
});

// Optional: health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));