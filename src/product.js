import { getAllFromDB, getFromDB, putToDB, getAllProductsLite } from "./db.js";
// REMOVED: import { showToast, showConfirmationModal, formatCurrency, formatReceiptDate } from "./ui.js";
// REMOVED: import { loadDashboard } from "./ui.js";
import { queueSyncAction } from "./sync.js";

// --- SANITIZATION HELPERS ---
function sanitizeProduct(product) {
    if (!product) return null;
    return {
        id: product.id,
        serverId: product.serverId,
        name: product.name,
        price: product.price,
        purchasePrice: product.purchasePrice,
        stock: product.stock,
        barcode: product.barcode,
        category: product.category,
        discount: product.discount,
        image: product.image,
        wholesalePrices: product.wholesalePrices || [],
        variations: product.variations || [],
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
    };
}

function sanitizeCategory(category) {
    if (!category) return null;
    return {
        id: category.id,
        serverId: category.serverId,
        name: category.name,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt
    };
}

// --- STOCK LOGGING HELPER ---
export async function logStockChange({productId, productName, variationName, oldStock, newStock, type, reason, userId, userName}) {
    if (oldStock === null || newStock === null) return; // Unlimited stock, no log needed
    const changeAmount = newStock - oldStock;
    if (changeAmount === 0) return;

    const logEntry = {
        productId,
        productName,
        variationName: variationName || null,
        oldStock,
        newStock,
        changeAmount,
        type, // 'Sale', 'Restock', 'Adjustment', 'Return'
        reason,
        userId: userId || (window.app.currentUser ? window.app.currentUser.id : null),
        userName: userName || (window.app.currentUser ? window.app.currentUser.name : 'System'),
        date: new Date().toISOString()
    };

    try {
        await putToDB('stock_history', logEntry);
        await queueSyncAction('CREATE_STOCK_LOG', logEntry);
    } catch (e) {
        console.error("Failed to log stock change", e);
    }
}

let wholesalePriceRowId = 0;
export function addWholesalePriceRow(modalType, data = { min: '', max: '', price: '' }) {
    const containerId = modalType === 'addProductModal' ? 'wholesalePricesContainer' : 'editWholesalePricesContainer';
    const container = document.getElementById(containerId);
    if (!container) return;

    const rowId = `wholesale-row-${wholesalePriceRowId++}`;
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'wholesale-price-row bg-gray-50 p-3 rounded-lg border relative';
    row.innerHTML = `
        <div class="grid grid-cols-2 gap-2 mb-2">
            <input type="number" class="input-field min-qty" placeholder="Qty Min" value="${data.min || ''}">
            <input type="number" class="input-field max-qty" placeholder="Qty Max" value="${data.max || ''}">
        </div>
        <div class="grid grid-cols-1">
            <input type="number" class="input-field price" placeholder="Harga Grosir" value="${data.price || ''}">
        </div>
        <button type="button" onclick="document.getElementById('${rowId}').remove()" class="absolute top-1 right-1 text-red-500 hover:text-red-700 clickable p-2"><i class="fas fa-times-circle"></i></button>
    `;
    container.appendChild(row);
}


let variationRowId = 0;
let variationWholesalePriceRowId = 0;
export function addVariationWholesalePriceRow(variationRowId, data = { min: '', max: '', price: '' }) {
    // `variationRowId` will be like "variation-row-1"
    const container = document.getElementById(`wholesale-container-${variationRowId}`);
    if (!container) return;

    const rowId = `variation-wholesale-row-${variationWholesalePriceRowId++}`;
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'wholesale-price-row bg-gray-50 p-3 rounded-lg border relative';
    row.innerHTML = `
        <div class="grid grid-cols-2 gap-2 mb-2">
            <input type="number" class="input-field min-qty" placeholder="Qty Min" value="${data.min || ''}">
            <input type="number" class="input-field max-qty" placeholder="Qty Max" value="${data.max || ''}">
        </div>
        <div class="grid grid-cols-1">
            <input type="number" class="input-field price" placeholder="Harga Grosir" value="${data.price || ''}">
        </div>
        <button type="button" onclick="document.getElementById('${rowId}').remove()" class="absolute top-1 right-1 text-red-500 hover:text-red-700 clickable p-2"><i class="fas fa-times-circle"></i></button>
    `;
    container.appendChild(row);
}

export function addVariationRow(modalType, data = { name: '', purchasePrice: '', price: '', stock: '', wholesalePrices: [] }) {
    const containerId = modalType === 'addProductModal' ? 'variationsContainer' : 'editVariationsContainer';
    const container = document.getElementById(containerId);
    if (!container) return;

    const isAddModal = modalType === 'addProductModal';
    const unlimitedCheckbox = document.getElementById(isAddModal ? 'unlimitedStock' : 'editUnlimitedStock');
    const isUnlimited = unlimitedCheckbox ? unlimitedCheckbox.checked : false;

    // When editing, data.stock can be null for unlimited. Use that to determine value.
    const stockValue = isUnlimited ? '' : (data.stock !== null ? (data.stock || '') : '');
    const stockPlaceholder = isUnlimited ? '∞' : 'Stok';
    const stockDisabled = isUnlimited ? 'disabled' : '';

    const rowId = `variation-row-${variationRowId++}`;
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'variation-row p-3 bg-white rounded-lg border space-y-2';
    row.innerHTML = `
        <div class="flex items-center justify-between gap-2">
            <input type="text" class="input-field flex-grow name" placeholder="Nama (e.g. Merah)" value="${data.name || ''}">
            <button type="button" onclick="document.getElementById('${rowId}').remove(); updateMainFieldsState('${modalType}'); updateTotalStock('${modalType}');" class="text-red-500 clickable p-2"><i class="fas fa-times-circle"></i></button>
        </div>
        <div class="grid grid-cols-2 gap-2">
            <input type="number" class="input-field purchasePrice" placeholder="Harga Beli" value="${data.purchasePrice || ''}">
            <input type="number" class="input-field price" placeholder="Harga Jual" value="${data.price || ''}">
        </div>
        <div class="grid grid-cols-1">
            <input type="number" class="input-field stock" placeholder="${stockPlaceholder}" value="${stockValue}" oninput="updateTotalStock('${modalType}')" ${stockDisabled}>
        </div>
        <div id="wholesale-container-${rowId}" class="mt-2 space-y-2">
            <!-- wholesale price rows for this variation -->
        </div>
        <button type="button" onclick="addVariationWholesalePriceRow('${rowId}')" class="text-xs text-blue-600 hover:underline mt-1">
            + Tambah Harga Grosir
        </button>
    `;
    container.appendChild(row);

    // Populate wholesale prices if they exist
    if (data.wholesalePrices && Array.isArray(data.wholesalePrices)) {
        data.wholesalePrices.forEach(wp => {
            addVariationWholesalePriceRow(rowId, wp);
        });
    }

    updateMainFieldsState(modalType);
}

