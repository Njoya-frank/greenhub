const SETTINGS_STORAGE_KEY = 'greenhub_settings';
const LEGACY_SETTINGS_STORAGE_KEY = 'hafenwerk_settings';
const STOREFRONT_SETTINGS_SYNC_KEY = 'greenhub_store_settings_updated';
const SUPPORT_VISITOR_TOKEN_KEY = 'greenhub_support_visitor_token';
const SUPPORT_CONVERSATION_KEY = 'greenhub_support_conversation';
const GREENHUB_WHATSAPP = '491638604683';
const GREENHUB_TELEGRAM = 'https://t.me/friedrich3458';
const database = window.GreenhubDB || { configured: false, client: null };

function loadSettings() {
  try {
    const storedValue = localStorage.getItem(SETTINGS_STORAGE_KEY) || localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    return JSON.parse(storedValue) || {};
  } catch (error) {
    return {};
  }
}

let products = [];
let catalogueLoaded = false;
let catalogueError = '';

const state = { filter: 'All', query: '', sort: 'featured', cart: [], wishes: new Set(), payment: 'card', giftCardDiscount: 0, giftCardCode: '' };
const supportState = { configured: false, initialized: false, available: false, visitorToken: '', conversationId: '', messages: [], lastRenderKey: '', pollTimer: null, initPromise: null };
const productGrid = document.querySelector('#product-grid');
const emptyState = document.querySelector('#empty-state');
const productCount = document.querySelector('#product-count');
const cartDrawer = document.querySelector('.cart-drawer');
const backdrop = document.querySelector('.drawer-backdrop');
const toast = document.querySelector('.toast');

