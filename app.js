const SETTINGS_STORAGE_KEY = 'greenhub_settings';
const LEGACY_SETTINGS_STORAGE_KEY = 'hafenwerk_settings';
const STOREFRONT_SETTINGS_SYNC_KEY = 'greenhub_store_settings_updated';
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

const state = { filter: 'All', query: '', sort: 'featured', cart: [], wishes: new Set(), payment: 'bitcoin', giftCardDiscount: 0, giftCardCode: '' };
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

function cleanStorefrontCopy(settings = {}) {
  const cleaned = { ...settings };
  Object.keys(cleaned).forEach((key) => {
    if (typeof cleaned[key] !== 'string' || /(url|path|email|whatsapp)/i.test(key)) return;
    cleaned[key] = cleaned[key]
      .replace(/\bparts that fit\b/gi, 'built to fit')
      .replace(/\b(?:spare|replacement) parts?\b/gi, 'replacement products')
      .replace(/\bpart number\b/gi, 'reference number')
      .replace(/\bparts?\b/gi, 'products')
      .replace(/\bspares\b/gi, 'products')
      .replace(/\bautomotive\b/gi, 'product')
      .replace(/\bvehicles?\b/gi, 'products')
      .replace(/\bcars?\b/gi, 'products')
      .replace(/\bdrivers?\b/gi, 'customers')
      .replace(/\bfitment\b/gi, 'product details')
      .replace(/\bmake, model and year\b/gi, 'product details')
      .replace(/\bmake or model\b/gi, 'product details')
      .replace(/\bworkshop\b/gi, 'quality')
      .replace(/\bgarage\b/gi, 'studio')
      .replace(/\bunder the hood\b/gi, 'behind the scenes')
      .replace(/\broad ahead\b/gi, 'days ahead')
      .replace(/\broad\b/gi, 'way')
      .replace(/\bjourneys?\b/gi, 'experiences');
  });
  return cleaned;
}

function imageEmptyStateMarkup(label = 'Image unavailable', hidden = false) {
  return `<span class="image-empty-state"${hidden ? ' hidden' : ''}>${escapeHtml(label)}</span>`;
}

function productVisual(product) {
  const imageUrl = product.image_url || product.imageUrl;
  return imageUrl
    ? `<img class="product-photo" data-empty-fallback src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />${imageEmptyStateMarkup('Image unavailable', true)}`
    : imageEmptyStateMarkup();
}

function bindMissingImageStates(container) {
  if (!container) return;
  container.querySelectorAll('img[data-empty-fallback]').forEach((image) => {
    const fallback = image.nextElementSibling;
    const showImage = () => {
      image.hidden = false;
      if (fallback?.classList.contains('image-empty-state')) fallback.hidden = true;
    };
    const showFallback = () => {
      image.hidden = true;
      if (fallback?.classList.contains('image-empty-state')) fallback.hidden = false;
    };
    image.addEventListener('load', showImage, { once: true });
    image.addEventListener('error', showFallback, { once: true });
    if (image.complete && image.naturalWidth > 0) showImage();
  });
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
    emptyState.innerHTML = '<strong>No products available.</strong><span>Products added to Supabase will appear here.</span>';
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
  bindMissingImageStates(productGrid);
  emptyState.hidden = visible.length !== 0;
  if (!visible.length) emptyState.innerHTML = '<strong>No matching products.</strong><span>Try another search term or browse all products.</span><button class="text-link reset-search">Clear search ↗</button>';
  productCount.textContent = visible.length ? `Showing ${visible.length} of ${products.length} products` : 'No matching products';
  observeReveals();
}

function formatPrice(value) {
  return `€${value.toFixed(2)}`;
}

function quantityControl(item) {
  return `<div class="quantity-control" data-quantity-control="${item.id}"><button type="button" data-quantity-decrease="${item.id}" aria-label="Decrease ${escapeHtml(item.name)} quantity">−</button><input type="number" data-cart-quantity="${item.id}" value="${item.quantity}" min="1" max="99" inputmode="numeric" aria-label="Quantity for ${escapeHtml(item.name)}" /><button type="button" data-quantity-increase="${item.id}" aria-label="Increase ${escapeHtml(item.name)} quantity">+</button></div>`;
}

