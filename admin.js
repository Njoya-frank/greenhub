const database = window.GreenhubDB || { configured: false, client: null };
const STOREFRONT_SETTINGS_SYNC_KEY = 'greenhub_store_settings_updated';
const STORAGE_BUCKET = 'greenhub';
const GREENHUB_WHATSAPP = '+49 1638 604683';
const IMAGE_CONTENT_TYPES = Object.freeze({
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
});

let ORDERS = [];
let CUSTOMERS = [];
let MEMBERS = [];
let products = [];
let editingProductId = null;
let storefrontSettings = {};
let currentAdminUserId = null;
let supportConversations = [];
let activeSupportConversationId = null;
let supportPollTimer = null;
let supportIsAvailable = false;
let pendingConfirmation = null;
const confirmMessageBox = document.querySelector('#confirm-message-box');
const confirmMessageTitle = document.querySelector('#confirm-message-title');
const confirmMessageCopy = document.querySelector('#confirm-message-copy');
const confirmMessageCancel = document.querySelector('#confirm-message-cancel');
const confirmMessageAccept = document.querySelector('#confirm-message-accept');

const CATEGORY_SETTING_KEYS = ['category1', 'category2', 'category3', 'category4'];
const LEGACY_CATEGORY_SETTING_KEYS = ['categoryBrakes', 'categoryEngine', 'categoryLighting', 'categorySuspension'];
const LEGACY_CATEGORY_VALUES = ['Brakes', 'Engine', 'Lighting', 'Suspension'];

const STOREFRONT_IMAGE_FIELDS = [
  { field: 'heroImage', urlKey: 'heroImageUrl', pathKey: 'heroImagePath', previewId: 'hero-image-preview', label: 'Hero image' },
  { field: 'storyImage', urlKey: 'storyImageUrl', pathKey: 'storyImagePath', previewId: 'story-image-preview', label: 'Our standard image' },
  { field: 'categoryBrakesImage', urlKey: 'categoryBrakesImageUrl', pathKey: 'categoryBrakesImagePath', previewId: 'category-brakes-image-preview', label: 'Brakes category image', categoryIndex: 0 },
  { field: 'categoryEngineImage', urlKey: 'categoryEngineImageUrl', pathKey: 'categoryEngineImagePath', previewId: 'category-engine-image-preview', label: 'Engine category image', categoryIndex: 1 },
  { field: 'categoryLightingImage', urlKey: 'categoryLightingImageUrl', pathKey: 'categoryLightingImagePath', previewId: 'category-lighting-image-preview', label: 'Lighting category image', categoryIndex: 2 },
  { field: 'categorySuspensionImage', urlKey: 'categorySuspensionImageUrl', pathKey: 'category-suspension-image-preview', label: 'Suspension category image', categoryIndex: 3 }
];

function saveProducts() {
  document.querySelector('#nav-product-count').textContent = products.length;
  document.querySelector('#metric-products').textContent = products.length;
}

function imageContentType(file) {
  const declaredType = String(file?.type || '').toLowerCase();
  if (Object.values(IMAGE_CONTENT_TYPES).includes(declaredType)) return declaredType;
  const extension = String(file?.name || '').toLowerCase().split('.').pop();
  return IMAGE_CONTENT_TYPES[extension] || '';
}

function validateImageFile(file, label = 'Image') {
  if (!(file instanceof File) || !file.size) return '';
  const contentType = imageContentType(file);
  if (!contentType) {
    showToast(`${label} must be a JPEG, PNG, WebP, GIF, or AVIF image`);
    return '';
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast(`${label} must be 5 MB or smaller`);
    return '';
  }
  return contentType;
}

function storageUploadError(error, label = 'image') {
  console.error(`[Greenhub] Could not upload ${label}:`, error);
  return error?.message || error?.statusCode || 'Supabase rejected the upload';
}

function toDatabaseProduct(product, includeId = true) {
  const payload = { name: product.name, category: product.category, type: product.type, price: product.price, old_price: product.oldPrice || null, meta: product.meta, tag: product.tag, active: product.active !== false, image_url: product.imageUrl || null, image_path: product.imagePath || null };
  if (includeId && product.id !== undefined && product.id !== null) payload.id = product.id;
  return payload;
}

function fromDatabaseProduct(product) {
  return { id: Number(product.id), name: product.name, category: product.category, type: product.type, price: Number(product.price), oldPrice: product.old_price !== null ? Number(product.old_price) : undefined, meta: product.meta, tag: product.tag, active: product.active !== false, imageUrl: product.image_url || '', imagePath: product.image_path || '' };
}

function price(value) {
  return `€${Number(value).toFixed(2)}`;
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
      .replace(/\bparts?\b/gi, 'products');
  });
  return cleaned;
}

function configuredCategories(settings = storefrontSettings) {
  const formCategories = [...document.querySelectorAll('#content-form input')]
    .filter((input) => /^category\d+$/.test(input.name))
    .map((input) => input.value);
  const settingCategories = Array.isArray(settings.categories)
    ? settings.categories
    : CATEGORY_SETTING_KEYS.map((key, index) => settings[key] || settings[LEGACY_CATEGORY_SETTING_KEYS[index]] || '');
  const productCategories = products.map((product) => product.category);
  const configured = [...formCategories, ...settingCategories].map((value) => String(value || '').trim()).filter(Boolean);
  const values = [...configured, ...productCategories].map((value) => String(value || '').trim()).filter(Boolean);
  return [...new Set(values)];
}

function refreshCategoryControls() {
  const categories = configuredCategories();
  const filter = document.querySelector('#product-filter');
  const categorySelect = document.querySelector('#product-form select[name="category"]');
  if (filter) {
    const currentValue = filter.value;
    filter.innerHTML = '<option value="All">All categories</option>';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      filter.appendChild(option);
    });
    filter.value = categories.includes(currentValue) ? currentValue : 'All';
  }
  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.replaceChildren(new Option('Choose a category', ''), ...categories.map((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      return option;
    }));
    categorySelect.value = categories.includes(currentValue) ? currentValue : '';
  }
}

function categoryFieldInputs() {
  return [...document.querySelectorAll('#content-form input')]
    .filter((input) => /^category\d+$/.test(input.name))
    .sort((a, b) => Number(a.name.replace('category', '')) - Number(b.name.replace('category', '')));
}

function categoryImageUrls(settings = storefrontSettings) {
  if (Array.isArray(settings.categoryImageUrls)) return settings.categoryImageUrls;
  return STOREFRONT_IMAGE_FIELDS
    .filter((field) => field.categoryIndex !== undefined)
    .sort((a, b) => a.categoryIndex - b.categoryIndex)
    .map((field) => settings[field.urlKey] || '');
}