function iconHeart() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 8.7c0 5.2-8.7 10-8.7 10S3.3 13.9 3.3 8.7A4.5 4.5 0 0 1 12 6.4a4.5 4.5 0 0 1 8.7 2.3Z"></path></svg>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function productVisual(product) {
  const imageUrl = product.image_url || product.imageUrl;
  return imageUrl ? `<img class="product-photo" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : '';
}

function visibleProducts() {
  const query = state.query.toLowerCase().trim();
  const filtered = products.filter((product) => {
    const matchesFilter = state.filter === 'All' || product.category === state.filter;
    const matchesQuery = !query || `${product.name} ${product.category} ${product.meta}`.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });
  if (state.sort === 'price-low') filtered.sort((a, b) => a.price - b.price);
  if (state.sort === 'price-high') filtered.sort((a, b) => b.price - a.price);
  return filtered;
}

function renderProducts() {
  if (!catalogueLoaded) {
    productGrid.innerHTML = '';
    emptyState.hidden = false;
    emptyState.innerHTML = '<strong>Loading catalogue…</strong><span>Connecting to the Greenhub catalogue.</span>';
    productCount.textContent = 'Loading catalogue…';
    return;
  }
  if (catalogueError) {
    productGrid.innerHTML = '';
    emptyState.hidden = false;
    emptyState.innerHTML = `<strong>Catalogue unavailable.</strong><span>${escapeHtml(catalogueError)}</span>`;
    productCount.textContent = 'Catalogue unavailable';
    return;
  }
  if (!products.length) {
    productGrid.innerHTML = '';
    emptyState.hidden = false;
    emptyState.innerHTML = '<strong>No products available.</strong><span>Products with images added to Supabase will appear here.</span>';
    productCount.textContent = 'No products available';
    return;
  }
  const visible = visibleProducts();
  productGrid.innerHTML = visible.map((product) => `
    <article class="product-card reveal">
      <div class="product-image">
        <span class="product-tag">${escapeHtml(product.tag)}</span>
        <button class="heart-button ${state.wishes.has(product.id) ? 'active' : ''}" data-wish="${product.id}" aria-label="${state.wishes.has(product.id) ? 'Remove' : 'Add'} ${escapeHtml(product.name)} ${state.wishes.has(product.id) ? 'from' : 'to'} wishlist">${iconHeart()}</button>
        ${productVisual(product)}
        <button class="add-button" data-add="${product.id}" aria-label="Add ${escapeHtml(product.name)} to bag">+</button>
      </div>
      <div class="product-copy"><div class="product-meta"><span>${escapeHtml(product.category)}</span><span>${escapeHtml(product.meta)}</span></div><h3>${escapeHtml(product.name)}</h3><div class="product-price">€${Number(product.price).toFixed(2)} ${product.oldPrice ? `<del>€${Number(product.oldPrice).toFixed(2)}</del>` : ''}</div></div>
    </article>
  `).join('');
  emptyState.hidden = visible.length !== 0;
  if (!visible.length) emptyState.innerHTML = '<strong>No matching parts.</strong><span>Try another search term or browse all parts.</span><button class="text-link reset-search">Clear search ↗</button>';
  productCount.textContent = visible.length ? `Showing ${visible.length} of ${products.length} parts` : 'No matching parts';
  observeReveals();
}

function formatPrice(value) {
  return `€${value.toFixed(2)}`;
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  document.querySelector('.cart-count').textContent = count;
  document.querySelector('.drawer-count').textContent = count;
  document.querySelector('#drawer-total').textContent = formatPrice(total);
  const drawerItems = document.querySelector('#drawer-items');
  if (!state.cart.length) {
    drawerItems.innerHTML = '<div class="drawer-empty"><div class="empty-bag-icon">＋</div><strong>Your bag is waiting.</strong><span>Add something useful for the road.</span><a class="text-link" href="#shop">Browse parts →</a></div>';
    renderCheckoutSummary();
    return;
  }
  drawerItems.innerHTML = state.cart.map((item) => `<div class="drawer-item"><div class="drawer-item-art">${productVisual(item)}</div><div><small>${escapeHtml(item.category)}</small><h4>${escapeHtml(item.name)}</h4><button class="remove-item" data-remove="${item.id}">− Remove</button></div><p>${formatPrice(item.price * item.quantity)}</p></div>`).join('');
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const summaryItems = document.querySelector('#checkout-items');
  if (!summaryItems) return;
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.min(state.giftCardDiscount, subtotal);
  summaryItems.innerHTML = state.cart.length ? state.cart.map((item) => `<div class="checkout-item"><span>${escapeHtml(item.name)} ×${item.quantity}</span><span>${formatPrice(item.price * item.quantity)}</span></div>`).join('') : '<div class="checkout-item"><span>Your bag is empty</span><span>€0.00</span></div>';
  document.querySelector('#checkout-subtotal').textContent = formatPrice(subtotal);
  document.querySelector('#checkout-discount').textContent = `−${formatPrice(discount)}`;
  document.querySelector('#checkout-discount-row').hidden = discount <= 0;
  document.querySelector('#checkout-grand-total').textContent = formatPrice(subtotal - discount);
  document.querySelector('#checkout-total').textContent = formatPrice(subtotal - discount);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2400);
}

function openCart() {
  cartDrawer.classList.add('open');
  backdrop.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  cartDrawer.classList.remove('open');
  backdrop.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('.filter-tab').forEach((button) => button.classList.toggle('active', button.dataset.filter === filter));
  renderProducts();
}

function observeReveals() {
  const revealItems = document.querySelectorAll('.reveal:not(.visible)');
  if (!('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  revealItems.forEach((item) => observer.observe(item));
}

document.querySelectorAll('.filter-tab').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
document.querySelector('#sort-select').addEventListener('change', (event) => { state.sort = event.target.value; renderProducts(); });
document.querySelectorAll('[data-category-link]').forEach((link) => link.addEventListener('click', () => setFilter(link.dataset.categoryLink)));

productGrid.addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add]');
  const wishButton = event.target.closest('[data-wish]');
  if (addButton) {
    if (addButton.classList.contains('is-loading')) return;
    const product = products.find((item) => item.id === Number(addButton.dataset.add));
    const existing = state.cart.find((item) => item.id === product.id);
    if (existing) existing.quantity += 1;
    else state.cart.push({ ...product, quantity: 1 });
    renderCart();
    showToast(`${product.name} added to your bag`);
    addButton.classList.add('is-loading');
    setTimeout(() => addButton.classList.remove('is-loading'), 500);
  }
  if (wishButton) {
    const product = products.find((item) => item.id === Number(wishButton.dataset.wish));
    if (state.wishes.has(product.id)) { state.wishes.delete(product.id); showToast('Removed from wishlist'); }
    else { state.wishes.add(product.id); showToast('Saved to your wishlist'); }
    renderProducts();
  }
});

document.querySelector('#drawer-items').addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove]');
  if (!removeButton) return;
  state.cart = state.cart.filter((item) => item.id !== Number(removeButton.dataset.remove));
  renderCart();
});

document.querySelectorAll('.cart-trigger').forEach((button) => button.addEventListener('click', openCart));
document.querySelector('.drawer-close').addEventListener('click', closeCart);
backdrop.addEventListener('click', closeCart);
const checkoutModal = document.querySelector('#checkout-modal');
const checkoutForm = document.querySelector('#checkout-form');
const cardFields = document.querySelector('#card-fields');
const giftcardFields = document.querySelector('#giftcard-fields');
const paymentNotice = document.querySelector('#payment-method-notice');
const paymentSecurity = document.querySelector('#checkout-security');
const paymentMessages = { card: 'Secure card payment with Visa, Mastercard and 3-D Secure.', paypal: 'You will be redirected to PayPal to approve your payment.', applepay: 'Apple Pay will open securely on a supported Apple device.', googlepay: 'Google Pay will open securely on a supported device.', klarna: 'Klarna lets you spread the cost. Availability depends on your location.', sepa: 'SEPA Direct Debit is available for supported euro-area bank accounts.', ideal: 'iDEAL securely connects you to your Dutch bank to approve payment.', bancontact: 'Bancontact securely connects you to your Belgian bank to approve payment.', sofort: 'Sofort securely connects you to your online banking provider.', giftcard: 'Enter a valid Greenhub gift card code to apply your balance.', bitcoin: 'Bitcoin payment is selected. Follow the payment instructions to complete your order.', cash: 'Cash payment is selected. Pay when your order is delivered.' };
const paymentLabels = { card: 'Pay securely', paypal: 'Continue to PayPal', applepay: 'Pay with Apple Pay', googlepay: 'Pay with Google Pay', klarna: 'Continue with Klarna', sepa: 'Set up SEPA debit', ideal: 'Pay with iDEAL', bancontact: 'Pay with Bancontact', sofort: 'Continue with Sofort', giftcard: 'Redeem gift card', bitcoin: 'Continue with Bitcoin', cash: 'Place cash order' };
const paymentSecurityMessages = { card: '🔒 Payments are encrypted and processed securely. Your card details never touch our store.', bitcoin: '₿ Bitcoin payment instructions will be provided after you confirm your order.', cash: '✓ Pay in cash when your order is delivered.' };

function selectPayment(payment) {
  state.payment = payment;
  document.querySelectorAll('.payment-method').forEach((button) => button.classList.toggle('active', button.dataset.payment === payment));
  paymentNotice.textContent = paymentMessages[payment];
  cardFields.hidden = payment !== 'card';
  giftcardFields.hidden = payment !== 'giftcard';
  cardFields.querySelectorAll('[data-card-field]').forEach((field) => { field.required = payment === 'card'; });
  document.querySelector('#pay-button-label').textContent = paymentLabels[payment];
  paymentSecurity.textContent = paymentSecurityMessages[payment] || '🔒 Your payment is processed securely by the selected provider.';
  renderCheckoutSummary();
}

function openCheckout() {
  if (!state.cart.length) { showToast('Add a part before checking out'); return; }
  closeCart();
  selectPayment(state.payment);
  checkoutModal.classList.add('open');
  checkoutModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeCheckout() {
  checkoutModal.classList.remove('open');
  checkoutModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function applyGiftCard() {
  const input = document.querySelector('#gift-card-input');
  const message = document.querySelector('#gift-card-message');
  const applyButton = document.querySelector('#apply-gift-card');
  if (applyButton.classList.contains('is-loading')) return;
  applyButton.classList.add('is-loading');
  const code = input.value.trim().toUpperCase();
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  setTimeout(() => {
    if (code === 'GREENHUB10') {
      state.giftCardDiscount = subtotal * .1;
      state.giftCardCode = code;
      message.innerHTML = '<strong>Gift card applied.</strong> You saved 10% on this order.';
    } else if (code === 'GIFT25') {
      state.giftCardDiscount = Math.min(25, subtotal);
      state.giftCardCode = code;
      message.innerHTML = '<strong>Gift card applied.</strong> €25 has been deducted from your order.';
    } else {
      state.giftCardDiscount = 0;
      state.giftCardCode = '';
      message.innerHTML = 'That code was not recognised. Try <strong>GREENHUB10</strong> or <strong>GIFT25</strong>.';
    }
    applyButton.classList.remove('is-loading');
    renderCheckoutSummary();
  }, 420);
}

document.querySelector('.checkout-button').addEventListener('click', openCheckout);
document.querySelectorAll('.payment-method').forEach((button) => button.addEventListener('click', () => selectPayment(button.dataset.payment)));
document.querySelectorAll('[data-checkout-close]').forEach((button) => button.addEventListener('click', closeCheckout));
document.querySelector('#apply-gift-card').addEventListener('click', applyGiftCard);
document.querySelector('#gift-card-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyGiftCard(); } });
checkoutForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.payment === 'giftcard' && !state.giftCardDiscount) { showToast('Apply a valid gift card before continuing'); return; }
  if (!checkoutForm.checkValidity()) { checkoutForm.reportValidity(); return; }
  const paymentName = document.querySelector(`.payment-method[data-payment="${state.payment}"] strong`).textContent;
  const submitButton = document.querySelector('.checkout-submit');
  submitButton.classList.add('is-loading');
  document.querySelector('#pay-button-label').textContent = 'Processing…';
  const formData = new FormData(checkoutForm);
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.min(state.giftCardDiscount, subtotal);
  const order = {
    id: `GH-${Date.now()}`,
    customer_name: String(formData.get('customer_name') || '').trim(),
    customer_email: String(formData.get('customer_email') || '').trim().toLowerCase(),
    items: state.cart.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, price: item.price })),
    total: Number((subtotal - discount).toFixed(2)),
    status: 'pending'
  };
  const saveOrder = database.configured ? (async () => {
    const orderResponse = await database.client.from('orders').insert(order);
    if (orderResponse.error) throw new Error(orderResponse.error.message);
    const customerResponse = await database.client.from('customers').insert({ name: order.customer_name, email: order.customer_email });
    if (customerResponse.error && customerResponse.error.code !== '23505') throw new Error(customerResponse.error.message);
  })() : new Promise((resolve) => setTimeout(resolve, 850));
  saveOrder.then(() => {
    submitButton.classList.remove('is-loading');
    document.querySelector('#pay-button-label').textContent = paymentLabels[state.payment];
    showToast(database.configured ? `Order ${order.id} received with ${paymentName}` : `Demo checkout ready with ${paymentName}`);
    state.cart = [];
    state.giftCardDiscount = 0;
    state.giftCardCode = '';
    renderCart();
    closeCheckout();
  }).catch((error) => {
    submitButton.classList.remove('is-loading');
    document.querySelector('#pay-button-label').textContent = paymentLabels[state.payment];
    const errorMessage = String(error?.message || error || 'Unknown error');
    const checkoutError = /failed to fetch|networkerror|err_connection_closed|load failed/i.test(errorMessage)
      ? 'Supabase could not be reached. Check your internet connection and confirm the project is running.'
      : /row-level security|permission denied|not authorized/i.test(errorMessage)
        ? 'Supabase rejected the order. Run the updated supabase/schema.sql policies, then try again.'
        : errorMessage;
    showToast(`Could not place order: ${checkoutError}`);
  });
});

const searchPanel = document.querySelector('.search-panel');
const searchInput = document.querySelector('#search-input');
function toggleSearch(open) {
  searchPanel.classList.toggle('open', open);
  searchPanel.setAttribute('aria-hidden', String(!open));
  if (open) setTimeout(() => searchInput.focus(), 50);
}
document.querySelector('.search-trigger').addEventListener('click', () => toggleSearch(!searchPanel.classList.contains('open')));
document.querySelector('.search-close').addEventListener('click', () => toggleSearch(false));
searchInput.addEventListener('input', (event) => { state.query = event.target.value; renderProducts(); });
emptyState.addEventListener('click', (event) => {
  if (!event.target.closest('.reset-search')) return;
  state.query = '';
  searchInput.value = '';
  setFilter('All');
});

const menuTrigger = document.querySelector('.menu-trigger');
const mobileNav = document.querySelector('.mobile-nav');
menuTrigger.addEventListener('click', () => { const open = mobileNav.classList.toggle('open'); menuTrigger.setAttribute('aria-expanded', String(open)); });
mobileNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => mobileNav.classList.remove('open')));
document.querySelector('.announcement-close').addEventListener('click', (event) => event.currentTarget.closest('.announcement').remove());
document.querySelector('#newsletter-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const email = form.querySelector('input').value.trim().toLowerCase();
  if (button.classList.contains('is-loading')) return;
  button.classList.add('is-loading');
  if (database.configured) {
    const { error } = await database.client.from('newsletter_subscribers').insert({ email });
    if (error) {
      button.classList.remove('is-loading');
      showToast(error.code === '23505' ? 'You are already on the list.' : `Could not subscribe: ${error.message}`);
      return;
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  button.classList.remove('is-loading');
  form.reset();
  showToast('You are on the list — welcome to Greenhub');
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { toggleSearch(false); closeCart(); closeCheckout(); } });

const chatLauncher = document.querySelector('.chat-launcher');
const chatWidget = document.querySelector('.chat-widget');
const chatMessages = document.querySelector('#chat-messages');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const chatQuick = document.querySelector('#chat-quick');

function toggleChat(open) {
  chatWidget.classList.toggle('open', open);
  chatLauncher.setAttribute('aria-expanded', String(open));
  chatWidget.setAttribute('aria-hidden', String(!open));
  if (open) {
    initializeSupportChat();
    setTimeout(() => chatInput.focus(), 180);
  }
}

function addChatMessage(message, role, options = {}) {
  const item = document.createElement('div');
  item.className = `chat-message ${role}`;
  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = options.label || (role === 'bot' ? 'GREENHUB' : role === 'admin' ? 'GREENHUB TEAM' : 'YOU');
  const copy = document.createElement('p');
  if (options.html) copy.innerHTML = message;
  else copy.textContent = message;
  item.append(time, copy);
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getBotReply(input) {
  const message = input.toLowerCase();
  if (message.includes('find') || message.includes('part') || message.includes('fit') || message.includes('car')) return 'I can help with that. Send me your <strong>make, model and year</strong> — for example, “BMW 3 Series, 2019, front brakes”. I’ll point you to the right system.';
  if (message.includes('order') || message.includes('track') || message.includes('delivery') || message.includes('ship')) return 'For an order update, reply with your <strong>order number</strong> (it starts with HW-). Orders usually leave our workshop within 24 hours.';
  if (message.includes('return') || message.includes('warranty') || message.includes('refund')) return 'You have <strong>30 days</strong> to return unused parts in their original packaging. Every Greenhub part also includes a 2-year fitment guarantee. <a href="#footer">Read the full returns policy →</a>';
  if (message.includes('person') || message.includes('human') || message.includes('agent') || message.includes('talk')) return `Of course. Our support team is online Mon–Fri, 08:00–18:00. <a href="https://wa.me/${GREENHUB_WHATSAPP}" target="_blank" rel="noreferrer">Chat on WhatsApp →</a> or send us a message on Telegram.`;
  if (message.includes('brake')) return 'For brakes, start with your exact make, model and year. You can also browse our <button class="inline-chat-action" data-chat-filter="Brakes">braking parts →</button>.';
  if (message.includes('engine') || message.includes('filter')) return 'Our engine and air range covers filters, belts and intake parts. Browse <button class="inline-chat-action" data-chat-filter="Engine">engine parts →</button>.';
  if (message.includes('light') || message.includes('lamp')) return 'For headlights and signal lamps, check the side and bulb type first. Browse <button class="inline-chat-action" data-chat-filter="Lighting">lighting parts →</button>.';
  return 'I can help with <strong>finding a part, order tracking, returns, or connecting you to a person</strong>. Try one of the buttons below or tell me what you need.';
}

function showChatTyping(show) {
  const existing = chatMessages.querySelector('.chat-typing-message');
  if (!show) { if (existing) existing.remove(); return; }
  if (existing) return;
  const typingMessage = document.createElement('div');
  typingMessage.className = 'chat-message bot chat-typing-message';
  typingMessage.innerHTML = '<span class="message-time">GREENHUB</span><div class="chat-typing" aria-label="Greenhub is typing"><span></span><span></span><span></span></div>';
  chatMessages.appendChild(typingMessage);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function supportStorageGet(key) {
  try { return localStorage.getItem(key) || ''; } catch (error) { return ''; }
}

function supportStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (error) { /* The chat can still work for this page. */ }
}

function getSupportVisitorToken() {
  const existing = supportStorageGet(SUPPORT_VISITOR_TOKEN_KEY);
  if (existing) return existing;
  const token = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  supportStorageSet(SUPPORT_VISITOR_TOKEN_KEY, token);
  return token;
}

function updateSupportStatus(isAvailable) {
  supportState.available = Boolean(isAvailable);
  const status = document.querySelector('#chat-status-copy');
  if (status) status.textContent = supportState.available ? 'Admin online · replies here' : 'Assistant online · replies instantly';
  if (chatQuick) chatQuick.style.display = supportState.available ? 'none' : 'flex';
}

function appendChatQuickActions() {
  if (chatQuick && !chatQuick.isConnected) chatMessages.appendChild(chatQuick);
}

function renderSupportMessages() {
  const fingerprint = `${supportState.available}:${supportState.messages.map((message) => `${message.id}:${message.body}`).join('|')}`;
  if (fingerprint === supportState.lastRenderKey) return;
  supportState.lastRenderKey = fingerprint;
  chatMessages.replaceChildren();
  if (!supportState.messages.length) {
    addChatMessage(
      supportState.available
        ? 'You are connected to Greenhub support. Send your question and an admin will reply here.'
        : 'Hi, I’m here to help you find the right part. What can I do for you?',
      'bot'
    );
  } else {
    supportState.messages.forEach((message) => {
      const role = message.sender_type === 'customer' ? 'user' : message.sender_type === 'admin' ? 'admin' : 'bot';
      addChatMessage(message.body, role, { label: message.sender_name || (role === 'admin' ? 'GREENHUB TEAM' : role === 'bot' ? 'GREENHUB' : 'YOU') });
    });
  }
  appendChatQuickActions();
  if (chatQuick) chatQuick.style.display = supportState.available ? 'none' : 'flex';
}

async function loadSupportPresence() {
  const { data, error } = await database.client.from('support_presence').select('is_available').eq('id', 1).maybeSingle();
  if (error) throw error;
  updateSupportStatus(data?.is_available === true);
}

async function ensureSupportConversation() {
  if (supportState.conversationId) return supportState.conversationId;
  const { data, error } = await database.client.rpc('create_support_conversation', { p_visitor_token: supportState.visitorToken });
  if (error) throw error;
  supportState.conversationId = Array.isArray(data) ? data[0] : data;
  supportStorageSet(SUPPORT_CONVERSATION_KEY, supportState.conversationId);
  return supportState.conversationId;
}

async function loadSupportMessages() {
  if (!supportState.conversationId) return;
  const { data, error } = await database.client.rpc('get_support_messages', {
    p_conversation_id: supportState.conversationId,
    p_visitor_token: supportState.visitorToken
  });
  if (error) throw error;
  supportState.messages = data || [];
  renderSupportMessages();
}

async function initializeSupportChat() {
  if (supportState.initialized) return;
  if (supportState.initPromise) return supportState.initPromise;
  supportState.initPromise = (async () => {
    supportState.visitorToken = getSupportVisitorToken();
    supportState.conversationId = supportStorageGet(SUPPORT_CONVERSATION_KEY);
    if (!database.configured) {
      supportState.initialized = true;
      updateSupportStatus(false);
      return;
    }
    supportState.configured = true;
    try {
      await loadSupportPresence();
      await ensureSupportConversation();
      try {
        await loadSupportMessages();
      } catch (conversationError) {
        supportState.conversationId = '';
        supportStorageSet(SUPPORT_CONVERSATION_KEY, '');
        await ensureSupportConversation();
        await loadSupportMessages();
      }
      supportState.initialized = true;
      supportState.pollTimer = window.setInterval(async () => {
        try {
          await loadSupportPresence();
          await loadSupportMessages();
        } catch (error) {
          console.error('[Greenhub] Support chat sync failed:', error.message);
        }
      }, 4000);
    } catch (error) {
      supportState.initialized = true;
      updateSupportStatus(false);
      renderSupportMessages();
      console.error('[Greenhub] Support chat is using bot fallback:', error.message);
    }
  })();
  try {
    await supportState.initPromise;
  } finally {
    supportState.initPromise = null;
  }
}

function waitForChatReply() {
  return new Promise((resolve) => window.setTimeout(resolve, 420));
}

async function answerChat(input) {
  const cleanInput = input.trim();
  if (!cleanInput || chatForm.classList.contains('is-busy')) return;
  chatInput.value = '';
  chatQuick.style.display = 'none';
  chatForm.classList.add('is-busy');
  if (!supportState.initialized) await initializeSupportChat();
  if (!supportState.configured || !supportState.conversationId) {
    addChatMessage(cleanInput, 'user');
    showChatTyping(true);
    await waitForChatReply();
    showChatTyping(false);
    addChatMessage(getBotReply(cleanInput), 'bot', { html: true });
    chatQuick.style.display = 'flex';
    chatForm.classList.remove('is-busy');
    chatInput.focus();
    return;
  }
  try {
    const { error } = await database.client.rpc('send_support_customer_message', {
      p_conversation_id: supportState.conversationId,
      p_visitor_token: supportState.visitorToken,
      p_body: cleanInput
    });
    if (error) throw error;
    await loadSupportMessages();
    if (!supportState.available) {
      showChatTyping(true);
      await waitForChatReply();
      const { error: botError } = await database.client.rpc('send_support_bot_message', {
        p_conversation_id: supportState.conversationId,
        p_visitor_token: supportState.visitorToken,
        p_body: getBotReply(cleanInput).replace(/<[^>]+>/g, '')
      });
      if (botError) throw botError;
      showChatTyping(false);
      await loadSupportMessages();
    } else {
      showChatTyping(true);
      await waitForChatReply();
      showChatTyping(false);
      await database.client.rpc('send_support_bot_message', {
        p_conversation_id: supportState.conversationId,
        p_visitor_token: supportState.visitorToken,
        p_body: 'Your message is with a Greenhub admin. They will reply here shortly.'
      });
      await loadSupportMessages();
    }
  } catch (error) {
    console.error('[Greenhub] Could not send support message:', error.message);
    showChatTyping(false);
    addChatMessage(getBotReply(cleanInput), 'bot', { html: true });
    chatQuick.style.display = supportState.available ? 'none' : 'flex';
  } finally {
    chatForm.classList.remove('is-busy');
    chatInput.focus();
  }
}

chatLauncher.addEventListener('click', () => toggleChat(!chatWidget.classList.contains('open')));
document.querySelector('.chat-close').addEventListener('click', () => toggleChat(false));
chatForm.addEventListener('submit', (event) => { event.preventDefault(); answerChat(chatInput.value); });
chatQuick.addEventListener('click', (event) => { const button = event.target.closest('[data-chat-question]'); if (button) answerChat(button.dataset.chatQuestion); });
chatMessages.addEventListener('click', (event) => { const button = event.target.closest('[data-chat-filter]'); if (!button) return; setFilter(button.dataset.chatFilter); document.querySelector('#shop').scrollIntoView({ behavior: 'smooth' }); addChatMessage(`Here are our ${button.dataset.chatFilter.toLowerCase()} parts.`, 'bot'); });

function applySettings(remoteSettings = null) {
  const settings = { ...(remoteSettings || loadSettings()) };
  Object.keys(settings).filter((key) => key.endsWith('Path')).forEach((pathKey) => {
    const urlKey = pathKey.replace(/Path$/, 'Url');
    settings[urlKey] = window.GreenhubStorage?.resolveUrl(settings[urlKey], settings[pathKey]) || settings[urlKey];
  });
  document.querySelectorAll('[data-setting]').forEach((element) => {
    const value = settings[element.dataset.setting];
    if (value !== undefined && value !== null) element.textContent = value;
  });
  const announcementCopy = document.querySelector('.announcement > span:first-child');
  const heroIntro = document.querySelector('.hero-intro');
  if (settings.announcement && announcementCopy) announcementCopy.textContent = settings.announcement;
  if (settings.heroIntro && heroIntro) heroIntro.textContent = settings.heroIntro;
  document.querySelectorAll('a[href*="wa.me"]').forEach((link) => { link.href = `https://wa.me/${GREENHUB_WHATSAPP}`; });
  document.querySelectorAll('a[href*="t.me"]').forEach((link) => { link.href = GREENHUB_TELEGRAM; });
  if (settings.supportEmail) {
    document.querySelectorAll('[data-support-email]').forEach((link) => {
      link.textContent = settings.supportEmail;
      link.href = `mailto:${settings.supportEmail}`;
    });
  }
  const setCustomerImage = (selector, imageUrl, backgroundImage = '') => {
    const element = document.querySelector(selector);
    if (!element) return;
    if (!imageUrl) {
      element.classList.remove('has-uploaded-image');
      element.style.removeProperty('background-image');
      return;
    }
    const safeUrl = JSON.stringify(String(imageUrl));
    element.style.backgroundImage = backgroundImage ? `${backgroundImage}, url(${safeUrl})` : `url(${safeUrl})`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.classList.add('has-uploaded-image');
  };
  setCustomerImage('.hero-image', settings.heroImageUrl);
  setCustomerImage('.statement-image', settings.storyImageUrl, 'linear-gradient(120deg,rgba(31,37,29,.2),transparent)');
  setCustomerImage('.category-brakes .category-art', settings.categoryBrakesImageUrl);
  setCustomerImage('.category-engine .category-art', settings.categoryEngineImageUrl);
  setCustomerImage('.category-lighting .category-art', settings.categoryLightingImageUrl);
  setCustomerImage('.category-suspension .category-art', settings.categorySuspensionImageUrl);
}

