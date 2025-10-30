import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { putSettingToDB, getSettingFromDB, getAllFromDB, putToDB, clearAllStores, getFromDB, getFromDBByIndex } from './db.js';
import { showToast, showConfirmationModal, loadDashboard, showPage, updateUiForRole } from './ui.js';
import { queueSyncAction } from './sync.js';
import { formatCurrency } from './ui.js';
import { loadProductsList, loadProductsGrid } from './product.js';

let pinLockoutInterval = null;
const FAILED_ATTEMPTS_LIMIT = 5;

// --- SANITIZATION HELPER ---
function sanitizeFee(fee) {
    if (!fee) return null;
    return {
        id: fee.id,
        serverId: fee.serverId,
        name: fee.name,
        type: fee.type,
        value: fee.value,
        isDefault: fee.isDefault,
        isTax: fee.isTax,
        createdAt: fee.createdAt,
    };
}

// --- SETTINGS ---
export async function saveStoreSettings() {
    const settings = [
        { key: 'storeName', value: (document.getElementById('storeName')).value.trim() },
        { key: 'storeAddress', value: (document.getElementById('storeAddress')).value.trim() },
        { key: 'storeFeedbackPhone', value: (document.getElementById('storeFeedbackPhone')).value.trim() },
        { key: 'storeFooterText', value: (document.getElementById('storeFooterText')).value.trim() },
        { key: 'storeLogo', value: window.app.currentStoreLogoData },
        { key: 'showLogoOnReceipt', value: document.getElementById('showLogoOnReceipt').checked },
        { key: 'lowStockThreshold', value: parseInt((document.getElementById('lowStockThreshold')).value) || 5 },
        { key: 'autoPrintReceipt', value: document.getElementById('autoPrintReceipt').checked },
        { key: 'printerPaperSize', value: document.getElementById('printerPaperSize').value },
        { key: 'autoOpenCashDrawer', value: document.getElementById('autoOpenCashDrawer').checked }
    ];

    try {
        const transaction = window.app.db.transaction('settings', 'readwrite');
        const store = transaction.objectStore('settings');
        settings.forEach(setting => store.put(setting));
        
        transaction.oncomplete = () => {
            window.app.lowStockThreshold = settings.find(s => s.key === 'lowStockThreshold').value;
            showToast('Pengaturan berhasil disimpan');
            loadDashboard();
        };
    } catch(error) {
        console.error("Failed to save settings:", error);
        showToast("Gagal menyimpan pengaturan.");
    }
}

export async function loadSettings() {
    try {
        const settings = await getAllFromDB('settings');
        const settingsMap = new Map(settings.map(s => [s.key, s.value]));

        (document.getElementById('storeName')).value = settingsMap.get('storeName') || '';
        (document.getElementById('storeAddress')).value = settingsMap.get('storeAddress') || '';
        (document.getElementById('storeFeedbackPhone')).value = settingsMap.get('storeFeedbackPhone') || '';
        (document.getElementById('storeFooterText')).value = settingsMap.get('storeFooterText') || '';
        (document.getElementById('lowStockThreshold')).value = settingsMap.get('lowStockThreshold') || 5;
        document.getElementById('autoPrintReceipt').checked = settingsMap.get('autoPrintReceipt') || false;
        document.getElementById('showLogoOnReceipt').checked = settingsMap.get('showLogoOnReceipt') !== false;
        document.getElementById('printerPaperSize').value = settingsMap.get('printerPaperSize') || '80mm';
        const autoOpenCashDrawerToggle = document.getElementById('autoOpenCashDrawer');
        if (autoOpenCashDrawerToggle) {
            autoOpenCashDrawerToggle.checked = settingsMap.get('autoOpenCashDrawer') || false;
        }

        window.app.lowStockThreshold = settingsMap.get('lowStockThreshold') || 5;
        
        window.app.currentStoreLogoData = settingsMap.get('storeLogo') || null;
        if (window.app.currentStoreLogoData) {
            (document.getElementById('storeLogoPreview')).innerHTML = `<img src="${window.app.currentStoreLogoData}" alt="Logo Preview" class="image-preview">`;
        }
    } catch (error) {
        console.error("Failed to load settings:", error);
    }
}

export function previewStoreLogo(event) {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            window.app.currentStoreLogoData = e.target?.result;
            (document.getElementById('storeLogoPreview')).innerHTML = `<img src="${window.app.currentStoreLogoData}" alt="Logo Preview" class="image-preview">`;
        };
        reader.readAsDataURL(file);
    }
}

