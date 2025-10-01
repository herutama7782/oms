
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// --- GLOBAL STATE & CONFIG ---
let db;
let cart = {
    items: [],
    fees: []
};
let currentImageData = null;
let currentEditImageData = null;
let currentStoreLogoData = null;
let currentPage = 'dashboard';
let confirmCallback = null;
let html5QrCode;
let currentReportData = [];
let lowStockThreshold = 5; // Default value
let isOnline = navigator.onLine;
let isSyncing = false;
let currentReceiptTransaction = null;
let isPrinterReady = false;
let isScannerReady = false;
let isChartJsReady = false;
let salesChartInstance = null;
let scanCallback = null; // Callback for when scanning is used for input fields
let isKioskModeActive = false;
let currentPinInput = "";
let pinAttemptCount = 0;
let lastDashboardLoadDate = null;
let audioContext = null; // For Web Audio API
let deviceId = null;
let deferredInstallPrompt = null;
const LICENSE_SECRET_SALT = "POS_MOBILE_SUPER_SECRET_2024";


// Bluetooth printing state
let bluetoothDevice = null;
let bluetoothCharacteristic = null;

// --- AUDIO FUNCTIONS ---
/**
 * Initializes the AudioContext. Must be called after a user interaction.
 */
function initAudioContext() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser");
        }
    }
}

/**
 * Memainkan satu nada audio pada waktu yang ditentukan.
 * @param {number} frequency - Frekuensi nada (Hz).
 * @param {number} duration - Durasi nada (detik).
 * @param {number} volume - Volume (0.0 hingga 1.0).
 * @param {string} waveType - Tipe gelombang ('sine', 'square', 'sawtooth', 'triangle').
 */
function playTone(frequency, duration, volume, waveType) {
    if (!audioContext) {
        console.warn("AudioContext not initialized. Cannot play tone.");
        return;
    }

    try {
        // 1. Buat Oscillator (sumber suara)
        const oscillator = audioContext.createOscillator();
        // 2. Buat Gain Node (kontrol volume)
        const gainNode = audioContext.createGain();

        // 3. Hubungkan Node: Oscillator -> Gain -> Output Speaker
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Pengaturan
        oscillator.type = waveType;
        oscillator.frequency.value = frequency;
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

        // Memulai dan Menghentikan oscillator pada waktu yang dijadwalkan
        const startTime = audioContext.currentTime;
        oscillator.start(startTime);
        oscillator.stop(startTime + duration);

    } catch (error) {
        console.error("Error playing tone:", error);
    }
}


// --- DATABASE FUNCTIONS ---
function initDB() {
    return new Promise((resolve, reject) => {
        // Graceful fallback for browsers that don't support IndexedDB
        if (!window.indexedDB) {
            console.error("IndexedDB could not be found in this browser.");
            const appContainer = document.getElementById('appContainer');
            if (appContainer) {
                appContainer.innerHTML = `
                    <div class="fixed inset-0 bg-gray-100 flex flex-col items-center justify-center p-8 text-center">
                        <i class="fas fa-exclamation-triangle text-5xl text-red-500 mb-4"></i>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">Browser Tidak Didukung</h1>
                        <p class="text-gray-600">
                            Aplikasi ini memerlukan fitur database modern (IndexedDB) yang tidak didukung oleh browser Anda.
                            Silakan gunakan browser modern seperti Chrome, Firefox, atau Safari.
                        </p>
                    </div>
                `;
            }
            reject("IndexedDB not supported");
            return;
        }

        const request = indexedDB.open('POS_DB', 7); 

        request.onerror = function(event) {
            console.error("Database error:", event.target.error);
            showToast('Gagal menginisialisasi database');
            reject(event.target.error);
        };
        
        request.onsuccess = function(event) {
            db = event.target.result;
            resolve();
        };
        
        request.onupgradeneeded = async function(event) {
            db = event.target.result;
            const transaction = event.target.transaction;
            
            if (event.oldVersion < 2) {
                if (!db.objectStoreNames.contains('products')) {
                    const productStore = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
                    productStore.createIndex('name', 'name', { unique: false });
                }
                if (!db.objectStoreNames.contains('transactions')) {
                    const transactionStore = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
                    transactionStore.createIndex('date', 'date', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            }
            
            if (event.oldVersion < 3) {
                if (db.objectStoreNames.contains('products')) {
                    const productStore = transaction.objectStore('products');
                    if (!productStore.indexNames.contains('barcode')) {
                        productStore.createIndex('barcode', 'barcode', { unique: true });
                    }
                }
            }

            if (event.oldVersion < 4) {
                if (!db.objectStoreNames.contains('auto_backup')) {
                    db.createObjectStore('auto_backup', { keyPath: 'key' });
                }
            }
            
            if (event.oldVersion < 5) {
                if (!db.objectStoreNames.contains('categories')) {
                    const categoryStore = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
                    categoryStore.createIndex('name', 'name', { unique: true });
                }
                 // Migration logic: Populate categories from existing products
                const productStore = transaction.objectStore('products');
                const categoryStore = transaction.objectStore('categories');
                const existingCategories = new Set();

                // Get all products
                const productsRequest = productStore.getAll();
                productsRequest.onsuccess = () => {
                    const products = productsRequest.result;
                    products.forEach(p => {
                        if (p.category) {
                            existingCategories.add(p.category.trim());
                        }
                    });
                     // Add default categories if they don't exist
                    ['Makanan', 'Minuman', 'Lainnya'].forEach(cat => existingCategories.add(cat));

                    // Add unique categories to the new store
                    existingCategories.forEach(categoryName => {
                        categoryStore.add({ name: categoryName });
                    });
                };
            }

            if (event.oldVersion < 6) {
                if (!db.objectStoreNames.contains('sync_queue')) {
                    db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                }
            }
             if (event.oldVersion < 7) {
                if (!db.objectStoreNames.contains('fees')) {
                    db.createObjectStore('fees', { keyPath: 'id', autoIncrement: true });
                }

                // Migration logic: move PPN from settings to the new fees store
                const settingsStore = transaction.objectStore('settings');
                const feesStore = transaction.objectStore('fees');
                const ppnRequest = settingsStore.get('storePpn');

                ppnRequest.onsuccess = () => {
                    const ppnSetting = ppnRequest.result;
                    if (ppnSetting && ppnSetting.value > 0) {
                        const ppnFee = {
                            name: 'PPN',
                            type: 'percentage',
                            value: ppnSetting.value,
                            isDefault: true,
                            isTax: true,
                            createdAt: new Date().toISOString()
                        };
                        feesStore.add(ppnFee);
                        settingsStore.delete('storePpn');
                    }
                };
            }
        };
    });
}


function getFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('Database not initialized on getFromDB');
            reject('Database not initialized');
            return;
        }
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject('Error fetching from DB: ' + event.target.error);
        };
    });
}

function getAllFromDB(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('Database not initialized on getAllFromDB');
            reject('Database not initialized');
            return;
        }
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject('Error fetching all from DB: ' + event.target.error);
        };
    });
}


function putToDB(storeName, value) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('Database not initialized on putToDB');
            reject('Database not initialized');
            return;
        }
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value);
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject('Error putting to DB: ' + event.target.error);
        };
    });
}

// Specific helpers for the settings store
async function getSettingFromDB(key) {
    const setting = await getFromDB('settings', key);
    return setting ? setting.value : undefined;
}

async function putSettingToDB(setting) {
    return putToDB('settings', setting);
}

// --- SERVER SYNC & OFFLINE HANDLING ---

// MOCK SERVER DATA - In a real app, this would live on a server.
const mockServerData = {
    products: [],
    categories: [
        { serverId: 'server_cat_201', name: 'Lainnya', updatedAt: new Date().toISOString() }
    ],
    deleted: {
        products: [], // e.g., ['server_id_of_deleted_product']
        categories: []
    }
};

/**
 * Mocks fetching data from a server.
 * @param {string | undefined} lastSync - The ISO string of the last sync time.
 * @returns {Promise<object>} A promise that resolves with updates.
 */
async function mockFetchFromServer(lastSync) {
    console.log('[SYNC] Mock fetching from server since:', lastSync);
    // In a real app, you'd send lastSync to the server API.
    // Here we simulate that by filtering items newer than the last sync.
    const lastSyncDate = lastSync ? new Date(lastSync) : new Date(0); // If never synced, get all.

    const updates = {
        products: mockServerData.products.filter(p => new Date(p.updatedAt) > lastSyncDate),
        categories: mockServerData.categories.filter(c => new Date(c.updatedAt) > lastSyncDate),
        deleted: mockServerData.deleted // For simplicity, we send all deletions every time in this mock.
    };

    // Simulate network latency
    return new Promise(resolve => setTimeout(() => resolve(updates), 500));
}


function updateSyncStatusUI(status) {
    const syncIcon = document.getElementById('syncIcon');
    const syncText = document.getElementById('syncText');
    if (!syncIcon || !syncText) return;

    syncIcon.classList.remove('fa-spin', 'text-green-500', 'text-red-500', 'text-yellow-500');

    switch (status) {
        case 'syncing':
            syncIcon.className = 'fas fa-sync-alt fa-spin';
            syncText.textContent = 'Menyinkronkan...';
            break;
        case 'synced':
            syncIcon.className = 'fas fa-check-circle text-green-500';
            syncText.textContent = 'Terbaru';
            break;
        case 'offline':
            syncIcon.className = 'fas fa-wifi text-gray-400';
            syncText.textContent = 'Offline';
            break;
        case 'error':
            syncIcon.className = 'fas fa-exclamation-triangle text-red-500';
            syncText.textContent = 'Gagal sinkron';
            break;
        default:
            syncIcon.className = 'fas fa-sync-alt';
            syncText.textContent = 'Siap';
            break;
    }
}

async function checkOnlineStatus() {
    isOnline = navigator.onLine;
    if (isOnline) {
        updateSyncStatusUI('synced'); // Optimistically set to synced, syncWithServer will update if needed
        showToast('Kembali online, sinkronisasi data dimulai.', 2000);
        await window.syncWithServer();
    } else {
        updateSyncStatusUI('offline');
        showToast('Anda sekarang offline. Perubahan akan disimpan secara lokal.', 3000);
    }
}

async function queueSyncAction(action, payload) {
    try {
        await putToDB('sync_queue', { action, payload, timestamp: new Date().toISOString() });
        // Trigger sync immediately after queueing an action if online
        if (isOnline) {
            window.syncWithServer();
        }
    } catch (error) {
        console.error('Failed to queue sync action:', error);
        showToast('Gagal menyimpan perubahan untuk sinkronisasi.');
    }
}