function setCartQuantity(productId, value) {
  const item = state.cart.find((cartItem) => cartItem.id === Number(productId));
  if (!item) return;
  item.quantity = Math.min(99, Math.max(1, Number.parseInt(value, 10) || 1));
  renderCart();
}

function renderCart() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  document.querySelector('.cart-count').textContent = count;
  document.querySelector('.drawer-count').textContent = count;
  document.querySelector('#drawer-total').textContent = formatPrice(total);
  const drawerItems = document.querySelector('#drawer-items');
  if (!state.cart.length) {
    drawerItems.innerHTML = '<div class="drawer-empty"><div class="empty-bag-icon">＋</div><strong>Your bag is waiting.</strong><span>Add something useful for today.</span><a class="text-link" href="#shop">Browse products →</a></div>';
    renderCheckoutSummary();
    return;
  }
  drawerItems.innerHTML = state.cart.map((item) => `<div class="drawer-item"><div class="drawer-item-art">${productVisual(item)}</div><div class="drawer-item-copy"><small>${escapeHtml(item.category)}</small><h4>${escapeHtml(item.name)}</h4>${quantityControl(item)}<button class="remove-item" data-remove="${item.id}">− Remove</button></div><p>${formatPrice(item.price * item.quantity)}</p></div>`).join('');
  bindMissingImageStates(drawerItems);
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const summaryItems = document.querySelector('#checkout-items');
  if (!summaryItems) return;
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.min(state.giftCardDiscount, subtotal);
  summaryItems.innerHTML = state.cart.length ? state.cart.map((item) => `<div class="checkout-item"><span class="checkout-item-copy"><strong>${escapeHtml(item.name)}</strong>${quantityControl(item)}</span><span>${formatPrice(item.price * item.quantity)}</span></div>`).join('') : '<div class="checkout-item"><span>Your bag is empty</span><span>€0.00</span></div>';
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

const orderMessageModal = document.querySelector('#order-message-modal');
const orderMessageId = document.querySelector('#order-message-id');

function closeOrderMessage() {
  orderMessageModal.classList.remove('open');
  orderMessageModal.setAttribute('aria-hidden', 'true');
}

function openOrderMessage(orderId) {
  orderMessageId.textContent = orderId;
  orderMessageModal.classList.add('open');
  orderMessageModal.setAttribute('aria-hidden', 'false');
}