// --- DATA MANAGEMENT ---
export async function exportData() {
    try {
        // Use a shallow copy for simple, flat objects.
        const sanitizeFlat = (items) => items.map(item => ({ ...item }));

        // Use a deep, manual reconstruction for complex nested objects like transactions
        // to robustly prevent circular reference errors.
        const sanitizeTransactions = (transactions) => {
            return transactions.map(t => ({
                id: t.id,
                subtotal: t.subtotal,
                totalDiscount: t.totalDiscount,
                total: t.total,
                cashPaid: t.cashPaid,
                change: t.change,
                paymentMethod: t.paymentMethod,
                userId: t.userId,
                userName: t.userName,
                date: t.date,
                items: (t.items || []).map(item => ({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    effectivePrice: item.effectivePrice,
                    discountPercentage: item.discountPercentage
                })),
                fees: (t.fees || []).map(fee => ({
                    id: fee.id,
                    name: fee.name,
                    type: fee.type,
                    value: fee.value,
                    isDefault: fee.isDefault,
                    isTax: fee.isTax,
                    createdAt: fee.createdAt,
                    amount: fee.amount
                }))
            }));
        };

        const products = sanitizeFlat(await getAllFromDB('products'));
        const transactions = sanitizeTransactions(await getAllFromDB('transactions'));
        const settings = sanitizeFlat(await getAllFromDB('settings'));
        const categories = sanitizeFlat(await getAllFromDB('categories'));
        const fees = sanitizeFlat(await getAllFromDB('fees'));
        const contacts = sanitizeFlat(await getAllFromDB('contacts'));
        const ledgers = sanitizeFlat(await getAllFromDB('ledgers'));
        const users = sanitizeFlat(await getAllFromDB('users'));
        
        const data = {
            products,
            transactions,
            settings,
            categories,
            fees,
            contacts,
            ledgers,
            users,
            exportDate: new Date().toISOString()
        };
        
        const fileContent = JSON.stringify(data, null, 2);
        const date = new Date().toISOString().split('T')[0];
        const fileName = `pos_backup_${date}.json`;

        if (window.AndroidDownloader) {
            window.AndroidDownloader.downloadFile(fileContent, fileName, 'application/json');
        } else {
            const blob = new Blob([fileContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        showToast('Export data berhasil.');
    } catch (error) {
        console.error('Export failed:', error);
        showToast('Gagal mengexport data.');
    }
}

export function importData() {
    (document.getElementById('importFile')).click();
}

export function handleImport(event) {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                showConfirmationModal(
                    'Import Data',
                    'Ini akan menimpa semua data saat ini. Apakah Anda yakin ingin melanjutkan?',
                    async () => {
                        const storesToClear = ['products', 'transactions', 'settings', 'categories', 'fees', 'contacts', 'ledgers', 'users'];
                        const transaction = window.app.db.transaction(storesToClear, 'readwrite');
                        
                        storesToClear.forEach(storeName => {
                            if (data[storeName]) {
                                transaction.objectStore(storeName).clear();
                            }
                        });
                        
                        if (data.products) data.products.forEach(p => transaction.objectStore('products').put(p));
                        if (data.transactions) data.transactions.forEach(t => transaction.objectStore('transactions').put(t));
                        if (data.settings) data.settings.forEach(s => transaction.objectStore('settings').put(s));
                        if (data.categories) data.categories.forEach(c => transaction.objectStore('categories').put(c));
                        if (data.fees) data.fees.forEach(f => transaction.objectStore('fees').put(f));
                        if (data.contacts) data.contacts.forEach(c => transaction.objectStore('contacts').put(c));
                        if (data.ledgers) data.ledgers.forEach(l => transaction.objectStore('ledgers').put(l));
                        if (data.users) data.users.forEach(u => transaction.objectStore('users').put(u));
                        
                        transaction.oncomplete = () => {
                            showToast('Data berhasil diimport. Aplikasi akan dimuat ulang.');
                            setTimeout(() => location.reload(), 2000);
                        };
                    },
                    'Ya, Import',
                    'bg-purple-500'
                );
            } catch (error) {
                console.error('Import parse error:', error);
                showToast('Format file tidak valid.');
            }
        };
        reader.readAsText(file);
    }
}

export function clearAllData() {
    showConfirmationModal(
        'Hapus Semua Data',
        'PERINGATAN: Ini akan menghapus semua produk, transaksi, dan pengaturan secara permanen. Tindakan ini tidak dapat dibatalkan. Apakah Anda benar-benar yakin?',
        async () => {
            await clearAllStores();
            showToast('Semua data berhasil dihapus. Aplikasi akan dimuat ulang.');
            setTimeout(() => location.reload(), 2000);
        },
        'Ya, Hapus Semua',
        'bg-red-500'
    );
}

export function showImportProductsModal() {
    document.getElementById('importProductsModal').classList.remove('hidden');
}

export function closeImportProductsModal() {
    const modal = document.getElementById('importProductsModal');
    if (modal) modal.classList.add('hidden');
    const fileInput = document.getElementById('importProductsFile');
    if (fileInput) fileInput.value = '';
}

// Helper function to convert an image URL to a Base64 string
async function imageUrlToBase64(url) {
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
        return null;
    }
    try {
        // NOTE: This fetch can be blocked by CORS policy. 
        // The image server must allow cross-origin requests.
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`Failed to fetch image from ${url}: ${response.statusText}`);
            return null;
        }
        const blob = await response.blob();
        if (blob.size === 0) {
            console.warn(`Fetched empty blob from ${url}`);
            return null;
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = (error) => {
                console.error(`FileReader error for URL ${url}:`, error);
                reject(error);
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error(`Error converting image URL to base64: ${url}`, error);
        return null;
    }
}