window.syncWithServer = async function(isManual = false) {
    if (!isOnline) {
        if (isManual) showToast('Anda sedang offline. Sinkronisasi akan dilanjutkan saat kembali online.');
        updateSyncStatusUI('offline');
        return;
    }
    if (isSyncing) {
        if (isManual) showToast('Sinkronisasi sedang berjalan.');
        return;
    }

    isSyncing = true;
    updateSyncStatusUI('syncing');

    try {
        // --- 1. PUSH local changes to server ---
        const syncQueue = await getAllFromDB('sync_queue');
        if (syncQueue.length > 0) {
             if (isManual) showToast(`Mengirim ${syncQueue.length} perubahan ke server...`);

            for (const task of syncQueue) {
                console.log(`[SYNC] Processing: ${task.action}`, task.payload);
                // MOCK API CALL - In a real app, this would be a fetch() call
                const response = await new Promise(resolve => setTimeout(() => {
                    console.log(`[SYNC] Mock API call for ${task.action}`);
                    // Simulate success, potentially returning a server-generated ID
                    resolve({ success: true, serverId: `server_${Date.now()}`, localId: task.payload.id });
                }, 300)); // Simulate network latency

                if (response.success) {
                    // Update local item with server ID if applicable
                    if (task.action.startsWith('CREATE_') && response.serverId && response.localId) {
                        let storeName = '';
                        if (task.action.includes('PRODUCT')) storeName = 'products';
                        if (task.action.includes('CATEGORY')) storeName = 'categories';
                        if (task.action.includes('TRANSACTION')) storeName = 'transactions';
                        if (task.action.includes('FEE')) storeName = 'fees';

                        if (storeName) {
                            const item = await getFromDB(storeName, response.localId);
                            if (item) {
                                item.serverId = response.serverId;
                                await putToDB(storeName, item);
                            }
                        }
                    }
                    
                    // Remove successfully processed task from the queue
                    const tx = db.transaction('sync_queue', 'readwrite');
                    tx.objectStore('sync_queue').delete(task.id);
                } else {
                    // Handle API failure - leave task in queue and stop current sync process
                    console.error(`[SYNC] Failed to process task ${task.id}:`, response.error);
                    throw new Error(`API call failed for action: ${task.action}`);
                }
            }
        }

        // --- 2. PULL server changes to local (MOCKED) ---
        if (isManual) showToast('Menerima pembaruan dari server...');
        const lastSync = await getSettingFromDB('lastSync');
        const serverUpdates = await mockFetchFromServer(lastSync);

        console.log('[SYNC] Received from mock server:', serverUpdates);

        if (serverUpdates.products.length > 0 || serverUpdates.categories.length > 0 || serverUpdates.deleted.products.length > 0 || serverUpdates.deleted.categories.length > 0) {
            
            const localProducts = await getAllFromDB('products');
            const localCategories = await getAllFromDB('categories');

            const productServerIdMap = new Map(localProducts.filter(p => p.serverId).map(p => [p.serverId, p]));
            const categoryServerIdMap = new Map(localCategories.filter(c => c.serverId).map(c => [c.serverId, c]));

            const tx = db.transaction(['products', 'categories'], 'readwrite');
            const productStore = tx.objectStore('products');
            const categoryStore = tx.objectStore('categories');

            let changesMade = false;

            // Process product updates/creations
            for (const serverProduct of serverUpdates.products) {
                const localProduct = productServerIdMap.get(serverProduct.serverId);
                if (localProduct) {
                    if (!localProduct.updatedAt || new Date(serverProduct.updatedAt) > new Date(localProduct.updatedAt)) {
                        console.log(`[SYNC] Updating local product: ${localProduct.name} -> ${serverProduct.name}`);
                        Object.assign(localProduct, serverProduct, { id: localProduct.id });
                        productStore.put(localProduct);
                        changesMade = true;
                    }
                } else {
                    console.log(`[SYNC] Adding new server product: ${serverProduct.name}`);
                    const { id, ...productToAdd } = serverProduct; 
                    productStore.put(productToAdd);
                    changesMade = true;
                }
            }

            // Process category updates/creations
            for (const serverCategory of serverUpdates.categories) {
                const localCategory = categoryServerIdMap.get(serverCategory.serverId);
                if (localCategory) {
                    if (!localCategory.updatedAt || new Date(serverCategory.updatedAt) > new Date(localCategory.updatedAt)) {
                        console.log(`[SYNC] Updating local category: ${localCategory.name} -> ${serverCategory.name}`);
                        Object.assign(localCategory, serverCategory, { id: localCategory.id });
                        categoryStore.put(localCategory);
                        changesMade = true;
                    }
                } else {
                    console.log(`[SYNC] Adding new server category: ${serverCategory.name}`);
                    const { id, ...categoryToAdd } = serverCategory;
                    categoryStore.put(categoryToAdd);
                    changesMade = true;
                }
            }

            // Process deletions
            for (const serverIdToDelete of serverUpdates.deleted.products) {
                const localProductToDelete = productServerIdMap.get(serverIdToDelete);
                if (localProductToDelete) {
                    console.log(`[SYNC] Deleting local product as instructed by server: ${localProductToDelete.name}`);
                    productStore.delete(localProductToDelete.id);
                    changesMade = true;
                }
            }

            for (const serverIdToDelete of serverUpdates.deleted.categories) {
                const localCategoryToDelete = categoryServerIdMap.get(serverIdToDelete);
                if (localCategoryToDelete) {
                    console.log(`[SYNC] Deleting local category as instructed by server: ${localCategoryToDelete.name}`);
                    categoryStore.delete(localCategoryToDelete.id);
                    changesMade = true;
                }
            }
            
            if (changesMade && isManual) {
                showToast('Data lokal diperbarui dari server.');
            }
        } else {
            console.log('[SYNC] Tidak ada pembaruan dari server.');
        }

        // --- 3. Finalize ---
        await putSettingToDB({ key: 'lastSync', value: new Date().toISOString() });
        updateSyncStatusUI('synced');
         if (isManual) showToast('Sinkronisasi berhasil!');

    } catch (error) {
        console.error('Sync failed:', error);
        updateSyncStatusUI('error');
         if (isManual) showToast('Sinkronisasi gagal. Silakan coba lagi.');
    } finally {
        isSyncing = false;
        // Refresh UI with latest data
        if (currentPage === 'dashboard') loadDashboard();
        if (currentPage === 'produk') window.loadProductsList();
    }
}


// --- UI & NAVIGATION ---
let isNavigating = false; // Flag to prevent multiple clicks during transition

// --- Cart Modal Functions ---
function showCartModal() {
    updateCartDisplay(); // Ensure content is up-to-date
    const modal = document.getElementById('cartModal');
    const sheet = document.getElementById('cartSection');
    const bottomNav = document.getElementById('bottomNav');
    const cartFab = document.getElementById('cartFab');
    if (!modal || !sheet) return;

    if (bottomNav) bottomNav.classList.add('hidden');
    if (cartFab) cartFab.classList.add('hidden');

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        sheet.classList.add('show');
    });
}
window.showCartModal = showCartModal;

function hideCartModal() {
    const modal = document.getElementById('cartModal');
    const sheet = document.getElementById('cartSection');
    const bottomNav = document.getElementById('bottomNav');
    const cartFab = document.getElementById('cartFab');
    if (!modal || !sheet) return;
    
    // Show nav and FAB again
    if (bottomNav && !isKioskModeActive) {
        bottomNav.classList.remove('hidden');
    }
    if (cartFab && currentPage === 'kasir') {
        cartFab.classList.remove('hidden');
    }

    sheet.classList.remove('show');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300); // Must match CSS transition duration
}
window.hideCartModal = hideCartModal;

function updateCartFabBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;

    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);

    if (totalItems > 0) {
        badge.textContent = totalItems > 99 ? '99+' : totalItems;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function updateFeatureAvailability() {
    // Scanner
    const scanBtn = document.getElementById('scanBarcodeBtn');
    if (scanBtn) {
        if (!isScannerReady) {
            scanBtn.disabled = true;
            scanBtn.classList.remove('bg-gray-600');
            scanBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
            scanBtn.title = 'Pemindai barcode gagal dimuat.';
        } else {
            scanBtn.disabled = false;
            scanBtn.classList.add('bg-gray-600');
            scanBtn.classList.remove('bg-gray-400', 'cursor-not-allowed');
            scanBtn.title = '';
        }
    }

    // Printer
    const printReceiptBtn = document.getElementById('printReceiptBtn');
    const autoPrintContainer = document.getElementById('autoPrintContainer');
    const testPrintBtn = document.getElementById('testPrintBtn');

    if (!isPrinterReady) {
        if (printReceiptBtn) {
            printReceiptBtn.disabled = true;
            printReceiptBtn.classList.remove('bg-gray-600');
            printReceiptBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
            printReceiptBtn.title = 'Fitur cetak gagal dimuat.';
        }
        if (testPrintBtn) {
            testPrintBtn.disabled = true;
            testPrintBtn.title = 'Fitur cetak gagal dimuat.';
        }
        if (autoPrintContainer) {
            autoPrintContainer.classList.add('opacity-50');
            const autoPrintCheckbox = document.getElementById('autoPrintReceipt');
            if (autoPrintCheckbox) autoPrintCheckbox.disabled = true;

            // Check if note already exists to prevent duplicates
            if (!autoPrintContainer.parentElement.querySelector('.library-error-note')) {
                const note = document.createElement('p');
                note.className = 'text-xs text-red-500 text-center mt-2 library-error-note';
                note.textContent = 'Fitur cetak tidak tersedia (library gagal dimuat).';
                autoPrintContainer.parentElement.insertBefore(note, autoPrintContainer.nextSibling);
            }
        }
    }
}


window.showPage = async function(pageName, force = false) {
    if (isKioskModeActive && pageName !== 'kasir') {
        showToast('Mode Kios aktif. Fitur lain dinonaktifkan.');
        return; 
    }

    // Confirmation logic for leaving Kasir page with items in cart
    if (currentPage === 'kasir' && cart.items.length > 0 && pageName !== 'kasir' && !force) {
        showConfirmationModal(
            'Keranjang Belum Disimpan',
            'Anda memiliki item di keranjang. Meninggalkan halaman ini akan mengosongkan keranjang. Lanjutkan?',
            async () => {
                // On confirm, clear the cart and proceed with navigation
                cart = { items: [], fees: [] }; // Reset the cart
                await applyDefaultFees(); // Re-apply default fees to the now-empty cart
                updateCartFabBadge(); // Update the badge to 0
                showPage(pageName, true); // Force navigation
            },
            'Ya, Lanjutkan & Kosongkan',
            'bg-yellow-500' 
        );
        return; // Stop the current navigation attempt
    }


    if (currentPage === pageName || isNavigating) return;
    isNavigating = true;

    const transitionDuration = 300; // Must match CSS transition duration

    const oldPage = document.querySelector('.page.active');
    const newPage = document.getElementById(pageName);
    const cartFab = document.getElementById('cartFab');

    if (!newPage) {
        isNavigating = false;
        return;
    }

    // Update nav item state immediately
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (navItem) navItem.classList.add('active');

    // Prepare the new page by setting its initial 'enter' state
    newPage.classList.add('page-enter');
    newPage.style.display = 'block';

    // Animate the old page out
    if (oldPage) {
        oldPage.classList.add('page-exit');
    }
    
    // Show cart FAB immediately when navigating to kasir page
    if (pageName === 'kasir') {
        cartFab.classList.remove('hidden');
    }

    // Load data for the new page
    if (pageName === 'dashboard') {
        loadDashboard();
    } else if (pageName === 'kasir') {
        loadProductsGrid();
        await reconcileCartFees();
        updateCartFabBadge();
    } else if (pageName === 'produk') {
        window.loadProductsList();
    } else if (pageName === 'pengaturan') {
        loadSettings(); // This will also call loadLicenseInfo
        loadFees();
    }


    // Force browser to apply start states before transitioning
    requestAnimationFrame(() => {
        // Animate the new page in
        newPage.classList.remove('page-enter');
        newPage.classList.add('active');

        // After transition, clean up the old page
        setTimeout(() => {
            if (oldPage) {
                oldPage.classList.remove('active');
                oldPage.classList.remove('page-exit');
                oldPage.style.display = 'none';
            }

            currentPage = pageName;
            isNavigating = false;
            
            // Hide FAB if not on kasir page
            if (pageName !== 'kasir') {
                cartFab.classList.add('hidden');
            }

            // Post-transition actions like focusing
            if (pageName === 'kasir') {
                const searchInput = document.getElementById('searchProduct');
                if (searchInput) {
                    setTimeout(() => searchInput.focus(), 50);
                }
            }
        }, transitionDuration);
    });
}

// This function is called directly from the onclick attribute in the HTML
window.handleNavClick = function(button) {
    const pageName = button.dataset.page;
    if (pageName) {
        window.showPage(pageName);
    }
}

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }
}

