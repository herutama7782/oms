import { putSettingToDB, getSettingFromDB, getAllFromDB, putToDB, clearAllStores } from './db.js';
import { showToast, showConfirmationModal, loadDashboard, showPage } from './ui.js';
import { queueSyncAction } from './sync.js';
import { formatCurrency } from './ui.js';

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
        { key: 'printerPaperSize', value: document.getElementById('printerPaperSize').value }
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

        const kioskToggle = document.getElementById('kioskModeToggle');
        if (kioskToggle) {
            kioskToggle.checked = settingsMap.get('kioskModeEnabled') || false;
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
        
        const data = {
            products,
            transactions,
            settings,
            categories,
            fees,
            contacts,
            ledgers,
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
                        const storesToClear = ['products', 'transactions', 'settings', 'categories', 'fees', 'contacts', 'ledgers'];
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

async function loadFees() {
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

// --- KIOSK MODE ---
export async function handleKioskModeToggle(isChecked) {
    const kioskPin = await getSettingFromDB('kioskPin');
    if (isChecked) {
        if (!kioskPin) {
            showSetKioskPinModal();
        } else {
            activateKioskMode();
        }
    } else {
        showEnterKioskPinModal();
    }
}

export function showSetKioskPinModal() {
    document.getElementById('newKioskPin').value = '';
    document.getElementById('confirmKioskPin').value = '';
    document.getElementById('setKioskPinModal').classList.remove('hidden');
}

export function closeSetKioskPinModal() {
    document.getElementById('kioskModeToggle').checked = false;
    document.getElementById('setKioskPinModal').classList.add('hidden');
}

export async function saveKioskPinAndActivate() {
    const newPin = document.getElementById('newKioskPin').value;
    const confirmPin = document.getElementById('confirmKioskPin').value;

    if (newPin.length !== 4 || newPin !== confirmPin) {
        showToast('PIN harus 4 digit dan konfirmasi harus cocok.');
        return;
    }

    await putSettingToDB({ key: 'kioskPin', value: newPin });
    await putSettingToDB({ key: 'kioskModeEnabled', value: true });
    showToast('PIN Kios berhasil diatur. Mode Kios diaktifkan.');
    document.getElementById('setKioskPinModal').classList.add('hidden');
    activateKioskMode();
}

export async function activateKioskMode() {
    window.app.isKioskModeActive = true;
    document.getElementById('bottomNav').classList.add('hidden');
    document.getElementById('exitKioskBtn').classList.remove('hidden');
    await showPage('kasir', { force: true });
    showToast('Mode Kios diaktifkan.');
}

export function showEnterKioskPinModal() {
    window.app.currentPinInput = "";
    updatePinDisplay();
    document.getElementById('kioskPinError').textContent = '';
    document.getElementById('enterKioskPinModal').classList.remove('hidden');
}

export function closeEnterKioskPinModal() {
    document.getElementById('kioskModeToggle').checked = window.app.isKioskModeActive;
    document.getElementById('enterKioskPinModal').classList.add('hidden');
}

export function handlePinKeyPress(key) {
    if (key === 'backspace') {
        if (window.app.currentPinInput.length > 0) {
            window.app.currentPinInput = window.app.currentPinInput.slice(0, -1);
        }
    } else if (key === 'clear') {
        window.app.currentPinInput = "";
    } else {
        if (window.app.currentPinInput.length < 4) {
            window.app.currentPinInput += key;
        }
    }
    updatePinDisplay();

    if (window.app.currentPinInput.length === 4) {
        verifyKioskPin();
    }
}

function updatePinDisplay() {
    const dots = document.querySelectorAll('#kioskPinDisplay div');
    dots.forEach((dot, index) => {
        dot.classList.toggle('bg-blue-500', index < window.app.currentPinInput.length);
        dot.classList.toggle('bg-gray-300', index >= window.app.currentPinInput.length);
    });
}

async function verifyKioskPin() {
    const savedPin = await getSettingFromDB('kioskPin');
    const errorEl = document.getElementById('kioskPinError');
    const pinDisplay = document.getElementById('kioskPinDisplay');

    if (window.app.currentPinInput === savedPin) {
        window.app.pinAttemptCount = 0;
        exitKioskMode();
    } else {
        window.app.pinAttemptCount++;
        errorEl.textContent = `PIN Salah (${window.app.pinAttemptCount}/5)`;
        pinDisplay.classList.add('animate-shake');
        setTimeout(() => {
            pinDisplay.classList.remove('animate-shake');
            window.app.currentPinInput = "";
            updatePinDisplay();
        }, 500);

        if (window.app.pinAttemptCount >= 5) {
            showToast('PIN salah 5 kali. Semua data akan dihapus!');
            await clearAllStores();
            setTimeout(() => location.reload(), 2000);
        }
    }
}

async function exitKioskMode() {
    window.app.isKioskModeActive = false;
    await putSettingToDB({ key: 'kioskModeEnabled', value: false });
    document.getElementById('bottomNav').classList.remove('hidden');
    document.getElementById('exitKioskBtn').classList.add('hidden');
    document.getElementById('kioskModeToggle').checked = false;
    closeEnterKioskPinModal();
    showToast('Mode Kios dinonaktifkan.');
    showPage('pengaturan');
}