export async function handleProductImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const csvText = e.target.result;
            const rows = csvText.split(/\r?\n/).filter(row => row.trim() !== '');
            if (rows.length < 2) {
                showToast('File CSV kosong atau hanya berisi header.');
                return;
            }

            const header = rows.shift().split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
            const requiredHeaders = ['nama', 'harga_jual'];
            if (!requiredHeaders.every(h => header.includes(h))) {
                showToast(`Header CSV tidak valid. Wajib ada: ${requiredHeaders.join(', ')}`);
                return;
            }

            showToast('Memulai proses import...', 4000);
            closeImportProductsModal();

            const existingProducts = await getAllFromDB('products');
            const productNameMap = new Map(existingProducts.map(p => [p.name.toLowerCase(), p]));
            const productBarcodeMap = new Map(existingProducts.filter(p => p.barcode).map(p => [p.barcode, p]));
            
            const existingCategories = await getAllFromDB('categories');
            const categoryNameMap = new Map(existingCategories.map(c => [c.name.toLowerCase(), c]));
            
            let errorCount = 0;
            let addedCount = 0;
            let updatedCount = 0;

            const productsData = rows.map(row => {
                 const values = row.split(',');
                 return header.reduce((obj, col, index) => {
                    obj[col] = values[index] ? values[index].trim() : '';
                    return obj;
                }, {});
            });

            showToast(`Mengunduh gambar... (0/${productsData.length})`, 60000);
            const imageDataResults = [];
            for (let i = 0; i < productsData.length; i++) {
                if (i > 0 && i % 5 === 0) showToast(`Mengunduh gambar... (${i}/${productsData.length})`, 60000);
                imageDataResults.push(await imageUrlToBase64(productsData[i].gambar));
            }
            
            showToast('Menyimpan data ke database...', 10000);

            for (const [index, rowData] of productsData.entries()) {
                try {
                    if (!rowData.nama || isNaN(parseFloat(rowData.harga_jual))) {
                        throw new Error("Baris tidak valid: Nama dan Harga Jual wajib diisi.");
                    }
                    
                    const barcode = rowData.barcode ? rowData.barcode.trim() : null;
                    let product;
                    let isUpdate = false;

                    const productByName = productNameMap.get(rowData.nama.toLowerCase());
                    const productByBarcode = barcode ? productBarcodeMap.get(barcode) : null;
                    
                    if (productByBarcode) {
                        product = productByBarcode;
                        isUpdate = true;
                    } else if (productByName) {
                        product = productByName;
                        isUpdate = true;
                    } else {
                        product = { createdAt: new Date().toISOString() };
                    }
                    
                    if (barcode) {
                        const conflictingProduct = await getFromDBByIndex('products', 'barcode', barcode);
                        if (conflictingProduct && conflictingProduct.id !== product.id) {
                            throw new Error(`Barcode '${barcode}' sudah digunakan oleh produk '${conflictingProduct.name}'.`);
                        }
                    }

                    product.name = rowData.nama;
                    product.price = parseFloat(rowData.harga_jual);
                    product.purchasePrice = parseFloat(rowData.harga_beli) || product.purchasePrice || 0;
                    product.stock = parseInt(rowData.stok) >= 0 ? parseInt(rowData.stok) : (product.stock || 0);
                    product.barcode = barcode;
                    product.category = rowData.kategori || product.category || 'Lainnya';
                    product.discountPercentage = parseFloat(rowData.diskon_persen) || product.discountPercentage || 0;
                    product.updatedAt = new Date().toISOString();
                    
                    const imageData = imageDataResults[index];
                    if (imageData) {
                        product.image = imageData;
                    } else if (!isUpdate) {
                        product.image = null;
                    }

                    const categoryName = product.category;
                    if (categoryName && !categoryNameMap.has(categoryName.toLowerCase())) {
                        const newCategory = { name: categoryName, createdAt: new Date().toISOString() };
                        const savedCatId = await putToDB('categories', newCategory);
                        const savedCategory = { ...newCategory, id: savedCatId };
                        categoryNameMap.set(categoryName.toLowerCase(), savedCategory);
                    }
                    
                    const savedProductId = await putToDB('products', product);
                    
                    if (!isUpdate) {
                       const newProduct = { ...product, id: savedProductId };
                       productNameMap.set(newProduct.name.toLowerCase(), newProduct);
                       if (newProduct.barcode) {
                           productBarcodeMap.set(newProduct.barcode, newProduct);
                       }
                    }

                    if (isUpdate) {
                        updatedCount++;
                    } else {
                        addedCount++;
                    }

                } catch(error) {
                    console.error("Gagal mengimpor baris:", rowData, "Error:", error.message);
                    errorCount++;
                }
            }

            let summary = `Import selesai.`;
            if (addedCount > 0) summary += ` ${addedCount} produk ditambah.`;
            if (updatedCount > 0) summary += ` ${updatedCount} produk diperbarui.`;
            if (errorCount > 0) summary += ` ${errorCount} baris gagal (cek konsol).`;
            showToast(summary, 5000);
            
            if(window.app.currentPage === 'produk') loadProductsList();
            loadProductsGrid();
            if(window.app.currentPage === 'dashboard') loadDashboard();

        } catch (error) {
            console.error('Import failed:', error);
            showToast('Gagal memproses file. Pastikan formatnya benar.');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}