// --- FORMATTERS ---
function formatCurrency(amount) {
    // Use Math.round to avoid floating point issues with decimals
    return Math.round(amount).toLocaleString('id-ID');
}


// --- DASHBOARD ---
function updateDashboardDate() {
    const dateEl = document.getElementById('dashboardDate');
    if (dateEl) {
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = today.toLocaleDateString('id-ID', options);
    }
}

function loadDashboard() {
    // Always update the displayed date string (e.g., "Kamis, 1 Agustus 2024")
    updateDashboardDate();

    console.log('Refreshing dashboard stats.');

    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    
    getAllFromDB('transactions').then(transactions => {
        let todaySales = 0;
        let todayTransactionsCount = 0;
        let monthSales = 0;
        
        transactions.forEach(t => {
            const transactionDate = t.date.split('T')[0];
            if (transactionDate === todayString) {
                todaySales += t.total;
                todayTransactionsCount++;
            }
            if (transactionDate >= monthStart) {
                monthSales += t.total;
            }
        });
        
        (document.getElementById('todaySales')).textContent = `Rp ${formatCurrency(todaySales)}`;
        (document.getElementById('todayTransactions')).textContent = todayTransactionsCount.toString();
        (document.getElementById('monthSales')).textContent = `Rp ${formatCurrency(monthSales)}`;
    });
    
    getAllFromDB('products').then(products => {
        (document.getElementById('totalProducts')).textContent = products.length.toString();
        const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= lowStockThreshold).length;
        const lowStockEl = document.getElementById('lowStockProducts');
        lowStockEl.textContent = lowStockCount.toString();
        lowStockEl.parentElement?.parentElement?.classList.toggle('animate-pulse', lowStockCount > 0);
    });

    getSettingFromDB('storeName').then(value => {
        const storeNameEl = document.getElementById('dashboardStoreName');
        if (storeNameEl) {
            storeNameEl.textContent = value || 'Dasbor';
        }
    });
    getSettingFromDB('storeAddress').then(value => {
        const storeAddressEl = document.getElementById('dashboardStoreAddress');
        if (storeAddressEl) {
            storeAddressEl.textContent = value || 'Pengaturan toko belum diisi';
        }
    });
}

// --- CATEGORY MANAGEMENT ---
async function populateCategoryDropdowns(selectElementIds, selectedValue) {
    try {
        const categories = await getAllFromDB('categories');
        categories.sort((a, b) => a.name.localeCompare(b.name));

        selectElementIds.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;

            const isFilter = id === 'productCategoryFilter';
            
            // Preserve current value if it's a filter and it exists, otherwise reset
            const currentValue = isFilter ? select.value : selectedValue;
            select.innerHTML = ''; // Clear existing options

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
            
             // Restore selected value
            if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
                select.value = currentValue;
            } else if (!isFilter) {
                select.selectedIndex = 0; // Select placeholder
            }
        });
    } catch (error) {
        console.error("Failed to populate categories:", error);
    }
}


window.showManageCategoryModal = async function() {
    (document.getElementById('manageCategoryModal')).classList.remove('hidden');
    await loadCategoriesForManagement();
}