export function updateMainFieldsState(modalType) {
    const isAddModal = modalType === 'addProductModal';
    const variationsContainer = document.getElementById(isAddModal ? 'variationsContainer' : 'editVariationsContainer');
    const priceInput = document.getElementById(isAddModal ? 'productPrice' : 'editProductPrice');
    const purchasePriceInput = document.getElementById(isAddModal ? 'productPurchasePrice' : 'editProductPurchasePrice');
    const stockInput = document.getElementById(isAddModal ? 'productStock' : 'editProductStock');
    const mainWholesaleSection = document.getElementById(isAddModal ? 'mainWholesalePriceSection' : 'editMainWholesalePriceSection');
    
    const hasVariations = variationsContainer.querySelector('.variation-row') !== null;

    if (priceInput && stockInput && purchasePriceInput) {
        priceInput.disabled = hasVariations;
        purchasePriceInput.disabled = hasVariations;
        stockInput.readOnly = hasVariations;
        
        if (hasVariations) {
            priceInput.value = '';
            priceInput.placeholder = 'Diatur per variasi';
            purchasePriceInput.value = '';
            purchasePriceInput.placeholder = 'Diatur per variasi';
            stockInput.classList.add('bg-gray-100');
            if(mainWholesaleSection) mainWholesaleSection.style.display = 'none';
            updateTotalStock(modalType);
        } else {
            priceInput.placeholder = '0';
            purchasePriceInput.placeholder = '0';
            stockInput.classList.remove('bg-gray-100');
            if(mainWholesaleSection) mainWholesaleSection.style.display = 'block';
        }
    }
}

export function updateTotalStock(modalType) {
    const isAddModal = modalType === 'addProductModal';
    const variationsContainer = document.getElementById(isAddModal ? 'variationsContainer' : 'editVariationsContainer');
    const stockInput = document.getElementById(isAddModal ? 'productStock' : 'editProductStock');
    const hasVariations = variationsContainer.querySelector('.variation-row') !== null;
    
    if (!stockInput || !hasVariations) return;

    let totalStock = 0;
    variationsContainer.querySelectorAll('.variation-row .stock').forEach(stockEl => {
        totalStock += parseInt(stockEl.value) || 0;
    });
    stockInput.value = totalStock;
}

export function toggleUnlimitedStock(modalType) {
    const isAddModal = modalType === 'addProductModal';
    const stockInput = document.getElementById(isAddModal ? 'productStock' : 'editProductStock');
    const unlimitedCheckbox = document.getElementById(isAddModal ? 'unlimitedStock' : 'editUnlimitedStock');
    const variationsContainer = document.getElementById(isAddModal ? 'variationsContainer' : 'editVariationsContainer');

    if (stockInput && unlimitedCheckbox) {
        const isUnlimited = unlimitedCheckbox.checked;

        // Handle main stock input
        const hasVariations = variationsContainer && variationsContainer.querySelector('.variation-row') !== null;
        stockInput.disabled = isUnlimited || hasVariations;
        stockInput.readOnly = hasVariations && !isUnlimited;

        stockInput.placeholder = isUnlimited ? '∞' : (hasVariations ? 'Diatur per variasi' : '0');
        if (isUnlimited) {
            stockInput.value = '';
        }

        // Handle variation stock inputs
        if (variationsContainer) {
            variationsContainer.querySelectorAll('.variation-row .stock').forEach(input => {
                input.disabled = isUnlimited;
                input.placeholder = isUnlimited ? '∞' : 'Stok';
                if (isUnlimited) {
                    input.value = '';
                }
            });
        }
        
        updateTotalStock(modalType);
    }
}


// --- CATEGORY MANAGEMENT ---
export async function populateCategoryDropdowns(selectElementIds, selectedValue) {
    try {
        const categories = await getAllFromDB('categories');
        categories.sort((a, b) => a.name.localeCompare(b.name));

        selectElementIds.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;

            const isFilter = id === 'productCategoryFilter';
            
            const currentValue = isFilter ? select.value : selectedValue;
            select.innerHTML = '';

            if (isFilter) {
                const allOption = document.createElement('option');
                allOption.value = 'all';
                allOption.textContent = 'Semua Kategori';
                select.appendChild(allOption);
            } else {
                 const placeholder = document.createElement('option');
                 placeholder.value = '';
                 placeholder.textContent = 'Pilih Kategori...';
                 placeholder.disabled = true;
                 select.appendChild(placeholder);
            }

            categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.name;
                option.textContent = cat.name;
                select.appendChild(option);
            });
            
            if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
                select.value = currentValue;
            } else if (!isFilter) {
                select.selectedIndex = 0;
            }
        });
    } catch (error) {
        console.error("Failed to populate categories:", error);
    }
}

export async function showManageCategoryModal() {
    (document.getElementById('manageCategoryModal')).classList.remove('hidden');
    await loadCategoriesForManagement();
}

export function closeManageCategoryModal() {
    (document.getElementById('manageCategoryModal')).classList.add('hidden');
    (document.getElementById('newCategoryName')).value = '';
}