function createCategoryField(index, value = '', imageUrl = '') {
  const label = document.createElement('label');
  label.textContent = `Product category ${index}`;
  const input = document.createElement('input');
  input.name = `category${index}`;
  input.type = 'text';
  input.placeholder = 'e.g. Accessories';
  input.value = value;
  label.appendChild(input);
  const imageLabel = document.createElement('small');
  imageLabel.className = 'field-help';
  imageLabel.textContent = 'Category image';
  label.appendChild(imageLabel);
  const imageInput = document.createElement('input');
  imageInput.name = `categoryImage${index}`;
  imageInput.type = 'file';
  imageInput.accept = 'image/*';
  imageInput.dataset.categoryImageIndex = String(index - 1);
  imageInput.addEventListener('change', previewSelectedCategoryImage);
  label.appendChild(imageInput);
  const preview = document.createElement('div');
  preview.className = 'storefront-image-preview category-image-preview';
  preview.dataset.categoryImagePreview = String(index - 1);
  preview.appendChild(document.createElement('span')).textContent = imageUrl ? 'Current image' : 'No image uploaded';
  label.appendChild(preview);
  if (imageUrl) setImagePreviewElement(preview, imageUrl, `Category ${index} image`);
  return label;
}

function syncCategoryFields(categories = [], imageUrls = categoryImageUrls()) {
  const firstInput = document.querySelector('#content-form input[name="category1"]');
  const group = firstInput?.closest('.form-grid');
  if (!group) return;
  const values = categories.map((category) => String(category || '').trim());
  const inputs = categoryFieldInputs();
  values.slice(inputs.length).forEach((value, offset) => {
    const index = inputs.length + offset + 1;
    group.insertBefore(createCategoryField(index, value, imageUrls[index - 1] || ''), group.querySelector('[data-add-store-category]'));
  });
  categoryFieldInputs().forEach((input, index) => {
    input.value = values[index] || '';
    const imageInput = input.closest('label')?.querySelector('input[data-category-image-index]');
    const preview = input.closest('label')?.querySelector('[data-category-image-preview]');
    if (imageInput && preview && imageUrls[index]) setImagePreviewElement(preview, imageUrls[index], `Category ${index + 1} image`);
  });
  let addButton = group.querySelector('[data-add-store-category]');
  if (!addButton) {
    addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'admin-button secondary category-add-button';
    addButton.dataset.addStoreCategory = 'true';
    addButton.textContent = '+ Add category';
    group.appendChild(addButton);
  }
}

function addStoreCategoryField() {
  const input = document.querySelector('#content-form input[name="category1"]');
  const group = input?.closest('.form-grid');
  if (!group) return;
  const nextIndex = categoryFieldInputs().length + 1;
  const addButton = group.querySelector('[data-add-store-category]');
  const field = createCategoryField(nextIndex, '', categoryImageUrls()[nextIndex - 1] || '');
  group.insertBefore(field, addButton || null);
  field.querySelector('input').focus();
  refreshCategoryControls();
}

function productImageMarkup(product) {
  return product.imageUrl
    ? `<img class="table-product-image" data-empty-fallback src="${product.imageUrl}" alt="" /><span class="table-image-empty" hidden>No image</span>`
    : '<span class="table-image-empty">No image</span>';
}

function bindMissingProductImages() {
  document.querySelectorAll('#products-table img[data-empty-fallback]').forEach((image) => {
    const showFallback = () => {
      image.hidden = true;
      const fallback = image.nextElementSibling;
      if (fallback?.classList.contains('table-image-empty')) fallback.hidden = false;
    };
    image.addEventListener('error', showFallback, { once: true });
    if (image.complete && image.naturalWidth === 0) showFallback();
  });
}

function renderProducts() {
  const searchTerm = document.querySelector('#product-search').value.toLowerCase().trim();
  const category = document.querySelector('#product-filter').value;
  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === 'All' || product.category === category;
    const matchesSearch = !searchTerm || `${product.name} ${product.category} ${product.meta}`.toLowerCase().includes(searchTerm);
    return matchesCategory && matchesSearch;
  });
  document.querySelector('#toolbar-count').textContent = `${visibleProducts.length} product${visibleProducts.length === 1 ? '' : 's'}`;
  document.querySelector('#products-table').innerHTML = visibleProducts.map((product) => `<tr><td><div class="table-product">${productImageMarkup(product)}<span>${product.name}</span></div></td><td><span class="category-pill">${product.category}</span></td><td>${price(product.price)}</td><td><span class="tag-pill">${product.tag}</span></td><td><span class="visibility ${product.active === false ? 'hidden' : ''}"><i></i>${product.active === false ? 'Hidden' : 'Live'}</span></td><td><div class="row-actions"><button data-edit-product="${product.id}" aria-label="Edit ${product.name}">✎</button><button class="delete" data-delete-product="${product.id}" aria-label="Delete ${product.name}">×</button></div></td></tr>`).join('');
  bindMissingProductImages();
}

function renderOrders() {
  const rows = ORDERS.map((order) => `<tr><td>${order.id}</td><td>${order.customer}</td><td>${order.date}</td><td>${order.items}</td><td>${price(order.total)}</td><td><select class="order-status-select status ${order.statusClass}" data-order-status="${order.id}"><option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option><option value="paid" ${order.status === 'paid' ? 'selected' : ''}>Paid</option><option value="packing" ${order.status === 'packing' ? 'selected' : ''}>To pack</option><option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option><option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option><option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option></select></td></tr>`).join('');
  document.querySelector('#orders-table').innerHTML = rows;
  document.querySelector('#mini-order-list').innerHTML = ORDERS.slice(0, 4).map((order) => `<div class="mini-order"><span><strong>${order.id}</strong><span>${order.customer}</span></span><small>${order.date}</small><span class="status ${order.statusClass}">${order.status}</span></div>`).join('');
}

async function updateOrderStatus(orderId, status) {
  const order = ORDERS.find((item) => item.id === orderId);
  if (!order) return;
  if (database.configured) {
    const { error } = await database.client.from('orders').update({ status }).eq('id', orderId);
    if (error) { showToast(`Could not update order: ${error.message}`); renderOrders(); return; }
  }
  order.status = status;
  order.statusClass = status === 'paid' ? 'paid' : status === 'shipped' || status === 'delivered' ? 'shipped' : status === 'cancelled' ? 'cancelled' : 'packing';
  renderOrders();
  showToast('Order status updated');
}

function renderCustomers() {
  document.querySelector('#customers-table').innerHTML = CUSTOMERS.map((customer) => `<tr><td><strong>${customer.name}</strong><br /><small>${customer.email}</small></td><td>${customer.location}</td><td>${customer.orders}</td><td>${price(customer.spent)}</td><td>${customer.lastOrder}</td><td><span class="tag-pill">${customer.segment}</span></td></tr>`).join('');
}

