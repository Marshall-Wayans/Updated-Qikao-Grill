// ===== Theme Toggle with Persistence =====

// 1) Grab the checkbox element so JS can react to user input.
//    Why: We need a handle to read/change its checked state.
const themeToggle = document.getElementById("theme-toggle");

// 2) On first load, read the last saved theme from localStorage.
//    Why: localStorage survives refresh/close so user preference sticks.
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  document.body.classList.add("dark");       // apply dark theme styles
  themeToggle.checked = true;               // move the switch to "on"
} else if (savedTheme === "light") {
  document.body.classList.remove("dark");   // ensure light mode
  themeToggle.checked = false;
} else {
  // Optional: respect user OS preference on first visit (no savedTheme yet)
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (prefersDark) {
    document.body.classList.add("dark");
    themeToggle.checked = true;
    localStorage.setItem("theme", "dark");
  }
} 

// === Navbar Hamburger Toggle ===
const hamburger = document.getElementById("hamburger");
const navLinks = document.querySelector(".nav-links");

hamburger.addEventListener("click", () => {
  hamburger.classList.toggle("active");
  navLinks.classList.toggle("active");
});

// === Close menu on link click ===
document.querySelectorAll(".nav-links a").forEach(link => {
  link.addEventListener("click", () => {
    hamburger.classList.remove("active");
    navLinks.classList.remove("active");
  });
});



// 3) When user toggles the switch, flip the theme and save the choice.
//    Why: Keep styling logic in CSS (via .dark class) and store the result.
themeToggle.addEventListener("change", () => {
  const isDark = themeToggle.checked;
  document.body.classList.toggle("dark", isDark);
  localStorage.setItem("theme", isDark ? "dark" : "light");
});


// ===== Simple Scroll-Reveal for .reveal elements =====

// 4) IntersectionObserver watches when elements enter the viewport.
//    Why: Animate in only when visible (performance + nice feel).
const revealEls = document.querySelectorAll(".reveal");

const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible"); // triggers CSS transition
      io.unobserve(entry.target);            // stop observing once revealed
    }
  });
}, {
  threshold: 0.15 // start revealing when ~15% of the element is visible
});

// 5) Start observing each .reveal element.
//    Why: This attaches the lazy animation to our sections/cards.
revealEls.forEach(el => io.observe(el));

/* menu-index script
   - stores cart in localStorage "qikao_cart"
   - per-card qty badge (top-left), + / - controls and Add button behavior
   - navbar cart count updates live
   - clicking navbar cart toggles a sidebar that lists cart items (database-like)
   - sidebar has a collapse/expand toggle and a "View Cart" button that navigates to cart.html
*/

/* ---------- helpers ---------- */
const STORAGE_KEY = 'qikao_cart';
function readCart(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e) { return []; } }
function saveCart(cart){ localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); }
function slugify(s){ return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g,''); }
function parsePrice(text){ const n = parseFloat((text||'').replace(/[^\d.]/g,'')); return isNaN(n) ? 0 : n; }
function fmtKsh(n){ return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, ''); }

/* ---------- build card models from DOM ---------- */
const CARD_NODES = Array.from(document.querySelectorAll('.menu-card')).map(card => {
  const title = card.querySelector('h3')?.textContent?.trim() || 'item';
  const id = slugify(title);
  const img = card.querySelector('img')?.getAttribute('src') || '';
  const price = parsePrice(card.querySelector('.price')?.textContent || '');
  return { id, title, img, price, card };
});

/* ---------- ensure qty badge exists per card ---------- */
function ensureBadge(cardEl, id, qty){
  let b = cardEl.querySelector('.qty-badge');
  if(!b){
    b = document.createElement('div');
    b.className = 'qty-badge';
    cardEl.prepend(b);
  }
  b.textContent = qty;
  b.dataset.id = id;
}

/* ---------- cart manipulation ---------- */
function setQuantity(id, newQty){
  let cart = readCart();
  const idx = cart.findIndex(i => i.id === id);
  if(newQty <= 0){
    if(idx !== -1) cart.splice(idx, 1);
  } else {
    if(idx === -1){
      // find card metadata
      const meta = CARD_NODES.find(c => c.id === id);
      cart.push({ id, name: meta.title, price: meta.price, img: meta.img, quantity: newQty });
    } else {
      cart[idx].quantity = newQty;
    }
  }
  saveCart(cart);
  refreshUI();
}

function changeQuantity(id, delta){
  const cart = readCart();
  const item = cart.find(i => i.id === id);
  const current = item ? item.quantity : 0;
  setQuantity(id, current + delta);
}

/* ---------- render sidebar (database-like) ---------- */
const sidebar = document.getElementById('cart-sidebar');
const cartItemsWrap = document.getElementById('cart-items');
const subtotalEl = document.getElementById('cart-subtotal');

