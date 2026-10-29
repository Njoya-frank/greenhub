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
let products = [];
let editingProductId = null;
let storefrontSettings = {};
let currentAdminUserId = null;
let supportConversations = [];
let activeSupportConversationId = null;
let supportPollTimer = null;
let supportIsAvailable = false;

const STOREFRONT_IMAGE_FIELDS = [
  { field: 'heroImage', urlKey: 'heroImageUrl', pathKey: 'heroImagePath', previewId: 'hero-image-preview', label: 'Hero image' },
  { field: 'storyImage', urlKey: 'storyImageUrl', pathKey: 'storyImagePath', previewId: 'story-image-preview', label: 'Our standard image' },
  { field: 'categoryBrakesImage', urlKey: 'categoryBrakesImageUrl', pathKey: 'categoryBrakesImagePath', previewId: 'category-brakes-image-preview', label: 'Brakes category image' },
  { field: 'categoryEngineImage', urlKey: 'categoryEngineImageUrl', pathKey: 'categoryEngineImagePath', previewId: 'category-engine-image-preview', label: 'Engine category image' },
  { field: 'categoryLightingImage', urlKey: 'categoryLightingImageUrl', pathKey: 'categoryLightingImagePath', previewId: 'category-lighting-image-preview', label: 'Lighting category image' },
  { field: 'categorySuspensionImage', urlKey: 'categorySuspensionImageUrl', pathKey: 'categorySuspensionImagePath', previewId: 'category-suspension-image-preview', label: 'Suspension category image' }
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

function artLetter(type) {
  return { 'art-rotor': '◉', 'art-filter': '▤', 'art-lamp': '◈', 'art-tensioner': '◎' }[type] || '◌';
}

function productImageMarkup(product) {
  return product.imageUrl
    ? `<img class="table-product-image" src="${product.imageUrl}" alt="" />`
    : `<span class="table-art">${artLetter(product.type)}</span>`;
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

async function saveProduct(event) {
  event.preventDefault();
  if (!database.configured) { showToast('Supabase is required before saving products'); return; }
  const formData = new FormData(event.currentTarget);
  const wasEditing = Boolean(editingProductId);
  const existingProduct = products.find((item) => item.id === editingProductId);
  const product = { ...(existingProduct || {}), id: editingProductId || undefined, name: formData.get('name').trim(), category: formData.get('category'), type: formData.get('type'), price: Number(formData.get('price')), oldPrice: Number(formData.get('oldPrice')) || undefined, meta: formData.get('meta').trim(), tag: formData.get('tag').trim(), active: formData.has('active') };
  const imageFile = formData.get('image');
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
    settings[field.urlKey] = publicUrlData.publicUrl;
    settings[field.pathKey] = imagePath;
    setImagePreviewElement(document.querySelector(`#${field.previewId}`), publicUrlData.publicUrl, field.label, imageFile.name);
    if (storefrontSettings[field.pathKey] && storefrontSettings[field.pathKey] !== imagePath) {
      await database.client.storage.from(STORAGE_BUCKET).remove([storefrontSettings[field.pathKey]]);
    }
  }
  const { data: savedSettings, error } = await database.client
    .from('store_settings')
    .upsert({ key: 'homepage', value: settings, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('value, updated_at')
    .single();
  if (error) { showToast(`Could not save content: ${error.message}`); return; }
  storefrontSettings = savedSettings?.value || settings;
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
    if (product && window.confirm(`Remove ${product.name} from the storefront?`)) deleteProduct(product);
  }
});
document.querySelector('#orders-table').addEventListener('change', (event) => {
  const statusSelect = event.target.closest('[data-order-status]');
  if (statusSelect) updateOrderStatus(statusSelect.dataset.orderStatus, statusSelect.value);
});
document.querySelector('#product-form').addEventListener('submit', saveProduct);
document.querySelector('#product-form input[name="image"]').addEventListener('change', previewSelectedProductImage);
document.querySelector('#content-form').addEventListener('submit', saveContent);
document.querySelector('#support-availability').addEventListener('change', setSupportAvailability);
document.querySelector('#support-conversation-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-support-conversation]');
  if (button) loadSupportThread(button.dataset.supportConversation);
});
document.querySelector('#support-reply-form').addEventListener('submit', sendSupportReply);
document.querySelector('#support-close-conversation').addEventListener('click', closeSupportConversation);
document.querySelectorAll('[data-modal-close]').forEach((item) => item.addEventListener('click', closeProductModal));
document.querySelector('.admin-menu').addEventListener('click', () => document.querySelector('#admin-sidebar').classList.toggle('open'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeProductModal(); });

async function loadContent() {
  if (!database.configured) return;
  const { data, error } = await database.client.from('store_settings').select('value, updated_at').eq('key', 'homepage').maybeSingle();
  if (error) { showToast(`Could not load store content: ${error.message}`); return; }
  const settings = { ...(data?.value || {}) };
  settings.whatsapp = GREENHUB_WHATSAPP;
  STOREFRONT_IMAGE_FIELDS.forEach((field) => {
    settings[field.urlKey] = window.GreenhubStorage.resolveUrl(settings[field.urlKey], settings[field.pathKey]);
  });
  storefrontSettings = settings;
  Object.entries(settings).forEach(([key, value]) => { if (document.querySelector(`#content-form [name="${key}"]`)) document.querySelector(`#content-form [name="${key}"]`).value = value; });
  STOREFRONT_IMAGE_FIELDS.forEach((field) => setImagePreviewElement(document.querySelector(`#${field.previewId}`), settings[field.urlKey] || '', field.label));
}