function renderMembers() {
  const searchTerm = document.querySelector('#team-search')?.value.toLowerCase().trim() || '';
  const visibleMembers = MEMBERS.filter((member) => {
    const searchText = `${member.full_name || ''} ${member.email || ''} ${member.id}`.toLowerCase();
    return !searchTerm || searchText.includes(searchTerm);
  });
  const adminCount = MEMBERS.filter((member) => member.role === 'admin').length;
  const table = document.querySelector('#team-table');
  if (!table) return;
  document.querySelector('#nav-team-count').textContent = MEMBERS.length;
  document.querySelector('#team-member-count').textContent = MEMBERS.length;
  document.querySelector('#team-admin-count').textContent = adminCount;
  document.querySelector('#team-toolbar-count').textContent = `${visibleMembers.length} member${visibleMembers.length === 1 ? '' : 's'}`;
  if (!visibleMembers.length) {
    table.innerHTML = '<tr><td colspan="5" class="team-empty">No members match this search.</td></tr>';
    return;
  }
  table.innerHTML = visibleMembers.map((member) => {
    const name = member.full_name || 'Unnamed member';
    const email = member.email || 'Email unavailable';
    const joined = member.created_at ? new Date(member.created_at).toLocaleDateString() : '—';
    const isSelf = member.id === currentAdminUserId;
    const role = member.role === 'admin' ? 'Admin' : 'Member';
    const action = isSelf
      ? '<span class="team-you">You</span>'
      : member.role === 'admin'
        ? `<button class="admin-button team-role-button revoke" type="button" data-member-id="${escapeHtml(member.id)}" data-member-role="customer">Revoke admin</button>`
        : `<button class="admin-button team-role-button" type="button" data-member-id="${escapeHtml(member.id)}" data-member-role="admin">Grant admin</button>`;
    return `<tr><td><strong>${escapeHtml(name)}</strong><br /><small>${escapeHtml(member.id)}</small></td><td>${escapeHtml(email)}</td><td>${escapeHtml(joined)}</td><td><span class="team-role ${member.role === 'admin' ? 'admin' : ''}"><i></i>${role}</span></td><td>${action}</td></tr>`;
  }).join('');
}

async function loadMembers(silent = false) {
  if (!database.configured) return;
  const { data, error } = await database.client
    .from('profiles')
    .select('id, full_name, email, role, created_at')
    .order('created_at', { ascending: false });
  if (error) {
    if (!silent) showToast(`Could not load team members: ${error.message}`);
    return;
  }
  MEMBERS = data || [];
  renderMembers();
}

async function updateMemberRole(memberId, role, button) {
  if (!database.configured || !memberId || !role) return;
  button.disabled = true;
  const { error } = await database.client.rpc('set_member_role', { p_member_id: memberId, p_role: role });
  button.disabled = false;
  if (error) {
    showToast(`Could not update member role: ${error.message}`);
    return;
  }
  await loadMembers();
  showToast(role === 'admin' ? 'Admin access granted' : 'Admin access revoked');
}

function refreshDashboardStats() {
  const orderCount = document.querySelector('.admin-nav-item[data-view="orders"] b');
  if (orderCount) orderCount.textContent = ORDERS.length;
  const statusCounts = ['pending', 'packing', 'shipped', 'delivered'].map((status) => ORDERS.filter((order) => order.status === status).length);
  document.querySelectorAll('.orders-summary > div strong').forEach((element, index) => { element.textContent = statusCounts[index] ?? 0; });
  const customerStats = document.querySelectorAll('.customer-stats > div strong');
  if (customerStats[0]) customerStats[0].textContent = CUSTOMERS.length;
  if (customerStats[1]) customerStats[1].textContent = CUSTOMERS.filter((customer) => customer.segment === 'New').length;
  if (customerStats[2]) customerStats[2].textContent = price(ORDERS.length ? ORDERS.reduce((sum, order) => sum + Number(order.total || 0), 0) / ORDERS.length : 0);
}

function showView(viewName) {
  document.querySelectorAll('.admin-view').forEach((view) => view.classList.toggle('active', view.id === `${viewName}-view`));
  document.querySelectorAll('.admin-nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  document.querySelector('#page-breadcrumb').textContent = viewName === 'content' ? 'Store content' : viewName[0].toUpperCase() + viewName.slice(1);
  document.querySelector('#admin-sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  const toast = document.querySelector('.admin-toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2400);
}

function updateSupportAvailabilityUI() {
  const toggle = document.querySelector('#support-availability');
  const label = document.querySelector('#support-availability-label');
  const inboxStatus = document.querySelector('#support-inbox-status');
  if (toggle) toggle.checked = supportIsAvailable;
  if (label) label.textContent = supportIsAvailable ? 'Online — you are answering customers' : 'Offline — bot is answering';
  if (inboxStatus) inboxStatus.textContent = supportIsAvailable ? 'Admin support active' : 'Bot support active';
}

async function loadSupportPresence() {
  const { data, error } = await database.client.from('support_presence').select('is_available').eq('id', 1).maybeSingle();
  if (error) throw error;
  supportIsAvailable = data?.is_available === true;
  updateSupportAvailabilityUI();
}

async function setSupportAvailability(event) {
  if (!database.configured) return;
  const nextValue = event.currentTarget.checked;
  event.currentTarget.disabled = true;
  const { error } = await database.client.from('support_presence').update({ is_available: nextValue, updated_at: new Date().toISOString() }).eq('id', 1);
  event.currentTarget.disabled = false;
  if (error) {
    event.currentTarget.checked = supportIsAvailable;
    showToast(`Could not update support status: ${error.message}`);
    return;
  }
  supportIsAvailable = nextValue;
  updateSupportAvailabilityUI();
  showToast(nextValue ? 'You are now available in customer chat' : 'Bot support is now answering customers');
}

function renderSupportConversations() {
  const list = document.querySelector('#support-conversation-list');
  const count = document.querySelector('#nav-support-count');
  if (!list) return;
  const openConversations = supportConversations.filter((conversation) => conversation.status === 'open');
  if (count) count.textContent = openConversations.length;
  list.replaceChildren();
  if (!supportConversations.length) {
    list.innerHTML = '<div class="support-empty">No customer conversations yet.</div>';
    return;
  }
  supportConversations.forEach((conversation) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `support-conversation-item ${conversation.id === activeSupportConversationId ? 'active' : ''}`;
    button.dataset.supportConversation = conversation.id;
    const heading = document.createElement('strong');
    heading.textContent = conversation.customer_name || `Visitor ${conversation.id.slice(0, 6)}`;
    const meta = document.createElement('span');
    meta.textContent = `${conversation.status === 'open' ? 'Open' : 'Closed'} · ${new Date(conversation.updated_at).toLocaleString()}`;
    button.append(heading, meta);
    list.appendChild(button);
  });
}