async function loadPublicStoreData() {
  if (!window.GreenhubDB?.configured) {
    catalogueLoaded = true;
    catalogueError = 'Connect Supabase with a public anon/publishable key to load products.';
    renderProducts();
    return;
  }
  const client = window.GreenhubDB.client;
  const [productsResponse, settingsResponse] = await Promise.all([
    client.from('products').select('id, name, category, type, price, old_price, meta, tag, image_url, image_path').eq('active', true).order('created_at', { ascending: false }),
    client.from('store_settings').select('value, updated_at').eq('key', 'homepage').maybeSingle()
  ]);
  if (productsResponse.error) {
    catalogueError = productsResponse.error.message;
  } else if (productsResponse.data) {
    products = productsResponse.data.map((product) => ({
      ...product,
      image_url: window.GreenhubStorage?.resolveUrl(product.image_url, product.image_path) || product.image_url,
      oldPrice: product.old_price
    })).filter((product) => product.name?.trim() && product.image_url?.trim());
  }
  if (settingsResponse.error) console.error('[Greenhub] Could not load store content:', settingsResponse.error.message);
  else if (settingsResponse.data?.value) applySettings(settingsResponse.data.value);
  catalogueLoaded = true;
  renderProducts();
}

async function refreshStorefrontSettings() {
  if (!window.GreenhubDB?.configured) return;
  const { data, error } = await window.GreenhubDB.client
    .from('store_settings')
    .select('value, updated_at')
    .eq('key', 'homepage')
    .maybeSingle();
  if (error) {
    console.error('[Greenhub] Could not refresh store content:', error.message);
    return;
  }
  if (data?.value) applySettings(data.value);
}

function scheduleStorefrontSettingsRefresh() {
  if (scheduleStorefrontSettingsRefresh.pending) return;
  scheduleStorefrontSettingsRefresh.pending = refreshStorefrontSettings()
    .catch(() => {})
    .finally(() => { scheduleStorefrontSettingsRefresh.pending = null; });
}

window.addEventListener('storage', (event) => {
  if (event.key === STOREFRONT_SETTINGS_SYNC_KEY) scheduleStorefrontSettingsRefresh();
});

window.addEventListener('pageshow', scheduleStorefrontSettingsRefresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleStorefrontSettingsRefresh();
});

applySettings();
renderProducts();
renderCart();
observeReveals();
loadPublicStoreData().catch((error) => {
  catalogueError = error.message || 'Could not connect to Supabase.';
  catalogueLoaded = true;
  renderProducts();
});