window.closeManageCategoryModal = function() {
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

window.addNewCategory = async function() {
    const input = document.getElementById('newCategoryName');
    const name = input.value.trim();
    if (!name) {
        showToast('Nama kategori tidak boleh kosong');
        return;
    }
    try {
        const newCategory = { name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const addedId = await putToDB('categories', newCategory);
        
        await queueSyncAction('CREATE_CATEGORY', { ...newCategory, id: addedId });
        showToast('Kategori berhasil ditambahkan');
        input.value = '';
        await loadCategoriesForManagement();
        await populateCategoryDropdowns(['productCategory', 'editProductCategory', 'productCategoryFilter']);
    } catch (error) {
        showToast('Gagal menambahkan. Kategori mungkin sudah ada.');
        console.error("Add category error:", error);
    }
}

window.deleteCategory = async function(id, name) {
    const products = await getAllFromDB('products');
    const isUsed = products.some(p => p.category === name);

    if (isUsed) {
        showToast(`Kategori "${name}" tidak dapat dihapus karena sedang digunakan oleh produk.`);
        return;
    }

    window.closeManageCategoryModal();

    showConfirmationModal(
        'Hapus Kategori',
        `Apakah Anda yakin ingin menghapus kategori "${name}"?`,
        async () => {
            const categoryToDelete = await getFromDB('categories', id);
            const transaction = db.transaction(['categories'], 'readwrite');
            const store = transaction.objectStore('categories');
            store.delete(id);
            transaction.oncomplete = async () => {
                await queueSyncAction('DELETE_CATEGORY', categoryToDelete);
                showToast('Kategori berhasil dihapus');
                await populateCategoryDropdowns(['productCategory', 'editProductCategory', 'productCategoryFilter']);
            };
        },
        'Ya, Hapus',
        'bg-red-500'
    );
}


// --- PRODUCT MANAGEMENT ---
function loadProducts() {
    // This function can be used for initial load or background checks
    // The main loading for UI is done by loadProductsGrid and loadProductsList
}

function loadProductsGrid() {
    const grid = document.getElementById('productsGrid');
    getAllFromDB('products').then(products => {
        if (products.length === 0) {
            grid.innerHTML = `
                <div class="col-span-3 empty-state">
                    <div class="empty-state-icon"><i class="fas fa-box-open"></i></div>
                    <h3 class="empty-state-title">Belum Ada Produk</h3>
                    <p class="empty-state-description">Silakan tambahkan produk terlebih dahulu di halaman Produk</p>
                    <button onclick="showPage('produk')" class="empty-state-action">
                        <i class="fas fa-plus mr-2"></i>Tambah Produk
                    </button>
                </div>
            `;
            return;
        }
        grid.innerHTML = products.map(p => {
            const lowStockIndicator = p.stock > 0 && p.stock <= lowStockThreshold ? ` <i class="fas fa-exclamation-triangle text-yellow-500 text-xs" title="Stok Rendah"></i>` : '';
            
            let itemClasses = 'product-item clickable';
            if (p.stock === 0) {
                itemClasses += ' opacity-60 pointer-events-none';
            } else if (p.stock > 0 && p.stock <= lowStockThreshold) {
                itemClasses += ' low-stock-warning';
            }

            const hasDiscount = p.discountPercentage && p.discountPercentage > 0;
            const discountedPrice = hasDiscount ? p.price * (1 - p.discountPercentage / 100) : p.price;

            return `
            <div class="${itemClasses} relative" onclick="addToCart(${p.id})" data-name="${p.name.toLowerCase()}" data-category="${p.category ? p.category.toLowerCase() : ''}" data-barcode="${p.barcode || ''}">
                ${hasDiscount ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full z-10">-${p.discountPercentage}%</span>` : ''}
                ${p.image ? `<img src="${p.image}" alt="${p.name}" class="product-image">` : `<div class="bg-gray-100 rounded-lg p-4 mb-2"><i class="fas fa-box text-3xl text-gray-400"></i></div>`}
                <h3 class="font-semibold text-sm">${p.name}</h3>
                ${hasDiscount
                    ? `<div>
                         <p class="text-xs text-gray-500 line-through">Rp ${formatCurrency(p.price)}</p>
                         <p class="text-blue-500 font-bold">Rp ${formatCurrency(discountedPrice)}</p>
                       </div>`
                    : `<p class="text-blue-500 font-bold">Rp ${formatCurrency(p.price)}</p>`
                }
                <p class="text-xs text-gray-500">Stok: ${p.stock}${lowStockIndicator}</p>
            </div>
        `}).join('');
    });
}

window.loadProductsList = async function() {
    const list = document.getElementById('productsList');
    const filterSelect = document.getElementById('productCategoryFilter');
    
    // Ensure filter is populated before using its value
    await populateCategoryDropdowns(['productCategoryFilter']);
    
    const selectedCategory = filterSelect ? filterSelect.value : 'all';

    getAllFromDB('products').then(products => {
        const filteredProducts = selectedCategory === 'all' 
            ? products 
            : products.filter(p => p.category === selectedCategory);

        if (filteredProducts.length === 0) {
            if (products.length === 0) {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-box-open"></i></div>
                        <h3 class="empty-state-title">Belum Ada Produk</h3>
                        <p class="empty-state-description">Mulai tambahkan produk untuk melihatnya di sini</p>
                        <button onclick="showAddProductModal()" class="empty-state-action">
                            <i class="fas fa-plus mr-2"></i>Tambah Produk Pertama
                        </button>
                    </div>
                `;
            } else {
                list.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-search"></i></div>
                        <h3 class="empty-state-title">Produk Tidak Ditemukan</h3>
                        <p class="empty-state-description">Tidak ada produk dalam kategori "${selectedCategory}"</p>
                    </div>
                `;
            }
            return;
        }
        list.innerHTML = filteredProducts.sort((a, b) => a.name.localeCompare(b.name)).map(p => {
            const profit = p.price - p.purchasePrice;
            const profitMargin = p.purchasePrice > 0 ? ((profit / p.purchasePrice) * 100).toFixed(1) : '&#8734;';
            const lowStockBadge = p.stock > 0 && p.stock <= lowStockThreshold ? '<span class="low-stock-badge">Stok Rendah</span>' : '';
            const outOfStockClass = p.stock === 0 ? 'opacity-60' : '';
            const lowStockClass = p.stock > 0 && p.stock <= lowStockThreshold ? 'low-stock-warning' : '';

            const hasDiscount = p.discountPercentage && p.discountPercentage > 0;
            const discountedPrice = hasDiscount ? p.price * (1 - p.discountPercentage / 100) : p.price;
            const discountBadge = hasDiscount ? `<span class="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">Diskon ${p.discountPercentage}%</span>` : '';

            return `
                <div class="card p-4 ${outOfStockClass} ${lowStockClass}">
                    <div class="flex gap-3">
                        ${p.image ? `<img src="${p.image}" alt="${p.name}" class="product-list-image">` : `<div class="bg-gray-100 rounded-lg p-4 flex items-center justify-center" style="width: 60px; height: 60px;"><i class="fas fa-box text-2xl text-gray-400"></i></div>`}
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
                                        ? `<p class="text-xs text-gray-400 line-through">Rp ${formatCurrency(p.price)}</p>
                                           <p class="text-blue-500 font-bold">Rp ${formatCurrency(discountedPrice)}</p>`
                                        : `<p class="text-blue-500 font-bold">Rp ${formatCurrency(p.price)}</p>`
                                    }
                                    <p class="text-xs text-gray-500">Beli: Rp ${formatCurrency(p.purchasePrice)}</p>
                                </div>
                                <div class="text-right">
                                    <div class="flex justify-end items-center gap-2 mb-1">
                                        ${discountBadge}
                                        ${lowStockBadge}
                                        <span class="profit-badge">+${profitMargin}%</span>
                                    </div>
                                    <div class="flex items-center justify-end gap-1">
                                        <span class="text-sm text-gray-500 mr-1">Stok:</span>
                                        <button onclick="decreaseStock(${p.id})" class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center clickable ${p.stock === 0 ? 'opacity-50 cursor-not-allowed' : ''}" ${p.stock === 0 ? 'disabled' : ''}><i class="fas fa-minus text-xs"></i></button>
                                        <span class="font-semibold text-base w-8 text-center">${p.stock}</span>
                                        <button onclick="increaseStock(${p.id})" class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center clickable"><i class="fas fa-plus text-xs"></i></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    });
}

window.increaseStock = async function(productId) {
    try {
        const product = await getFromDB('products', productId);
        if (!product) {
            showToast('Produk tidak ditemukan.');
            return;
        }

        product.stock += 1;
        product.updatedAt = new Date().toISOString();

        await putToDB('products', product);
        await queueSyncAction('UPDATE_PRODUCT', product);

        // Smart UI refresh
        if (currentPage === 'produk') {
            await window.loadProductsList();
        }
        loadProductsGrid(); // Always refresh cashier grid in case it's the next page
        if (currentPage === 'dashboard') {
            loadDashboard(); // Refresh dashboard stats
        }
    } catch (error) {
        console.error('Failed to increase stock:', error);
        showToast('Gagal memperbarui stok.');
    }
}

window.decreaseStock = async function(productId) {
    try {
        const product = await getFromDB('products', productId);
        if (!product) {
            showToast('Produk tidak ditemukan.');
            return;
        }

        if (product.stock <= 0) {
            return; // Button should be disabled, but this is a safeguard
        }

        product.stock -= 1;
        product.updatedAt = new Date().toISOString();

        await putToDB('products', product);
        await queueSyncAction('UPDATE_PRODUCT', product);

        // Smart UI refresh
        if (currentPage === 'produk') {
            await window.loadProductsList();
        }
        loadProductsGrid(); // Always refresh cashier grid
        if (currentPage === 'dashboard') {
            loadDashboard(); // Refresh dashboard stats
        }
    } catch (error) {
        console.error('Failed to decrease stock:', error);
        showToast('Gagal memperbarui stok.');
    }
}


// Add Product Modal
window.showAddProductModal = function() {
    (document.getElementById('addProductModal')).classList.remove('hidden');
    populateCategoryDropdowns(['productCategory']);
}

window.closeAddProductModal = function() {
    (document.getElementById('addProductModal')).classList.add('hidden');
    (document.getElementById('productName')).value = '';
    (document.getElementById('productPrice')).value = '';
    (document.getElementById('productPurchasePrice')).value = '';
    (document.getElementById('productStock')).value = '';
    (document.getElementById('productBarcode')).value = '';
    (document.getElementById('productCategory')).value = '';
    (document.getElementById('productDiscount')).value = '';
    (document.getElementById('imagePreview')).innerHTML = `<i class="fas fa-camera text-3xl mb-2"></i><p>Tap untuk upload gambar</p>`;
    currentImageData = null;
}

window.previewImage = function(event) {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            currentImageData = e.target?.result;
            (document.getElementById('imagePreview')).innerHTML = `<img src="${currentImageData}" alt="Preview" class="image-preview">`;
        };
        reader.readAsDataURL(file);
    }
}

window.addProduct = async function() {
    const name = (document.getElementById('productName')).value.trim();
    const price = parseFloat((document.getElementById('productPrice')).value);
    const purchasePrice = parseFloat((document.getElementById('productPurchasePrice')).value) || 0;
    const stock = parseInt((document.getElementById('productStock')).value) || 0;
    let barcode = (document.getElementById('productBarcode')).value.trim();
    const category = (document.getElementById('productCategory')).value;
    const discountPercentage = parseFloat((document.getElementById('productDiscount')).value) || 0;
    
    if (!name || isNaN(price) || price <= 0) {
        showToast('Nama dan Harga Jual produk wajib diisi.');
        return;
    }

    if (barcode) {
        const products = await getAllFromDB('products');
        if (products.some(p => p.barcode === barcode)) {
            showToast('Barcode ini sudah digunakan oleh produk lain.');
            return;
        }
    } else {
        barcode = null; // Treat empty string as null for DB uniqueness
    }

    const newProduct = {
        name,
        price,
        purchasePrice,
        stock,
        barcode,
        category,
        discountPercentage,
        image: currentImageData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    try {
        const addedId = await putToDB('products', newProduct);
        await queueSyncAction('CREATE_PRODUCT', { ...newProduct, id: addedId });
        showToast('Produk berhasil ditambahkan');
        closeAddProductModal();
        window.loadProductsList();
        loadProductsGrid();
    } catch (error) {
        console.error('Failed to add product:', error);
        showToast('Gagal menambahkan produk. Cek kembali data Anda.');
    }
}

// Edit Product Modal
window.editProduct = async function(id) {
    try {
        const product = await getFromDB('products', id);
        if (product) {
            (document.getElementById('editProductId')).value = product.id;
            (document.getElementById('editProductName')).value = product.name;
            (document.getElementById('editProductBarcode')).value = product.barcode || '';
            (document.getElementById('editProductPrice')).value = product.price;
            (document.getElementById('editProductPurchasePrice')).value = product.purchasePrice || 0;
            (document.getElementById('editProductStock')).value = product.stock;
            (document.getElementById('editProductDiscount')).value = product.discountPercentage || 0;
            
            await populateCategoryDropdowns(['editProductCategory'], product.category);
            
            currentEditImageData = product.image;
            (document.getElementById('editImagePreview')).innerHTML = product.image 
                ? `<img src="${product.image}" alt="Preview" class="image-preview">`
                : `<i class="fas fa-camera text-3xl mb-2"></i><p>Tap untuk ubah gambar</p>`;
            
            (document.getElementById('editProductModal')).classList.remove('hidden');
        }
    } catch (error) {
        console.error('Failed to fetch product for editing:', error);
        showToast('Gagal memuat data produk.');
    }
}

window.closeEditProductModal = function() {
    (document.getElementById('editProductModal')).classList.add('hidden');
    currentEditImageData = null;
    (document.getElementById('editProductBarcode')).value = '';
}

window.previewEditImage = function(event) {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            currentEditImageData = e.target?.result;
            (document.getElementById('editImagePreview')).innerHTML = `<img src="${currentEditImageData}" alt="Preview" class="image-preview">`;
        };
        reader.readAsDataURL(file);
    }
}

window.updateProduct = async function() {
    const id = parseInt((document.getElementById('editProductId')).value);
    const name = (document.getElementById('editProductName')).value.trim();
    let barcode = (document.getElementById('editProductBarcode')).value.trim();
    const price = parseFloat((document.getElementById('editProductPrice')).value);
    const purchasePrice = parseFloat((document.getElementById('editProductPurchasePrice')).value) || 0;
    const stock = parseInt((document.getElementById('editProductStock')).value) || 0;
    const category = (document.getElementById('editProductCategory')).value;
    const discountPercentage = parseFloat((document.getElementById('editProductDiscount')).value) || 0;
    
    if (!name || isNaN(price) || price <= 0) {
        showToast('Nama dan Harga Jual produk wajib diisi.');
        return;
    }

    if (barcode) {
        const products = await getAllFromDB('products');
        if (products.some(p => p.barcode === barcode && p.id !== id)) {
            showToast('Barcode ini sudah digunakan oleh produk lain.');
            return;
        }
    } else {
        barcode = null; // Treat empty string as null for DB uniqueness
    }
    
    try {
        const product = await getFromDB('products', id);
        if (product) {
            product.name = name;
            product.barcode = barcode;
            product.price = price;
            product.purchasePrice = purchasePrice;
            product.stock = stock;
            product.category = category;
            product.discountPercentage = discountPercentage;
            product.image = currentEditImageData;
            product.updatedAt = new Date().toISOString();
            
            await putToDB('products', product);
            await queueSyncAction('UPDATE_PRODUCT', product);
            showToast('Produk berhasil diperbarui');
            closeEditProductModal();
            window.loadProductsList();
            loadProductsGrid();
        }
    } catch (error) {
        console.error('Failed to update product:', error);
        showToast('Gagal memperbarui produk.');
    }
}

window.deleteProduct = function(id) {
    showConfirmationModal(
        'Hapus Produk',
        'Apakah Anda yakin ingin menghapus produk ini? Tindakan ini tidak dapat dibatalkan.',
        async () => {
            try {
                const productToDelete = await getFromDB('products', id);
                const transaction = db.transaction(['products'], 'readwrite');
                const store = transaction.objectStore('products');
                store.delete(id);
                transaction.oncomplete = async () => {
                    await queueSyncAction('DELETE_PRODUCT', productToDelete);
                    showToast('Produk berhasil dihapus');
                    window.loadProductsList();
                    loadProductsGrid();
                };
            } catch (error) {
                console.error('Failed to delete product:', error);
                showToast('Gagal menghapus produk.');
            }
        },
        'Ya, Hapus',
        'bg-red-500'
    );
}

// --- BARCODE SCANNING ---

function startScanner() {
    if (!isScannerReady || !Html5Qrcode) {
        console.warn('Scanner library not ready.');
        return;
    }
    
    const onScanSuccess = async (decodedText, decodedResult) => {
        if (html5QrCode.isScanning) {
            await html5QrCode.stop();
        }

        if (scanCallback) {
            scanCallback(decodedText);
            return; // Exit after handling the callback
        }

        const products = await getAllFromDB('products');
        const product = products.find(p => p.barcode === decodedText);

        if (product) {
            addToCart(product.id);
            closeScanModal();
        } else {
            showToast(`Produk dengan barcode ${decodedText} tidak ditemukan.`);
            // Optionally restart scanning after a short delay
            setTimeout(() => {
                if (document.getElementById('scanModal').classList.contains('hidden') === false) {
                     html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, (errorMessage) => {});
                }
            }, 2000);
        }
    };
    
    const onScanFailure = (error) => {
        // This callback is called frequently, so keep it lightweight.
    };
    
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, onScanFailure)
      .catch((err) => {
        showToast('Gagal memulai kamera. Pastikan izin telah diberikan.');
        console.error("Failed to start QR code reader:", err);
      });
}