function renderSupportThread(messages = []) {
  const thread = document.querySelector('#support-thread');
  if (!thread) return;
  thread.replaceChildren();
  if (!messages.length) {
    thread.innerHTML = '<div class="support-empty">No messages in this conversation.</div>';
    return;
  }
  messages.forEach((message) => {
    const item = document.createElement('div');
    item.className = `admin-chat-message ${message.sender_type}`;
    const meta = document.createElement('span');
    const senderLabel = message.sender_name || (message.sender_type === 'customer' ? 'CUSTOMER' : message.sender_type === 'admin' ? 'YOU' : 'GREENHUB BOT');
    meta.textContent = `${senderLabel} · ${new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const body = document.createElement('p');
    body.textContent = message.body;
    item.append(meta, body);
    thread.appendChild(item);
  });
  thread.scrollTop = thread.scrollHeight;
}

async function loadSupportThread(conversationId = activeSupportConversationId) {
  if (!conversationId) return;
  const conversation = supportConversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  activeSupportConversationId = conversationId;
  const title = document.querySelector('#support-thread-title');
  const closeButton = document.querySelector('#support-close-conversation');
  const replyInput = document.querySelector('#support-reply-input');
  const replyButton = document.querySelector('#support-reply-form button');
  if (title) title.textContent = conversation.customer_name || `Visitor ${conversation.id.slice(0, 6)}`;
  if (closeButton) closeButton.hidden = conversation.status !== 'open';
  if (replyInput) replyInput.disabled = conversation.status !== 'open';
  if (replyButton) replyButton.disabled = conversation.status !== 'open';
  renderSupportConversations();
  const { data, error } = await database.client.from('support_messages').select('id, sender_type, sender_name, body, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error) { showToast(`Could not load conversation: ${error.message}`); return; }
  renderSupportThread(data || []);
}

async function loadSupportData(silent = false) {
  if (!database.configured) return;
  try {
    await loadSupportPresence();
    const { data, error } = await database.client.from('support_conversations').select('id, customer_name, customer_email, status, created_at, updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    supportConversations = data || [];
    if (activeSupportConversationId && !supportConversations.some((item) => item.id === activeSupportConversationId)) activeSupportConversationId = null;
    renderSupportConversations();
    if (activeSupportConversationId) await loadSupportThread(activeSupportConversationId);
  } catch (error) {
    if (!silent) showToast(`Could not load support inbox: ${error.message}`);
    else console.error('[Greenhub] Support inbox sync failed:', error.message);
  }
}

async function sendSupportReply(event) {
  event.preventDefault();
  const input = document.querySelector('#support-reply-input');
  const body = input.value.trim();
  const conversation = supportConversations.find((item) => item.id === activeSupportConversationId);
  if (!body || !conversation || conversation.status !== 'open') return;
  const button = event.currentTarget.querySelector('button');
  input.disabled = true;
  button.disabled = true;
  const { error } = await database.client.from('support_messages').insert({ conversation_id: conversation.id, sender_type: 'admin', sender_id: currentAdminUserId, sender_name: 'Greenhub admin', body });
  input.disabled = false;
  button.disabled = false;
  if (error) { showToast(`Could not send reply: ${error.message}`); return; }
  input.value = '';
  await loadSupportData(true);
  await loadSupportThread(conversation.id);
}

async function closeSupportConversation() {
  const conversation = supportConversations.find((item) => item.id === activeSupportConversationId);
  if (!conversation) return;
  const { error } = await database.client.from('support_conversations').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', conversation.id);
  if (error) { showToast(`Could not close conversation: ${error.message}`); return; }
  showToast('Conversation closed');
  await loadSupportData(true);
  await loadSupportThread(conversation.id);
}

function releasePreviewObjectUrl(preview) {
  if (!preview?.dataset.objectUrl) return;
  URL.revokeObjectURL(preview.dataset.objectUrl);
  delete preview.dataset.objectUrl;
}

function releaseImagePreviewUrl() {
  releasePreviewObjectUrl(document.querySelector('#product-image-preview'));
}

function setImagePreviewElement(preview, imageUrl = '', alt = 'Image preview', fileName = '') {
  if (!preview) return;
  releasePreviewObjectUrl(preview);
  if (!imageUrl) {
    preview.innerHTML = '<span>No image uploaded</span>';
    return;
  }
  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = alt;
  preview.replaceChildren(image);
  if (fileName) {
    const caption = document.createElement('span');
    caption.className = 'preview-file-name';
    caption.textContent = fileName;
    preview.appendChild(caption);
  }
}

function setProductImagePreview(imageUrl = '', alt = 'Product image', fileName = '') {
  setImagePreviewElement(document.querySelector('#product-image-preview'), imageUrl, alt, fileName);
}

function previewSelectedProductImage(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) {
    const product = products.find((item) => item.id === editingProductId);
    setProductImagePreview(product?.imageUrl || '', 'Current product image');
    return;
  }
  if (!file.type.startsWith('image/')) {
    event.currentTarget.value = '';
    showToast('Please choose an image file');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    event.currentTarget.value = '';
    showToast('Images must be 5 MB or smaller');
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  const preview = document.querySelector('#product-image-preview');
  setProductImagePreview(objectUrl, file.name, file.name);
  if (preview) preview.dataset.objectUrl = objectUrl;
}

function storefrontImageConfig(fieldName) {
  return STOREFRONT_IMAGE_FIELDS.find((field) => field.field === fieldName);
}

function previewSelectedStorefrontImage(event) {
  const field = storefrontImageConfig(event.currentTarget.dataset.storefrontImage);
  const preview = document.querySelector(`#${field?.previewId}`);
  if (!field || !preview) return;
  const file = event.currentTarget.files?.[0];
  if (!file) {
    setImagePreviewElement(preview, storefrontSettings[field.urlKey] || '', field.label);
    return;
  }
  if (!file.type.startsWith('image/')) {
    event.currentTarget.value = '';
    showToast('Please choose an image file');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    event.currentTarget.value = '';
    showToast('Images must be 5 MB or smaller');
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  setImagePreviewElement(preview, objectUrl, file.name, file.name);
  preview.dataset.objectUrl = objectUrl;
}

function previewSelectedCategoryImage(event) {
  const imageInput = event.currentTarget;
  const preview = imageInput.closest('label')?.querySelector('[data-category-image-preview]');
  const index = Number(imageInput.dataset.categoryImageIndex);
  if (!preview || !Number.isInteger(index)) return;
  const file = imageInput.files?.[0];
  if (!file) {
    setImagePreviewElement(preview, categoryImageUrls()[index] || '', `Category ${index + 1} image`);
    return;
  }
  const contentType = validateImageFile(file, `Category ${index + 1} image`);
  if (!contentType) {
    imageInput.value = '';
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  setImagePreviewElement(preview, objectUrl, `Category ${index + 1} image`, file.name);
  preview.dataset.objectUrl = objectUrl;
}

function openProductModal(productId = null) {
  const modal = document.querySelector('#product-modal');
  const form = document.querySelector('#product-form');
  const product = products.find((item) => item.id === Number(productId));
  editingProductId = product ? product.id : null;
  form.reset();
  document.querySelector('#modal-title').textContent = product ? 'Edit product' : 'Add product';
  if (product) Object.entries(product).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    if (key === 'active') form.elements[key].checked = value !== false;
    else if (key !== 'image') form.elements[key].value = value;
  });
  setProductImagePreview(product?.imageUrl || '', 'Current product image');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => form.elements.name.focus(), 100);
}

function closeProductModal() {
  const modal = document.querySelector('#product-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  releaseImagePreviewUrl();
  editingProductId = null;
}

function closeConfirmation(confirmed = false) {
  if (!confirmMessageBox) return;
  confirmMessageBox.classList.remove('open');
  confirmMessageBox.setAttribute('aria-hidden', 'true');
  const resolve = pendingConfirmation;
  pendingConfirmation = null;
  if (resolve) resolve(confirmed);
}

function openConfirmation({ title, message, confirmLabel = 'Confirm' }) {
  if (!confirmMessageBox) return Promise.resolve(false);
  if (pendingConfirmation) closeConfirmation(false);
  confirmMessageTitle.textContent = title;
  confirmMessageCopy.textContent = message;
  confirmMessageAccept.textContent = confirmLabel;
  confirmMessageBox.classList.add('open');
  confirmMessageBox.setAttribute('aria-hidden', 'false');
  setTimeout(() => confirmMessageAccept.focus(), 0);
  return new Promise((resolve) => { pendingConfirmation = resolve; });
}

async function saveProduct(event) {
  event.preventDefault();
  if (!database.configured) { showToast('Supabase is required before saving products'); return; }
  const formData = new FormData(event.currentTarget);
  const wasEditing = Boolean(editingProductId);
  const existingProduct = products.find((item) => item.id === editingProductId);
  const product = { ...(existingProduct || {}), id: editingProductId || undefined, name: formData.get('name').trim(), category: formData.get('category'), type: formData.get('type'), price: Number(formData.get('price')), oldPrice: Number(formData.get('oldPrice')) || undefined, meta: formData.get('meta').trim(), tag: formData.get('tag').trim(), active: formData.has('active') };
  const imageFile = formData.get('image');
  if (!wasEditing && (!imageFile || !imageFile.size)) {
    showToast('Upload a product image before publishing');
    return;
  }
  if (database.configured) {
    let savedProduct;
    if (wasEditing) {
      const { data, error } = await database.client.from('products').update(toDatabaseProduct(product, false)).eq('id', editingProductId).select().single();
      if (error) { showToast(`Could not save product: ${error.message}`); return; }
      savedProduct = fromDatabaseProduct(data);
    } else {
      const { data, error } = await database.client.from('products').insert(toDatabaseProduct(product, false)).select().single();
      if (error) { showToast(`Could not save product: ${error.message}`); return; }
      savedProduct = fromDatabaseProduct(data);
    }
    if (imageFile instanceof File && imageFile.size) {
      const contentType = validateImageFile(imageFile, 'Product image');
      if (!contentType) return;
      const safeName = imageFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
      const imagePath = `products/${savedProduct.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await database.client.storage.from(STORAGE_BUCKET).upload(imagePath, imageFile, { upsert: false, cacheControl: '3600', contentType });
      if (uploadError) { showToast(`Could not upload image: ${storageUploadError(uploadError, 'product image')}`); return; }
      const { data: publicUrlData } = database.client.storage.from(STORAGE_BUCKET).getPublicUrl(imagePath);
      const { error: imageUpdateError } = await database.client.from('products').update({ image_url: publicUrlData.publicUrl, image_path: imagePath }).eq('id', savedProduct.id);
      if (imageUpdateError) { showToast(`Could not save image URL: ${imageUpdateError.message}`); return; }
      savedProduct.imageUrl = publicUrlData.publicUrl;
      savedProduct.imagePath = imagePath;
    }
    product.id = savedProduct.id;
    product.imageUrl = savedProduct.imageUrl;
    product.imagePath = savedProduct.imagePath;
  }
  product.id = product.id || Date.now();
  if (editingProductId) products = products.map((item) => item.id === editingProductId ? product : item);
  else products.push(product);
  saveProducts();
  renderProducts();
  closeProductModal();
  showToast(wasEditing ? 'Product updated' : 'Product added to the storefront');
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Report downloaded');
}

async function saveContent(event) {
  event.preventDefault();
  if (!database.configured) { showToast('Supabase is required before saving content'); return; }
  const formData = new FormData(event.currentTarget);
  const settings = { ...storefrontSettings };
  for (const [key, value] of formData.entries()) {
    if (!(value instanceof File)) settings[key] = value;
  }
  const categories = categoryFieldInputs().map((input) => input.value.trim()).filter(Boolean);
  settings.categories = categories;
  CATEGORY_SETTING_KEYS.forEach((key, index) => { settings[key] = categories[index] || ''; });
  const categoryUrls = [...categoryImageUrls(settings)];
  const categoryPaths = Array.isArray(settings.categoryImagePaths) ? [...settings.categoryImagePaths] : [];
  for (const field of STOREFRONT_IMAGE_FIELDS) {
    const imageFile = formData.get(field.field);
    if (!(imageFile instanceof File) || !imageFile.size) continue;
    const contentType = validateImageFile(imageFile, field.label);
    if (!contentType) return;
    const safeName = imageFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    const imagePath = `storefront/${field.field}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await database.client.storage.from(STORAGE_BUCKET).upload(imagePath, imageFile, { upsert: false, cacheControl: '3600', contentType });
    if (uploadError) { showToast(`Could not upload ${field.label.toLowerCase()}: ${storageUploadError(uploadError, field.label.toLowerCase())}`); return; }
    const { data: publicUrlData } = database.client.storage.from(STORAGE_BUCKET).getPublicUrl(imagePath);
    const previousPath = field.categoryIndex !== undefined ? categoryPaths[field.categoryIndex] || storefrontSettings[field.pathKey] : storefrontSettings[field.pathKey];
    settings[field.urlKey] = publicUrlData.publicUrl;
    settings[field.pathKey] = imagePath;
    if (field.categoryIndex !== undefined) {
      categoryUrls[field.categoryIndex] = publicUrlData.publicUrl;
      categoryPaths[field.categoryIndex] = imagePath;
    }
    setImagePreviewElement(document.querySelector(`#${field.previewId}`), publicUrlData.publicUrl, field.label, imageFile.name);
    if (previousPath && previousPath !== imagePath) {
      await database.client.storage.from(STORAGE_BUCKET).remove([previousPath]);
    }
  }
  for (const input of categoryFieldInputs()) {
    const index = Number(input.name.replace('category', '')) - 1;
    const imageFile = formData.get(`categoryImage${index + 1}`);
    if (!(imageFile instanceof File) || !imageFile.size) continue;
    const contentType = validateImageFile(imageFile, `Category ${index + 1} image`);
    if (!contentType) return;
    const safeName = imageFile.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    const imagePath = `storefront/category-${index + 1}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await database.client.storage.from(STORAGE_BUCKET).upload(imagePath, imageFile, { upsert: false, cacheControl: '3600', contentType });
    if (uploadError) { showToast(`Could not upload category ${index + 1} image: ${storageUploadError(uploadError, `category ${index + 1} image`)}`); return; }
    const { data: publicUrlData } = database.client.storage.from(STORAGE_BUCKET).getPublicUrl(imagePath);
    const previousPath = categoryPaths[index] || '';
    categoryUrls[index] = publicUrlData.publicUrl;
    categoryPaths[index] = imagePath;
    const preview = input.closest('label')?.querySelector('[data-category-image-preview]');
    setImagePreviewElement(preview, publicUrlData.publicUrl, `Category ${index + 1} image`, imageFile.name);
    if (previousPath && previousPath !== imagePath) await database.client.storage.from(STORAGE_BUCKET).remove([previousPath]);
  }
  settings.categoryImageUrls = categoryUrls.slice(0, categories.length);
  settings.categoryImagePaths = categoryPaths.slice(0, categories.length);
  const { data: savedSettings, error } = await database.client
    .from('store_settings')
    .upsert({ key: 'homepage', value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('value, updated_at')
    .single();
  if (error) { showToast(`Could not save content: ${error.message}`); return; }
  storefrontSettings = savedSettings?.value || settings;
  refreshCategoryControls();
  try {
    localStorage.setItem(STOREFRONT_SETTINGS_SYNC_KEY, String(Date.now()));
  } catch (storageError) {
    // The Supabase row is the source of truth; syncing is still handled on refresh.
  }
  showToast('Store content saved — storefront updated');
}

async function deleteProduct(product) {
  if (!database.configured) { showToast('Supabase is required before removing products'); return; }
  const { error } = await database.client.from('products').delete().eq('id', product.id);
  if (error) { showToast(`Could not remove product: ${error.message}`); return; }
  if (product.imagePath) await database.client.storage.from(STORAGE_BUCKET).remove([product.imagePath]);
  products = products.filter((item) => item.id !== product.id);
  saveProducts();
  renderProducts();
  showToast('Product removed');
}

document.querySelectorAll('.admin-nav-item').forEach((item) => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('[data-jump]').forEach((item) => item.addEventListener('click', () => showView(item.dataset.jump)));
document.querySelectorAll('[data-action="add-product"]').forEach((item) => item.addEventListener('click', () => { showView('products'); openProductModal(); }));
document.querySelector('[data-action="export-orders"]').addEventListener('click', () => downloadCsv('greenhub-orders.csv', [['Order', 'Customer', 'Date', 'Items', 'Total', 'Status'], ...ORDERS.map((order) => [order.id, order.customer, order.date, order.items, price(order.total), order.status])]));
document.querySelector('[data-action="export-customers"]').addEventListener('click', () => downloadCsv('greenhub-customers.csv', [['Name', 'Email', 'Location', 'Orders', 'Spent', 'Last order', 'Segment'], ...CUSTOMERS.map((customer) => [customer.name, customer.email, customer.location, customer.orders, price(customer.spent), customer.lastOrder, customer.segment])]));
document.querySelector('#product-search').addEventListener('input', renderProducts);
document.querySelector('#product-filter').addEventListener('change', renderProducts);
document.querySelector('#products-table').addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit-product]');
  const deleteButton = event.target.closest('[data-delete-product]');
  if (editButton) openProductModal(editButton.dataset.editProduct);
  if (deleteButton) {
    const product = products.find((item) => item.id === Number(deleteButton.dataset.deleteProduct));
    if (product) {
      openConfirmation({
        title: 'Remove product?',
        message: `Remove “${product.name}” from the storefront? This cannot be undone.`,
        confirmLabel: 'Remove product'
      }).then((confirmed) => { if (confirmed) deleteProduct(product); });
    }
  }
});
document.querySelector('#orders-table').addEventListener('change', (event) => {
  const statusSelect = event.target.closest('[data-order-status]');
  if (statusSelect) updateOrderStatus(statusSelect.dataset.orderStatus, statusSelect.value);
});
document.querySelector('#product-form').addEventListener('submit', saveProduct);
document.querySelector('#product-form input[name="image"]').addEventListener('change', previewSelectedProductImage);
document.querySelector('#content-form').addEventListener('submit', saveContent);
document.querySelector('#content-form').addEventListener('click', (event) => {
  if (event.target.closest('[data-add-store-category]')) addStoreCategoryField();
});
document.querySelector('#team-search').addEventListener('input', renderMembers);
document.querySelector('#team-table').addEventListener('click', (event) => {
  const roleButton = event.target.closest('[data-member-id]');
  if (roleButton) updateMemberRole(roleButton.dataset.memberId, roleButton.dataset.memberRole, roleButton);
});
document.querySelector('#support-availability').addEventListener('change', setSupportAvailability);
document.querySelector('#support-conversation-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-support-conversation]');
  if (button) loadSupportThread(button.dataset.supportConversation);
});
document.querySelector('#support-reply-form').addEventListener('submit', sendSupportReply);
document.querySelector('#support-close-conversation').addEventListener('click', closeSupportConversation);
confirmMessageCancel.addEventListener('click', () => closeConfirmation(false));
confirmMessageAccept.addEventListener('click', () => closeConfirmation(true));
confirmMessageBox.addEventListener('click', (event) => {
  if (event.target.closest('[data-confirm-close]')) closeConfirmation(false);
});
document.querySelectorAll('[data-modal-close]').forEach((item) => item.addEventListener('click', closeProductModal));
document.querySelector('.admin-menu').addEventListener('click', () => document.querySelector('#admin-sidebar').classList.toggle('open'));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (confirmMessageBox.classList.contains('open')) closeConfirmation(false);
  else closeProductModal();
});

async function loadContent() {
  if (!database.configured) return;
  const { data, error } = await database.client.from('store_settings').select('value, updated_at').eq('key', 'homepage').maybeSingle();
  if (error) { showToast(`Could not load store content: ${error.message}`); return; }
  const settings = cleanStorefrontCopy(data?.value || {});
  const categories = Array.isArray(settings.categories)
    ? settings.categories
    : CATEGORY_SETTING_KEYS.map((key, index) => settings[key] || LEGACY_CATEGORY_VALUES[index] || '');
  settings.categories = categories;
  settings.whatsapp = GREENHUB_WHATSAPP;
  STOREFRONT_IMAGE_FIELDS.forEach((field) => {
    settings[field.urlKey] = window.GreenhubStorage.resolveUrl(settings[field.urlKey], settings[field.pathKey]);
  });
  settings.categoryImageUrls = categoryImageUrls(settings).map((url, index) => window.GreenhubStorage.resolveUrl(url, settings.categoryImagePaths?.[index]) || url);
  syncCategoryFields(categories, settings.categoryImageUrls);
  storefrontSettings = settings;
  document.querySelectorAll('#content-form [name]').forEach((field) => {
    const value = settings[field.name];
    if (/title/i.test(field.name) && !String(value ?? '').trim()) field.value = 'Not titled';
    else if (value !== undefined && value !== null) field.value = value;
  });
  STOREFRONT_IMAGE_FIELDS.forEach((field) => setImagePreviewElement(document.querySelector(`#${field.previewId}`), settings[field.urlKey] || '', field.label));
  refreshCategoryControls();
}

function ensureExtendedContentFields() {
  const form = document.querySelector('#content-form');
  if (!form || form.dataset.extended === 'true') return;
  const panel = document.createElement('article');
  panel.className = 'admin-panel content-panel extended-content-panel';
  panel.innerHTML = `<div class="panel-heading"><div><p class="admin-kicker">HOMEPAGE</p><h2>Homepage controls</h2></div><span class="content-status">Editable storefront copy</span></div><div class="form-grid"><label>Hero eyebrow<input name="heroEyebrow" type="text" value="THE NEW STANDARD IN SPARES" /></label><label>Hero title line 1<input name="heroTitleLine1" type="text" value="Parts that fit." /></label><label>Hero title line 2<input name="heroTitleLine2" type="text" value="Every time." /></label><label>Shop button<input name="heroShopCta" type="text" value="Shop all parts" /></label><label>Browse button<input name="heroBrowseCta" type="text" value="Browse by system" /></label></div><div class="form-grid"><label>Category eyebrow<input name="categoryEyebrow" type="text" value="FIND YOUR FIT" /></label><label>Category title<input name="categoryTitle" type="text" value="Start with your car." /></label><label>Product category 1<input name="category1" type="text" value="Brakes" placeholder="e.g. Braking" /></label><label>Product category 2<input name="category2" type="text" value="Engine" placeholder="e.g. Engine & air" /></label><label>Product category 3<input name="category3" type="text" value="Lighting" placeholder="e.g. Lighting" /></label><label>Product category 4<input name="category4" type="text" value="Suspension" placeholder="e.g. Suspension" /></label></div><div class="form-grid"><label>Shop section eyebrow<input name="shopEyebrow" type="text" value="THE ESSENTIALS" /></label><label>Shop section title<input name="shopTitle" type="text" value="Good parts. No drama." /></label><label>Story eyebrow<input name="storyEyebrow" type="text" value="WHY GREENHUB" /></label><label>Story link label<input name="storyLink" type="text" value="More about our standard" /></label><label>Newsletter eyebrow<input name="newsletterEyebrow" type="text" value="KEEP MOVING" /></label><label>Newsletter title line 1<input name="newsletterTitleLine1" type="text" value="Better parts." /></label><label>Newsletter title line 2<input name="newsletterTitleLine2" type="text" value="Better journeys." /></label><label>Footer intro<input name="footerIntro" type="text" value="For the road ahead. For the work under the hood." /></label></div><div class="storefront-image-grid"><label>Hero image<input name="heroImage" type="file" accept="image/*" data-storefront-image="heroImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="hero-image-preview"><span>No image uploaded</span></div></label><label>Our standard image<input name="storyImage" type="file" accept="image/*" data-storefront-image="storyImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="story-image-preview"><span>No image uploaded</span></div></label><label>Category 1 image<input name="categoryBrakesImage" type="file" accept="image/*" data-storefront-image="categoryBrakesImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-brakes-image-preview"><span>No image uploaded</span></div></label><label>Category 2 image<input name="categoryEngineImage" type="file" accept="image/*" data-storefront-image="categoryEngineImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-engine-image-preview"><span>No image uploaded</span></div></label><label>Category 3 image<input name="categoryLightingImage" type="file" accept="image/*" data-storefront-image="categoryLightingImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-lighting-image-preview"><span>No image uploaded</span></div></label><label>Category 4 image<input name="categorySuspensionImage" type="file" accept="image/*" data-storefront-image="categorySuspensionImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-suspension-image-preview"><span>No image uploaded</span></div></label></div>`;
  const actions = form.querySelector('.content-actions')?.closest('article');
  panel.innerHTML = panel.innerHTML.replace(/\bparts?\b/gi, 'products').replace(/Products that fit\./g, 'Built to fit.');
  form.insertBefore(panel, actions || null);
  form.dataset.extended = 'true';
}

async function loadRemoteData() {
  if (!database.configured) return;
  try {
    const [productResponse, orderResponse, customerResponse] = await Promise.all([
      database.client.from('products').select('id, name, category, type, price, old_price, meta, tag, active, image_url, image_path').order('created_at', { ascending: false }),
      database.client.from('orders').select('id, customer_name, customer_email, items, total, status, created_at').order('created_at', { ascending: false }),
      database.client.from('customers').select('name, email, location, segment, created_at').order('created_at', { ascending: false })
    ]);
    if (!productResponse.error && productResponse.data) products = productResponse.data.map(fromDatabaseProduct);
    if (!orderResponse.error && orderResponse.data) ORDERS = orderResponse.data.map((order) => ({ id: order.id, customer: order.customer_name, customerEmail: order.customer_email || '', date: new Date(order.created_at).toLocaleDateString(), items: Array.isArray(order.items) ? `${order.items.length} product${order.items.length === 1 ? '' : 's'}` : '—', total: Number(order.total), status: order.status, statusClass: order.status === 'paid' ? 'paid' : order.status === 'shipped' || order.status === 'delivered' ? 'shipped' : order.status === 'cancelled' ? 'cancelled' : 'packing' }));
    if (!customerResponse.error && customerResponse.data) CUSTOMERS = customerResponse.data.map((customer) => {
      const customerOrders = ORDERS.filter((order) => order.customerEmail && customer.email && order.customerEmail.toLowerCase() === customer.email.toLowerCase());
      return { name: customer.name, email: customer.email || '—', location: customer.location || '—', orders: customerOrders.length, spent: customerOrders.reduce((sum, order) => sum + order.total, 0), lastOrder: customerOrders[0]?.date || '—', segment: customer.segment };
    });
    document.querySelector('#metric-products').textContent = products.length;
    document.querySelector('#metric-orders').textContent = ORDERS.length;
    document.querySelector('#metric-revenue').textContent = price(ORDERS.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + Number(order.total || 0), 0));
    document.querySelector('#metric-customers').textContent = CUSTOMERS.length;
    refreshDashboardStats();
    saveProducts();
    refreshCategoryControls();
    renderProducts();
    renderOrders();
    renderCustomers();
    await loadContent();
    await loadMembers();
  } catch (error) {
    showToast('Could not load Supabase data');
  }
}

const authScreen = document.querySelector('#admin-auth-screen');
const adminShell = document.querySelector('#admin-shell');
const authForm = document.querySelector('#admin-auth-form');
const authMessage = document.querySelector('#auth-message');
const authNote = document.querySelector('#auth-note');
const authSubmit = document.querySelector('#auth-submit-label');
const signOutButton = document.querySelector('#sign-out-button');
const authTitle = document.querySelector('#admin-auth-title');
const authNameField = document.querySelector('#admin-name-field');
const authNameInput = document.querySelector('#admin-name');
const authEmailInput = document.querySelector('#admin-email');
const authPasswordInput = document.querySelector('#admin-password');
const authModeToggle = document.querySelector('#auth-mode-toggle');
const authSwitchCopy = document.querySelector('#auth-switch-copy');
let authMode = 'signin';

function setAuthMessage(message, type = 'error') {
  authMessage.textContent = message;
  authMessage.classList.toggle('success', type === 'success');
}

function readableAuthError(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (error?.status === 500 || /database error saving new user|error saving new user/i.test(message)) {
    return 'Supabase could not finish creating the account. Run supabase/admin-management.sql in the Supabase SQL Editor as the database owner, then try again.';
  }
  return message;
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === 'signup';
  authTitle.textContent = signingUp ? 'Request admin access.' : 'Sign in to your store.';
  authNameField.hidden = !signingUp;
  authNameInput.required = signingUp;
  authPasswordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
  authSubmit.textContent = signingUp ? 'Create account' : 'Sign in securely';
  authSwitchCopy.textContent = signingUp ? 'Already have an account?' : 'Need an admin account?';
  authModeToggle.textContent = signingUp ? 'Sign in' : 'Sign up';
  authNote.textContent = signingUp
    ? 'New accounts must confirm their email and be approved by an existing administrator.'
    : 'Supabase authentication is required for the admin console.';
  setAuthMessage('');
}

function showAdminShell(profile) {
  authScreen.classList.add('hidden');
  adminShell.classList.add('authenticated');
  if (profile?.full_name) document.querySelector('.admin-user strong').textContent = profile.full_name;
}

function showAuthScreen(message = '') {
  authScreen.classList.remove('hidden');
  adminShell.classList.remove('authenticated');
  setAuthMessage(message);
}

async function authorizeAdmin(user) {
  if (!user?.id) {
    showAuthScreen('Could not identify this account. Please sign in again.');
    return false;
  }
  const { data: profile, error } = await database.client.from('profiles').select('role, full_name').eq('id', user.id).maybeSingle();
  if (error || profile?.role !== 'admin') {
    await database.client.auth.signOut();
    showAuthScreen(error ? 'Could not verify admin access. Check that the Supabase schema is installed.' : 'Admin access only. This account is not approved for the console.');
    return false;
  }
  currentAdminUserId = user.id;
  showAdminShell(profile);
  await loadRemoteData();
  await loadSupportData();
  if (!supportPollTimer) supportPollTimer = setInterval(() => loadSupportData(true), 5000);
  return true;
}

async function initializeAdminAuth() {
  if (window.GREENHUB_FILE_PROTOCOL) {
    authSubmit.textContent = 'Open via server';
    authForm.querySelector('button').disabled = true;
    authModeToggle.disabled = true;
    authNote.textContent = 'This admin console must be opened over HTTP, not directly as a file.';
    setAuthMessage('Run `npm start`, then open http://localhost:4173/admin.html.');
    return;
  }
  if (!database.configured) {
    authSubmit.textContent = 'Supabase required';
    authForm.querySelector('button').disabled = true;
    authModeToggle.disabled = true;
    authNote.textContent = 'Add SUPABASE_URL and SUPABASE_ANON_KEY to .env.local or .env, then start the Greenhub server.';
    setAuthMessage('The admin console is locked until Supabase is configured.');
    return;
  }
  try {
    const { data: sessionData, error } = await database.client.auth.getSession();
    if (error) {
      showAuthScreen(`Could not restore your session: ${error.message}`);
    } else if (sessionData.session) {
      await authorizeAdmin(sessionData.session.user);
    }
  } catch (error) {
    showAuthScreen(`Could not restore your session: ${error.message}`);
  }
  database.client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && adminShell.classList.contains('authenticated')) showAuthScreen('You have been signed out.');
  });
}