async function loadCategoriesForManagement() {
    const listEl = document.getElementById('categoryList');
    const categories = await getAllFromDB('categories');
    categories.sort((a, b) => a.name.localeCompare(b.name));

    if (categories.length === 0) {
        listEl.innerHTML = `<p class="text-gray-500 text-center py-4">Belum ada kategori</p>`;
        return;
    }
    listEl.innerHTML = categories.map(cat => `
        <div class="flex justify-between items-center bg-gray-100 p-2 rounded-lg">
            <span>${cat.name}</span>
            <button onclick="deleteCategory(${cat.id}, '${cat.name}')" class="text-red-500 clickable"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

export async function addNewCategory() {
    const input = document.getElementById('newCategoryName');
    const name = input.value.trim();
    if (!name) {
        window.showToast('Nama kategori tidak boleh kosong');
        return;
    }
    try {
        const newCategory = { name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const addedId = await putToDB('categories', newCategory);
        
        await queueSyncAction('CREATE_CATEGORY', { ...newCategory, id: addedId });
        window.showToast('Kategori berhasil ditambahkan');
        input.value = '';
        await loadCategoriesForManagement();
        await populateCategoryDropdowns(['productCategory', 'editProductCategory', 'productCategoryFilter']);
    } catch (error) {
        window.showToast('Gagal menambahkan. Kategori mungkin sudah ada.');
        console.error("Add category error:", error);
    }
}

export async function deleteCategory(id, name) {
    const products = await getAllFromDB('products');
    const isUsed = products.some(p => p.category === name);

    if (isUsed) {
        window.showToast(`Kategori "${name}" tidak dapat dihapus karena sedang digunakan oleh produk.`);
        return;
    }

    closeManageCategoryModal();

    window.showConfirmationModal(
        'Hapus Kategori',
        `Apakah Anda yakin ingin menghapus kategori "${name}"?`,
        async () => {
            const categoryToDelete = await getFromDB('categories', id);
            const transaction = window.app.db.transaction(['categories'], 'readwrite');
            const store = transaction.objectStore('categories');
            store.delete(id);
            transaction.oncomplete = async () => {
                await queueSyncAction('DELETE_CATEGORY', sanitizeCategory(categoryToDelete));
                window.showToast('Kategori berhasil dihapus');
                await populateCategoryDropdowns(['productCategory', 'editProductCategory', 'productCategoryFilter']);
            };
        },
        'Ya, Hapus',
        'bg-red-500'
    );
}

// --- PRODUCT MANAGEMENT (PAGINATION & LAZY LOADING OPTIMIZED) ---

// Lazy loading function to fetch images only for visible items
async function loadVisibleImages() {
    // Only target images that still have the data-lazy-id attribute
    const lazyImages = document.querySelectorAll('img[data-lazy-id]');
    
    // Using IntersectionObserver could be better, but for simplicity in this architecture,
    // we assume we want to load images for the current page content immediately.
    // Given pagination is small (24 items), fetching 24 images individually is acceptable.
    
    for (const img of lazyImages) {
        const id = parseInt(img.dataset.lazyId);
        try {
            // We fetch the full product just to get the image
            const product = await getFromDB('products', id);
            if (product && product.image) {
                img.src = product.image;
                img.onload = () => {
                    img.classList.remove('opacity-50', 'bg-gray-200');
                };
                img.removeAttribute('data-lazy-id');
            } else {
                // If no image found in DB (maybe deleted?), fallback to default icon
                const container = document.createElement('div');
                container.className = "bg-gray-100 rounded-lg p-4 mb-2 flex items-center justify-center";
                if(img.classList.contains('product-list-image')) {
                    container.style.width = '60px';
                    container.style.height = '60px';
                    container.innerHTML = '<i class="fas fa-box text-2xl text-gray-400"></i>';
                } else {
                    container.innerHTML = '<i class="fas fa-box text-3xl text-gray-400"></i>';
                }
                img.replaceWith(container);
            }
        } catch (e) {
            console.warn('Failed to load image for', id);
        }
    }
}

function renderProductGridItem(p) {
    const stockDisplay = p.stock === null ? '∞' : p.stock;
    const lowStockIndicator = p.stock !== null && p.stock > 0 && p.stock <= window.app.lowStockThreshold ? ` <i class="fas fa-exclamation-triangle text-yellow-500 text-xs" title="Stok Rendah"></i>` : '';
    
    let itemClasses = 'product-item clickable';
    if (p.stock !== null && p.stock === 0) {
        itemClasses += ' opacity-60 pointer-events-none';
    } else if (p.stock !== null && p.stock > 0 && p.stock <= window.app.lowStockThreshold) {
        itemClasses += ' low-stock-warning';
    }

    let hasDiscount = (p.discount && p.discount.value > 0) || (p.discountPercentage > 0);
    let discountedPrice = p.price;
    let discountText = '';
    if(hasDiscount) {
        const discount = p.discount || { type: 'percentage', value: p.discountPercentage };
        if (discount.type === 'percentage') {
            discountedPrice = p.price * (1 - discount.value / 100);
            discountText = `-${discount.value}%`;
        } else {
            discountedPrice = Math.max(0, p.price - discount.value);
            discountText = `-Rp`;
        }
    }

    // Determine Image HTML (Full vs Lazy vs Placeholder)
    let imageHtml = '';
    if (p.image) {
        // Full image data available (e.g. newly added/edited in session)
        imageHtml = `<img src="${p.image}" alt="${p.name}" class="product-image">`;
    } else if (p.hasImage) {
        // Image exists in DB but not loaded in RAM (Lite Object)
        // Use a transparent pixel placeholder or loading spinner
        imageHtml = `<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjwvc3ZnPg==" data-lazy-id="${p.id}" alt="${p.name}" class="product-image bg-gray-200 transition-opacity duration-300 opacity-50">`;
    } else {
        // No image
        imageHtml = `<div class="bg-gray-100 rounded-lg p-4 mb-2"><i class="fas fa-box text-3xl text-gray-400"></i></div>`;
    }

    return `
    <div class="${itemClasses} relative" onclick="addToCart(${p.id})" data-name="${p.name.toLowerCase()}" data-category="${p.category ? p.category.toLowerCase() : ''}" data-barcode="${p.barcode || ''}">
        ${hasDiscount ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full z-10">${discountText}</span>` : ''}
        ${imageHtml}
        <h3 class="font-semibold text-sm">${p.name}</h3>
        ${hasDiscount
            ? `<div>
                 <p class="text-xs text-gray-500 line-through">Rp ${window.formatCurrency(p.price)}</p>
                 <p class="text-blue-500 font-bold">Rp ${window.formatCurrency(discountedPrice)}</p>
               </div>`
            : `<p class="text-blue-500 font-bold">Rp ${window.formatCurrency(p.price)}</p>`
        }
        <p class="text-xs text-gray-500">Stok: ${stockDisplay}${lowStockIndicator}</p>
    </div>`;
}

function renderProductListItem(p) {
    const profit = p.price - p.purchasePrice;
    const profitMargin = p.purchasePrice > 0 ? ((profit / p.purchasePrice) * 100).toFixed(1) : '&#8734;';
    const stockDisplay = p.stock === null ? '∞' : p.stock;
    const stockButtonsDisabled = p.stock === null;
    const decreaseButtonDisabled = stockButtonsDisabled || p.stock === 0;

    const lowStockBadge = p.stock !== null && p.stock > 0 && p.stock <= window.app.lowStockThreshold ? '<span class="low-stock-badge">Stok Rendah</span>' : '';
    const outOfStockClass = p.stock !== null && p.stock === 0 ? 'opacity-60' : '';
    const lowStockClass = p.stock !== null && p.stock > 0 && p.stock <= window.app.lowStockThreshold ? 'low-stock-warning' : '';

    let hasDiscount = (p.discount && p.discount.value > 0) || (p.discountPercentage > 0);
    let discountedPrice = p.price;
    let discountBadge = '';

    if(hasDiscount) {
        const discount = p.discount || { type: 'percentage', value: p.discountPercentage };
        if (discount.type === 'percentage') {
            discountedPrice = p.price * (1 - discount.value / 100);
            discountBadge = `<span class="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">Diskon ${discount.value}%</span>`;
        } else { // fixed
            discountedPrice = Math.max(0, p.price - discount.value);
            discountBadge = `<span class="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">Diskon Rp</span>`;
        }
    }

    // Determine Image HTML (Full vs Lazy vs Placeholder)
    let imageHtml = '';
    if (p.image) {
        imageHtml = `<img src="${p.image}" alt="${p.name}" class="product-list-image">`;
    } else if (p.hasImage) {
        imageHtml = `<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjwvc3ZnPg==" data-lazy-id="${p.id}" alt="${p.name}" class="product-list-image bg-gray-200 transition-opacity duration-300 opacity-50">`;
    } else {
        imageHtml = `<div class="bg-gray-100 rounded-lg p-4 flex items-center justify-center" style="width: 60px; height: 60px;"><i class="fas fa-box text-2xl text-gray-400"></i></div>`;
    }

    return `
        <div id="product-card-${p.id}" class="card p-4 ${outOfStockClass} ${lowStockClass}">
            <div class="flex gap-3">
                ${imageHtml}
                <div class="flex-1">
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h3 class="font-semibold">${p.name}</h3>
                            <p class="text-sm text-gray-600">${p.category}</p>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="editProduct(${p.id})" class="text-blue-500 clickable"><i class="fas fa-edit"></i></button>
                            <button onclick="deleteProduct(${p.id})" class="text-red-500 clickable"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="flex justify-between items-center">
                        <div>
                            ${hasDiscount
                                ? `<p class="text-xs text-gray-400 line-through">Rp ${window.formatCurrency(p.price)}</p>
                                   <p class="text-blue-500 font-bold">Rp ${window.formatCurrency(discountedPrice)}</p>`
                                : `<p class="text-blue-500 font-bold">Rp ${window.formatCurrency(p.price)}</p>`
                            }
                            <p class="text-xs text-gray-500">Beli: Rp ${window.formatCurrency(p.purchasePrice)}</p>
                        </div>
                        <div class="text-right">
                            <div class="flex justify-end items-center gap-2 mb-1">
                                ${discountBadge}
                                ${lowStockBadge}
                                <span class="profit-badge">+${profitMargin}%</span>
                            </div>
                            <div class="flex items-center justify-end gap-1">
                                <span class="text-sm text-gray-500 mr-1">Stok:</span>
                                <button onclick="decreaseStock(${p.id})" class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center clickable ${decreaseButtonDisabled ? 'opacity-50 cursor-not-allowed' : ''}" ${decreaseButtonDisabled ? 'disabled' : ''}><i class="fas fa-minus text-xs"></i></button>
                                <span id="stock-display-${p.id}" class="font-semibold text-base w-8 text-center">${stockDisplay}</span>
                                <button onclick="increaseStock(${p.id})" class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center clickable ${stockButtonsDisabled ? 'opacity-50 cursor-not-allowed' : ''}" ${stockButtonsDisabled ? 'disabled' : ''}><i class="fas fa-plus text-xs"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Optimized Search Function
export function searchProducts(e) {
    const query = e.target.value.toLowerCase();
    const isKasir = window.app.currentPage === 'kasir';
    
    // Filter from global cache
    const matches = window.app.productsCache.filter(p => 
        p.name.toLowerCase().includes(query) || 
        (p.barcode && p.barcode.toLowerCase().includes(query)) ||
        (p.category && p.category.toLowerCase().includes(query))
    );

    if (isKasir) {
        window.app.filteredGridProducts = matches;
        loadProductsGrid(true, true); // Reset to page 1, skip fetching DB
    } else {
        // For Produk page list
        // Apply category filter if active
        const catFilter = document.getElementById('productCategoryFilter')?.value;
        if (catFilter && catFilter !== 'all') {
             window.app.filteredListProducts = matches.filter(p => p.category === catFilter);
        } else {
             window.app.filteredListProducts = matches;
        }
        loadProductsList(true, true); // Reset to page 1, skip fetching DB
    }
}

export async function loadProductsGrid(isReset = true, useCache = false) {
    const grid = document.getElementById('productsGrid');
    const loadMoreBtn = document.getElementById('loadMoreGridContainer');
    
    if (isReset) {
        window.app.gridPage = 1;
        grid.innerHTML = '';
        
        if (!useCache) {
            // Only fetch LITE version from DB if explicitly requested
            // This prevents loading all base64 images into memory
            const products = await getAllProductsLite();
            window.app.productsCache = products;
            // Also reset filtered list to all products initially
            window.app.filteredGridProducts = products;
        }
    }

    const { gridPage, itemsPerPage, filteredGridProducts } = window.app;
    
    if (filteredGridProducts.length === 0) {
        grid.innerHTML = `
            <div class="col-span-3 empty-state">
                <div class="empty-state-icon"><i class="fas fa-box-open"></i></div>
                <h3 class="empty-state-title">Produk Tidak Ditemukan</h3>
                <p class="empty-state-description">Coba kata kunci lain atau tambah produk baru.</p>
                <button onclick="showPage('produk')" class="empty-state-action">
                    <i class="fas fa-plus mr-2"></i>Tambah Produk
                </button>
            </div>
        `;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    const start = (gridPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const itemsToShow = filteredGridProducts.slice(start, end);

    const html = itemsToShow.map(p => renderProductGridItem(p)).join('');
    
    if (isReset) {
        grid.innerHTML = html;
    } else {
        grid.insertAdjacentHTML('beforeend', html);
    }

    // Toggle Load More Button
    if (end < filteredGridProducts.length) {
        loadMoreBtn.classList.remove('hidden');
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    // Important: Fetch images for currently visible items
    loadVisibleImages();
}

export function loadMoreProductsGrid() {
    window.app.gridPage++;
    loadProductsGrid(false, true); // Append mode, use existing cache
}

export async function loadProductsList(isReset = true, useCache = false) {
    const list = document.getElementById('productsList');
    const loadMoreBtn = document.getElementById('loadMoreListContainer');
    const filterSelect = document.getElementById('productCategoryFilter');
    
    // Only populate dropdown on fresh load if needed
    if (!useCache && isReset) {
        await populateCategoryDropdowns(['productCategoryFilter']);
    }
    
    const selectedCategory = filterSelect ? filterSelect.value : 'all';

    if (isReset) {
        window.app.listPage = 1;
        list.innerHTML = '';
        
        if (!useCache) {
            // Use Lite Fetch
            const products = await getAllProductsLite();
            window.app.productsCache = products; // Sync cache
        }
        
        // Filter Logic
        let filtered = window.app.productsCache;
        if (selectedCategory !== 'all') {
            filtered = filtered.filter(p => p.category === selectedCategory);
        }
        // Sort alphabetically
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        window.app.filteredListProducts = filtered;
    }

    const { listPage, itemsPerPage, filteredListProducts } = window.app;

    if (filteredListProducts.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-search"></i></div>
                <h3 class="empty-state-title">Produk Tidak Ditemukan</h3>
                <p class="empty-state-description">Tidak ada produk dalam kategori "${selectedCategory}"</p>
                <button onclick="showAddProductModal()" class="empty-state-action">
                    <i class="fas fa-plus mr-2"></i>Tambah Produk
                </button>
            </div>
        `;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    const start = (listPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const itemsToShow = filteredListProducts.slice(start, end);

    const html = itemsToShow.map(p => renderProductListItem(p)).join('');

    if (isReset) {
        list.innerHTML = html;
    } else {
        list.insertAdjacentHTML('beforeend', html);
    }

    if (end < filteredListProducts.length) {
        loadMoreBtn.classList.remove('hidden');
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    // Fetch images for visible items
    loadVisibleImages();
}

export function loadMoreProductsList() {
    window.app.listPage++;
    loadProductsList(false, true);
}

// --- OPTIMIZED STOCK UPDATES (DOM MANIPULATION) ---

async function updateProductStockInCache(productId, change) {
    // Update Global Cache
    const cachedProduct = window.app.productsCache.find(p => p.id === productId);
    if (cachedProduct && cachedProduct.stock !== null) {
        cachedProduct.stock += change;
        if(cachedProduct.stock < 0) cachedProduct.stock = 0;
    }
    
    // Update Filtered Lists Cache
    const gridProduct = window.app.filteredGridProducts.find(p => p.id === productId);
    if (gridProduct && gridProduct.stock !== null) {
        gridProduct.stock += change;
        if(gridProduct.stock < 0) gridProduct.stock = 0;
    }
    
    const listProduct = window.app.filteredListProducts.find(p => p.id === productId);
    if (listProduct && listProduct.stock !== null) {
        listProduct.stock += change;
        if(listProduct.stock < 0) listProduct.stock = 0;
    }
}

export async function increaseStock(productId) {
    try {
        const product = await getFromDB('products', productId);
        if (!product) return;

        if (product.stock === null) {
            window.showToast('Stok tidak dapat diubah untuk produk tak terbatas.');
            return;
        }

        const oldStock = product.stock;
        product.stock += 1;
        product.updatedAt = new Date().toISOString();

        await putToDB('products', product);
        await logStockChange({
            productId: product.id,
            productName: product.name,
            oldStock: oldStock,
            newStock: product.stock,
            type: 'adjustment',
            reason: 'Koreksi Cepat (+)'
        });
        await queueSyncAction('UPDATE_PRODUCT', sanitizeProduct(product));

        // Update Cache
        updateProductStockInCache(productId, 1);

        // Update DOM directly if element exists (Optimized)
        const stockDisplay = document.getElementById(`stock-display-${productId}`);
        if (stockDisplay) {
            stockDisplay.textContent = product.stock;
        } else {
            // Fallback: reload grid if we are in Kasir/Dashboard
            if (window.app.currentPage === 'kasir') {
                 loadProductsGrid(true, true); 
            }
        }
        
        if (window.app.currentPage === 'dashboard') {
            window.loadDashboard(); // Background update
        }
    } catch (error) {
        console.error('Failed to increase stock:', error);
    }
}

export async function decreaseStock(productId) {
    try {
        const product = await getFromDB('products', productId);
        if (!product) return;

        if (product.stock === null) {
            window.showToast('Stok tidak dapat diubah untuk produk tak terbatas.');
            return;
        }

        if (product.stock <= 0) return;

        const oldStock = product.stock;
        product.stock -= 1;
        product.updatedAt = new Date().toISOString();

        await putToDB('products', product);
        await logStockChange({
            productId: product.id,
            productName: product.name,
            oldStock: oldStock,
            newStock: product.stock,
            type: 'adjustment',
            reason: 'Koreksi Cepat (-)'
        });
        await queueSyncAction('UPDATE_PRODUCT', sanitizeProduct(product));

        // Update Cache
        updateProductStockInCache(productId, -1);

        // Update DOM directly
        const stockDisplay = document.getElementById(`stock-display-${productId}`);
        if (stockDisplay) {
            stockDisplay.textContent = product.stock;
            // Handle visual disable if stock becomes 0
            if (product.stock === 0) {
                // Find parent card and add opacity class if needed, or disable minus button
                const card = document.getElementById(`product-card-${productId}`);
                if (card) card.classList.add('opacity-60');
            }
        } else {
             if (window.app.currentPage === 'kasir') {
                 loadProductsGrid(true, true);
            }
        }

        if (window.app.currentPage === 'dashboard') {
            window.loadDashboard();
        }
    } catch (error) {
        console.error('Failed to decrease stock:', error);
    }
}

export function showAddProductModal() {
    (document.getElementById('addProductModal')).classList.remove('hidden');
    populateCategoryDropdowns(['productCategory']);
}

export function closeAddProductModal() {
    const modal = document.getElementById('addProductModal');
    modal.classList.add('hidden');
    modal.querySelector('#productName').value = '';
    modal.querySelector('#productPrice').value = '';
    modal.querySelector('#productPurchasePrice').value = '';
    modal.querySelector('#productStock').value = '';
    modal.querySelector('#unlimitedStock').checked = false;
    modal.querySelector('#productBarcode').value = '';
    modal.querySelector('#productCategory').value = '';
    modal.querySelector('#productDiscountValue').value = '';
    modal.querySelector('#imagePreview').innerHTML = `<i class="fas fa-camera text-3xl mb-2"></i><p>Tap untuk upload gambar</p>`;
    modal.querySelector('#wholesalePricesContainer').innerHTML = '';
    modal.querySelector('#variationsContainer').innerHTML = '';
    window.app.currentImageData = null;
    toggleUnlimitedStock('addProductModal');
    updateMainFieldsState('addProductModal'); // Re-enable fields
}

// Helper to resize image to max 500x500 and compress
function resizeImageFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 500;

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // Compress to JPEG 0.7 quality
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

export async function previewImage(event) {
    const file = event.target.files?.[0];
    if (file) {
        try {
            const resizedDataUrl = await resizeImageFile(file);
            window.app.currentImageData = resizedDataUrl;
            (document.getElementById('imagePreview')).innerHTML = `<img src="${window.app.currentImageData}" alt="Preview" class="image-preview">`;
        } catch (e) {
            console.error("Error resizing image", e);
            window.showToast("Gagal memproses gambar.");
        }
    }
}

export async function addProduct() {
    const name = (document.getElementById('productName')).value.trim();
    let price = parseFloat((document.getElementById('productPrice')).value);
    if (isNaN(price)) price = 0;

    const purchasePrice = parseFloat((document.getElementById('productPurchasePrice')).value) || 0;
    const stock = parseInt((document.getElementById('productStock')).value) || 0;
    const unlimitedStock = document.getElementById('unlimitedStock').checked;
    let barcode = (document.getElementById('productBarcode')).value.trim();
    const category = (document.getElementById('productCategory')).value;
    const discountValue = parseFloat((document.getElementById('productDiscountValue')).value) || 0;
    
    const wholesalePrices = [];
    document.querySelectorAll('#wholesalePricesContainer .wholesale-price-row').forEach(row => {
        const min = parseInt(row.querySelector('.min-qty').value);
        const max = parseInt(row.querySelector('.max-qty').value);
        const price = parseFloat(row.querySelector('.price').value);

        if (!isNaN(min) && min > 0 && !isNaN(price) && price > 0) {
            wholesalePrices.push({ min, max: !isNaN(max) && max > 0 ? max : null, price });
        }
    });

    const variations = [];
    document.querySelectorAll('#variationsContainer .variation-row').forEach(row => {
        const name = row.querySelector('.name').value.trim();
        const purchasePrice = parseFloat(row.querySelector('.purchasePrice').value) || 0;
        let price = parseFloat(row.querySelector('.price').value);
        if (isNaN(price)) price = 0;

        const stockInput = row.querySelector('.stock');
        const stock = unlimitedStock ? null : (parseInt(stockInput.value) || 0);
        
        const variationWholesalePrices = [];
        row.querySelectorAll('.wholesale-price-row').forEach(wpRow => {
            const min = parseInt(wpRow.querySelector('.min-qty').value);
            const max = parseInt(wpRow.querySelector('.max-qty').value);
            const price = parseFloat(wpRow.querySelector('.price').value);

            if (!isNaN(min) && min > 0 && !isNaN(price) && price > 0) {
                variationWholesalePrices.push({ min, max: !isNaN(max) && max > 0 ? max : null, price });
            }
        });

        if (name) {
            variations.push({ name, purchasePrice, price, stock, wholesalePrices: variationWholesalePrices });
        }
    });

    if (variations.length > 0) {
        if (!variations.every(v => v.name)) {
            window.showToast('Setiap variasi harus memiliki Nama.');
            return;
        }
    } else {
        if (!name) {
            window.showToast('Nama produk wajib diisi.');
            return;
        }
    }

    if (barcode) {
        const products = await getAllFromDB('products');
        if (products.some(p => p.barcode === barcode)) {
            window.showToast('Barcode ini sudah digunakan oleh produk lain.');
            return;
        }
    } else {
        barcode = null;
    }

    const newProduct = {
        name,
        purchasePrice,
        barcode,
        category,
        discount: discountValue > 0 ? { type: 'fixed', value: discountValue } : null,
        image: window.app.currentImageData,
        wholesalePrices,
        variations,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    if (variations.length > 0) {
       newProduct.price = variations.sort((a,b) => a.price - b.price)[0].price; // Use lowest price as main price
       newProduct.purchasePrice = variations.sort((a,b) => a.purchasePrice - b.purchasePrice)[0].purchasePrice;
       newProduct.stock = unlimitedStock ? null : newProduct.variations.reduce((sum, v) => sum + (v.stock || 0), 0);
    } else {
       newProduct.price = price;
       newProduct.stock = unlimitedStock ? null : stock;
    }
    
    try {
        const addedId = await putToDB('products', newProduct);
        await queueSyncAction('CREATE_PRODUCT', { ...newProduct, id: addedId });
        
        // Log Initial Stock
        if (variations.length > 0) {
            for (const v of variations) {
                if (v.stock !== null && v.stock > 0) {
                    await logStockChange({
                        productId: addedId,
                        productName: name,
                        variationName: v.name,
                        oldStock: 0,
                        newStock: v.stock,
                        type: 'restock',
                        reason: 'Stok Awal'
                    });
                }
            }
        } else if (newProduct.stock !== null && newProduct.stock > 0) {
            await logStockChange({
                productId: addedId,
                productName: name,
                oldStock: 0,
                newStock: newProduct.stock,
                type: 'restock',
                reason: 'Stok Awal'
            });
        }

        window.showToast('Produk berhasil ditambahkan');
        closeAddProductModal();
        // Force reload from DB to include new item
        loadProductsList(true, false);
        loadProductsGrid(true, false);
    } catch (error) {
        console.error('Failed to add product:', error);
        window.showToast('Gagal menambahkan produk. Cek kembali data Anda.');
    }
}

export async function editProduct(id) {
    try {
        const product = await getFromDB('products', id);
        if (product) {
            (document.getElementById('editProductId')).value = product.id;
            (document.getElementById('editProductName')).value = product.name;
            (document.getElementById('editProductBarcode')).value = product.barcode || '';
            (document.getElementById('editProductPrice')).value = product.price;
            (document.getElementById('editProductPurchasePrice')).value = product.purchasePrice || 0;
            (document.getElementById('editProductStock')).value = product.stock === null ? '' : product.stock;
            
            const discountValueInput = document.getElementById('editProductDiscountValue');
            
            if (product.discount && product.discount.value > 0) {
                if (product.discount.type === 'percentage') {
                    // Convert percentage to fixed value based on the main price
                    const fixedValue = (product.price * product.discount.value) / 100;
                    discountValueInput.value = Math.round(fixedValue);
                } else { // it's 'fixed'
                    discountValueInput.value = product.discount.value;
                }
            } else if (product.discountPercentage > 0) { // Backward compatibility
                // Convert percentage to fixed value
                const fixedValue = (product.price * product.discountPercentage) / 100;
                discountValueInput.value = Math.round(fixedValue);
            } else {
                discountValueInput.value = '';
            }
            
            const unlimitedCheckbox = document.getElementById('editUnlimitedStock');
            unlimitedCheckbox.checked = product.stock === null;
            
            await populateCategoryDropdowns(['editProductCategory'], product.category);
            
            window.app.currentEditImageData = product.image;
            (document.getElementById('editImagePreview')).innerHTML = product.image 
                ? `<img src="${product.image}" alt="Preview" class="image-preview">`
                : `<i class="fas fa-camera text-3xl mb-2"></i><p>Tap untuk ubah gambar</p>`;
            
            const editWholesaleContainer = document.getElementById('editWholesalePricesContainer');
            editWholesaleContainer.innerHTML = '';
            if (product.wholesalePrices && Array.isArray(product.wholesalePrices)) {
                product.wholesalePrices.forEach(wp => {
                    addWholesalePriceRow('editProductModal', { min: wp.min, max: wp.max || '', price: wp.price });
                });
            }

            const editVariationsContainer = document.getElementById('editVariationsContainer');
            editVariationsContainer.innerHTML = '';
            if (product.variations && Array.isArray(product.variations)) {
                product.variations.forEach(v => {
                    addVariationRow('editProductModal', v);
                });
            }
            
            // This needs to be after adding variations
            toggleUnlimitedStock('editProductModal');
            updateMainFieldsState('editProductModal');
            
            // Add Stock History Button logic to the edit modal footer or header
            const footer = document.getElementById('editProductModal').querySelector('.flex.gap-3.mt-6');
            if (footer) {
                // Remove existing history button if present to prevent duplicates
                const oldBtn = document.getElementById('btnViewStockHistory');
                if(oldBtn) oldBtn.remove();

                const historyBtn = document.createElement('button');
                historyBtn.id = 'btnViewStockHistory';
                historyBtn.className = "btn bg-orange-500 text-white flex-1 py-2";
                historyBtn.innerHTML = `<i class="fas fa-history mr-2"></i>Riwayat`;
                historyBtn.onclick = () => showStockHistoryModal(product.id, product.name);
                // Insert as first child or specific position
                footer.insertBefore(historyBtn, footer.firstChild);
            }


            (document.getElementById('editProductModal')).classList.remove('hidden');
        }
    } catch (error) {
        console.error('Failed to fetch product for editing:', error);
        window.showToast('Gagal memuat data produk.');
    }
}

export function closeEditProductModal() {
    const modal = document.getElementById('editProductModal');
    modal.classList.add('hidden');
    modal.querySelector('#editWholesalePricesContainer').innerHTML = '';
    modal.querySelector('#editVariationsContainer').innerHTML = '';
    window.app.currentEditImageData = null;
    modal.querySelector('#editProductBarcode').value = '';
    modal.querySelector('#editProductDiscountValue').value = '';
    modal.querySelector('#editUnlimitedStock').checked = false;
    toggleUnlimitedStock('editProductModal');
    updateMainFieldsState('editProductModal'); // Re-enable fields
}

export async function previewEditImage(event) {
    const file = event.target.files?.[0];
    if (file) {
        try {
            const resizedDataUrl = await resizeImageFile(file);
            window.app.currentEditImageData = resizedDataUrl;
            (document.getElementById('editImagePreview')).innerHTML = `<img src="${window.app.currentEditImageData}" alt="Preview" class="image-preview">`;
        } catch (e) {
            console.error("Error resizing image", e);
            window.showToast("Gagal memproses gambar.");
        }
    }
}

export async function updateProduct() {
    const id = parseInt((document.getElementById('editProductId')).value);
    const name = (document.getElementById('editProductName')).value.trim();
    let barcode = (document.getElementById('editProductBarcode')).value.trim();
    let price = parseFloat((document.getElementById('editProductPrice')).value);
    if (isNaN(price)) price = 0;

    const purchasePrice = parseFloat((document.getElementById('editProductPurchasePrice')).value) || 0;
    const stock = parseInt((document.getElementById('editProductStock')).value) || 0;
    const unlimitedStock = document.getElementById('editUnlimitedStock').checked;
    const category = (document.getElementById('editProductCategory')).value;
    const discountValue = parseFloat((document.getElementById('editProductDiscountValue')).value) || 0;
    
    const wholesalePrices = [];
    document.querySelectorAll('#editWholesalePricesContainer .wholesale-price-row').forEach(row => {
        const min = parseInt(row.querySelector('.min-qty').value);
        const max = parseInt(row.querySelector('.max-qty').value);
        const price = parseFloat(row.querySelector('.price').value);

        if (!isNaN(min) && min > 0 && !isNaN(price) && price > 0) {
            wholesalePrices.push({ min, max: !isNaN(max) && max > 0 ? max : null, price });
        }
    });

    const variations = [];
    document.querySelectorAll('#editVariationsContainer .variation-row').forEach(row => {
        const name = row.querySelector('.name').value.trim();
        const purchasePrice = parseFloat(row.querySelector('.purchasePrice').value) || 0;
        let price = parseFloat(row.querySelector('.price').value);
        if (isNaN(price)) price = 0;

        const stockInput = row.querySelector('.stock');
        const stock = unlimitedStock ? null : (parseInt(stockInput.value) || 0);
        
        const variationWholesalePrices = [];
        row.querySelectorAll('.wholesale-price-row').forEach(wpRow => {
            const min = parseInt(wpRow.querySelector('.min-qty').value);
            const max = parseInt(wpRow.querySelector('.max-qty').value);
            const price = parseFloat(wpRow.querySelector('.price').value);

            if (!isNaN(min) && min > 0 && !isNaN(price) && price > 0) {
                variationWholesalePrices.push({ min, max: !isNaN(max) && max > 0 ? max : null, price });
            }
        });
        
        if (name) {
            variations.push({ name, purchasePrice, price, stock, wholesalePrices: variationWholesalePrices });
        }
    });

    if (variations.length > 0) {
        if (!variations.every(v => v.name)) {
            window.showToast('Setiap variasi harus memiliki Nama.');
            return;
        }
    } else {
        if (!name) {
            window.showToast('Nama produk wajib diisi.');
            return;
        }
    }

    if (barcode) {
        const products = await getAllFromDB('products');
        if (products.some(p => p.barcode === barcode && p.id !== id)) {
            window.showToast('Barcode ini sudah digunakan oleh produk lain.');
            return;
        }
    } else {
        barcode = null;
    }
    
    try {
        const oldProduct = await getFromDB('products', id);
        const product = { ...oldProduct }; // Clone

        if (product) {
            product.name = name;
            product.barcode = barcode;
            product.purchasePrice = purchasePrice;
            product.category = category;
            product.discount = discountValue > 0 ? { type: 'fixed', value: discountValue } : null;
            delete product.discountPercentage; // Remove old key
            product.image = window.app.currentEditImageData;
            product.wholesalePrices = wholesalePrices;
            product.variations = variations;
            product.updatedAt = new Date().toISOString();
            
            if (variations.length > 0) {
               product.price = variations.sort((a,b) => a.price - b.price)[0].price;
               product.purchasePrice = variations.sort((a,b) => a.purchasePrice - b.purchasePrice)[0].purchasePrice;
               product.stock = unlimitedStock ? null : variations.reduce((sum, v) => sum + (v.stock || 0), 0);
               
               // Logic to detect stock changes in variations
               if (!unlimitedStock && oldProduct.variations) {
                   for (let i = 0; i < variations.length; i++) {
                       const newVar = variations[i];
                       // Try to find matching old variation by name (fallback to index if name changed, but index usually correlates in UI order)
                       const oldVar = oldProduct.variations.find(ov => ov.name === newVar.name) || oldProduct.variations[i];
                       
                       if (oldVar) {
                           await logStockChange({
                               productId: id,
                               productName: name,
                               variationName: newVar.name,
                               oldStock: oldVar.stock,
                               newStock: newVar.stock,
                               type: 'adjustment',
                               reason: 'Edit Manual'
                           });
                       } else {
                           // New variation added
                           await logStockChange({
                               productId: id,
                               productName: name,
                               variationName: newVar.name,
                               oldStock: 0,
                               newStock: newVar.stock,
                               type: 'adjustment',
                               reason: 'Variasi Baru'
                           });
                       }
                   }
               }

            } else {
               // Normal product stock change logic
               product.price = price;
               product.stock = unlimitedStock ? null : stock;
               
               await logStockChange({
                   productId: id,
                   productName: name,
                   oldStock: oldProduct.stock,
                   newStock: product.stock,
                   type: 'adjustment',
                   reason: 'Edit Manual'
               });
            }
            
            await putToDB('products', product);
            await queueSyncAction('UPDATE_PRODUCT', sanitizeProduct(product));
            window.showToast('Produk berhasil diperbarui');
            closeEditProductModal();
            // Force reload
            loadProductsList(true, false);
            loadProductsGrid(true, false);
        }
    } catch (error) {
        console.error('Failed to update product:', error);
        window.showToast('Gagal memperbarui produk.');
    }
}

export function deleteProduct(id) {
    window.showConfirmationModal(
        'Hapus Produk',
        'Apakah Anda yakin ingin menghapus produk ini? Tindakan ini tidak dapat dibatalkan.',
        async () => {
            try {
                const productToDelete = await getFromDB('products', id);
                const transaction = window.app.db.transaction(['products'], 'readwrite');
                const store = transaction.objectStore('products');
                store.delete(id);
                transaction.oncomplete = async () => {
                    await queueSyncAction('DELETE_PRODUCT', sanitizeProduct(productToDelete));
                    window.showToast('Produk berhasil dihapus');
                    // Force reload
                    loadProductsList(true, false);
                    loadProductsGrid(true, false);
                };
            } catch (error) {
                console.error('Failed to delete product:', error);
                window.showToast('Gagal menghapus produk.');
            }
        },
        'Ya, Hapus',
        'bg-red-500'
    );
}

// --- STOCK HISTORY UI ---
export async function showStockHistoryModal(productId, productName) {
    const modal = document.getElementById('stockHistoryModal');
    const title = document.getElementById('stockHistoryTitle');
    const list = document.getElementById('stockHistoryList');
    
    title.textContent = `Riwayat Stok - ${productName}`;
    list.innerHTML = '<p class="text-gray-500 text-center py-4">Memuat data...</p>';
    modal.classList.remove('hidden');

    try {
        const allHistory = await getAllFromDB('stock_history', 'productId', productId);
        
        if (allHistory.length === 0) {
            list.innerHTML = '<p class="text-gray-500 text-center py-4">Belum ada riwayat stok.</p>';
            return;
        }

        // Sort desc by date
        allHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

        list.innerHTML = allHistory.map(log => {
            const date = window.formatReceiptDate(log.date);
            const isPositive = log.changeAmount > 0;
            const colorClass = isPositive ? 'text-green-600' : 'text-red-600';
            const sign = isPositive ? '+' : '';
            const variationText = log.variationName ? `<span class="text-xs bg-gray-200 px-1 rounded ml-1">${log.variationName}</span>` : '';

            return `
                <div class="border-b py-3 last:border-0">
                    <div class="flex justify-between items-center mb-1">
                        <div class="flex items-center">
                            <span class="font-bold text-sm text-gray-800">${log.reason || log.type}</span>
                            ${variationText}
                        </div>
                        <span class="font-bold ${colorClass}">${sign}${log.changeAmount}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs text-gray-500">
                        <span>${date} • Oleh: ${log.userName || 'System'}</span>
                        <span>Sisa: <strong>${log.newStock}</strong></span>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error("Error loading history", e);
        list.innerHTML = '<p class="text-red-500 text-center py-4">Gagal memuat riwayat.</p>';
    }
}

export function closeStockHistoryModal() {
    document.getElementById('stockHistoryModal').classList.add('hidden');
}