function sendOrderToSmartsupp(order) {
  if (typeof window.smartsupp !== 'function') throw new Error('Smartsupp chat is not available.');
  const products = order.items.map((item) => `- ${item.name} ×${item.quantity} (€${(item.price * item.quantity).toFixed(2)})`).join('\n');
  const message = [
    `New Greenhub order: ${order.id}`,
    `Customer: ${order.customer_name}`,
    `Email: ${order.customer_email}`,
    `Payment method: ${order.payment_method}`,
    'Products:',
    products,
    `Total: €${Number(order.total).toFixed(2)}`
  ].join('\n');
  window.smartsupp('name', order.customer_name);
  window.smartsupp('email', order.customer_email);
  window.smartsupp('variables', {
    Order_ID: order.id,
    Payment_Method: order.payment_method,
    Order_Total: `€${Number(order.total).toFixed(2)}`
  });
  window.smartsupp('chat:send', message);
  window.smartsupp('chat:open');
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

const CATEGORY_SETTING_KEYS = ['category1', 'category2', 'category3', 'category4'];
const CATEGORY_IMAGE_SETTING_KEYS = ['categoryBrakesImageUrl', 'categoryEngineImageUrl', 'categoryLightingImageUrl', 'categorySuspensionImageUrl'];

function storeCategories(settings = {}) {
  const configured = Array.isArray(settings.categories)
    ? settings.categories
    : CATEGORY_SETTING_KEYS.map((key) => settings[key]);
  const configuredValues = configured.map((value) => String(value || '').trim()).filter(Boolean);
  const catalogueCategories = products.map((product) => String(product.category || '').trim()).filter(Boolean);
  return [...new Set(configuredValues.length ? configuredValues : catalogueCategories)];
}

function storeCategoryImage(settings = {}, index) {
  if (Array.isArray(settings.categoryImageUrls)) return settings.categoryImageUrls[index] || '';
  return settings[CATEGORY_IMAGE_SETTING_KEYS[index]] || '';
}

function setCustomerImage(target, imageUrl, backgroundImage = '') {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  if (!element) return;
  let emptyState = [...element.children].find((child) => child.classList.contains('image-empty-state'));
  if (!emptyState) {
    emptyState = document.createElement('span');
    emptyState.className = 'image-empty-state';
    emptyState.textContent = 'Image unavailable';
    element.appendChild(emptyState);
  }
  if (!imageUrl) {
    element.classList.remove('has-uploaded-image');
    element.style.removeProperty('background-image');
    delete element.dataset.imageSource;
    emptyState.hidden = false;
    return;
  }
  const source = String(imageUrl).trim();
  if (!source) {
    setCustomerImage(element, '', backgroundImage);
    return;
  }
  element.dataset.imageSource = source;
  emptyState.hidden = false;
  const showEmptyState = () => {
    if (element.dataset.imageSource !== source) return;
    element.classList.remove('has-uploaded-image');
    element.style.removeProperty('background-image');
    emptyState.hidden = false;
  };
  const showImage = () => {
    if (element.dataset.imageSource !== source) return;
    const safeUrl = JSON.stringify(source);
    element.style.backgroundImage = backgroundImage ? `${backgroundImage}, url(${safeUrl})` : `url(${safeUrl})`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.classList.add('has-uploaded-image');
    emptyState.hidden = true;
  };
  if (typeof Image === 'undefined') {
    showImage();
    return;
  }
  const probe = new Image();
  probe.onload = showImage;
  probe.onerror = showEmptyState;
  probe.src = source;
}

function renderCategoryControls(settings = {}) {
  const categories = storeCategories(settings);
  const categorySection = document.querySelector('#categories');
  const categoryGrid = document.querySelector('.category-grid');
  if (categorySection) categorySection.hidden = !categories.length;
  if (!categoryGrid) return;
  const cardClasses = ['category-brakes', 'category-engine', 'category-lighting', 'category-suspension'];
  categoryGrid.replaceChildren(...categories.map((category, index) => {
    const card = document.createElement('a');
    card.className = `category-card ${cardClasses[index % cardClasses.length]}`;
    card.href = '#shop';
    card.dataset.categoryLink = category;
    const number = document.createElement('div');
    number.className = 'category-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const art = document.createElement('div');
    art.className = 'category-art';
    art.innerHTML = imageEmptyStateMarkup();
    const bottom = document.createElement('div');
    bottom.className = 'category-bottom';
    const label = document.createElement('span');
    label.textContent = category;
    const explore = document.createElement('span');
    explore.textContent = 'Explore ↗';
    bottom.append(label, explore);
    card.append(number, art, bottom);
    setCustomerImage(art, storeCategoryImage(settings, index));
    return card;
  }));
  const filterTabs = document.querySelector('.filter-tabs');
  if (filterTabs) {
    filterTabs.querySelectorAll('[data-dynamic-category]').forEach((button) => button.remove());
    categories.forEach((category) => {
      const button = document.createElement('button');
      button.className = 'filter-tab';
      button.type = 'button';
      button.dataset.filter = category;
      button.dataset.dynamicCategory = 'true';
      button.textContent = category;
      filterTabs.appendChild(button);
    });
  }
  if (state.filter !== 'All' && !categories.includes(state.filter)) setFilter('All');
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

document.querySelector('.filter-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('.filter-tab');
  if (button) setFilter(button.dataset.filter);
});
document.querySelector('#sort-select').addEventListener('change', (event) => { state.sort = event.target.value; renderProducts(); });
document.querySelector('.category-grid').addEventListener('click', (event) => {
  const link = event.target.closest('[data-category-link]');
  if (link) setFilter(link.dataset.categoryLink);
});

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

function handleCartQuantityClick(event) {
  const increaseButton = event.target.closest('[data-quantity-increase]');
  const decreaseButton = event.target.closest('[data-quantity-decrease]');
  const button = increaseButton || decreaseButton;
  if (!button) return;
  const item = state.cart.find((cartItem) => cartItem.id === Number(button.dataset.quantityIncrease || button.dataset.quantityDecrease));
  if (item) setCartQuantity(item.id, item.quantity + (increaseButton ? 1 : -1));
}

function handleCartQuantityChange(event) {
  const input = event.target.closest('[data-cart-quantity]');
  if (input) setCartQuantity(input.dataset.cartQuantity, input.value);
}

document.querySelector('#drawer-items').addEventListener('click', (event) => {
  handleCartQuantityClick(event);
  const removeButton = event.target.closest('[data-remove]');
  if (!removeButton) return;
  state.cart = state.cart.filter((item) => item.id !== Number(removeButton.dataset.remove));
  renderCart();
});
document.querySelector('#drawer-items').addEventListener('change', handleCartQuantityChange);
document.querySelector('#checkout-items').addEventListener('click', handleCartQuantityClick);
document.querySelector('#checkout-items').addEventListener('change', handleCartQuantityChange);

document.querySelectorAll('.cart-trigger').forEach((button) => button.addEventListener('click', openCart));
document.querySelector('.drawer-close').addEventListener('click', closeCart);
backdrop.addEventListener('click', closeCart);
const checkoutModal = document.querySelector('#checkout-modal');
const checkoutForm = document.querySelector('#checkout-form');
const giftcardFields = document.querySelector('#giftcard-fields');
const paymentNotice = document.querySelector('#payment-method-notice');
const paymentSecurity = document.querySelector('#checkout-security');
const paymentMessages = { giftcard: 'Gift card payment is selected. Follow the payment instructions to complete your order.', bitcoin: 'Bitcoin payment is selected. Follow the payment instructions to complete your order.', revolut: 'Revolut Bank transfer is selected. Follow the payment instructions to complete your order.' };
const paymentLabels = { giftcard: 'Continue with Gift card', bitcoin: 'Continue with Bitcoin', revolut: 'Continue with Revolut' };
const paymentSecurityMessages = { bitcoin: '₿ Bitcoin payment instructions will be provided after you confirm your order.', giftcard: '✦ Gift card payment instructions will be provided after you confirm your order.', revolut: '↗ Revolut Bank transfer instructions will be provided after you confirm your order.' };

function selectPayment(payment) {
  state.payment = payment;
  if (payment !== 'giftcard') {
    state.giftCardDiscount = 0;
    state.giftCardCode = '';
    document.querySelector('#gift-card-input').value = '';
    document.querySelector('#gift-card-message').textContent = 'Enter a code if you have one, or continue with gift card payment.';
  }
  document.querySelectorAll('.payment-method').forEach((button) => button.classList.toggle('active', button.dataset.payment === payment));
  paymentNotice.textContent = paymentMessages[payment];
  giftcardFields.hidden = payment !== 'giftcard';
  document.querySelector('#pay-button-label').textContent = paymentLabels[payment];
  paymentSecurity.textContent = paymentSecurityMessages[payment] || '🔒 Your payment is processed securely by the selected provider.';
  renderCheckoutSummary();
}

function openCheckout() {
  if (!state.cart.length) { showToast('Add a product before checking out'); return; }
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
    if (!code) {
      state.giftCardDiscount = 0;
      state.giftCardCode = '';
      message.textContent = 'No gift card code applied. You can continue with gift card payment.';
    } else if (code === 'GREENHUB10') {
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
    payment_method: state.payment,
    items: state.cart.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, price: item.price })),
    total: Number((subtotal - discount).toFixed(2)),
    status: 'pending'
  };
  const saveOrder = database.configured ? (async () => {
    let orderResponse = await database.client.from('orders').insert(order);
    if (orderResponse.error && /payment_method|column .* does not exist/i.test(orderResponse.error.message || '')) {
      const legacyOrder = { ...order };
      delete legacyOrder.payment_method;
      orderResponse = await database.client.from('orders').insert(legacyOrder);
    }
    if (orderResponse.error) throw new Error(orderResponse.error.message);
    const customerResponse = await database.client.from('customers').insert({ name: order.customer_name, email: order.customer_email });
    if (customerResponse.error && customerResponse.error.code !== '23505') throw new Error(customerResponse.error.message);
  })() : new Promise((resolve) => setTimeout(resolve, 850));
  saveOrder.then(async () => {
    let chatWarning = '';
    try {
      sendOrderToSmartsupp(order);
    } catch (error) {
      chatWarning = String(error?.message || 'Order details could not be sent to Smartsupp.');
      console.error('Smartsupp order message failed:', error);
    }
    submitButton.classList.remove('is-loading');
    document.querySelector('#pay-button-label').textContent = paymentLabels[state.payment];
    const confirmation = database.configured ? `Order ${order.id} received with ${paymentName}` : `Demo checkout ready with ${paymentName}`;
    const chatStatus = chatWarning ? ` Smartsupp message failed: ${chatWarning}` : ' Order details sent to Smartsupp chat.';
    showToast(`${confirmation}.${chatStatus}`);
    state.cart = [];
    state.giftCardDiscount = 0;
    state.giftCardCode = '';
    document.querySelector('#gift-card-input').value = '';
    document.querySelector('#gift-card-message').textContent = 'Enter a code if you have one, or continue with gift card payment.';
    renderCart();
    closeCheckout();
    openOrderMessage(order.id);
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
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { toggleSearch(false); closeCart(); closeCheckout(); closeOrderMessage(); } });