window.showScanModal = function() {
    if (!isScannerReady) {
        showToast('Pemindai barcode gagal dimuat.');
        return;
    }
    (document.getElementById('scanModal')).classList.remove('hidden');
    startScanner();
}

// Function to handle scanning for a specific input field
window.scanBarcodeForInput = function(targetInputId) {
    scanCallback = (decodedText) => {
        const inputEl = document.getElementById(targetInputId);
        if (inputEl) {
            inputEl.value = decodedText;
        }
        closeScanModal();
    };
    showScanModal();
};


window.closeScanModal = async function() {
    const modal = document.getElementById('scanModal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        if (html5QrCode && html5QrCode.isScanning) {
            try {
                await html5QrCode.stop();
            } catch (err) {
                console.error("Error stopping scanner:", err);
            }
        }
    }
    scanCallback = null; // Always reset the callback when the modal closes
}


// --- CART MANAGEMENT ---
async function addToCart(productId) {
    try {
        const product = await getFromDB('products', productId);
        if (!product || product.stock === 0) {
            showToast('Produk habis atau tidak ditemukan.');
            return;
        }

        const existingItem = cart.items.find(item => item.id === productId);
        
        if (existingItem) {
            if (existingItem.quantity < product.stock) {
                existingItem.quantity++;
            } else {
                showToast(`Stok ${product.name} tidak mencukupi.`);
                return;
            }
        } else {
            const hasDiscount = product.discountPercentage && product.discountPercentage > 0;
            const price = hasDiscount ? product.price * (1 - product.discountPercentage / 100) : product.price;

            cart.items.push({ 
                id: product.id, 
                name: product.name, 
                price: product.price, // Original price
                effectivePrice: price, // Price after discount
                discountPercentage: product.discountPercentage || 0,
                quantity: 1, 
                stock: product.stock 
            });
        }
        
        playTone(1200, 0.1, 0.3, 'square');
        showToast(`${product.name} ditambahkan ke keranjang`);
        updateCartFabBadge();
    } catch (error) {
        console.error('Failed to add to cart:', error);
        showToast('Gagal menambahkan produk ke keranjang.');
    }
}
window.addToCart = addToCart;

window.updateCartItemQuantity = function(productId, change) {
    const item = cart.items.find(i => i.id === productId);
    if (item) {
        const newQuantity = item.quantity + change;
        if (newQuantity > 0 && newQuantity <= item.stock) {
            item.quantity = newQuantity;
        } else if (newQuantity > item.stock) {
            showToast(`Stok tidak mencukupi. Sisa ${item.stock}.`);
        } else {
            cart.items = cart.items.filter(i => i.id !== productId);
        }
        updateCartDisplay();
    }
}

