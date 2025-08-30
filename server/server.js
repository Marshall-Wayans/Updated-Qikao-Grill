require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// env
const {
  MPESA_ENV = 'sandbox',
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  MPESA_CALLBACK_URL
} = process.env;

const BASE_URL = MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

// In-memory store for demo (checkoutId -> { status, detail })
const ORDERS = new Map();

// Helpers
function timestampNow(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function createPassword(shortcode, passkey, timestamp){
  return Buffer.from(shortcode + passkey + timestamp).toString('base64');
}
async function getAccessToken(){
  if(!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new Error('Missing MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET');
  }
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const url = `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;
  const r = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return r.data.access_token;
}

// STK Push endpoint
app.post('/api/mpesa/stkpush', async (req, res) => {
  try {
    const { phone, amount, accountRef = 'QikaoOrder', description = 'Qikao Grill Order' } = req.body;
    if(!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });
    if(!MPESA_SHORTCODE || !MPESA_PASSKEY || !MPESA_CALLBACK_URL) {
      return res.status(500).json({ error: 'MPESA_SHORTCODE/MPESA_PASSKEY/MPESA_CALLBACK_URL not set' });
    }

    // normalize msisdn to 2547...
    let msisdn = String(phone).replace(/\s+/g,'');
    if(msisdn.startsWith('+')) msisdn = msisdn.slice(1);
    if(msisdn.startsWith('0')) msisdn = '254' + msisdn.slice(1);

    const token = await getAccessToken();
    const ts = timestampNow();
    const password = createPassword(MPESA_SHORTCODE, MPESA_PASSKEY, ts);

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: Number(amount),
      PartyA: msisdn,
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: msisdn,
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: description
    };

    const url = `${BASE_URL}/mpesa/stkpush/v1/processrequest`;
    const mpRes = await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}` } });

    // Save a pending record to ORDERS so polling can find it (if CheckoutRequestID exists)
    const responseData = mpRes.data || {};
    const checkoutId = responseData.CheckoutRequestID || responseData.checkoutRequestID || responseData.CheckoutRequestId;
    if(checkoutId){
      ORDERS.set(checkoutId, { status: 'PENDING', detail: responseData });
    }

    return res.json({ success: true, data: responseData });
  } catch (err) {
    console.error('STK push error:', err.response ? err.response.data : err.message);
    return res.status(500).json({ error: 'STK push failed', detail: err.response ? err.response.data : err.message });
  }
});

// Callback endpoint for Safaricom to send final result
app.post('/api/mpesa/callback', (req, res) => {
  // Safaricom will POST a body with Body.stkCallback
  try {
    console.log('MPESA CALLBACK RECEIVED:', JSON.stringify(req.body).slice(0,1000));
    const body = req.body || {};
    const stk = (body.Body && body.Body.stkCallback) || body.stkCallback || null;

    if(stk && stk.CheckoutRequestID){
      const checkoutId = stk.CheckoutRequestID;
      const resultCode = stk.ResultCode;
      const resultDesc = stk.ResultDesc || '';
      const meta = stk.CallbackMetadata || stk.callbackMetadata || null;

      if(resultCode === 0){
        // success — extract receipt etc.
        const detail = {};
        if(meta && Array.isArray(meta.Item)) {
          meta.Item.forEach(i => {
            if(i.Name && i.Value !== undefined) detail[i.Name] = i.Value;
          });
        }
        ORDERS.set(checkoutId, { status: 'SUCCESS', detail: Object.assign({ ResultDesc: resultDesc }, detail) });
      } else {
        ORDERS.set(checkoutId, { status: 'FAILED', detail: { ResultCode: resultCode, ResultDesc: resultDesc } });
      }
    } else {
      // Fallback: try to parse differently or log
      console.warn('stkCallback not found in callback payload');
    }

    // Always respond quickly to Safaricom
    res.json({ ResultCode: 0, ResultDesc: 'Received' });
  } catch(e){
    console.error('callback processing error', e);
    res.status(500).json({ error: 'callback processing error' });
  }
});

// Polling/status endpoint used by frontend
app.get('/api/mpesa/status', (req, res) => {
  const checkoutId = req.query.checkoutId;
  if(!checkoutId) return res.status(400).json({ error: 'checkoutId required' });

  const record = ORDERS.get(checkoutId);
  if(!record) {
    // unknown - still pending or not yet stored
    return res.json({ status: 'PENDING' });
  }
  return res.json({ status: record.status, detail: record.detail || null });
});

// Simple health
app.get('/', (req, res) => res.send('Qikao Grill MPESA server running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running on ${PORT}`));