function renderSidebarItems(collapsed = false){
  const cart = readCart();
  cartItemsWrap.innerHTML = '';
  if(!cart.length){
    cartItemsWrap.innerHTML = '<div class="empty">No items in cart</div>';
    subtotalEl.textContent = 'Ksh 0.00';
    return;
  }

  // If collapsed, hide the list content (still show header & footer)
  if(collapsed){
    cartItemsWrap.innerHTML = '<div class="empty">List collapsed</div>';
    let total = cart.reduce((s,i)=>s + i.price * i.quantity, 0);
    subtotalEl.textContent = 'Ksh ' + fmtKsh(total);
    return;
  }

  let sum = 0;
  cart.forEach(it => {
    sum += it.price * it.quantity;
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <div style="display:flex;gap:.6rem;align-items:center">
        <img src="${it.img}" alt="${it.name}">
        <div>
          <div style="font-weight:700">${it.name}</div>
          <div style="color:#666;font-size:.95rem">Ksh ${fmtKsh(it.price)} • ${it.quantity} pcs</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">Ksh ${fmtKsh(it.price * it.quantity)}</div>
        <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">
          <button class="btn-small cart-decr" data-id="${it.id}">−</button>
          <button class="btn-small cart-incr" data-id="${it.id}">+</button>
          <button class="cart-remove" data-id="${it.id}" style="background:none;border:none;color:var(--primary);cursor:pointer">Remove</button>
        </div>
      </div>
    `;
    cartItemsWrap.appendChild(row);
  });
  subtotalEl.textContent = 'Ksh ' + fmtKsh(sum);
}

/* ---------- refresh UI: badges + navbar count + sidebar render ---------- */
function refreshUI(){
  const cart = readCart();
  const totalCount = cart.reduce((s,i)=> s + i.quantity, 0);
  const navCount = document.getElementById('nav-count');
  navCount.textContent = totalCount;

  // update per-card badge
  CARD_NODES.forEach(m => {
    const item = cart.find(x => x.id === m.id);
    const qty = item ? item.quantity : 0;
    ensureBadge(m.card, m.id, qty);
  });

  // re-render sidebar (if open)
  if(sidebar.classList.contains('open')){
    const collapsed = collapseState === true;
    renderSidebarItems(collapsed);
  }
}

/* ---------- event delegation for buttons ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;

  // Add to cart
  if(t.matches('.order-btn')){
    const card = t.closest('.menu-card');
    const title = card.querySelector('h3').textContent.trim();
    const id = slugify(title);
    changeQuantity(id, 1);
    return;
  }

  // card plus/minus
  if(t.matches('.btn-incr')){
    const card = t.closest('.menu-card');
    const id = card.querySelector('.qty-badge')?.dataset.id || slugify(card.querySelector('h3').textContent);
    changeQuantity(id, 1);
    return;
  }
  if(t.matches('.btn-decr')){
    const card = t.closest('.menu-card');
    const id = card.querySelector('.qty-badge')?.dataset.id || slugify(card.querySelector('h3').textContent);
    changeQuantity(id, -1);
    return;
  }

  // sidebar controls
  if(t.matches('.cart-incr')){
    changeQuantity(t.dataset.id, 1); return;
  }
  if(t.matches('.cart-decr')){
    changeQuantity(t.dataset.id, -1); return;
  }
  if(t.matches('.cart-remove')){
    setQuantity(t.dataset.id, 0); return;
  }

});

/* ---------- open/close sidebar ---------- */
document.getElementById('open-cart').addEventListener('click', () => {
  const wasOpen = sidebar.classList.contains('open');
  sidebar.classList.toggle('open');
  sidebar.setAttribute('aria-hidden', !sidebar.classList.contains('open'));
  // when opening, render items (expanded by default)
  collapseState = false;
  updateCollapseBtn();
  if(!wasOpen) renderSidebarItems(false);
});

/* ---------- collapse/expand inside sidebar ---------- */
let collapseState = false; // false => expanded, true => collapsed
const collapseBtn = document.getElementById('collapse-list');
collapseBtn.addEventListener('click', () => {
  collapseState = !collapseState;
  updateCollapseBtn();
  renderSidebarItems(collapseState);
});
function updateCollapseBtn(){
  collapseBtn.textContent = collapseState ? 'Expand ▼' : 'Collapse ▲';
  collapseBtn.setAttribute('aria-expanded', String(!collapseState));
}

/* ---------- View Cart navigation ---------- */
document.getElementById('view-cart').addEventListener('click', () => {
  // navigate to cart.html (checkout). cart stored in localStorage
  window.location.href = 'cart.html';
});

/* ---------- initialize badges and controls ---------- */
(function init(){
  const cart = readCart();
  CARD_NODES.forEach(m => {
    const qty = (cart.find(i=>i.id===m.id) || { quantity: 0 }).quantity;
    ensureBadge(m.card, m.id, qty);

    // ensure controls buttons have expected classes - they already exist in markup above
    // but attach data-id if missing
    const incr = m.card.querySelector('.btn-incr');
    const decr = m.card.querySelector('.btn-decr');
    if(incr) incr.dataset.id = m.id;
    if(decr) decr.dataset.id = m.id;
  });
  refreshUI();
})();