function updateCartDisplay() {
    const cartItemsEl = document.getElementById('cartItems');
    const cartSubtotalEl = document.getElementById('cartSubtotal');
    const cartTotalEl = document.getElementById('cartTotal');
    const cartFeesEl = document.getElementById('cartFees');
    const paymentButton = document.querySelector('#cartSection button[onclick="showPaymentModal()"]');
    
    if (cart.items.length === 0) {
        cartItemsEl.innerHTML = `<p class="text-gray-500 text-center py-4">Keranjang kosong</p>`;
        paymentButton.disabled = true;
        paymentButton.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        cartItemsEl.innerHTML = cart.items.map(item => `
            <div class="cart-item flex items-center justify-between">
                <div>
                    <p class="font-semibold">${item.name}</p>
                    <p class="text-sm text-gray-600">Rp ${formatCurrency(item.effectivePrice)}</p>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="updateCartItemQuantity(${item.id}, -1)" class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center clickable"><i class="fas fa-minus text-xs"></i></button>
                    <span>${item.quantity}</span>
                    <button onclick="updateCartItemQuantity(${item.id}, 1)" class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center clickable"><i class="fas fa-plus text-xs"></i></button>
                </div>
            </div>
        `).join('');
        paymentButton.disabled = false;
        paymentButton.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    const subtotal = cart.items.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
    
    let totalFees = 0;
    cartFeesEl.innerHTML = '';
    cart.fees.forEach(fee => {
        let feeAmount = 0;
        if (fee.type === 'percentage') {
            feeAmount = subtotal * (fee.value / 100);
        } else {
            feeAmount = fee.value;
        }
        totalFees += feeAmount;
        
        const feeElement = document.createElement('div');
        feeElement.className = 'flex justify-between';
        feeElement.innerHTML = `
            <span>${fee.name} (${fee.type === 'percentage' ? `${fee.value}%` : `Rp ${formatCurrency(fee.value)}`}):</span>
            <span>Rp ${formatCurrency(feeAmount)}</span>
        `;
        cartFeesEl.appendChild(feeElement);
    });
    
    const total = subtotal + totalFees;

    cartSubtotalEl.textContent = `Rp ${formatCurrency(subtotal)}`;
    cartTotalEl.textContent = `Rp ${formatCurrency(total)}`;
    updateCartFabBadge();
}

window.clearCart = function() {
    if (cart.items.length === 0) return;
    showConfirmationModal('Kosongkan Keranjang', 'Apakah Anda yakin ingin mengosongkan keranjang?', () => {
        cart.items = [];
        applyDefaultFees(); // Re-apply default fees which will be 0 on an empty cart
        updateCartDisplay();
        showToast('Keranjang dikosongkan.');
    });
}

// --- TAXES & FEES ---
async function addFee() {
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
window.addFee = addFee;

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


async function deleteFee(id) {
    showConfirmationModal('Hapus Biaya', 'Yakin ingin menghapus biaya ini?', async () => {
         try {
            const feeToDelete = await getFromDB('fees', id);
            const tx = db.transaction('fees', 'readwrite');
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
window.deleteFee = deleteFee;


window.showFeeSelectionModal = async function() {
    const feeSelectionList = document.getElementById('feeSelectionList');
    const fees = await getAllFromDB('fees');
    
    if (fees.length === 0) {
        feeSelectionList.innerHTML = '<p class="text-gray-500 text-center py-4">Tidak ada pajak atau biaya yang dapat dipilih. Tambahkan terlebih dahulu di halaman Pengaturan.</p>';
    } else {
        feeSelectionList.innerHTML = fees.map(fee => {
            const isChecked = cart.fees.some(cartFee => cartFee.id === fee.id);
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

window.closeFeeSelectionModal = function() {
    (document.getElementById('feeSelectionModal')).classList.add('hidden');
}

window.applySelectedFees = async function() {
    const checkboxes = document.querySelectorAll('#feeSelectionList input[type="checkbox"]');
    const allFees = await getAllFromDB('fees');
    
    const selectedFeeIds = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => parseInt(cb.dataset.feeId));

    cart.fees = allFees.filter(fee => selectedFeeIds.includes(fee.id));
    
    updateCartDisplay();
    closeFeeSelectionModal();
    showToast('Pajak & biaya berhasil diperbarui.');
}


async function applyDefaultFees() {
    const allFees = await getAllFromDB('fees');
    cart.fees = allFees.filter(fee => fee.isDefault);
}

/**
 * Synchronizes the cart's fees with the master list in the database.
 * This ensures deletions, edits, and new default fees from settings are reflected.
 */
async function reconcileCartFees() {
    const allFees = await getAllFromDB('fees');
    const allFeesMap = new Map(allFees.map(f => [f.id, f]));

    // Create the new list of fees for the cart
    const reconciledFees = [];
    const addedFeeIds = new Set();

    // 1. Add all current, valid cart fees first, using the latest data from the DB.
    // This preserves manually selected fees.
    cart.fees.forEach(cartFee => {
        if (allFeesMap.has(cartFee.id)) {
            reconciledFees.push(allFeesMap.get(cartFee.id));
            addedFeeIds.add(cartFee.id);
        }
    });

    // 2. Now, add any default fees from the DB that were not already in the cart.
    allFees.forEach(dbFee => {
        if (dbFee.isDefault && !addedFeeIds.has(dbFee.id)) {
            reconciledFees.push(dbFee);
            addedFeeIds.add(dbFee.id);
        }
    });
    
    // 3. Update the global cart state.
    cart.fees = reconciledFees;
}

// --- CHECKOUT PROCESS ---
window.showPaymentModal = function() {
    if (cart.items.length === 0) {
        showToast('Keranjang kosong. Tidak dapat melakukan pembayaran.');
        return;
    }
    const total = cart.items.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
    const subtotal = cart.items.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
    let totalFees = 0;
    cart.fees.forEach(fee => {
        totalFees += fee.type === 'percentage' ? subtotal * (fee.value / 100) : fee.value;
    });
    const finalTotal = subtotal + totalFees;

    (document.getElementById('paymentTotal')).textContent = `Rp ${formatCurrency(finalTotal)}`;
    (document.getElementById('paymentModal')).classList.remove('hidden');
    
    const cashInput = document.getElementById('cashPaidInput');
    cashInput.value = ''; // Clear previous value
    
    // Reset change display
    const changeEl = document.getElementById('paymentChange');
    const changeLabelEl = document.getElementById('paymentChangeLabel');
    const completeButton = document.getElementById('completeTransactionButton');

    changeEl.textContent = 'Rp 0';
    changeLabelEl.textContent = 'Kembalian:';
    changeEl.classList.remove('text-red-500', 'text-green-500');
    completeButton.disabled = true;
    completeButton.classList.add('disabled:bg-blue-300');

    cashInput.focus();
}

window.closePaymentModal = function() {
    (document.getElementById('paymentModal')).classList.add('hidden');
}

window.handleQuickCash = function(amount) {
    const cashInput = document.getElementById('cashPaidInput');
    cashInput.value = amount;
    cashInput.dispatchEvent(new Event('input')); // Trigger input event to update change
}

document.getElementById('cashPaidInput')?.addEventListener('input', (e) => {
    const cashPaidValue = e.target.value;
    const subtotal = cart.items.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
    let totalFees = 0;
    cart.fees.forEach(fee => {
        totalFees += fee.type === 'percentage' ? subtotal * (fee.value / 100) : fee.value;
    });
    const total = subtotal + totalFees;

    const changeEl = document.getElementById('paymentChange');
    const changeLabelEl = document.getElementById('paymentChangeLabel');
    const completeButton = document.getElementById('completeTransactionButton');

    if (cashPaidValue.trim() === '') {
        changeEl.textContent = 'Rp 0';
        changeLabelEl.textContent = 'Kembalian:';
        changeEl.classList.remove('text-red-500', 'text-green-500');
        completeButton.disabled = true;
        completeButton.classList.add('disabled:bg-blue-300');
        return;
    }

    const cashPaid = parseFloat(cashPaidValue) || 0;
    const change = cashPaid - total;
    
    if (change >= 0) {
        changeEl.textContent = `Rp ${formatCurrency(change)}`;
        changeEl.classList.remove('text-red-500');
        changeEl.classList.add('text-green-500');
        changeLabelEl.textContent = 'Kembalian:';
        completeButton.disabled = false;
        completeButton.classList.remove('disabled:bg-blue-300');
    } else {
        changeEl.textContent = `Rp ${formatCurrency(Math.abs(change))}`;
        changeEl.classList.add('text-red-500');
        changeEl.classList.remove('text-green-500');
        changeLabelEl.textContent = 'Kurang:';
        completeButton.disabled = true;
        completeButton.classList.add('disabled:bg-blue-300');
    }
});


window.completeTransaction = async function() {
    const button = document.getElementById('completeTransactionButton');
    const buttonText = button.querySelector('.payment-button-text');
    const spinner = button.querySelector('.payment-button-spinner');

    button.disabled = true;
    buttonText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const cashPaid = parseFloat(document.getElementById('cashPaidInput').value) || 0;
        const subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalDiscount = cart.items.reduce((sum, item) => {
             const discountAmount = item.price * (item.discountPercentage / 100);
             return sum + (discountAmount * item.quantity);
        }, 0);

        let calculatedFees = [];
        let totalFeeAmount = 0;
        const subtotalAfterDiscount = subtotal - totalDiscount;

        cart.fees.forEach(fee => {
            const feeAmount = fee.type === 'percentage' 
                ? subtotalAfterDiscount * (fee.value / 100) 
                : fee.value;
            calculatedFees.push({ ...fee, amount: feeAmount });
            totalFeeAmount += feeAmount;
        });

        const total = subtotalAfterDiscount + totalFeeAmount;
        const change = cashPaid - total;

        const transaction = {
            items: cart.items.map(item => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                effectivePrice: item.effectivePrice,
                discountPercentage: item.discountPercentage,
            })),
            subtotal: subtotal,
            totalDiscount: totalDiscount,
            fees: calculatedFees,
            total: total,
            cashPaid: cashPaid,
            change: change,
            date: new Date().toISOString()
        };

        const addedId = await putToDB('transactions', transaction);
        await queueSyncAction('CREATE_TRANSACTION', { ...transaction, id: addedId });

        // Update stock
        for (const item of cart.items) {
            const product = await getFromDB('products', item.id);
            if (product) {
                product.stock -= item.quantity;
                product.updatedAt = new Date().toISOString();
                await putToDB('products', product);
                await queueSyncAction('UPDATE_PRODUCT', product);
            }
        }
        
        currentReceiptTransaction = { ...transaction, id: addedId };

        showReceiptModal();
        
    } catch (error) {
        console.error("Transaction failed:", error);
        showToast('Transaksi gagal. Silakan coba lagi.');
    } finally {
        button.disabled = false;
        buttonText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
}

function showReceiptModal() {
    closePaymentModal();
    hideCartModal();
    (document.getElementById('receiptModal')).classList.remove('hidden');
    generateReceiptContent(currentReceiptTransaction);
    
    const actionButton = document.getElementById('receiptActionButton');
    actionButton.textContent = 'Transaksi Baru';
    actionButton.onclick = startNewTransaction;

    // Auto print if enabled
    getSettingFromDB('autoPrintReceipt').then(autoPrint => {
        if (autoPrint && isPrinterReady) {
            printReceipt(true);
        }
    });
}

function startNewTransaction() {
    (document.getElementById('receiptModal')).classList.add('hidden');
    cart = { items: [], fees: [] };
    applyDefaultFees();
    updateCartDisplay();
    loadProductsGrid(); // Refresh grid for stock updates
    if(currentPage === 'dashboard') loadDashboard();
    currentReceiptTransaction = null;
    showToast('Siap untuk transaksi berikutnya.');
}
window.startNewTransaction = startNewTransaction;


// --- SETTINGS ---
async function saveStoreSettings() {
    const settings = [
        { key: 'storeName', value: (document.getElementById('storeName')).value.trim() },
        { key: 'storeAddress', value: (document.getElementById('storeAddress')).value.trim() },
        { key: 'storeFeedbackPhone', value: (document.getElementById('storeFeedbackPhone')).value.trim() },
        { key: 'storeFooterText', value: (document.getElementById('storeFooterText')).value.trim() },
        { key: 'storeLogo', value: currentStoreLogoData },
        { key: 'showLogoOnReceipt', value: document.getElementById('showLogoOnReceipt').checked },
        { key: 'lowStockThreshold', value: parseInt((document.getElementById('lowStockThreshold')).value) || 5 },
        { key: 'autoPrintReceipt', value: document.getElementById('autoPrintReceipt').checked },
        { key: 'printerPaperSize', value: document.getElementById('printerPaperSize').value }
    ];

    try {
        const transaction = db.transaction('settings', 'readwrite');
        const store = transaction.objectStore('settings');
        settings.forEach(setting => store.put(setting));
        
        transaction.oncomplete = () => {
            lowStockThreshold = settings.find(s => s.key === 'lowStockThreshold').value;
            showToast('Pengaturan berhasil disimpan');
            loadDashboard(); // Refresh dashboard with new store name/address
        };
    } catch(error) {
        console.error("Failed to save settings:", error);
        showToast("Gagal menyimpan pengaturan.");
    }
}
window.saveStoreSettings = saveStoreSettings;


async function loadSettings() {
    try {
        const settings = await getAllFromDB('settings');
        const settingsMap = new Map(settings.map(s => [s.key, s.value]));

        (document.getElementById('storeName')).value = settingsMap.get('storeName') || '';
        (document.getElementById('storeAddress')).value = settingsMap.get('storeAddress') || '';
        (document.getElementById('storeFeedbackPhone')).value = settingsMap.get('storeFeedbackPhone') || '';
        (document.getElementById('storeFooterText')).value = settingsMap.get('storeFooterText') || '';
        (document.getElementById('lowStockThreshold')).value = settingsMap.get('lowStockThreshold') || 5;
        document.getElementById('autoPrintReceipt').checked = settingsMap.get('autoPrintReceipt') || false;
        // Default to true if the setting doesn't exist yet
        document.getElementById('showLogoOnReceipt').checked = settingsMap.get('showLogoOnReceipt') !== false;
        document.getElementById('printerPaperSize').value = settingsMap.get('printerPaperSize') || '80mm';

        // Set Kiosk Mode toggle state
        const kioskToggle = document.getElementById('kioskModeToggle');
        if (kioskToggle) {
            kioskToggle.checked = settingsMap.get('kioskModeEnabled') || false;
        }

        lowStockThreshold = settingsMap.get('lowStockThreshold') || 5;
        
        currentStoreLogoData = settingsMap.get('storeLogo') || null;
        if (currentStoreLogoData) {
            (document.getElementById('storeLogoPreview')).innerHTML = `<img src="${currentStoreLogoData}" alt="Logo Preview" class="image-preview">`;
        }

        loadLicenseInfo();
    } catch (error) {
        console.error("Failed to load settings:", error);
    }
}

window.previewStoreLogo = function(event) {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            currentStoreLogoData = e.target?.result;
            (document.getElementById('storeLogoPreview')).innerHTML = `<img src="${currentStoreLogoData}" alt="Logo Preview" class="image-preview">`;
        };
        reader.readAsDataURL(file);
    }
}

// --- DATA MANAGEMENT ---
async function exportData() {
    try {
        const products = await getAllFromDB('products');
        const transactions = await getAllFromDB('transactions');
        const settings = await getAllFromDB('settings');
        const categories = await getAllFromDB('categories');
        const fees = await getAllFromDB('fees');
        
        const data = {
            products,
            transactions,
            settings,
            categories,
            fees,
            exportDate: new Date().toISOString()
        };
        
        const fileContent = JSON.stringify(data, null, 2);
        const date = new Date().toISOString().split('T')[0];
        const fileName = `pos_backup_${date}.json`;

        // Cek apakah interface Android ada
        if (window.AndroidDownloader) {
            // Panggil fungsi Java
            window.AndroidDownloader.downloadFile(fileContent, fileName, 'application/json');
            showConfirmationModal(
                '<div class="flex items-center justify-center"><i class="fas fa-save text-blue-500 mr-3 text-xl"></i><span>Menyimpan File</span></div>',
                'Silakan pilih lokasi untuk menyimpan file backup Anda.',
                () => {},
                'Mengerti',
                'bg-blue-500'
            );
        } else {
            // Fallback untuk browser biasa
            const blob = new Blob([fileContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showConfirmationModal(
                '<div class="flex items-center justify-center"><i class="fas fa-check-circle text-green-500 mr-3 text-xl"></i><span>Export Berhasil</span></div>',
                'File backup data Anda (.json) telah berhasil di-download dan biasanya tersimpan di folder <strong>\'Downloads\'</strong> atau <strong>\'Unduhan\'</strong> pada perangkat Anda.',
                () => {},
                'Mengerti',
                'bg-blue-500'
            );
        }
    } catch (error) {
        console.error('Export failed:', error);
        showToast('Gagal mengexport data.');
    }
}
window.exportData = exportData;


window.importData = function() {
    (document.getElementById('importFile')).click();
}

window.handleImport = function(event) {
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
                        await clearAllStores();
                        const transaction = db.transaction(['products', 'transactions', 'settings', 'categories', 'fees'], 'readwrite');
                        
                        if (data.products) transaction.objectStore('products').clear();
                        if (data.transactions) transaction.objectStore('transactions').clear();
                        if (data.settings) transaction.objectStore('settings').clear();
                        if (data.categories) transaction.objectStore('categories').clear();
                        if (data.fees) transaction.objectStore('fees').clear();

                        if (data.products) data.products.forEach(p => transaction.objectStore('products').put(p));
                        if (data.transactions) data.transactions.forEach(t => transaction.objectStore('transactions').put(t));
                        if (data.settings) data.settings.forEach(s => transaction.objectStore('settings').put(s));
                        if (data.categories) data.categories.forEach(c => transaction.objectStore('categories').put(c));
                        if (data.fees) data.fees.forEach(f => transaction.objectStore('fees').put(f));
                        
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

async function clearAllStores() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject('Database not initialized');
            return;
        }
        const transaction = db.transaction(db.objectStoreNames, 'readwrite');
        Array.from(db.objectStoreNames).forEach(storeName => {
            transaction.objectStore(storeName).clear();
        });
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
    });
}

window.clearAllData = function() {
    showConfirmationModal(
        'Hapus Semua Data',
        'PERINGATAN: Ini akan menghapus LISENSI ANDA, semua produk, transaksi, dan pengaturan secara permanen. Tindakan ini tidak dapat dibatalkan. Aplikasi akan kembali seperti semula. Apakah Anda benar-benar yakin?',
        async () => {
            await clearAllStores();
            showToast('Semua data berhasil dihapus. Aplikasi akan dimuat ulang.');
            setTimeout(() => location.reload(), 2000);
        },
        'Ya, Hapus Semua',
        'bg-red-500'
    );
}

// --- MODALS ---
function showConfirmationModal(title, message, onConfirm, confirmText = 'OK', confirmClass = 'bg-blue-500') {
    document.getElementById('confirmationTitle').innerHTML = title;
    document.getElementById('confirmationMessage').innerHTML = message;
    
    const confirmButton = document.getElementById('confirmButton');
    const cancelButton = document.getElementById('cancelButton');
    
    confirmButton.textContent = confirmText;
    
    // A simple info modal will have an empty function as its callback.
    const isInfoModal = onConfirm && onConfirm.toString() === '() => {}';

    if (isInfoModal) {
        cancelButton.classList.add('hidden');
        confirmButton.className = `btn text-white w-full py-2 ${confirmClass}`;
    } else {
        cancelButton.classList.remove('hidden');
        confirmButton.className = `btn text-white flex-1 py-2 ${confirmClass}`;
        cancelButton.className = 'btn bg-gray-300 text-gray-700 flex-1 py-2';
    }

    confirmCallback = onConfirm;
    document.getElementById('confirmationModal').classList.remove('hidden');
}

function closeConfirmationModal() {
    (document.getElementById('confirmationModal')).classList.add('hidden');
    confirmCallback = null;
}

// --- REPORTS ---
window.generateReport = async function() {
    const dateFrom = (document.getElementById('dateFrom')).value;
    const dateTo = (document.getElementById('dateTo')).value;
    
    if (!dateFrom || !dateTo) {
        showToast('Silakan pilih rentang tanggal.');
        return;
    }
    
    const transactions = await getAllFromDB('transactions');
    const products = await getAllFromDB('products'); // Get all products for cost calculation
    
    const filteredTransactions = transactions.filter(t => {
        const date = t.date.split('T')[0];
        return date >= dateFrom && date <= dateTo;
    });
    
    currentReportData = filteredTransactions;

    if (filteredTransactions.length === 0) {
        showToast('Tidak ada transaksi ditemukan pada rentang tanggal tersebut.');
        document.getElementById('reportSummary').style.display = 'none';
        document.getElementById('reportDetails').style.display = 'none';
        document.getElementById('topSellingProductsCard').style.display = 'none';
        document.getElementById('salesChartCard').style.display = 'none';
        return;
    }

    displayReportSummary(filteredTransactions, products);
    displayReportDetails(filteredTransactions);
    displayTopSellingProducts(filteredTransactions);
    displaySalesReport(filteredTransactions, 'daily');

    document.getElementById('reportSummary').style.display = 'block';
    document.getElementById('reportDetails').style.display = 'block';
    document.getElementById('topSellingProductsCard').style.display = 'block';
    document.getElementById('salesChartCard').style.display = 'block';

}

function displayReportSummary(transactions, products) {
    // Create a lookup map for product costs for efficiency
    const productMap = new Map(products.map(p => [p.id, p]));

    let omzet = 0;
    let hpp = 0;
    let totalOperationalCost = 0;

    transactions.forEach(t => {
        const subtotalAfterDiscount = t.subtotal - (t.totalDiscount || 0);
        omzet += subtotalAfterDiscount;

        // Calculate HPP (COGS) for this transaction
        t.items.forEach(item => {
            const product = productMap.get(item.id);
            // Use current purchasePrice. If product was deleted, its cost is 0.
            const purchasePrice = product ? (product.purchasePrice || 0) : 0;
            hpp += purchasePrice * item.quantity;
        });
        
        // Calculate total fees for this transaction
        (t.fees || []).forEach(fee => {
            totalOperationalCost += fee.amount;
        });
    });

    const grossProfit = omzet - hpp;
    const netProfit = grossProfit - totalOperationalCost;
    const cashFlow = grossProfit; // In this cash-based system, operational cash flow is best represented by gross profit.
    const totalTransactions = transactions.length;
    const average = totalTransactions > 0 ? omzet / totalTransactions : 0;

    // Update DOM elements
    (document.getElementById('reportOmzet')).textContent = `Rp ${formatCurrency(omzet)}`;
    (document.getElementById('reportHpp')).textContent = `Rp ${formatCurrency(hpp)}`;
    (document.getElementById('reportGrossProfit')).textContent = `Rp ${formatCurrency(grossProfit)}`;
    (document.getElementById('reportOperationalCost')).textContent = `Rp ${formatCurrency(totalOperationalCost)}`;
    (document.getElementById('reportNetProfit')).textContent = `Rp ${formatCurrency(netProfit)}`;
    (document.getElementById('reportCashFlow')).textContent = `Rp ${formatCurrency(cashFlow)}`;
    (document.getElementById('reportTotalTransactions')).textContent = totalTransactions.toString();
    (document.getElementById('reportAverage')).textContent = `Rp ${formatCurrency(average)}`;
}

function displayReportDetails(transactions) {
    const detailsEl = document.getElementById('reportTransactions');
    detailsEl.innerHTML = transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).map(t => {
        const date = new Date(t.date);
        const formattedDate = `${date.toLocaleDateString('id-ID')} ${date.toLocaleTimeString('id-ID')}`;
        return `
            <div class="border-t pt-2 mt-2">
                <div class="flex justify-between text-sm">
                    <span>${formattedDate}</span>
                    <span class="font-semibold">Rp ${formatCurrency(t.total)}</span>
                </div>
                <ul class="text-xs text-gray-600 pl-4 mt-1 space-y-1">
                    ${t.items.map((item, index) => `
                        <li class="flex justify-between items-center">
                            <span>${item.quantity}x ${item.name} &mdash; Rp ${formatCurrency(item.effectivePrice * item.quantity)}</span>
                            <button onclick="returnItem(${t.id}, ${index})" title="Kembalikan item ini" class="text-red-500 hover:text-red-700 clickable text-sm w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-100 transition-colors">
                                <i class="fas fa-undo"></i>
                            </button>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }).join('');
}

/**
 * Handles the click on the return item button in the report details.
 * @param {number} transactionId - The ID of the transaction.
 * @param {number} itemIndex - The index of the item in the transaction's items array.
 */
window.returnItem = async function(transactionId, itemIndex) {
    try {
        const transaction = await getFromDB('transactions', transactionId);
        if (!transaction || !transaction.items[itemIndex]) {
            showToast('Item atau transaksi tidak ditemukan.');
            return;
        }

        const item = transaction.items[itemIndex];

        showConfirmationModal(
            'Konfirmasi Pengembalian',
            `Anda yakin ingin mengembalikan <strong>${item.quantity}x ${item.name}</strong> senilai <strong>Rp ${formatCurrency(item.effectivePrice * item.quantity)}</strong>? Stok produk akan dikembalikan dan laporan akan diperbarui.`,
            async () => {
                await processItemReturn(transactionId, itemIndex);
            },
            'Ya, Kembalikan',
            'bg-red-500'
        );
    } catch (error) {
        console.error('Error preparing item return:', error);
        showToast('Gagal memproses pengembalian.');
    }
}

/**
 * Processes the actual return logic after user confirmation.
 * @param {number} transactionId - The ID of the transaction to modify.
 * @param {number} itemIndex - The index of the item to return.
 */
async function processItemReturn(transactionId, itemIndex) {
    try {
        const originalTransaction = await getFromDB('transactions', transactionId);
        // Deep clone for safe manipulation and for the sync queue payload
        const transaction = JSON.parse(JSON.stringify(originalTransaction));

        if (!transaction || !transaction.items[itemIndex]) {
            showToast('Transaksi tidak valid saat proses.');
            return;
        }

        // 1. Remove item from transaction and get its details
        const [returnedItem] = transaction.items.splice(itemIndex, 1);
        if (!returnedItem) {
             showToast('Item tidak ditemukan dalam transaksi.');
             return;
        }
        
        // 2. If this was the last item, delete the entire transaction. Otherwise, update it.
        if (transaction.items.length === 0) {
             const tx = db.transaction('transactions', 'readwrite');
             tx.objectStore('transactions').delete(transactionId);
             await new Promise(resolve => tx.oncomplete = resolve);
             await queueSyncAction('DELETE_TRANSACTION', originalTransaction);
        } else {
            // 3. Recalculate all transaction financials
            transaction.subtotal = transaction.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            transaction.totalDiscount = transaction.items.reduce((sum, item) => {
                const discountAmount = item.price * ((item.discountPercentage || 0) / 100);
                return sum + (discountAmount * item.quantity);
            }, 0);
            
            const subtotalAfterDiscount = transaction.subtotal - transaction.totalDiscount;
            let totalFeeAmount = 0;

            (transaction.fees || []).forEach(fee => {
                if (fee.type === 'percentage') {
                    fee.amount = subtotalAfterDiscount * (fee.value / 100);
                }
                totalFeeAmount += fee.amount;
            });
            
            transaction.total = subtotalAfterDiscount + totalFeeAmount;
            transaction.change = transaction.cashPaid - transaction.total;
            
            await putToDB('transactions', transaction);
            await queueSyncAction('UPDATE_TRANSACTION', transaction);
        }

        // 4. Adjust the product's stock
        const product = await getFromDB('products', returnedItem.id);
        if (product) {
            product.stock += returnedItem.quantity;
            product.updatedAt = new Date().toISOString();
            await putToDB('products', product);
            await queueSyncAction('UPDATE_PRODUCT', product);
        }

        // 5. Refresh the report UI and notify the user
        showToast('Item berhasil dikembalikan.');
        await generateReport();

    } catch (error) {
        console.error('Failed to process item return:', error);
        showToast('Terjadi kesalahan saat mengembalikan item.');
    }
}


function displayTopSellingProducts(transactions) {
    const productSales = {};

    transactions.forEach(t => {
        t.items.forEach(item => {
            if (!productSales[item.name]) {
                productSales[item.name] = { quantity: 0, revenue: 0 };
            }
            productSales[item.name].quantity += item.quantity;
            productSales[item.name].revenue += item.effectivePrice * item.quantity;
        });
    });

    const sortedProducts = Object.entries(productSales)
        .sort(([,a], [,b]) => b.quantity - a.quantity)
        .slice(0, 5);
    
    const listEl = document.getElementById('topSellingProductsList');
    if (sortedProducts.length === 0) {
        listEl.innerHTML = `<p class="text-gray-500 text-center py-2">Tidak ada produk terjual.</p>`;
        return;
    }

    listEl.innerHTML = sortedProducts.map(([name, data], index) => `
        <div class="flex justify-between items-center text-sm">
            <span>${index + 1}. ${name}</span>
            <div class="text-right">
                <span class="font-semibold">${data.quantity} terjual</span>
                <p class="text-xs text-gray-500">Rp ${formatCurrency(data.revenue)}</p>
            </div>
        </div>
    `).join('');
}


function displaySalesReport(transactions, viewType) {
    if (!isChartJsReady || !Chart) {
        document.getElementById('salesChartCard').innerHTML = `<p class="text-center text-red-500">Grafik tidak dapat dimuat.</p>`;
        return;
    }
    
    const salesData = {};
    const getWeekStartDate = (d) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
        return new Date(date.setDate(diff)).toISOString().split('T')[0];
    };

    transactions.forEach(t => {
        const date = t.date.split('T')[0];
        const key = viewType === 'daily' ? date : getWeekStartDate(date);
        if (!salesData[key]) {
            salesData[key] = 0;
        }
        salesData[key] += t.total;
    });

    const sortedKeys = Object.keys(salesData).sort();
    const labels = sortedKeys.map(key => {
        const d = new Date(key);
        return viewType === 'daily'
            ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
            : `Minggu ${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
    });
    const data = sortedKeys.map(key => salesData[key]);

    const ctx = document.getElementById('salesChart').getContext('2d');
    if (salesChartInstance) {
        salesChartInstance.destroy();
    }
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Penjualan',
                data: data,
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderColor: 'rgba(59, 130, 246, 1)',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'Rp ' + formatCurrency(value);
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += 'Rp ' + formatCurrency(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// --- PWA INSTALL PROMPT ---
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredInstallPrompt = e;
    // Update UI to notify the user they can install the PWA
    showInstallPrompt();
});

function showInstallPrompt() {
    const installModal = document.getElementById('installModal');
    if (installModal) {
        installModal.classList.remove('hidden');
    }
}

async function handleInstall() {
    const installModal = document.getElementById('installModal');
    if (installModal) {
        installModal.classList.add('hidden');
    }
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredInstallPrompt = null;
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loadingOverlay');
    try {
        await initDB();
        
        // Check for license after DB is ready
        const licenseOk = await checkLicense();
        if (!licenseOk) {
            // License check will handle showing the overlay
            loadingOverlay.classList.add('opacity-0');
            setTimeout(() => loadingOverlay.classList.add('hidden'), 300);
            return; // Stop further initialization
        }

        // Setup event listeners
        document.getElementById('confirmButton').addEventListener('click', () => {
            if (confirmCallback) {
                confirmCallback();
            }
            closeConfirmationModal();
        });
        document.getElementById('cancelButton').addEventListener('click', closeConfirmationModal);
        
        const searchProductInput = document.getElementById('searchProduct');
        if (searchProductInput) {
            searchProductInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const products = document.querySelectorAll('#productsGrid .product-item');
                products.forEach(product => {
                    const name = product.dataset.name || '';
                    const barcode = product.dataset.barcode || '';
                    const isVisible = name.includes(searchTerm) || barcode.includes(searchTerm);
                    product.style.display = isVisible ? 'block' : 'none';
                });
            });
        }
        
        window.addEventListener('online', checkOnlineStatus);
        window.addEventListener('offline', checkOnlineStatus);
        
        // Load initial data
        loadDashboard();
        await applyDefaultFees(); // Load default fees into the initial cart state
        updateCartDisplay();
        
        // Initialize scanner if library loaded
        if (typeof Html5Qrcode !== 'undefined') {
            html5QrCode = new Html5Qrcode("qr-reader");
            isScannerReady = true;
        } else {
            console.warn("Html5Qrcode library not loaded.");
            isScannerReady = false;
        }

        if (typeof EscPosEncoder !== 'undefined') {
            isPrinterReady = true;
        } else {
             console.warn("EscPosEncoder library not loaded.");
            isPrinterReady = false;
        }
        
        if (typeof Chart !== 'undefined') {
            isChartJsReady = true;
        } else {
            console.warn("Chart.js library not loaded.");
            isChartJsReady = false;
        }
        
        // PWA install button listener
        document.getElementById('installAppBtn').addEventListener('click', handleInstall);
        document.getElementById('closeInstallBtn').addEventListener('click', () => {
            document.getElementById('installModal').classList.add('hidden');
        });


        // Hide loading overlay and show app
        loadingOverlay.classList.add('opacity-0');
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            document.getElementById('appContainer').classList.remove('hidden');
        }, 300);

        // First time user interaction to initialize audio context
        document.body.addEventListener('click', initAudioContext, { once: true });

        updateFeatureAvailability();
        checkOnlineStatus(); // Initial check
        
    } catch (error) {
        console.error("Initialization failed:", error);
        loadingOverlay.innerHTML = `<p class="text-red-500">Gagal memuat aplikasi. Silakan coba lagi.</p>`;
    }
});

/**
 * Checks if a valid, device-specific license key is stored.
 * If not, it displays the license activation overlay.
 * @returns {Promise<boolean>} - True if the app is licensed, false otherwise.
 */
async function checkLicense() {
    const storedKey = await getSettingFromDB('licenseKey');
    const licenseOverlay = document.getElementById('licenseOverlay');
    const deviceIdEl = document.getElementById('licenseDeviceId');

    // Always generate and display the device ID
    if (!deviceId) {
       deviceId = await generateDeviceId();
    }
    if(deviceIdEl) {
        deviceIdEl.textContent = deviceId;
        deviceIdEl.addEventListener('click', () => {
            navigator.clipboard.writeText(deviceId);
            showToast('Device ID disalin!');
        });
    }

    if (!storedKey) {
        console.log("No license key found. Locking app.");
        licenseOverlay.classList.remove('hidden');
        return false;
    }

    // A key is stored, now we must VALIDATE it against the current device
    try {
        const decoded = atob(storedKey);
        const [keyDeviceId, salt] = decoded.split('::');
        
        if (keyDeviceId === deviceId && salt === LICENSE_SECRET_SALT) {
            console.log("License key found and validated. App unlocked.");
            return true; // The key is valid for this device
        } else {
            console.warn("Stored license key is invalid for this device. Locking app.");
            licenseOverlay.classList.remove('hidden');
            showToast('Kunci lisensi yang tersimpan tidak cocok untuk perangkat ini.', 4000);
            return false;
        }
    } catch (e) {
        console.error("Corrupt or old format license key found. Locking app.");
        licenseOverlay.classList.remove('hidden');
        showToast('Format lisensi tidak valid, silakan aktivasi dengan kunci baru.', 4000);
        return false;
    }
}

/**
 * Validates the entered license key against the device ID and activates the app if valid.
 */
async function activateLicense() {
    const keyInput = document.getElementById('licenseKeyInput');
    const licenseKey = keyInput.value.trim();
    
    if (!licenseKey) {
        showToast('Kunci lisensi tidak boleh kosong.');
        return;
    }

    // The validation logic now checks if the key was generated for THIS specific device.
    try {
        const decoded = atob(licenseKey);
        const [keyDeviceId, salt] = decoded.split('::');

        if (keyDeviceId === deviceId && salt === LICENSE_SECRET_SALT) {
            // VALID! The key matches the device.
            await putSettingToDB({ key: 'licenseKey', value: licenseKey });
            showToast('Lisensi berhasil diaktifkan untuk perangkat ini. Aplikasi akan dimulai ulang.');
            setTimeout(() => {
                location.reload();
            }, 2500);
        } else {
            // Key is validly formatted but for a different device or has wrong salt.
            showToast('Kunci lisensi tidak valid untuk perangkat ini.');
        }
    } catch (e) {
        // Base64 decoding failed or the format is wrong.
        showToast('Format kunci lisensi tidak valid.');
        console.error("License activation error:", e);
    }
}

document.getElementById('activateLicenseBtn')?.addEventListener('click', activateLicense);

// Function to generate a unique-ish device ID
async function generateDeviceId() {
    let storedId = await getSettingFromDB('deviceId');
    if (storedId) {
        return storedId;
    }

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    let renderer = 'unknown';
    if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            renderer = gl.getParameter(debugInfo.UNCOMPRESSED_RENDERER_WEBGL);
        }
    }
    
    const idString = `${navigator.userAgent}-${navigator.language}-${screen.width}x${screen.height}-${renderer}`;
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < idString.length; i++) {
        const char = idString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    
    const newId = `POSM-${Math.abs(hash).toString(16).toUpperCase()}`;
    await putSettingToDB({ key: 'deviceId', value: newId });
    return newId;
}

function loadLicenseInfo() {
     if (!deviceId) {
        generateDeviceId().then(id => {
            deviceId = id;
            document.getElementById('settingsDeviceId').textContent = deviceId;
        });
    } else {
        document.getElementById('settingsDeviceId').textContent = deviceId;
    }

    document.getElementById('settingsDeviceId').addEventListener('click', () => {
        navigator.clipboard.writeText(deviceId);
        showToast('Device ID disalin!');
    });
}