function ensureExtendedContentFields() {
  const form = document.querySelector('#content-form');
  if (!form || form.dataset.extended === 'true') return;
  const panel = document.createElement('article');
  panel.className = 'admin-panel content-panel extended-content-panel';
  panel.innerHTML = `<div class="panel-heading"><div><p class="admin-kicker">HOMEPAGE</p><h2>Homepage controls</h2></div><span class="content-status">Editable storefront copy</span></div><div class="form-grid"><label>Hero eyebrow<input name="heroEyebrow" type="text" value="THE NEW STANDARD IN SPARES" /></label><label>Brand strip label<input name="brandStripLabel" type="text" value="BUILT FOR" /></label><label>Hero title line 1<input name="heroTitleLine1" type="text" value="Parts that fit." /></label><label>Hero title line 2<input name="heroTitleLine2" type="text" value="Every time." /></label><label>Shop button<input name="heroShopCta" type="text" value="Shop all parts" /></label><label>Browse button<input name="heroBrowseCta" type="text" value="Browse by system" /></label></div><div class="form-grid"><label>Category eyebrow<input name="categoryEyebrow" type="text" value="FIND YOUR FIT" /></label><label>Category title<input name="categoryTitle" type="text" value="Start with your car." /></label><label>Brakes category<input name="categoryBrakes" type="text" value="Braking" /></label><label>Engine category<input name="categoryEngine" type="text" value="Engine & air" /></label><label>Lighting category<input name="categoryLighting" type="text" value="Lighting" /></label><label>Suspension category<input name="categorySuspension" type="text" value="Suspension" /></label></div><div class="form-grid"><label>Story eyebrow<input name="storyEyebrow" type="text" value="WHY GREENHUB" /></label><label>Story link label<input name="storyLink" type="text" value="More about our standard" /></label><label>Newsletter eyebrow<input name="newsletterEyebrow" type="text" value="KEEP MOVING" /></label><label>Newsletter title line 1<input name="newsletterTitleLine1" type="text" value="Better parts." /></label><label>Newsletter title line 2<input name="newsletterTitleLine2" type="text" value="Better journeys." /></label><label>Footer intro<input name="footerIntro" type="text" value="For the road ahead. For the work under the hood." /></label></div><div class="storefront-image-grid"><label>Hero image<input name="heroImage" type="file" accept="image/*" data-storefront-image="heroImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="hero-image-preview"><span>No image uploaded</span></div></label><label>Our standard image<input name="storyImage" type="file" accept="image/*" data-storefront-image="storyImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="story-image-preview"><span>No image uploaded</span></div></label><label>Brakes category image<input name="categoryBrakesImage" type="file" accept="image/*" data-storefront-image="categoryBrakesImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-brakes-image-preview"><span>No image uploaded</span></div></label><label>Engine category image<input name="categoryEngineImage" type="file" accept="image/*" data-storefront-image="categoryEngineImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-engine-image-preview"><span>No image uploaded</span></div></label><label>Lighting category image<input name="categoryLightingImage" type="file" accept="image/*" data-storefront-image="categoryLightingImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-lighting-image-preview"><span>No image uploaded</span></div></label><label>Suspension category image<input name="categorySuspensionImage" type="file" accept="image/*" data-storefront-image="categorySuspensionImage" /><small class="field-help">JPG, PNG or WebP · max 5 MB</small><div class="storefront-image-preview" id="category-suspension-image-preview"><span>No image uploaded</span></div></label></div>`;
  const actions = form.querySelector('.content-actions')?.closest('article');
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
    if (!orderResponse.error && orderResponse.data) ORDERS = orderResponse.data.map((order) => ({ id: order.id, customer: order.customer_name, customerEmail: order.customer_email || '', date: new Date(order.created_at).toLocaleDateString(), items: Array.isArray(order.items) ? `${order.items.length} part${order.items.length === 1 ? '' : 's'}` : '—', total: Number(order.total), status: order.status, statusClass: order.status === 'paid' ? 'paid' : order.status === 'shipped' || order.status === 'delivered' ? 'shipped' : order.status === 'cancelled' ? 'cancelled' : 'packing' }));
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
    renderProducts();
    renderOrders();
    renderCustomers();
    await loadContent();
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

function setAuthMessage(message) {
  authMessage.textContent = message;
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
      if (error) { authSubmit.textContent = 'Create account'; setAuthMessage(error.message); return; }
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
      setAuthMessage('Account created. Confirm your email if required, then have an existing administrator promote it to admin.');
    } catch (error) {
      authSubmit.textContent = 'Create account';
      setAuthMessage(`Could not create account: ${error.message}`);
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
document.querySelectorAll('[data-storefront-image]').forEach((input) => input.addEventListener('change', previewSelectedStorefrontImage));
loadContent();
initializeAdminAuth();
