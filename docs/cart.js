document.getElementById('mpesa-pay').addEventListener('click', async () => {
  const phoneEl = document.getElementById('mpesa-phone');
  const amountEl = document.getElementById('mpesa-amount');
  const status = document.getElementById('mpesa-status');

  const phone = (phoneEl.value || '').trim();
  const amount = Number(amountEl.value);

  // basic validation
  if(!/^0\d{8,9}$/.test(phone) && !/^254\d{9}$/.test(phone) && !/^\+254\d{9}$/.test(phone)){
    status.textContent = 'Enter a valid Kenya phone number (07...)';
    phoneEl.focus();
    return;
  }
  if(!amount || amount <= 0){ status.textContent = 'Enter an amount'; amountEl.focus(); return; }

  status.innerHTML = 'Requesting M-Pesa prompt… <em>(you will receive a prompt on your phone to enter your PIN)</em>';
  const btn = document.getElementById('mpesa-pay');
  btn.disabled = true;

  try {
    const resp = await fetch('/api/mpesa/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, amount, accountRef: 'QikaoOrder-123' })
    });
    const result = await resp.json();

    if(!resp.ok){
      console.error('Server error', result);
      status.textContent = 'Payment request failed: ' + (result.error || JSON.stringify(result));
      btn.disabled = false;
      return;
    }

    // Success: Safaricom accepted checkout request. They will send STK prompt to buyer's phone.
    // result.data contains CheckoutRequestID and ResponseCode
    console.log('STK response', result);
    status.innerHTML = 'M-Pesa prompt sent — please enter your M-Pesa PIN on your phone now. Waiting for confirmation...';

    // Optional: poll your server for transaction confirmation, or implement a websocket / push.
    pollForPayment(result.data.CheckoutRequestID); // implement polling below

  } catch(err){
    console.error(err);
    status.textContent = 'Network error. Try again.';
    btn.disabled = false;
  }
});

// Example simple polling function (poll server for callback state). Requires server endpoint which tracks CheckoutRequestID.
// For demo, this just simulates waiting and enables button again.
function pollForPayment(checkoutRequestID){
  const status = document.getElementById('mpesa-status');
  // in production: call your server endpoint like /api/mpesa/status?checkoutId=...
  // Here we show a demo loop that checks every 4 seconds (max 6 tries).
  let attempts = 0;
  const max = 8;
  const interval = setInterval(async () => {
    attempts++;
    // TODO: replace with actual fetch to server /api/mpesa/status?checkoutId=...
    // Example:
    // const r = await fetch(`/api/mpesa/status?checkoutId=${checkoutRequestID}`);
    // const json = await r.json();
    // if(json.status === 'SUCCESS'){ ... }
    console.log('Polling (demo) attempt', attempts);

    // DEMO only: after 3 attempts, pretend success so UI completes
    if(attempts === 3){
      clearInterval(interval);
      status.innerHTML = '<strong>Payment confirmed — thank you! 🎉</strong>';
      document.getElementById('mpesa-pay').disabled = false;
      // you might redirect to a receipt page or clear cart now
    } else if(attempts >= max){
      clearInterval(interval);
      status.innerHTML = 'Payment not confirmed yet. Check your phone or try again later.';
      document.getElementById('mpesa-pay').disabled = false;
    }
  }, 4000);
}