document.querySelectorAll('[data-order-message-close]').forEach((button) => button.addEventListener('click', closeOrderMessage));
document.querySelector('#open-order-chat').addEventListener('click', () => {
  closeOrderMessage();
  if (typeof window.smartsupp === 'function') window.smartsupp('chat:open');
});

document.querySelectorAll('.smartsupp-trigger').forEach((button) => button.addEventListener('click', (event) => {
  event.preventDefault();
  if (typeof window.smartsupp === 'function') window.smartsupp('chat:open');
}));

function applySettings(remoteSettings = null) {
  const settings = cleanStorefrontCopy(remoteSettings || loadSettings());
  Object.keys(settings).filter((key) => key.endsWith('Path')).forEach((pathKey) => {
    const urlKey = pathKey.replace(/Path$/, 'Url');
    settings[urlKey] = window.GreenhubStorage?.resolveUrl(settings[urlKey], settings[pathKey]) || settings[urlKey];
  });
  if (Array.isArray(settings.categoryImageUrls)) {
    settings.categoryImageUrls = settings.categoryImageUrls.map((url, index) => window.GreenhubStorage?.resolveUrl(url, settings.categoryImagePaths?.[index]) || url);
  }
  document.querySelectorAll('[data-setting]').forEach((element) => {
    const settingName = element.dataset.setting;
    const value = settings[settingName];
    if (/title/i.test(settingName) && !String(value ?? '').trim()) element.textContent = 'Not titled';
    else if (value !== undefined && value !== null) element.textContent = value;
  });
  renderCategoryControls(settings);
  const announcementCopy = document.querySelector('.announcement > span:first-child');
  const heroIntro = document.querySelector('.hero-intro');
  if (settings.announcement && announcementCopy) announcementCopy.textContent = settings.announcement;
  if (settings.heroIntro && heroIntro) heroIntro.textContent = settings.heroIntro;
  document.querySelectorAll('.footer-links a').forEach((link) => {
    if (link.textContent.trim() === 'Fitment help') link.textContent = 'Product help';
  });
  if (settings.supportEmail) {
    document.querySelectorAll('[data-support-email]').forEach((link) => {
      link.textContent = settings.supportEmail;
      link.href = `mailto:${settings.supportEmail}`;
    });
  }
  setCustomerImage('.hero-image', settings.heroImageUrl);
  setCustomerImage('.statement-image', settings.storyImageUrl, 'linear-gradient(120deg,rgba(31,37,29,.2),transparent)');
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
    })).filter((product) => product.name?.trim());
  }
  if (settingsResponse.error) console.error('[Greenhub] Could not load store content:', settingsResponse.error.message);
  else if (settingsResponse.data?.value) applySettings(settingsResponse.data.value);
  else renderCategoryControls();
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
