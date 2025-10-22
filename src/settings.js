import { putSettingToDB, getSettingFromDB, getAllFromDB, putToDB, clearAllStores, getFromDB } from './db.js';
import { showToast, showConfirmationModal, loadDashboard, showPage, updateUiForRole } from './ui.js';
import { queueSyncAction } from './sync.js';
import { formatCurrency } from './ui.js';
import { loadProductsList, loadProductsGrid } from './product.js';

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
        const products = await getAllFromDB('products');
        const transactions = await getAllFromDB('transactions');
        const settings = await getAllFromDB('settings');
        const categories = await getAllFromDB('categories');
        const fees = await getAllFromDB('fees');
        const contacts = await getAllFromDB('contacts');
        const ledgers = await getAllFromDB('ledgers');
        const users = await getAllFromDB('users');
        
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
            const newCategories = new Map();

            let addedCount = 0;
            let updatedCount = 0;
            let errorCount = 0;
            
            const transaction = window.app.db.transaction(['products', 'categories'], 'readwrite');
            const productStore = transaction.objectStore('products');
            const categoryStore = transaction.objectStore('categories');

            for (const row of rows) {
                const values = row.split(',');
                const rowData = header.reduce((obj, col, index) => {
                    obj[col] = values[index] ? values[index].trim() : '';
                    return obj;
                }, {});

                // Validation
                if (!rowData.nama || isNaN(parseFloat(rowData.harga_jual))) {
                    errorCount++;
                    continue;
                }
                
                const name = rowData.nama;
                const barcode = rowData.barcode || null;
                
                let existingProduct = null;
                if (barcode && productBarcodeMap.has(barcode)) {
                    existingProduct = productBarcodeMap.get(barcode);
                } else if (productNameMap.has(name.toLowerCase())) {
                    existingProduct = productNameMap.get(name.toLowerCase());
                }

                const product = existingProduct || {
                    createdAt: new Date().toISOString()
                };

                product.name = name;
                product.price = parseFloat(rowData.harga_jual);
                product.purchasePrice = parseFloat(rowData.harga_beli) || product.purchasePrice || 0;
                product.stock = parseInt(rowData.stok) >= 0 ? parseInt(rowData.stok) : (product.stock || 0);
                product.barcode = barcode;
                product.category = rowData.kategori || product.category || 'Lainnya';
                product.discountPercentage = parseFloat(rowData.diskon_persen) || product.discountPercentage || 0;
                product.updatedAt = new Date().toISOString();
                
                // Handle new category
                const categoryName = product.category;
                if (categoryName && !categoryNameMap.has(categoryName.toLowerCase()) && !newCategories.has(categoryName.toLowerCase())) {
                    const newCategory = { name: categoryName, createdAt: new Date().toISOString() };
                    newCategories.set(categoryName.toLowerCase(), newCategory);
                    categoryStore.add(newCategory);
                }
                
                productStore.put(product);
                
                if (existingProduct) {
                    updatedCount++;
                } else {
                    addedCount++;
                }
            }

            transaction.oncomplete = () => {
                let summary = `Import selesai.`;
                if (addedCount > 0) summary += ` ${addedCount} produk ditambah.`;
                if (updatedCount > 0) summary += ` ${updatedCount} produk diperbarui.`;
                if (errorCount > 0) summary += ` ${errorCount} baris gagal.`;
                showToast(summary, 5000);
                
                // Refresh UI
                if(window.app.currentPage === 'produk') loadProductsList();
                loadProductsGrid();
                if(window.app.currentPage === 'dashboard') loadDashboard();
            };
            
            transaction.onerror = (event) => {
                console.error("Import transaction error:", event.target.error);
                showToast('Terjadi kesalahan saat menyimpan data.');
            }

        } catch (error) {
            console.error('Import failed:', error);
            showToast('Gagal memproses file. Pastikan formatnya benar.');
        } finally {
            event.target.value = ''; // Reset file input
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
                await queueSyncAction('DELETE_FEE', feeToDelete);
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

// --- AUTH & USER MANAGEMENT ---

/**
 * Checks if the current user has access based on their role.
 * @param {string|string[]} allowedRoles - A role or an array of roles that are allowed.
 * @returns {boolean} - True if the user has access, false otherwise.
 */
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

async function createDefaultOwner() {
    const owner = {
        name: 'Pemilik',
        pin: '1234', // Default PIN
        role: 'owner',
        createdAt: new Date().toISOString()
    };
    await putToDB('users', owner);
    showConfirmationModal(
        'Selamat Datang!',
        'Akun "Pemilik" default telah dibuat dengan PIN: <strong>1234</strong>. Silakan login dan segera ganti PIN Anda di menu Manajemen Pengguna.',
        () => {}, 'Mengerti', 'bg-blue-500'
    );
}

export async function startAuthFlow(onSuccessCallback) {
    const users = await getAllFromDB('users');
    if (users.length === 0) {
        await createDefaultOwner();
    }
    
    document.getElementById('loginModal').classList.remove('hidden');
    // Hide main app elements until login is successful
    document.getElementById('appContainer').classList.add('hidden');
    document.getElementById('bottomNav').classList.add('hidden');
    document.getElementById('loadingOverlay').style.display = 'none';

    window.app.onLoginSuccess = onSuccessCallback;
}

function updateLoginPinDisplay() {
    const dots = document.querySelectorAll('#loginPinDisplay div');
    dots.forEach((dot, index) => {
        dot.classList.toggle('bg-gray-800', index < window.app.currentPinInput.length);
        dot.classList.toggle('bg-gray-200', index >= window.app.currentPinInput.length);
    });
}

async function verifyLoginPin() {
    const pin = window.app.currentPinInput;
    const errorEl = document.getElementById('loginPinError');
    const pinDisplay = document.getElementById('loginPinDisplay');
    
    const users = await getAllFromDB('users', 'pin', pin);
    const user = users.length > 0 ? users[0] : null;

    if (user) {
        errorEl.textContent = '';
        login(user);
    } else {
        errorEl.textContent = `PIN Salah.`;
        pinDisplay.classList.add('animate-shake');
        setTimeout(() => {
            pinDisplay.classList.remove('animate-shake');
            window.app.currentPinInput = "";
            updateLoginPinDisplay();
        }, 500);
    }
}

function login(user) {
    window.app.currentUser = user;
    document.getElementById('loginModal').classList.add('hidden');
    
    if (window.app.onLoginSuccess) {
        window.app.onLoginSuccess();
    } else {
        location.reload();
    }
}

export function logout() {
    showConfirmationModal('Logout', 'Anda yakin ingin keluar?', () => {
        window.app.currentUser = null;
        location.reload();
    });
}

export function handleLoginPinKeyPress(key) {
    if (key === 'backspace') {
        if (window.app.currentPinInput.length > 0) {
            window.app.currentPinInput = window.app.currentPinInput.slice(0, -1);
        }
    } else {
        if (window.app.currentPinInput.length < 4) {
            window.app.currentPinInput += key;
        }
    }
    updateLoginPinDisplay();

    if (window.app.currentPinInput.length === 4) {
        verifyLoginPin();
    }
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
            <div class="flex justify-between items-center bg-gray-100 p-3 rounded-lg">
                <div>
                    <p class="font-semibold">${user.name}</p>
                    <p class="text-sm text-gray-600">${roleDisplay[user.role] || user.role}</p>
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
    const idInput = document.getElementById('userId');
    const nameInput = document.getElementById('userName');
    const pinInput = document.getElementById('userPin');
    const roleInput = document.getElementById('userRole');

    // Reset form
    idInput.value = '';
    nameInput.value = '';
    pinInput.value = '';
    pinInput.placeholder = 'Masukkan 4 digit PIN';
    roleInput.value = 'cashier';

    const currentUser = window.app.currentUser;
    Array.from(roleInput.options).forEach(option => {
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
            pinInput.placeholder = 'Kosongkan jika tidak ganti PIN';
            roleInput.value = user.role;
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

    if (!name) {
        showToast('Nama pengguna tidak boleh kosong.');
        return;
    }
    
    if (!id && (!pin || pin.length !== 4)) {
        showToast('PIN wajib diisi dengan 4 digit untuk pengguna baru.');
        return;
    }

    if (pin && pin.length !== 4) {
        showToast('PIN harus 4 digit.');
        return;
    }

    const userData = {
        name,
        role,
        updatedAt: new Date().toISOString()
    };

    if (pin) {
        const usersWithPin = await getAllFromDB('users', 'pin', pin);
        if (usersWithPin.some(u => u.id !== id)) {
            showToast('PIN ini sudah digunakan oleh pengguna lain.');
            return;
        }
        userData.pin = pin;
    }

    let action = '';
    if (id) {
        userData.id = id;
        const existingUser = await getFromDB('users', id);
        if (!userData.pin) userData.pin = existingUser.pin;
        userData.createdAt = existingUser.createdAt;
        action = 'UPDATE_USER';
    } else {
        userData.createdAt = new Date().toISOString();
        action = 'CREATE_USER';
    }

    try {
        const savedId = await putToDB('users', userData);
        showToast(`Pengguna berhasil ${id ? 'diperbarui' : 'disimpan'}.`);
        closeUserFormModal();
        await loadUsersForManagement();
    } catch (error) {
        console.error('Failed to save user:', error);
        showToast('Gagal menyimpan pengguna.');
    }
}

export async function deleteUser(userId) {
    const currentUser = window.app.currentUser;
    if (userId === currentUser.id) {
        showToast('Anda tidak dapat menghapus akun sendiri.');
        return;
    }
    
    const userToDelete = await getFromDB('users', userId);

    showConfirmationModal('Hapus Pengguna', `Yakin ingin menghapus pengguna "${userToDelete.name}"?`, async () => {
        try {
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