// --- TAXES & FEES ---
export async function addFee() {
    const nameInput = document.getElementById('feeName');
    const typeInput = document.getElementById('feeType');
    const valueInput = document.getElementById('feeValue');
    const isDefaultInput = document.getElementById('feeIsDefault');

    const name = nameInput.value.trim();
    const type = typeInput.value;
    const value = parseFloat(valueInput.value);
    const isDefault = isDefaultInput.checked;

    if (!name || isNaN(value) || value < 0) {
        showToast('Nama dan Nilai Biaya harus diisi dengan benar.');
        return;
    }

    const newFee = {
        name,
        type,
        value,
        isDefault,
        isTax: name.toLowerCase().includes('pajak') || name.toLowerCase().includes('ppn'),
        createdAt: new Date().toISOString()
    };

    try {
        const addedId = await putToDB('fees', newFee);
        await queueSyncAction('CREATE_FEE', { ...newFee, id: addedId });
        showToast('Biaya berhasil ditambahkan.');
        nameInput.value = '';
        valueInput.value = '';
        isDefaultInput.checked = false;
        await loadFees();
    } catch (error) {
        console.error('Failed to add fee:', error);
        showToast('Gagal menambahkan biaya.');
    }
}

export async function loadFees() {
    const feesListEl = document.getElementById('feesList');
    const fees = await getAllFromDB('fees');
    
    if (fees.length === 0) {
        feesListEl.innerHTML = '<p class="text-gray-500 text-center py-2">Belum ada pajak atau biaya.</p>';
        return;
    }

    feesListEl.innerHTML = fees.map(fee => {
        const valueDisplay = fee.type === 'percentage'
            ? `${fee.value}%`
            : `Rp ${formatCurrency(fee.value)}`;
        
        const defaultBadge = fee.isDefault ? '<span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Otomatis</span>' : '';

        return `
            <div class="flex justify-between items-center bg-gray-100 p-2 rounded-lg">
                <div>
                    <p class="font-semibold">${fee.name}</p>
                    <p class="text-sm text-gray-600">${valueDisplay}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${defaultBadge}
                    <button onclick="deleteFee(${fee.id})" class="text-red-500 clickable"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');
}


export async function deleteFee(id) {
    showConfirmationModal('Hapus Biaya', 'Yakin ingin menghapus biaya ini?', async () => {
         try {
            const feeToDelete = await getFromDB('fees', id);
            const tx = window.app.db.transaction('fees', 'readwrite');
            tx.objectStore('fees').delete(id);
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_FEE', sanitizeFee(feeToDelete));
                showToast('Biaya berhasil dihapus.');
                loadFees();
            };
        } catch (error) {
            console.error('Failed to delete fee:', error);
            showToast('Gagal menghapus biaya.');
        }
    });
}


export async function showFeeSelectionModal() {
    const feeSelectionList = document.getElementById('feeSelectionList');
    const fees = await getAllFromDB('fees');
    
    if (fees.length === 0) {
        feeSelectionList.innerHTML = '<p class="text-gray-500 text-center py-4">Tidak ada pajak atau biaya yang dapat dipilih. Tambahkan terlebih dahulu di halaman Pengaturan.</p>';
    } else {
        feeSelectionList.innerHTML = fees.map(fee => {
            const isChecked = window.app.cart.fees.some(cartFee => cartFee.id === fee.id);
            return `
                <label class="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer">
                    <div>
                        <span class="font-semibold">${fee.name}</span>
                        <p class="text-sm text-gray-500">${fee.type === 'percentage' ? `${fee.value}%` : `Rp ${formatCurrency(fee.value)}`}</p>
                    </div>
                    <input type="checkbox" data-fee-id="${fee.id}" class="h-5 w-5 rounded text-blue-600 border-gray-300 focus:ring-blue-500" ${isChecked ? 'checked' : ''}>
                </label>
            `;
        }).join('');
    }
    (document.getElementById('feeSelectionModal')).classList.remove('hidden');
}

export function closeFeeSelectionModal() {
    (document.getElementById('feeSelectionModal')).classList.add('hidden');
}

export async function applySelectedFees() {
    const checkboxes = document.querySelectorAll('#feeSelectionList input[type="checkbox"]');
    const allFees = await getAllFromDB('fees');
    
    const selectedFeeIds = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => parseInt(cb.dataset.feeId));

    window.app.cart.fees = allFees.filter(fee => selectedFeeIds.includes(fee.id));
    
    window.updateCartDisplay();
    closeFeeSelectionModal();
    showToast('Pajak & biaya berhasil diperbarui.');
}


export async function applyDefaultFees() {
    const allFees = await getAllFromDB('fees');
    window.app.cart.fees = allFees.filter(fee => fee.isDefault);
}

export async function reconcileCartFees() {
    const allFees = await getAllFromDB('fees');
    const allFeesMap = new Map(allFees.map(f => [f.id, f]));

    const reconciledFees = [];
    const addedFeeIds = new Set();

    window.app.cart.fees.forEach(cartFee => {
        if (allFeesMap.has(cartFee.id)) {
            reconciledFees.push(allFeesMap.get(cartFee.id));
            addedFeeIds.add(cartFee.id);
        }
    });

    allFees.forEach(dbFee => {
        if (dbFee.isDefault && !addedFeeIds.has(dbFee.id)) {
            reconciledFees.push(dbFee);
            addedFeeIds.add(dbFee.id);
        }
    });
    
    window.app.cart.fees = reconciledFees;
}

// --- PIN & AUTH FLOW ---

// Helper function to enable/disable the PIN keypad
function setKeypadDisabled(disabled) {
    const keypad = document.getElementById('pinKeypad');
    if (!keypad) return;
    keypad.querySelectorAll('button').forEach(btn => {
        btn.disabled = disabled;
    });
    if (disabled) {
        keypad.classList.add('opacity-50', 'pointer-events-none');
    } else {
        keypad.classList.remove('opacity-50', 'pointer-events-none');
    }
}

// Manages the lockout timer UI
function updateLockoutTimer(endTime) {
    const lockoutMessageEl = document.getElementById('pinLockoutMessage');
    const remainingMs = endTime - Date.now();

    if (remainingMs <= 0) {
        clearInterval(pinLockoutInterval);
        pinLockoutInterval = null;
        lockoutMessageEl.classList.add('hidden');
        setKeypadDisabled(false);
        localStorage.removeItem('pinLockoutEndTime');
        // Reset attempts after lockout period ends, giving them a fresh start
        localStorage.setItem('pinFailedAttempts', '0');
    } else {
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        lockoutMessageEl.textContent = `Terlalu banyak percobaan. ${minutes > 0 ? `${minutes} menit ` : ''}${seconds} detik.`;
    }
}

// Initiates the UI and logic for a PIN lockout
function startPinLockout(endTime) {
    const lockoutMessageEl = document.getElementById('pinLockoutMessage');
    setKeypadDisabled(true);
    lockoutMessageEl.classList.remove('hidden');

    if (pinLockoutInterval) {
        clearInterval(pinLockoutInterval);
    }
    updateLockoutTimer(endTime); // Initial call to show message immediately
    pinLockoutInterval = setInterval(() => updateLockoutTimer(endTime), 1000);
}

// Checks for an active lockout when the PIN modal is displayed
function checkPinLockout() {
    const endTime = parseInt(localStorage.getItem('pinLockoutEndTime') || '0');
    if (endTime > Date.now()) {
        startPinLockout(endTime);
    } else {
        setKeypadDisabled(false);
        document.getElementById('pinLockoutMessage').classList.add('hidden');
    }
}

function resetPinInput() {
    window.app.currentPinInput = "";
    const pinDisplay = document.getElementById('pinDisplay');
    pinDisplay.innerHTML = `
        <div class="w-4 h-4 rounded-full border-2 border-gray-400"></div>
        <div class="w-4 h-4 rounded-full border-2 border-gray-400"></div>
        <div class="w-4 h-4 rounded-full border-2 border-gray-400"></div>
        <div class="w-4 h-4 rounded-full border-2 border-gray-400"></div>
    `;
    pinDisplay.classList.remove('animate-shake');
}

export async function initiatePinLoginFlow(firebaseUser) {
    document.getElementById('authContainer')?.classList.add('hidden');
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay.style.display !== 'none') {
        loadingOverlay.classList.add('opacity-0');
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
    }

    if (firebaseUser.isAnonymous) {
        // Handle guest login: create a temporary user session and show the app
        console.log("Anonymous user detected:", firebaseUser.uid);
        window.app.currentUser = {
            id: 'guest',
            name: 'Pengguna Tamu',
            role: 'cashier', // Guests get a restricted role
            firebaseUid: firebaseUser.uid
        };

        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('bottomNav').classList.remove('hidden');
        updateUiForRole();
        showPage('dashboard');
        return; // Bypass the PIN flow entirely for guests
    }

    const allUsers = await getAllFromDB('users');
    if (allUsers.length === 0) {
        console.log("No local users found. Initiating first-time PIN setup for owner.");
        document.getElementById('setDevicePinModal').classList.remove('hidden');
    } else {
        console.log("Local users found. Showing PIN login screen.");
        document.getElementById('loginModal').classList.remove('hidden');
        resetPinInput();
        checkPinLockout();
    }
}

export async function handleInitialPinSetup() {
    const pin = document.getElementById('setPinInput').value;
    const confirmPin = document.getElementById('confirmPinInput').value;
    const errorEl = document.getElementById('pinSetError');

    if (pin.length !== 4) {
        errorEl.textContent = 'PIN harus 4 digit.';
        return;
    }
    if (pin !== confirmPin) {
        errorEl.textContent = 'PIN tidak cocok.';
        return;
    }
    errorEl.textContent = '';

    try {
        const firebaseUser = window.app.firebaseUser;
        let userName = firebaseUser.email.split('@')[0];

        // Try to get name from Firestore, but don't fail if offline
        try {
            if (window.app.isOnline) {
                const userDocRef = doc(window.db_firestore, 'users', firebaseUser.uid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists()) {
                    userName = userDoc.data().name || userName;
                }
            }
        } catch (e) {
            console.warn("Could not fetch user profile from Firestore during initial setup (likely offline):", e.message);
            // Fallback to email-based name is already the default, so we just continue.
        }

        const ownerUser = {
            name: userName,
            pin: pin,
            role: 'owner',
            firebaseUid: firebaseUser.uid,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const addedId = await putToDB('users', ownerUser);
        window.app.currentUser = { ...ownerUser, id: addedId };

        document.getElementById('setDevicePinModal').classList.add('hidden');
        document.getElementById('appContainer').classList.remove('hidden');
        document.getElementById('bottomNav').classList.remove('hidden');
        updateUiForRole();
        showPage('dashboard');

    } catch (error) {
        console.error('Failed to set up initial PIN:', error);
        errorEl.textContent = 'Gagal menyimpan PIN. Coba lagi.';
    }
}

export async function handlePinInput(digit) {
    const pinDisplay = document.getElementById('pinDisplay');
    pinDisplay.classList.remove('animate-shake');

    if (digit === 'clear') {
        resetPinInput();
        return;
    }
    if (digit === 'backspace') {
        window.app.currentPinInput = window.app.currentPinInput.slice(0, -1);
    } else if (window.app.currentPinInput.length < 4) {
        window.app.currentPinInput += digit;
    }

    let dots = '';
    for (let i = 0; i < 4; i++) {
        const filled = i < window.app.currentPinInput.length ? 'bg-blue-500 border-blue-500' : 'border-gray-400';
        dots += `<div class="w-4 h-4 rounded-full border-2 ${filled}"></div>`;
    }
    pinDisplay.innerHTML = dots;

    if (window.app.currentPinInput.length === 4) {
        const pin = window.app.currentPinInput;
        const user = await getFromDBByIndex('users', 'pin', pin);

        if (user) {
            // Successful login, clear all attempt/lockout data
            localStorage.removeItem('pinFailedAttempts');
            localStorage.removeItem('pinLockoutEndTime');
            localStorage.removeItem('pinLockoutCount');

            window.app.currentUser = user;
            document.getElementById('loginModal').classList.add('hidden');
            document.getElementById('appContainer').classList.remove('hidden');
            document.getElementById('bottomNav').classList.remove('hidden');
            updateUiForRole();
            showPage('dashboard');
        } else {
            // Incorrect PIN
            const failedAttempts = parseInt(localStorage.getItem('pinFailedAttempts') || '0') + 1;
            localStorage.setItem('pinFailedAttempts', failedAttempts);

            if (failedAttempts >= FAILED_ATTEMPTS_LIMIT) {
                const lockoutCount = parseInt(localStorage.getItem('pinLockoutCount') || '0') + 1;
                localStorage.setItem('pinLockoutCount', lockoutCount);
                
                let lockoutMinutes = 1; // 1 minute for 1st lockout
                if (lockoutCount > 1) lockoutMinutes = 5; // 5 mins for 2nd
                if (lockoutCount > 2) lockoutMinutes = 15; // 15 mins thereafter
                
                const endTime = Date.now() + lockoutMinutes * 60 * 1000;
                localStorage.setItem('pinLockoutEndTime', endTime);
                startPinLockout(endTime);
                // Don't reset failed attempts here; it will be reset when the lockout ends
            } else {
                pinDisplay.classList.add('animate-shake');
                showToast(`PIN salah. Sisa percobaan: ${FAILED_ATTEMPTS_LIMIT - failedAttempts}`);
            }
            setTimeout(resetPinInput, 500);
        }
    }
}

export function lockScreen() {
    window.app.currentUser = null;
    document.getElementById('appContainer').classList.add('hidden');
    document.getElementById('bottomNav').classList.add('hidden');
    document.getElementById('loginModal').classList.remove('hidden');
    resetPinInput();
    checkPinLockout();
}


// --- AUTH & USER MANAGEMENT ---
export function checkAccess(allowedRoles) {
    const currentUser = window.app.currentUser;
    if (!currentUser) {
        return false;
    }
    const userRole = currentUser.role;
    if (Array.isArray(allowedRoles)) {
        return allowedRoles.includes(userRole);
    } else {
        return userRole === allowedRoles;
    }
}

export function logout() {
    showConfirmationModal('Logout Akun Utama', 'Ini akan mengakhiri sesi Anda. Anda yakin ingin melanjutkan?', () => {
        window.app.currentUser = null;
        signOut(window.auth); // onAuthStateChanged will handle UI reset
    }, 'Ya, Logout', 'bg-orange-500');
}

export async function showManageUsersModal() {
    document.getElementById('manageUsersModal').classList.remove('hidden');
    await loadUsersForManagement();
}

async function loadUsersForManagement() {
    const listEl = document.getElementById('usersList');
    const users = await getAllFromDB('users');
    const currentUser = window.app.currentUser;

    if (!users.length) {
        listEl.innerHTML = `<p class="text-gray-500 text-center py-4">Tidak ada pengguna.</p>`;
        return;
    }

    listEl.innerHTML = users.sort((a,b) => a.name.localeCompare(b.name)).map(user => {
        const roleDisplay = {
            owner: 'Pemilik',
            manager: 'Manajer',
            cashier: 'Kasir'
        };
        
        let canEdit = false;
        let canDelete = false;

        if (currentUser.role === 'owner') {
            canEdit = true;
            canDelete = user.id !== currentUser.id;
        } else if (currentUser.role === 'manager') {
            canEdit = user.role !== 'owner';
            canDelete = user.role === 'cashier' && user.id !== currentUser.id;
        }

        const editButton = canEdit ? `<button onclick="showUserFormModal(${user.id})" class="text-blue-500 clickable"><i class="fas fa-edit"></i></button>` : `<div class="w-6"></div>`;
        const deleteButton = canDelete ? `<button onclick="deleteUser(${user.id})" class="text-red-500 clickable"><i class="fas fa-trash"></i></button>` : `<div class="w-6"></div>`;

        return `
            <div class="flex justify-between items-center bg-gray-100 p-2 rounded-lg">
                <div>
                    <p class="font-semibold">${user.name}</p>
                    <p class="text-sm text-gray-500">${roleDisplay[user.role]}</p>
                </div>
                <div class="flex items-center gap-4">
                    ${editButton}
                    ${deleteButton}
                </div>
            </div>
        `;
    }).join('');
}

export function closeManageUsersModal() {
    document.getElementById('manageUsersModal').classList.add('hidden');
}

export async function showUserFormModal(userId = null) {
    const modal = document.getElementById('userFormModal');
    const title = document.getElementById('userFormTitle');
    const nameInput = document.getElementById('userName');
    const pinInput = document.getElementById('userPin');
    const roleSelect = document.getElementById('userRole');
    const idInput = document.getElementById('userId');
    const currentUser = window.app.currentUser;

    // Reset form
    idInput.value = '';
    nameInput.value = '';
    pinInput.value = '';
    pinInput.placeholder = 'Wajib diisi (4 digit)';
    roleSelect.value = 'cashier';

    // Disable role selection based on current user's role
    Array.from(roleSelect.options).forEach(option => {
        if (currentUser.role === 'manager' && option.value === 'owner') {
            option.disabled = true;
        } else {
            option.disabled = false;
        }
    });

    if (userId) {
        title.textContent = 'Edit Pengguna';
        const user = await getFromDB('users', userId);
        if (user) {
            idInput.value = user.id;
            nameInput.value = user.name;
            roleSelect.value = user.role;
            pinInput.placeholder = 'Kosongkan jika tidak diubah';
            
            // A manager cannot edit an owner
            if (currentUser.role === 'manager' && user.role === 'owner') {
                 showToast('Manajer tidak dapat mengedit data Pemilik.');
                 return;
            }
        }
    } else {
        title.textContent = 'Tambah Pengguna';
    }

    modal.classList.remove('hidden');
}

export function closeUserFormModal() {
    document.getElementById('userFormModal').classList.add('hidden');
}

export async function saveUser() {
    const id = document.getElementById('userId').value ? parseInt(document.getElementById('userId').value) : null;
    const name = document.getElementById('userName').value.trim();
    const pin = document.getElementById('userPin').value.trim();
    const role = document.getElementById('userRole').value;
    const currentUser = window.app.currentUser;

    if (!name) {
        showToast('Nama pengguna tidak boleh kosong.');
        return;
    }

    if (!id && pin.length !== 4) {
        showToast('PIN baru wajib diisi dan harus 4 digit.');
        return;
    }
    
    if (id && pin && pin.length !== 4) {
        showToast('Jika diisi, PIN harus 4 digit.');
        return;
    }
    
    if (pin) {
        const existingUserWithPin = await getFromDBByIndex('users', 'pin', pin);
        if (existingUserWithPin && existingUserWithPin.id !== id) {
            showToast('PIN ini sudah digunakan oleh pengguna lain.');
            return;
        }
    }
    
    // A manager cannot create an owner
    if (currentUser.role === 'manager' && role === 'owner') {
        showToast('Manajer tidak dapat membuat pengguna dengan peran Pemilik.');
        return;
    }

    try {
        let userData;
        let action = '';

        if (id) { // Update
            userData = await getFromDB('users', id);
            if (!userData) {
                showToast('Pengguna tidak ditemukan.');
                return;
            }
            userData.name = name;
            userData.role = role;
            if (pin) {
                userData.pin = pin;
            }
            userData.updatedAt = new Date().toISOString();
            action = 'UPDATE_USER';
        } else { // Create
            userData = {
                name,
                pin,
                role,
                firebaseUid: currentUser.firebaseUid, // Associate with the main Firebase account
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            action = 'CREATE_USER';
        }

        const savedId = await putToDB('users', userData);
        
        showToast(`Pengguna berhasil ${id ? 'diperbarui' : 'ditambahkan'}.`);
        closeUserFormModal();
        await loadUsersForManagement();
    } catch (error) {
        console.error('Failed to save user:', error);
        showToast('Gagal menyimpan pengguna. Cek kembali data Anda.');
    }
}

export function deleteUser(userId) {
    const currentUser = window.app.currentUser;
    if (userId === currentUser.id) {
        showToast('Anda tidak dapat menghapus akun Anda sendiri.');
        return;
    }

    showConfirmationModal('Hapus Pengguna', 'Yakin ingin menghapus pengguna ini?', async () => {
        try {
            const userToDelete = await getFromDB('users', userId);
            const tx = window.app.db.transaction('users', 'readwrite');
            tx.objectStore('users').delete(userId);
            tx.oncomplete = async () => {
                showToast('Pengguna berhasil dihapus.');
                await loadUsersForManagement();
            };
        } catch (error) {
            console.error('Failed to delete user:', error);
            showToast('Gagal menghapus pengguna.');
        }
    }, 'Ya, Hapus', 'bg-red-500');
}

// --- FIREBASE AUTH UI FLOW ---

export function showAuthContainer() {
    const authContainer = document.getElementById('authContainer');
    if (authContainer) {
        authContainer.classList.remove('hidden');
        showLoginView(); // Default to login view
    }
}

function switchAuthView(viewToShow) {
    // Only manage views that exist in the HTML.
    ['loginView', 'forgotPasswordView'].forEach(viewId => {
        const view = document.getElementById(viewId);
        if (view) {
            if (viewId === viewToShow) {
                view.classList.remove('hidden');
            } else {
                view.classList.add('hidden');
            }
        }
    });
    // Clear any previous error messages, checking for nulls.
    const loginError = document.getElementById('loginError');
    if (loginError) loginError.textContent = '';

    const forgotError = document.getElementById('forgotError');
    if (forgotError) forgotError.textContent = '';
    
    const forgotSuccess = document.getElementById('forgotSuccess');
    if (forgotSuccess) forgotSuccess.textContent = '';
}

export function showLoginView() {
    switchAuthView('loginView');
}

export function showForgotPasswordView() {
    switchAuthView('forgotPasswordView');
}

function setAuthButtonLoading(buttonId, isLoading) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = isLoading;
        const text = button.querySelector('.auth-button-text');
        const spinner = button.querySelector('.auth-button-spinner');
        if (text) text.style.display = isLoading ? 'none' : 'inline';
        if (spinner) spinner.style.display = isLoading ? 'inline-block' : 'none';
    }
}

export async function handleEmailLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    setAuthButtonLoading('loginButton', true);
    errorEl.textContent = '';

    try {
        await signInWithEmailAndPassword(window.auth, email, password);
        // onAuthStateChanged will handle the rest
    } catch (error) {
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
            console.warn("Login attempt failed (invalid credentials):", error.code);
            errorEl.textContent = 'Email atau password salah.';
        } else {
            console.error("An unexpected login error occurred:", error);
            errorEl.textContent = 'Gagal login. Terjadi kesalahan tak terduga.';
        }
    } finally {
        setAuthButtonLoading('loginButton', false);
    }
}

export async function handleGuestLogin() {
    const buttonId = 'guestLoginButton';
    setAuthButtonLoading(buttonId, true);
    try {
        await signInAnonymously(window.auth);
        // onAuthStateChanged will handle the rest of the flow, no need to turn off loader on success
    } catch (error) {
        console.error("Anonymous sign-in failed:", error);
        const errorEl = document.getElementById('loginError');
        if (errorEl) errorEl.textContent = 'Gagal masuk sebagai tamu. Coba lagi nanti.';
        setAuthButtonLoading(buttonId, false);
    }
}

export async function handleForgotPassword(event) {
    event.preventDefault();
    const email = document.getElementById('forgotEmail').value;
    const errorEl = document.getElementById('forgotError');
    const successEl = document.getElementById('forgotSuccess');
    setAuthButtonLoading('forgotButton', true);
    errorEl.textContent = '';
    successEl.textContent = '';

    try {
        await sendPasswordResetEmail(window.auth, email);
        successEl.textContent = 'Link reset password telah dikirim ke email Anda.';
    } catch (error) {
        console.error("Forgot password failed:", error.code);
        errorEl.textContent = 'Gagal mengirim link. Periksa kembali email Anda.';
    } finally {
        setAuthButtonLoading('forgotButton', false);
    }
}