function getAuthRedirectUrl() {
  const configuredRedirect = window.GREENHUB_SUPABASE_CONFIG?.authRedirectTo;
  return configuredRedirect || undefined;
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!database.configured) return;
  const button = authForm.querySelector('button');
  button.disabled = true;
  authSubmit.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
  setAuthMessage('');
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (authMode === 'signup') {
    const options = { data: { full_name: authNameInput.value.trim() } };
    const redirectTo = getAuthRedirectUrl();
    if (redirectTo) options.emailRedirectTo = redirectTo;
    try {
      const { data, error } = await database.client.auth.signUp({ email, password, options });
      if (error) { authSubmit.textContent = 'Create account'; setAuthMessage(readableAuthError(error)); return; }
      if (!data?.user) { authSubmit.textContent = 'Create account'; setAuthMessage('We could not create that account. Please try again.'); return; }
      if (data.session) {
        const { error: signOutError } = await database.client.auth.signOut();
        if (signOutError) {
          authSubmit.textContent = 'Create account';
          setAuthMessage(`Account created, but we could not finish signing out: ${signOutError.message}`);
          return;
        }
      }
      authForm.reset();
      setAuthMode('signin');
      setAuthMessage('Account created. Confirm your email if required, then have an existing administrator promote it to admin.', 'success');
    } catch (error) {
      authSubmit.textContent = 'Create account';
      setAuthMessage(`Could not create account: ${readableAuthError(error)}`);
    } finally {
      button.disabled = false;
    }
    return;
  }
  try {
    const { data, error } = await database.client.auth.signInWithPassword({ email, password });
    if (error) { setAuthMessage(error.message); return; }
    await authorizeAdmin(data.user);
  } catch (error) {
    setAuthMessage(`Could not sign in: ${error.message}`);
  } finally {
    button.disabled = false;
    authSubmit.textContent = 'Sign in securely';
  }
});

authModeToggle.addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));

signOutButton.addEventListener('click', async () => {
  if (!database.configured) return;
  signOutButton.disabled = true;
  const { error } = await database.client.auth.signOut();
  signOutButton.disabled = false;
  if (error) showToast(`Could not sign out: ${error.message}`);
});

saveProducts();
renderProducts();
renderOrders();
renderCustomers();
refreshDashboardStats();
ensureExtendedContentFields();
syncCategoryFields(LEGACY_CATEGORY_VALUES);
document.querySelectorAll('[data-storefront-image]').forEach((input) => input.addEventListener('change', previewSelectedStorefrontImage));
loadContent();
initializeAdminAuth();
