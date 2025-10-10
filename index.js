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
let currentLogoData = null;
let currentPage = 'dashboard';
let confirmCallback = null;
let html5QrCode;
let currentReportData = [];
let dashboardTransactions = []; // For the dashboard chart
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
let dashboardDateCheckInterval = null; // For auto-refreshing stats on date change
let audioContext = null; // For Web Audio API
let currentContactId = null; // For tracking which contact's ledger is open
let dueItemsList = []; // For due date notifications
let activePopover = null; // For the ledger actions popover
let cameraStream = null; // For camera capture stream

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

        // Memulai dan Menghentikan oscillator pada waktu yang dijadwalkeun
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

        const request = indexedDB.open('POS_DB', 8); 

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

            if (event.oldVersion < 8) {
                if (!db.objectStoreNames.contains('contacts')) {
                    const contactStore = db.createObjectStore('contacts', { keyPath: 'id', autoIncrement: true });
                    contactStore.createIndex('type', 'type', { unique: false });
                }
                if (!db.objectStoreNames.contains('ledgers')) {
                     const ledgerStore = db.createObjectStore('ledgers', { keyPath: 'id', autoIncrement: true });
                     ledgerStore.createIndex('contactId', 'contactId', { unique: false });
                }
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

function getAllFromDB(storeName, indexName, query) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('Database not initialized on getAllFromDB');
            reject('Database not initialized');
            return;
        }
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = indexName ? store.index(indexName).getAll(query) : store.getAll();
        
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(`Error fetching all from DB (${storeName}): ` + event.target.error);
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
    const testPrintBtn = document.getElementById('testPrintBtn');

    if (!isPrinterReady) {
        if (testPrintBtn) {
            testPrintBtn.disabled = true;
            testPrintBtn.title = 'Fitur cetak gagal dimuat.';
            testPrintBtn.classList.replace('bg-gray-600', 'bg-gray-400');
        }
        const autoPrintContainer = document.getElementById('autoPrintContainer');
        if (autoPrintContainer) {
            autoPrintContainer.classList.add('opacity-50');
            const autoPrintCheckbox = document.getElementById('autoPrintReceipt');
            if (autoPrintCheckbox) autoPrintCheckbox.disabled = true;
        }
    }
}


window.showPage = async function(pageName, options = { force: false, initialTab: null }) {
     const { force, initialTab } = options;

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
                showPage(pageName, { force: true }); // Force navigation
            },
            'Ya, Lanjutkan & Kosongkan',
            'bg-yellow-500' 
        );
        return; // Stop the current navigation attempt
    }


    if (currentPage === pageName || isNavigating) return;
    isNavigating = true;

    // Clear the interval if we are leaving the dashboard
    if (currentPage === 'dashboard' && pageName !== 'dashboard' && dashboardDateCheckInterval) {
        clearInterval(dashboardDateCheckInterval);
        dashboardDateCheckInterval = null;
    }

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
        // Set up an interval to check for date change every minute
        if (dashboardDateCheckInterval) clearInterval(dashboardDateCheckInterval);
        dashboardDateCheckInterval = setInterval(() => {
            const todayString = new Date().toISOString().split('T')[0];
            // Ensure lastDashboardLoadDate is not null before comparing
            if (lastDashboardLoadDate && lastDashboardLoadDate !== todayString) {
                console.log('Date changed while dashboard is active. Refreshing stats.');
                loadDashboard(); // This will also update lastDashboardLoadDate
            }
        }, 60000); // Check every 60 seconds
    } else if (pageName === 'kasir') {
        loadProductsGrid();
        await reconcileCartFees();
        updateCartFabBadge();
    } else if (pageName === 'produk') {
        window.loadProductsList();
    } else if (pageName === 'kontak') {
        loadContactsPage(initialTab);
    } else if (pageName === 'pengaturan') {
        loadSettings();
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

function formatReceiptDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const d = date.getDate();
    const m = date.getMonth() + 1;
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${d}/${m}/${y}, ${h}.${min}.${s}`;
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

async function updateDashboardSummaries() {
    const contacts = await getAllFromDB('contacts');
    const ledgers = await getAllFromDB('ledgers');
    
    let totalReceivables = 0;
    let totalDebts = 0;

    const balanceMap = new Map();

    ledgers.forEach(entry => {
        const currentBalance = balanceMap.get(entry.contactId) || 0;
        const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
        balanceMap.set(entry.contactId, currentBalance + amount);
    });

    contacts.forEach(contact => {
        const balance = balanceMap.get(contact.id) || 0;
        if (contact.type === 'customer') {
            totalReceivables += balance;
        } else {
            totalDebts += balance;
        }
    });
    
    document.getElementById('totalReceivables').textContent = `Rp ${formatCurrency(totalReceivables)}`;
    document.getElementById('totalDebts').textContent = `Rp ${formatCurrency(totalDebts)}`;
}


function loadDashboard() {
    // Always update the displayed date string (e.g., "Kamis, 1 Agustus 2024")
    updateDashboardDate();

    // Set the date for the auto-refresh check
    lastDashboardLoadDate = new Date().toISOString().split('T')[0];

    console.log('Refreshing dashboard stats.');

    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    
    getAllFromDB('transactions').then(transactions => {
        dashboardTransactions = transactions; // Store for chart use
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

        // Handle chart visibility and rendering
        const salesChartCard = document.getElementById('salesChartCard');
        if (transactions.length > 0) {
            displaySalesReport(transactions, 'daily');
            salesChartCard.style.display = 'block';
        } else {
            salesChartCard.style.display = 'none';
        }
    });
    
    getAllFromDB('products').then(products => {
        (document.getElementById('totalProducts')).textContent = products.length.toString();
        const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= lowStockThreshold).length;
        const lowStockEl = document.getElementById('lowStockProducts');
        lowStockEl.textContent = lowStockCount.toString();
        lowStockEl.parentElement?.parentElement?.classList.toggle('animate-pulse', lowStockCount > 0);
    });
    
    checkDueDateNotifications();
    updateDashboardSummaries();

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

// --- DUE DATE NOTIFICATIONS ---
async function checkDueDateNotifications() {
    const notificationCard = document.getElementById('dueDateNotificationCard');
    const countEl = document.getElementById('dueDateCount');
    if (!notificationCard || !countEl) return;

    try {
        const ledgers = await getAllFromDB('ledgers');
        const contacts = await getAllFromDB('contacts');
        const contactsMap = new Map(contacts.map(c => [c.id, c]));

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(today.getDate() + 3);
        threeDaysFromNow.setHours(23, 59, 59, 999);

        // Re-calculate the balance for each contact
        const balanceMap = new Map();
        ledgers.forEach(entry => {
            const currentBalance = balanceMap.get(entry.contactId) || 0;
            const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
            balanceMap.set(entry.contactId, currentBalance + amount);
        });

        const dueContactIds = new Set();
        ledgers.forEach(entry => {
             if (entry.type === 'debit' && entry.dueDate) {
                const dueDate = new Date(entry.dueDate);
                if (dueDate <= threeDaysFromNow) {
                    const balance = balanceMap.get(entry.contactId) || 0;
                    if (balance > 0) { // Only show if there's an outstanding balance
                        dueContactIds.add(entry.contactId);
                    }
                }
            }
        });

        // Fetch the full ledger details for only the contacts that have due items
        dueItemsList = ledgers
            .filter(entry => dueContactIds.has(entry.contactId) && entry.type === 'debit' && entry.dueDate)
            .map(entry => {
                const contact = contactsMap.get(entry.contactId);
                return { ...entry, contactName: contact ? contact.name : 'N/A', contactType: contact ? contact.type : 'N/A' };
            })
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));


        if (dueItemsList.length > 0) {
            countEl.textContent = dueItemsList.length;
            notificationCard.classList.remove('hidden');
            notificationCard.onclick = () => showDueDateModal();
        } else {
            notificationCard.classList.add('hidden');
        }

    } catch (error) {
        console.error("Error checking for due dates:", error);
        notificationCard.classList.add('hidden');
    }
}

window.showDueDateModal = function() {
    const modal = document.getElementById('dueDateModal');
    const listEl = document.getElementById('dueDateList');
    if (!modal || !listEl) return;

    if (dueItemsList.length === 0) {
        listEl.innerHTML = `<p class="text-gray-500 text-center py-4">Tidak ada item yang jatuh tempo.</p>`;
    } else {
        listEl.innerHTML = dueItemsList.map(item => {
            const dueDate = new Date(item.dueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let dueDateText;
            let textColor = 'text-gray-600';
            if (dueDate < today) {
                dueDateText = 'Terlambat';
                textColor = 'text-red-500 font-bold';
            } else if (dueDate.toDateString() === today.toDateString()) {
                dueDateText = 'Hari Ini';
                textColor = 'text-orange-500 font-bold';
            } else {
                dueDateText = dueDate.toLocaleDateString('id-ID', {day: 'numeric', month: 'long', year: 'numeric'});
            }

            const debtOrReceivable = item.contactType === 'customer' ? 'Piutang' : 'Hutang';

            return `
            <div class="border-b pb-3">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-semibold">${item.contactName}</p>
                        <p class="text-sm text-gray-500">${debtOrReceivable}: ${item.description}</p>
                    </div>
                    <p class="font-bold text-lg text-gray-800">Rp ${formatCurrency(item.amount)}</p>
                </div>
                <div class="flex justify-between items-center mt-2">
                    <p class="text-sm ${textColor}">Jatuh Tempo: ${dueDateText}</p>
                    <button class="btn bg-blue-500 text-white px-3 py-1 text-xs" onclick="viewLedgerFromDueDateModal(${item.contactId})">
                        Lihat Buku Besar
                    </button>
                </div>
            </div>
            `;
        }).join('');
    }

    modal.classList.remove('hidden');
}

window.closeDueDateModal = function() {
    const modal = document.getElementById('dueDateModal');
    if (modal) modal.classList.add('hidden');
}

window.viewLedgerFromDueDateModal = function(contactId) {
    closeDueDateModal();
    showPage('kontak');
    setTimeout(() => showLedgerModal(contactId), 350); // Wait for page transition
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

// --- CAMERA FUNCTIONS ---
window.openCameraModal = async function() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraFeed');
    const photoPreview = document.getElementById('photoPreview');
    const errorEl = document.getElementById('cameraError');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        errorEl.textContent = 'Kamera tidak didukung oleh browser ini.';
        errorEl.style.display = 'block';
        video.style.display = 'none';
        captureBtn.style.display = 'none';
        modal.classList.remove('hidden');
        return;
    }
    
    // Reset UI
    errorEl.style.display = 'none';
    video.style.display = 'block';
    photoPreview.style.display = 'none';
    captureBtn.style.display = 'flex';
    retakeBtn.style.display = 'none';
    usePhotoBtn.style.display = 'none';

    modal.classList.remove('hidden');

    try {
        const constraints = { video: { facingMode: "environment" } };
        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = cameraStream;
        await video.play();
    } catch (err) {
        console.error("Error accessing camera:", err);
        errorEl.textContent = 'Gagal mengakses kamera. Pastikan izin telah diberikan.';
        errorEl.style.display = 'block';
        video.style.display = 'none';
        captureBtn.style.display = 'none';
    }
}

window.closeCameraModal = function() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    const video = document.getElementById('cameraFeed');
    if (video) video.srcObject = null;
    document.getElementById('cameraModal').classList.add('hidden');
}

window.capturePhoto = function() {
    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('cameraCanvas');
    const photoPreview = document.getElementById('photoPreview');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');
    const context = canvas.getContext('2d');

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Show the captured photo
    photoPreview.src = canvas.toDataURL('image/jpeg');
    photoPreview.style.display = 'block';
    video.style.display = 'none';

    // Toggle controls
    captureBtn.style.display = 'none';
    retakeBtn.style.display = 'block';
    usePhotoBtn.style.display = 'block';
}

window.retakePhoto = function() {
    const video = document.getElementById('cameraFeed');
    const photoPreview = document.getElementById('photoPreview');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');

    // Hide preview, show video
    photoPreview.style.display = 'none';
    video.style.display = 'block';

    // Toggle controls
    captureBtn.style.display = 'flex';
    retakeBtn.style.display = 'none';
    usePhotoBtn.style.display = 'none';
}

window.useCapturedPhoto = function() {
    const canvas = document.getElementById('cameraCanvas');
    const activeModal = document.getElementById('addProductModal').classList.contains('hidden') ? 'edit' : 'add';

    if (activeModal === 'add') {
        currentImageData = canvas.toDataURL('image/jpeg');
        document.getElementById('imagePreview').innerHTML = `<img src="${currentImageData}" alt="Preview" class="image-preview">`;
    } else {
        currentEditImageData = canvas.toDataURL('image/jpeg');
        document.getElementById('editImagePreview').innerHTML = `<img src="${currentEditImageData}" alt="Preview" class="image-preview">`;
    }
    
    closeCameraModal();
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
        if (autoPrint) {
            printReceipt();
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
        { key: 'storeLogo', value: currentLogoData },
        { key: 'storeName', value: (document.getElementById('storeName')).value.trim() },
        { key: 'storeAddress', value: (document.getElementById('storeAddress')).value.trim() },
        { key: 'storeFeedbackPhone', value: (document.getElementById('storeFeedbackPhone')).value.trim() },
        { key: 'storeFooterText', value: (document.getElementById('storeFooterText')).value.trim() },
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
        document.getElementById('printerPaperSize').value = settingsMap.get('printerPaperSize') || '80mm';

        // Load logo
        const logoPreview = document.getElementById('logoPreview');
        const removeLogoBtn = document.getElementById('removeLogoBtn');
        currentLogoData = settingsMap.get('storeLogo') || null;
        if (currentLogoData) {
            logoPreview.innerHTML = `<img src="${currentLogoData}" alt="Logo Preview" class="image-preview">`;
            removeLogoBtn.classList.remove('hidden');
        } else {
            logoPreview.innerHTML = `<i class="fas fa-image text-3xl mb-2"></i><p>Tap untuk upload logo</p>`;
            removeLogoBtn.classList.add('hidden');
        }

        // Set Kiosk Mode toggle state
        const kioskToggle = document.getElementById('kioskModeToggle');
        if (kioskToggle) {
            kioskToggle.checked = settingsMap.get('kioskModeEnabled') || false;
        }

        lowStockThreshold = settingsMap.get('lowStockThreshold') || 5;
        
    } catch (error) {
        console.error("Failed to load settings:", error);
    }
}

// --- LOGO HANDLING ---
window.previewLogo = function(event) {
    const file = event.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            currentLogoData = e.target?.result;
            document.getElementById('logoPreview').innerHTML = `<img src="${currentLogoData}" alt="Logo Preview" class="image-preview">`;
            document.getElementById('removeLogoBtn').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

window.removeLogo = function() {
    currentLogoData = null;
    document.getElementById('logoPreview').innerHTML = `<i class="fas fa-image text-3xl mb-2"></i><p>Tap untuk upload logo</p>`;
    document.getElementById('storeLogo').value = ''; // Reset file input
    document.getElementById('removeLogoBtn').classList.add('hidden');
    putSettingToDB({ key: 'storeLogo', value: null }).then(() => {
        showToast('Logo dihapus.');
    });
}


// --- DATA MANAGEMENT ---
async function exportData() {
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

        // Cek apakah interface Android ada
        if (window.AndroidDownloader) {
            // Panggil fungsi Java
            window.AndroidDownloader.downloadFile(fileContent, fileName, 'application/json');
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
        }
        showToast('Export data berhasil.');
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
                        const storesToClear = ['products', 'transactions', 'settings', 'categories', 'fees', 'contacts', 'ledgers'];
                        const transaction = db.transaction(storesToClear, 'readwrite');
                        
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
        return;
    }

    displayReportSummary(filteredTransactions, products);
    displayReportDetails(filteredTransactions);
    displayTopSellingProducts(filteredTransactions);

    document.getElementById('reportSummary').style.display = 'block';
    document.getElementById('reportDetails').style.display = 'block';
    document.getElementById('topSellingProductsCard').style.display = 'block';
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
    const getWeek = (d) => {
        const date = new Date(d.getTime());
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        const week1 = new Date(date.getFullYear(), 0, 4);
        return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    };

    transactions.forEach(t => {
        const date = new Date(t.date);
        let key;

        if (viewType === 'daily') {
            key = date.toISOString().split('T')[0];
        } else { // weekly
            key = `${date.getFullYear()}-W${getWeek(date)}`;
        }

        if (!salesData[key]) {
            salesData[key] = 0;
        }
        salesData[key] += t.total;
    });

    const sortedLabels = Object.keys(salesData).sort();
    const dataPoints = sortedLabels.map(label => salesData[label]);
    
    const ctx = document.getElementById('salesChart').getContext('2d');
    
    if (salesChartInstance) {
        salesChartInstance.destroy();
    }
    
    salesChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedLabels,
            datasets: [{
                label: 'Total Penjualan',
                data: dataPoints,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value, index, values) {
                            return 'Rp ' + (value / 1000) + 'k';
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
                                label += new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}


function setupChartViewToggle() {
    const dailyBtn = document.getElementById('dailyViewBtn');
    const weeklyBtn = document.getElementById('weeklyViewBtn');
    const glider = document.getElementById('chartViewGlider');

    dailyBtn.addEventListener('click', () => {
        glider.style.transform = 'translateX(0%)';
        dailyBtn.classList.remove('text-gray-500');
        dailyBtn.classList.add('text-gray-800');
        weeklyBtn.classList.add('text-gray-500');
        weeklyBtn.classList.remove('text-gray-800');
        displaySalesReport(dashboardTransactions, 'daily');
    });

    weeklyBtn.addEventListener('click', () => {
        glider.style.transform = 'translateX(100%)';
        weeklyBtn.classList.remove('text-gray-500');
        weeklyBtn.classList.add('text-gray-800');
        dailyBtn.classList.add('text-gray-500');
        dailyBtn.classList.remove('text-gray-800');
        displaySalesReport(dashboardTransactions, 'weekly');
    });
}


async function exportReportToCSV() {
    if (currentReportData.length === 0) {
        showToast('Tidak ada data untuk diexport.');
        return;
    }

    try {
        // 1. Fetch all products to get purchase price and category info
        const products = await getAllFromDB('products');
        const productMap = new Map(products.map(p => [p.id, p]));

        // 2. Recalculate summary metrics to ensure consistency with the UI
        let omzet = 0;
        let hpp = 0;
        let totalOperationalCost = 0;

        currentReportData.forEach(t => {
            const subtotalAfterDiscount = t.subtotal - (t.totalDiscount || 0);
            omzet += subtotalAfterDiscount;
            t.items.forEach(item => {
                const product = productMap.get(item.id);
                const purchasePrice = product ? (product.purchasePrice || 0) : 0;
                hpp += purchasePrice * item.quantity;
            });
            (t.fees || []).forEach(fee => {
                totalOperationalCost += fee.amount;
            });
        });

        const grossProfit = omzet - hpp;
        const netProfit = grossProfit - totalOperationalCost;
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;

        let csvContent = "";

        // 3. Build Summary Block
        csvContent += "Ringkasan Laporan\n";
        csvContent += `Periode,"${dateFrom} s/d ${dateTo}"\n`;
        csvContent += "\n";
        csvContent += `Total Omzet (Penjualan Kotor),${omzet}\n`;
        csvContent += `(-) Total Harga Pokok Penjualan (HPP),${hpp}\n`;
        csvContent += `Laba Kotor,${grossProfit}\n`;
        csvContent += `(-) Total Biaya Operasional (Pajak/Biaya),${totalOperationalCost}\n`;
        csvContent += `Laba Bersih,${netProfit}\n`;
        csvContent += "\n\n";

        // 4. Build Detailed Transactions Block
        const header = [
            'ID Transaksi', 'Tanggal', 'Nama Produk', 'Kategori', 'Jumlah',
            'Harga Jual (Satuan)', 'Total Omzet Item', 'Harga Beli (Satuan)',
            'Total HPP Item', 'Laba Item'
        ].join(',');
        csvContent += header + '\n';

        currentReportData.forEach(t => {
            const transactionDate = new Date(t.date).toLocaleString('id-ID');
            t.items.forEach(item => {
                const product = productMap.get(item.id);
                const category = product ? product.category : 'N/A';
                const purchasePrice = product ? (product.purchasePrice || 0) : 0;

                const totalOmzetItem = item.effectivePrice * item.quantity;
                const totalHppItem = purchasePrice * item.quantity;
                const labaItem = totalOmzetItem - totalHppItem;

                // Helper to escape commas and quotes for CSV
                const escapeCSV = (val) => {
                    if (val === null || val === undefined) return '';
                    let str = String(val);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                };

                const row = [
                    t.id,
                    transactionDate,
                    item.name,
                    category,
                    item.quantity,
                    item.effectivePrice,
                    totalOmzetItem,
                    purchasePrice,
                    totalHppItem,
                    labaItem
                ].map(escapeCSV).join(',');
                
                csvContent += row + '\n';
            });
        });
        
        const fileName = `laporan_penjualan_rinci_${dateFrom}_sd_${dateTo}.csv`;

        // 5. Cek apakah interface Android ada
        if (window.AndroidDownloader) {
            // Panggil fungsi Java
            window.AndroidDownloader.downloadFile(csvContent, fileName, 'text/csv');
        } else {
            // Fallback untuk browser biasa
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", fileName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
        showToast('Export laporan berhasil.');
    } catch (error) {
        console.error('Export report failed:', error);
        showToast('Gagal mengekspor laporan.');
    }
}
window.exportReportToCSV = exportReportToCSV;

// --- RECEIPT PRINTING ---
const receiptLine = (char, paperWidthChars) => char.repeat(paperWidthChars);

async function _generateReceiptHTML(data, isPreview) {
    const settings = await getAllFromDB('settings');
    const settingsMap = new Map(settings.map(s => [s.key, s.value]));

    const storeName = settingsMap.get('storeName') || 'Toko Anda';
    const storeAddress = settingsMap.get('storeAddress') || '';
    const feedbackPhone = settingsMap.get('storeFeedbackPhone') || '';
    const footerText = settingsMap.get('storeFooterText') || 'Terima kasih!';
    const storeLogo = settingsMap.get('storeLogo') || null;
    const paperSize = settingsMap.get('printerPaperSize') || '80mm';
    const paperWidthChars = paperSize === '58mm' ? 32 : 42;

    const escapeHtml = (unsafe) => {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    };

    // --- Logo ---
    const logoHtml = storeLogo 
        ? `<div id="receiptLogoContainer"><img src="${storeLogo}" alt="Logo Toko"></div>` 
        : '';

    // --- Items ---
    let itemsHtml = '';
    data.items.forEach(item => {
        const leftPart = `${escapeHtml(item.name)} x${item.quantity}`;
        const rightPart = `Rp.${formatCurrency(item.effectivePrice * item.quantity)}`;
        
        itemsHtml += `<div class="receipt-line-justify"><span>${leftPart}</span><span>${rightPart}</span></div>`;
        
        if (item.discountPercentage > 0) {
            const priceDetailText = `  @ Rp.${formatCurrency(item.price)} Disc ${item.discountPercentage}%`;
            itemsHtml += `<div style="font-size: 0.8rem;">${priceDetailText}</div>`;
        }
    });

    // --- Summary ---
    let summaryHtml = `<div class="receipt-divider">${receiptLine('-', paperWidthChars)}</div>`;
    const subtotalAfterDiscount = data.subtotal - data.totalDiscount;
    const subtotalText = "Subtotal";
    const subtotalValue = `Rp.${formatCurrency(subtotalAfterDiscount)}`;
    summaryHtml += `<div class="receipt-line-justify"><span>${subtotalText}</span><span>${subtotalValue}</span></div>`;
    
    if (data.fees && data.fees.length > 0) {
        data.fees.forEach(fee => {
            let feeName = escapeHtml(fee.name);
             if (fee.type === 'percentage') {
                feeName += ` ${fee.value}%`;
            }
            const feeAmount = `Rp. ${formatCurrency(fee.amount)}`;
            summaryHtml += `<div class="receipt-line-justify"><span>${feeName}</span><span>${feeAmount}</span></div>`;
        });
    }
    
    summaryHtml += `<div class="receipt-divider">${receiptLine('-', paperWidthChars)}</div>`;

    const totalText = "TOTAL";
    const totalValue = `Rp.${formatCurrency(data.total)}`;
    summaryHtml += `<div class="receipt-line-justify" style="font-weight: bold;"><span>${totalText}</span><span>${totalValue}</span></div>`;

    const cashText = "TUNAI";
    const cashValue = `Rp.${formatCurrency(data.cashPaid)}`;
    summaryHtml += `<div class="receipt-line-justify"><span>${cashText}</span><span>${cashValue}</span></div>`;
    
    const changeText = "KEMBALI";
    const changeValue = `Rp. ${formatCurrency(data.change)}`;
    summaryHtml += `<div class="receipt-line-justify"><span>${changeText}</span><span>${changeValue}</span></div>`;

    // --- Footer ---
    const footerLines = escapeHtml(footerText).split('\n').map(line => `<p style="margin: 0;">${line}</p>`).join('');
    const feedbackHtml = feedbackPhone ? `<p style="margin: 0; font-size: 0.8rem;">Kritik/Saran: ${escapeHtml(feedbackPhone)}</p>` : '';
    
    return (
        `${logoHtml}` +
        `<div style="text-align: center;">` +
            `<h2 style="font-size: 1.1rem; font-weight: bold; margin: 0;">${escapeHtml(storeName)}</h2>` +
            `<p style="margin: 0; font-size: 0.8rem;">${escapeHtml(storeAddress)}</p>` +
        `</div>` +
        `<div class="receipt-divider">${receiptLine('=', paperWidthChars)}</div>` +
        `<div style="font-size: 0.8rem;">` +
            `<div>No: ${data.id || (isPreview ? 'PREVIEW' : 'N/A')}</div>` +
            `<div>Tgl: ${formatReceiptDate(data.date)}</div>` +
        `</div>` +
        `<div class="receipt-divider">${receiptLine('-', paperWidthChars)}</div>` +
        `<div style="font-size: 0.9rem;">${itemsHtml}</div>` +
        `${summaryHtml}` +
        `<div class="receipt-divider" style="margin-top: 2px;">${receiptLine('=', paperWidthChars)}</div>` +
        `<div style="text-align: center; margin-top: 4px; font-size: 0.8rem;">` +
            `${footerLines}` +
            `${feedbackHtml}` +
        `</div>`
    );
}

async function generateReceiptContent(transactionData, targetElementId = 'receiptContent') {
    const contentEl = document.getElementById(targetElementId);
    contentEl.innerHTML = await _generateReceiptHTML(transactionData, targetElementId === 'previewReceiptContent');
}

window.showPreviewReceiptModal = async function() {
    if (cart.items.length === 0) {
        showToast('Keranjang kosong, tidak ada struk untuk ditampilkan.');
        return;
    }
    const subtotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const totalDiscount = cart.items.reduce((sum, item) => {
         const discountAmount = item.price * (item.discountPercentage / 100);
         return sum + (discountAmount * item.quantity);
    }, 0);
    const subtotalAfterDiscount = subtotal - totalDiscount;
    let calculatedFees = [];
    let totalFeeAmount = 0;
    cart.fees.forEach(fee => {
        const feeAmount = fee.type === 'percentage' ? subtotalAfterDiscount * (fee.value / 100) : fee.value;
        calculatedFees.push({ ...fee, amount: feeAmount });
        totalFeeAmount += feeAmount;
    });
    const total = subtotalAfterDiscount + totalFeeAmount;

    const previewData = {
        items: cart.items,
        subtotal,
        totalDiscount,
        fees: calculatedFees,
        total,
        cashPaid: 0,
        change: 0,
        date: new Date().toISOString()
    };
    
    await generateReceiptContent(previewData, 'previewReceiptContent');
    document.getElementById('previewReceiptModal').classList.remove('hidden');
}

window.closePreviewReceiptModal = function() {
    document.getElementById('previewReceiptModal').classList.add('hidden');
}

// --- CONTACT & LEDGER MANAGEMENT (HUTANG/PIUTANG) ---
let currentContactTab = 'customer'; // 'customer' or 'supplier'

function switchContactTab(tabName) {
    if (currentContactTab === tabName) return;

    currentContactTab = tabName;
    const customerTab = document.getElementById('customerTab');
    const supplierTab = document.getElementById('supplierTab');
    const customerListContainer = document.getElementById('customerListContainer');
    const supplierListContainer = document.getElementById('supplierListContainer');

    if (tabName === 'customer') {
        customerTab.classList.add('active');
        supplierTab.classList.remove('active');
        customerListContainer.classList.remove('hidden');
        supplierListContainer.classList.add('hidden');
        loadContacts('customer');
    } else {
        supplierTab.classList.add('active');
        customerTab.classList.remove('active');
        supplierListContainer.classList.remove('hidden');
        customerListContainer.classList.add('hidden');
        loadContacts('supplier');
    }
}
window.switchContactTab = switchContactTab;

async function loadContacts(type) {
    const listElId = type === 'customer' ? 'customerList' : 'supplierList';
    const listEl = document.getElementById(listElId);
    
    const contacts = await getAllFromDB('contacts', 'type', type);
    const ledgers = await getAllFromDB('ledgers');
    
    const balanceMap = new Map();
    ledgers.forEach(entry => {
        const currentBalance = balanceMap.get(entry.contactId) || 0;
        const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
        balanceMap.set(entry.contactId, currentBalance + amount);
    });

    if (contacts.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-users-slash"></i></div>
                <h3 class="empty-state-title">Belum Ada Kontak</h3>
                <p class="empty-state-description">Tambahkan ${type === 'customer' ? 'pelanggan' : 'supplier'} baru untuk mulai melacak hutang/piutang.</p>
                <button onclick="showContactModal()" class="empty-state-action">
                    <i class="fas fa-plus mr-2"></i>Tambah Kontak
                </button>
            </div>
        `;
        return;
    }
    
    listEl.innerHTML = contacts.sort((a,b) => a.name.localeCompare(b.name)).map(contact => {
        const balance = balanceMap.get(contact.id) || 0;
        let balanceHtml = '';
        if (balance > 0) {
            const balanceColor = type === 'customer' ? 'text-teal-600' : 'text-red-600';
            const balanceLabel = type === 'customer' ? 'Piutang' : 'Hutang';
            balanceHtml = `<p class="text-sm font-semibold ${balanceColor}">${balanceLabel}: Rp ${formatCurrency(balance)}</p>`;
        } else {
            balanceHtml = `<p class="text-sm text-green-600">Lunas</p>`;
        }

        return `
            <div class="card p-4 clickable" onclick="showLedgerModal(${contact.id})">
                <div class="flex justify-between items-start">
                    <div>
                        <h3 class="font-semibold text-lg">${contact.name}</h3>
                        <p class="text-sm text-gray-500"><i class="fas fa-phone mr-2"></i>${contact.phone || '-'}</p>
                    </div>
                    <div class="text-right">
                         ${balanceHtml}
                    </div>
                </div>
                <div class="flex justify-end gap-2 mt-2 pt-2 border-t">
                    <button onclick="event.stopPropagation(); showContactModal(${contact.id})" class="btn bg-blue-100 text-blue-700 px-3 py-1 text-xs">Edit</button>
                    <button onclick="event.stopPropagation(); deleteContact(${contact.id})" class="btn bg-red-100 text-red-700 px-3 py-1 text-xs">Hapus</button>
                </div>
            </div>
        `;
    }).join('');
}
function loadContactsPage(initialTab = 'customer') {
    switchContactTab(initialTab);
}

window.showContactModal = async function(contactId = null) {
    const modal = document.getElementById('contactModal');
    const title = document.getElementById('contactModalTitle');
    const idInput = document.getElementById('contactId');
    const nameInput = document.getElementById('contactName');
    const phoneInput = document.getElementById('contactPhone');
    const addressInput = document.getElementById('contactAddress');
    const notesInput = document.getElementById('contactNotes');
    const typeInput = document.getElementById('contactType');

    // Reset form
    idInput.value = '';
    nameInput.value = '';
    phoneInput.value = '';
    addressInput.value = '';
    notesInput.value = '';
    typeInput.value = currentContactTab;

    if (contactId) {
        title.textContent = 'Edit Kontak';
        const contact = await getFromDB('contacts', contactId);
        if (contact) {
            idInput.value = contact.id;
            nameInput.value = contact.name;
            phoneInput.value = contact.phone || '';
            addressInput.value = contact.address || '';
            notesInput.value = contact.notes || '';
            typeInput.value = contact.type;
        }
    } else {
        title.textContent = 'Tambah Kontak';
    }

    modal.classList.remove('hidden');
}

window.closeContactModal = function() {
    document.getElementById('contactModal').classList.add('hidden');
}

window.saveContact = async function() {
    const id = document.getElementById('contactId').value ? parseInt(document.getElementById('contactId').value) : null;
    const name = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const address = document.getElementById('contactAddress').value.trim();
    const notes = document.getElementById('contactNotes').value.trim();
    const type = document.getElementById('contactType').value;

    if (!name) {
        showToast('Nama kontak tidak boleh kosong.');
        return;
    }

    const contactData = {
        name,
        phone,
        address,
        notes,
        type,
        updatedAt: new Date().toISOString()
    };
    
    let action = '';
    if (id) {
        contactData.id = id;
        action = 'UPDATE_CONTACT';
    } else {
        contactData.createdAt = new Date().toISOString();
        action = 'CREATE_CONTACT';
    }
    
    try {
        const savedId = await putToDB('contacts', contactData);
        const syncPayload = id ? contactData : { ...contactData, id: savedId };
        await queueSyncAction(action, syncPayload);
        showToast(`Kontak berhasil ${id ? 'diperbarui' : 'disimpan'}.`);
        closeContactModal();
        loadContacts(type); // Refresh the list for the current tab
    } catch (error) {
        console.error('Failed to save contact:', error);
        showToast('Gagal menyimpan kontak.');
    }
}

window.deleteContact = async function(contactId) {
    const ledgers = await getAllFromDB('ledgers', 'contactId', contactId);
    if (ledgers.length > 0) {
        showToast('Kontak tidak dapat dihapus karena memiliki riwayat transaksi.');
        return;
    }

    showConfirmationModal('Hapus Kontak', 'Yakin ingin menghapus kontak ini?', async () => {
        try {
            const contactToDelete = await getFromDB('contacts', contactId);
            const tx = db.transaction('contacts', 'readwrite');
            tx.objectStore('contacts').delete(contactId);
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_CONTACT', contactToDelete);
                showToast('Kontak berhasil dihapus.');
                loadContacts(contactToDelete.type);
            };
        } catch (error) {
            console.error('Failed to delete contact:', error);
            showToast('Gagal menghapus kontak.');
        }
    }, 'Ya, Hapus', 'bg-red-500');
}

window.showLedgerModal = async function(contactId) {
    currentContactId = contactId;
    const modal = document.getElementById('ledgerModal');
    const nameEl = document.getElementById('ledgerContactName');
    const typeEl = document.getElementById('ledgerContactType');
    const detailsEl = document.getElementById('ledgerContactDetails');
    const historyEl = document.getElementById('ledgerHistory');
    const addDebitBtn = document.getElementById('addDebitButton');

    const contact = await getFromDB('contacts', contactId);
    if (!contact) {
        showToast('Kontak tidak ditemukan.');
        return;
    }

    nameEl.textContent = contact.name;
    const isCustomer = contact.type === 'customer';
    typeEl.textContent = isCustomer ? 'Pelanggan' : 'Supplier';
    typeEl.className = `text-sm font-semibold ${isCustomer ? 'text-teal-600' : 'text-red-600'}`;
    addDebitBtn.innerHTML = `<i class="fas fa-minus-circle"></i> Tambah ${isCustomer ? 'Piutang' : 'Hutang'}`;
    
    let contactDetailsHtml = '';
    if (contact.phone) contactDetailsHtml += `<p><i class="fas fa-phone fa-fw mr-2"></i>${contact.phone}</p>`;
    if (contact.address) contactDetailsHtml += `<p><i class="fas fa-map-marker-alt fa-fw mr-2"></i>${contact.address}</p>`;
    if (contact.notes) contactDetailsHtml += `<p><i class="fas fa-sticky-note fa-fw mr-2"></i>${contact.notes}</p>`;
    detailsEl.innerHTML = contactDetailsHtml || '<p>Tidak ada detail tambahan.</p>';

    await renderLedgerHistory(contactId);
    modal.classList.remove('hidden');
}

async function renderLedgerHistory(contactId) {
    const historyEl = document.getElementById('ledgerHistory');
    const ledgers = await getAllFromDB('ledgers', 'contactId', contactId);
    ledgers.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    let balance = 0;
    const historyWithBalance = ledgers.map(entry => {
        const amount = entry.type === 'debit' ? entry.amount : -entry.amount;
        const entryWithBalance = { ...entry, balance: balance + amount };
        balance += amount;
        return entryWithBalance;
    }).reverse(); // now chronological

    historyEl.innerHTML = historyWithBalance.reverse().map(entry => {
        const isDebit = entry.type === 'debit';
        const amountColor = isDebit ? 'text-red-500' : 'text-green-500';
        const amountSign = isDebit ? '+' : '-';
        const date = new Date(entry.createdAt).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'});

        let dueDateHtml = '';
        if (entry.dueDate) {
            const dueDate = new Date(entry.dueDate);
            const today = new Date(); today.setHours(0,0,0,0);
            let color = 'text-gray-500';
            if(dueDate < today) color = 'text-red-500';
            else if (dueDate.getTime() === today.getTime()) color = 'text-orange-500';
            dueDateHtml = `<p class="text-xs ${color}"><i class="fas fa-calendar-alt mr-1"></i>Jatuh tempo: ${dueDate.toLocaleDateString('id-ID')}</p>`;
        }

        return `
            <div class="border-b pb-2">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-semibold">${entry.description}</p>
                        <p class="text-xs text-gray-500">${date}</p>
                        ${dueDateHtml}
                    </div>
                    <div class="text-right">
                        <p class="font-bold ${amountColor}">${amountSign} Rp ${formatCurrency(entry.amount)}</p>
                        <p class="text-xs text-gray-600">Saldo: Rp ${formatCurrency(entry.balance)}</p>
                    </div>
                     <button onclick="showLedgerActions(event, ${entry.id})" class="ml-2 text-gray-500 clickable"><i class="fas fa-ellipsis-v"></i></button>
                </div>
            </div>
        `;
    }).join('');

    if (ledgers.length === 0) {
        historyEl.innerHTML = `<p class="text-center text-gray-500 py-4">Belum ada riwayat transaksi.</p>`;
    }
}

window.closeLedgerModal = function() {
    document.getElementById('ledgerModal').classList.add('hidden');
    currentContactId = null;
}

window.showAddLedgerEntryModal = async function(entryId = null, entryType = 'credit') {
    const modal = document.getElementById('addLedgerEntryModal');
    const titleEl = document.getElementById('addLedgerEntryTitle');
    const amountInput = document.getElementById('ledgerAmount');
    const descInput = document.getElementById('ledgerDescription');
    const dueDateContainer = document.getElementById('ledgerDueDateContainer');
    const dueDateInput = document.getElementById('ledgerDueDate');

    // Reset form
    amountInput.value = '';
    descInput.value = '';
    dueDateInput.value = '';
    modal.dataset.entryId = entryId || '';
    modal.dataset.entryType = entryType;
    
    if(entryId) { // Editing existing entry
        const entry = await getFromDB('ledgers', entryId);
        titleEl.textContent = 'Edit Transaksi';
        amountInput.value = entry.amount;
        descInput.value = entry.description;
        dueDateInput.value = entry.dueDate || '';
        modal.dataset.entryType = entry.type; // override
    } else { // Adding new entry
        const isDebit = entryType === 'debit';
        const contact = await getFromDB('contacts', currentContactId);
        const isCustomer = contact.type === 'customer';
        if(isDebit) {
            titleEl.textContent = `Tambah ${isCustomer ? 'Piutang' : 'Hutang'}`;
            descInput.placeholder = 'e.g., Penjualan kredit, Pinjaman';
        } else {
            titleEl.textContent = 'Catat Pembayaran';
            descInput.placeholder = 'e.g., Pelunasan, Cicilan';
        }
    }
    
    // Show due date only for debit entries
    dueDateContainer.style.display = modal.dataset.entryType === 'debit' ? 'block' : 'none';

    modal.classList.remove('hidden');
}

window.closeAddLedgerEntryModal = function() {
    document.getElementById('addLedgerEntryModal').classList.add('hidden');
}

window.saveLedgerEntry = async function() {
    const modal = document.getElementById('addLedgerEntryModal');
    const entryId = modal.dataset.entryId ? parseInt(modal.dataset.entryId) : null;
    const type = modal.dataset.entryType;
    const amount = parseFloat(document.getElementById('ledgerAmount').value);
    const description = document.getElementById('ledgerDescription').value.trim();
    const dueDate = document.getElementById('ledgerDueDate').value || null;

    if (isNaN(amount) || amount <= 0 || !description) {
        showToast('Jumlah dan Keterangan harus diisi.');
        return;
    }

    const entryData = {
        contactId: currentContactId,
        type,
        amount,
        description,
        dueDate: type === 'debit' ? dueDate : null, // only save due date for debits
        updatedAt: new Date().toISOString()
    };
    
    let action = '';
    if (entryId) {
        entryData.id = entryId;
        const originalEntry = await getFromDB('ledgers', entryId);
        entryData.createdAt = originalEntry.createdAt; // preserve creation date
        action = 'UPDATE_LEDGER_ENTRY';
    } else {
        entryData.createdAt = new Date().toISOString();
        action = 'CREATE_LEDGER_ENTRY';
    }
    
    try {
        const savedId = await putToDB('ledgers', entryData);
        const syncPayload = entryId ? entryData : { ...entryData, id: savedId };
        await queueSyncAction(action, syncPayload);
        showToast(`Transaksi berhasil ${entryId ? 'diperbarui' : 'dicatat'}.`);
        closeAddLedgerEntryModal();
        await renderLedgerHistory(currentContactId);
        await updateDashboardSummaries();
        await checkDueDateNotifications(); // Refresh notifications
    } catch (error) {
        console.error('Failed to save ledger entry:', error);
        showToast('Gagal menyimpan transaksi.');
    }
}

window.showLedgerActions = async function(event, entryId) {
    event.stopPropagation();
    const popover = document.getElementById('ledgerActionsPopover');
    
    const entry = await getFromDB('ledgers', entryId);
    if (!entry) return;

    let actionsHtml = `<a onclick="event.stopPropagation(); showAddLedgerEntryModal(${entryId})"><i class="fas fa-edit fa-fw mr-2"></i>Edit</a>`;
    if (entry.type === 'debit') {
        actionsHtml += `<a onclick="event.stopPropagation(); showEditDueDateModal(${entryId})"><i class="fas fa-calendar-alt fa-fw mr-2"></i>Ubah Jatuh Tempo</a>`;
    }
    actionsHtml += `<a onclick="event.stopPropagation(); deleteLedgerEntry(${entryId})" class="text-red-600"><i class="fas fa-trash fa-fw mr-2"></i>Hapus</a>`;

    popover.innerHTML = actionsHtml;

    // Position and show popover
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    popover.style.display = 'block';
    popover.style.top = `${rect.bottom + window.scrollY}px`;
    popover.style.left = `${rect.right + window.scrollX - popover.offsetWidth}px`;
    activePopover = popover;
}

window.deleteLedgerEntry = function(entryId) {
    closeActivePopover();
    showConfirmationModal('Hapus Transaksi', 'Yakin ingin menghapus catatan transaksi ini?', async () => {
        try {
            const entryToDelete = await getFromDB('ledgers', entryId);
            const tx = db.transaction('ledgers', 'readwrite');
            tx.objectStore('ledgers').delete(entryId);
            tx.oncomplete = async () => {
                await queueSyncAction('DELETE_LEDGER_ENTRY', entryToDelete);
                showToast('Transaksi berhasil dihapus.');
                await renderLedgerHistory(currentContactId);
                await updateDashboardSummaries();
                await checkDueDateNotifications();
            };
        } catch (error) {
            console.error('Failed to delete ledger entry:', error);
            showToast('Gagal menghapus transaksi.');
        }
    }, 'Ya, Hapus', 'bg-red-500');
}

window.showEditDueDateModal = async function(entryId) {
    closeActivePopover();
    const modal = document.getElementById('editDueDateModal');
    const entry = await getFromDB('ledgers', entryId);
    if (entry) {
        modal.querySelector('#editDueDateEntryId').value = entryId;
        modal.querySelector('#newDueDate').value = entry.dueDate || '';
        modal.classList.remove('hidden');
    }
}

window.closeEditDueDateModal = function() {
    document.getElementById('editDueDateModal').classList.add('hidden');
}

window.saveDueDate = async function() {
    const modal = document.getElementById('editDueDateModal');
    const entryId = parseInt(modal.querySelector('#editDueDateEntryId').value);
    const newDueDate = modal.querySelector('#newDueDate').value;

    const entry = await getFromDB('ledgers', entryId);
    if (entry) {
        entry.dueDate = newDueDate || null;
        entry.updatedAt = new Date().toISOString();
        await putToDB('ledgers', entry);
        await queueSyncAction('UPDATE_LEDGER_ENTRY', entry);
        showToast('Tanggal jatuh tempo diperbarui.');
        closeEditDueDateModal();
        await renderLedgerHistory(entry.contactId);
        await checkDueDateNotifications();
    }
}

function closeActivePopover() {
    if (activePopover) {
        activePopover.style.display = 'none';
        activePopover = null;
    }
}

// Event listener to close popover when clicking outside
document.addEventListener('click', (event) => {
    if (activePopover && !activePopover.contains(event.target) && !event.target.closest('[onclick^="showLedgerActions"]')) {
        closeActivePopover();
    }
});


// --- BLUETOOTH PRINTING (with PrintHub) ---

/**
 * A generic wrapper function to handle the entire lifecycle of a print job.
 * It initiates a connection, executes the provided print logic, and handles success/failure.
 * @param {Function} printLogicCallback - An async function that receives the 'print' object and contains the actual printing commands.
 */
async function performPrintJob(printLogicCallback) {
    if (!isPrinterReady) {
        showToast('Fitur cetak tidak tersedia (library PrintHub gagal dimuat).');
        return;
    }

    const paperSize = await getSettingFromDB('printerPaperSize') || '80mm';
    const printer = new PrintHub.init({
        paperSize: paperSize === '58mm' ? '58' : '80',
        printerType: 'bluetooth'
    });

    showToast('Pilih printer Anda dari daftar Bluetooth...', 3000);

    printer.connectToPrint({
        onReady: async (print) => {
            try {
                showToast('Printer terhubung, mengirim data...', 2000);
                await printLogicCallback(print);
                showToast('Data cetak berhasil dikirim.');
            } catch (error) {
                console.error("Printing failed during job execution:", error);
                showToast(`Gagal mencetak: ${error.message}`);
            }
        },
        onFailed: (message) => {
            console.error("Printer connection failed:", message);
            const cancellationMessage = 'Pemilihan printer dibatalkan.';
            let isCancellation = false;

            // Case 1: Standard DOMException for cancellation
            if (typeof message === 'object' && message.name === 'NotFoundError') {
                isCancellation = true;
            } 
            // Case 2: Error object with a 'message' property indicating cancellation
            else if (typeof message === 'object' && message.message && message.message.toLowerCase().includes('user cancelled')) {
                isCancellation = true;
            }
            // Case 3: Simple string message indicating cancellation
            else if (typeof message === 'string' && message.toLowerCase().includes('user cancelled')) {
                isCancellation = true;
            }
            
            if (isCancellation) {
                showToast(cancellationMessage);
            } else {
                let errorMessage = 'Koneksi printer gagal. Pastikan printer menyala & coba lagi.';
                if (typeof message === 'object' && message.message) {
                    errorMessage = `Gagal terhubung: ${message.message}`;
                } else if (typeof message === 'string' && message) {
                    errorMessage = `Gagal terhubung: ${message}`;
                }
                showToast(errorMessage, 4000);
            }
        }
    });
}

window.testPrint = async function() {
    const printLogic = async (print) => {
        await print.writeText('Test Cetak Berhasil!', { align: 'center', bold: true, size: 'double' });
        await print.writeText('Ini adalah hasil test dari POS Mobile App.', { align: 'center' });
        await print.writeDashLine();
        await print.writeTextWith2Column("Status", "OK");
        await print.writeTextWith2Column("Koneksi", "Stabil");
        await print.writeDashLine();
        await print.writeText("Test QR Code & Barcode:", { align: 'center' });
        await print.printQRCode("https://github.com/wahyufatur/POS-Mobile-Connect-CDN-jsdelivr-Print", {
            align: 'center',
            size: 'medium',
            errorCorrection: 'M'
        });
        await print.writeLineBreak();
        await print.printBarcode("1234567890", {
            align: 'center',
            displayValue: true,
            format: 'CODE128',
            height: 50
        });
        await print.writeLineBreak({ count: 3 });
    };
    await performPrintJob(printLogic);
}

async function printReceipt() {
    if (!currentReceiptTransaction) {
        showToast('Tidak ada data struk untuk dicetak.');
        return;
    }

    showToast('Mempersiapkan untuk mencetak struk...');

    const printLogic = async (print) => {
        const transactionData = currentReceiptTransaction;
        const settings = await getAllFromDB('settings');
        const settingsMap = new Map(settings.map(s => [s.key, s.value]));

        // Print Logo
        const logoUrl = settingsMap.get('storeLogo');
        if (logoUrl) {
            try {
                // The library has a bug or limitation with putImageWithUrl, so this might fail silently or warn.
                // We keep it for future library updates but wrap in try-catch to prevent breaking the print job.
                await print.putImageWithUrl(logoUrl, { align: "center" });
                await print.writeLineBreak({ count: 1 });
            } catch (e) {
                console.warn("Could not print logo from URL. The library might not support it or the image format is incorrect.", e);
            }
        }

        // Header
        await print.writeText(settingsMap.get('storeName') || 'Toko Anda', { align: 'center', bold: true, size: 'double' });
        await print.writeText(settingsMap.get('storeAddress') || '', { align: 'center' });
        await print.writeDashLine();

        // Transaction Info
        const dateParts = formatReceiptDate(transactionData.date).split(', ');
        await print.writeTextWith2Column(`No: ${transactionData.id}`, `Tgl: ${dateParts[0]}`);
        if (dateParts[1]) {
            await print.writeTextWith2Column('', `${dateParts[1]}`);
        }

        await print.writeDashLine();

        // Items
        for (const item of transactionData.items) {
            const leftPart = `${item.name} x${item.quantity}`;
            const rightPart = `${formatCurrency(item.effectivePrice * item.quantity)}`;
            await print.writeTextWith2Column(leftPart, rightPart);
            if (item.discountPercentage > 0) {
                await print.writeText(`  @ ${formatCurrency(item.price)} Disc ${item.discountPercentage}%`);
            }
        }

        await print.writeDashLine();

        // Summary
        const subtotalAfterDiscount = transactionData.subtotal - transactionData.totalDiscount;
        await print.writeTextWith2Column('Subtotal', `${formatCurrency(subtotalAfterDiscount)}`);

        if (transactionData.fees && transactionData.fees.length > 0) {
            for (const fee of transactionData.fees) {
                let feeName = fee.name;
                if (fee.type === 'percentage') {
                    feeName += ` ${fee.value}%`;
                }
                const feeAmount = `${formatCurrency(fee.amount)}`;
                await print.writeTextWith2Column(feeName, feeAmount);
            }
        }

        await print.writeDashLine();

        // Totals
        await print.writeTextWith2Column('TOTAL', `${formatCurrency(transactionData.total)}`, { bold: true });
        await print.writeTextWith2Column('TUNAI', `${formatCurrency(transactionData.cashPaid)}`);
        await print.writeTextWith2Column('KEMBALI', `${formatCurrency(transactionData.change)}`);

        await print.writeDashLine();

        // Footer
        const footerText = settingsMap.get('storeFooterText') || 'Terima kasih!';
        const footerLines = footerText.split('\n');
        for (const line of footerLines) {
            await print.writeText(line, { align: 'center' });
        }
        const feedbackPhone = settingsMap.get('storeFeedbackPhone');
        if (feedbackPhone) {
            await print.writeText(`Kritik/Saran: ${feedbackPhone}`, { align: 'center' });
        }

        await print.writeLineBreak({ count: 3 });
    };

    await performPrintJob(printLogic);
}
window.printReceipt = printReceipt;

window.showPrintHelpModal = function() {
    document.getElementById('printHelpModal').classList.remove('hidden');
}

window.closePrintHelpModal = function() {
    document.getElementById('printHelpModal').classList.add('hidden');
}


// --- BARCODE LABEL GENERATOR ---
document.getElementById('generateBarcodeLabelBtn')?.addEventListener('click', function() {
    const productName = document.getElementById('product-name').value;
    const productPrice = document.getElementById('product-price').value;
    const barcodeCode = document.getElementById('barcode-code').value.trim();

    if (!barcodeCode) {
        showToast('Teks/Angka untuk barcode wajib diisi.');
        return;
    }

    const outputContainer = document.getElementById('barcodeLabelOutput');
    const nameEl = document.getElementById('output-product-name');
    const priceEl = document.getElementById('output-product-price');
    const barcodeTextEl = document.getElementById('output-barcode-text');
    const downloadButtons = document.getElementById('download-buttons');

    // Update text content
    nameEl.textContent = productName || '';
    priceEl.textContent = productPrice ? `Rp ${formatCurrency(parseFloat(productPrice))}` : '';
    barcodeTextEl.textContent = barcodeCode;

    // Generate barcode
    try {
        JsBarcode("#barcode", barcodeCode, {
            format: "CODE128",
            lineColor: "#000",
            width: 2,
            height: 50,
            displayValue: false,
            margin: 5
        });
        outputContainer.classList.remove('hidden');
        downloadButtons.classList.remove('hidden');
    } catch (e) {
        showToast('Gagal membuat barcode. Kode tidak valid.');
        console.error("Barcode generation error:", e);
        outputContainer.classList.add('hidden');
        downloadButtons.classList.add('hidden');
    }
});

/**
 * Downloads the generated barcode label as a PNG image.
 * This uses a canvas to "screenshot" the label div.
 */
document.getElementById('downloadPngBtn')?.addEventListener('click', async function() {
    const labelContent = document.getElementById('labelContent');
    const outputContainer = document.getElementById('barcodeLabelOutput');
    const barcodeCode = document.getElementById('output-barcode-text').textContent;

    if (!labelContent || !outputContainer) return;
    showToast('Membuat gambar PNG...', 2000);

    // Temporarily remove border for cleaner screenshot
    const originalBorder = outputContainer.style.border;
    outputContainer.style.border = 'none';

    try {
        // Need to use an external library to convert DOM to canvas for reliable results,
        // but for this simple case, we'll try to reconstruct it on a canvas manually.
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Serialize the SVG to a string and create an Image object from it.
        const svgElement = labelContent.querySelector('#barcode');
        const svgString = new XMLSerializer().serializeToString(svgElement);
        const svgBlob = new Blob([svgString], {type: 'image/svg+xml;charset=utf-8'});
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        
        img.onload = () => {
            // Get text elements
            const nameText = labelContent.querySelector('#output-product-name').textContent;
            const priceText = labelContent.querySelector('#output-product-price').textContent;
            const codeText = barcodeCode;
            
            // Set canvas size, adding padding
            const padding = 20;
            const textHeight = (nameText ? 22 : 0) + (priceText ? 22 : 0) + (codeText ? 14 : 0);
            const totalHeight = img.height + textHeight + padding * 1.5;
            const totalWidth = Math.max(img.width + padding * 2, 280); // Minimum width
            
            canvas.width = totalWidth;
            canvas.height = totalHeight;

            // White background
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            let currentY = padding;

            // Draw text
            ctx.fillStyle = 'black';
            if (nameText) {
                ctx.font = 'bold 18px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(nameText, canvas.width / 2, currentY + 16);
                currentY += 22;
            }
            if (priceText) {
                ctx.font = '500 18px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(priceText, canvas.width / 2, currentY + 16);
                currentY += 22;
            }

            // Draw barcode image
            const imgX = (canvas.width - img.width) / 2;
            ctx.drawImage(img, imgX, currentY);
            currentY += img.height;

            // Draw barcode text
            if (codeText) {
                ctx.font = '14px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(codeText, canvas.width / 2, currentY + 14);
            }
            
            // Trigger download
            const link = document.createElement('a');
            link.download = `label-${codeText || 'barcode'}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            URL.revokeObjectURL(url);
            outputContainer.style.border = originalBorder; // Restore border
        };
        
        img.onerror = () => {
            showToast('Gagal memuat gambar barcode untuk diunduh.');
            URL.revokeObjectURL(url);
            outputContainer.style.border = originalBorder; // Restore border
        };

        img.src = url;

    } catch (error) {
        console.error('Error creating PNG:', error);
        showToast('Gagal membuat file PNG.');
        outputContainer.style.border = originalBorder; // Restore border
    }
});


/**
 * Prints the generated barcode label using a Bluetooth thermal printer.
 */
window.printBarcodeLabel = async function() {
    const productName = document.getElementById('output-product-name').textContent;
    const productPrice = document.getElementById('output-product-price').textContent;
    const barcodeCode = document.getElementById('output-barcode-text').textContent;

    if (!barcodeCode) {
        showToast('Tidak ada barcode untuk dicetak.');
        return;
    }

    const printLogic = async (print) => {
        if (productName) {
            await print.writeText(productName, { align: 'center', bold: true, size: 'single' });
        }
        if (productPrice) {
            await print.writeText(productPrice, { align: 'center', bold: true, size: 'single' });
        }

        await print.printBarcode(barcodeCode, {
            align: 'center',
            displayValue: true,
            format: 'CODE128',
            height: 50,
            width: 2
        });

        await print.writeLineBreak({ count: 3 });
    };

    await performPrintJob(printLogic);
};


// --- KIOSK MODE ---
window.handleKioskModeToggle = async function(isChecked) {
    const currentPin = await getSettingFromDB('kioskPin');
    if (isChecked && !currentPin) {
        // If enabling and no PIN is set, show the set PIN modal.
        // The toggle will be unchecked by the modal's cancel action if needed.
        showSetKioskPinModal();
    } else if (isChecked && currentPin) {
        // If enabling and PIN exists, just activate it.
        await putSettingToDB({ key: 'kioskModeEnabled', value: true });
        isKioskModeActive = true;
        enterKioskMode();
        showToast('Mode Kios diaktifkan.');
    } else {
        // If disabling, show the enter PIN modal.
        // The toggle will be re-checked if the PIN is wrong.
        showEnterKioskPinModal();
    }
}

function showSetKioskPinModal() {
    document.getElementById('setKioskPinModal').classList.remove('hidden');
}

function closeSetKioskPinModal() {
    document.getElementById('setKioskPinModal').classList.add('hidden');
    // If the user cancels setting a PIN, revert the toggle.
    const kioskToggle = document.getElementById('kioskModeToggle');
    if (kioskToggle.checked) {
        kioskToggle.checked = false;
    }
}

window.saveKioskPinAndActivate = async function() {
    const newPin = document.getElementById('newKioskPin').value;
    const confirmPin = document.getElementById('confirmKioskPin').value;

    if (newPin.length !== 4 || newPin !== confirmPin) {
        showToast('PIN tidak cocok atau kurang dari 4 digit.');
        return;
    }

    await putSettingToDB({ key: 'kioskPin', value: newPin });
    await putSettingToDB({ key: 'kioskModeEnabled', value: true });
    isKioskModeActive = true;
    
    closeSetKioskPinModal();
    enterKioskMode();
    showToast('PIN diatur & Mode Kios diaktifkan.');
}

function enterKioskMode() {
    isKioskModeActive = true;
    document.getElementById('bottomNav').classList.add('hidden');
    document.getElementById('exitKioskBtn').classList.remove('hidden');
    
    // Force navigate to Kasir page
    if (currentPage !== 'kasir') {
        showPage('kasir', { force: true });
    }
}

function exitKioskMode() {
    isKioskModeActive = false;
    document.getElementById('bottomNav').classList.remove('hidden');
    document.getElementById('exitKioskBtn').classList.add('hidden');
    showPage('dashboard', { force: true });
    showToast('Mode Kios dinonaktifkan.');
}

function showEnterKioskPinModal() {
    currentPinInput = "";
    updatePinDisplay();
    document.getElementById('kioskPinError').textContent = '';
    document.getElementById('enterKioskPinModal').classList.remove('hidden');
}

function closeEnterKioskPinModal() {
    document.getElementById('enterKioskPinModal').classList.add('hidden');
    // If user cancels exiting, and kiosk mode is supposed to be on, re-check the toggle.
    const kioskToggle = document.getElementById('kioskModeToggle');
    if (!kioskToggle.checked && isKioskModeActive) {
        kioskToggle.checked = true;
    }
}

async function handlePinKeyPress(key) {
    if (key === 'backspace') {
        currentPinInput = currentPinInput.slice(0, -1);
    } else if (key === 'clear') {
        currentPinInput = "";
    } else if (currentPinInput.length < 4) {
        currentPinInput += key;
    }
    
    updatePinDisplay();

    if (currentPinInput.length === 4) {
        const storedPin = await getSettingFromDB('kioskPin');
        if (currentPinInput === storedPin) {
            pinAttemptCount = 0;
            await putSettingToDB({ key: 'kioskModeEnabled', value: false });
            closeEnterKioskPinModal();
            exitKioskMode();
        } else {
            pinAttemptCount++;
            const pinDisplay = document.getElementById('kioskPinDisplay');
            const errorEl = document.getElementById('kioskPinError');
            
            errorEl.textContent = `PIN Salah (${pinAttemptCount}/5)`;
            pinDisplay.classList.add('animate-shake');
            updatePinDisplay(true); // 'true' indicates an error state
            
            if (pinAttemptCount >= 5) {
                errorEl.textContent = 'PIN salah 5x. Data akan dihapus.';
                setTimeout(() => {
                    clearAllData();
                }, 1500);
                return;
            }
            
            setTimeout(() => {
                currentPinInput = "";
                updatePinDisplay();
                pinDisplay.classList.remove('animate-shake');
            }, 500);
        }
    }
}
window.handlePinKeyPress = handlePinKeyPress;

function updatePinDisplay(isError = false) {
    const dots = document.querySelectorAll('#kioskPinDisplay div');
    dots.forEach((dot, index) => {
        if (index < currentPinInput.length) {
            dot.classList.add('bg-blue-500');
            dot.classList.remove('bg-gray-300');
        } else {
            dot.classList.remove('bg-blue-500');
            dot.classList.add('bg-gray-300');
        }
        // Handle error state color
        if (isError) {
            dot.classList.replace('bg-blue-500', 'bg-red-500');
        } else {
            dot.classList.remove('bg-red-500');
        }
    });
}


// --- APP INITIALIZATION ---
async function initializeApp() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const appContainer = document.getElementById('appContainer');
    
    try {
        await initDB();

        // Load external libraries and set readiness flags
        if (typeof Html5Qrcode !== 'undefined') {
            html5QrCode = new Html5Qrcode("qr-reader");
            isScannerReady = true;
        }
        if (typeof Chart !== 'undefined') {
            isChartJsReady = true;
        }
        if (typeof PrintHub !== 'undefined') {
            isPrinterReady = true;
        }

        updateFeatureAvailability();
        await applyDefaultFees();
        
        // Load initial settings
        lowStockThreshold = await getSettingFromDB('lowStockThreshold') || 5;
        const kioskEnabled = await getSettingFromDB('kioskModeEnabled') || false;

        if (kioskEnabled) {
            enterKioskMode();
        } else {
            showPage('dashboard');
        }

        setupEventListeners();
        checkOnlineStatus();
        
    } catch (error) {
        console.error("Initialization failed:", error);
        loadingOverlay.innerHTML = `<p class="text-red-500 p-4">Gagal memuat aplikasi. Coba muat ulang halaman.</p>`;
        return; // Stop execution
    }
    
    // Fade out loading screen and show app
    loadingOverlay.classList.add('opacity-0');
    setTimeout(() => {
        loadingOverlay.classList.add('hidden');
        appContainer.classList.remove('hidden');
    }, 300);
}

function setupEventListeners() {
    // Online/Offline status
    window.addEventListener('online', checkOnlineStatus);
    window.addEventListener('offline', checkOnlineStatus);

    // Search functionality
    document.getElementById('searchProduct')?.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('.product-item').forEach(item => {
            const name = item.dataset.name || '';
            const barcode = item.dataset.barcode || '';
            const isVisible = name.includes(searchTerm) || barcode.includes(searchTerm);
            item.style.display = isVisible ? 'block' : 'none';
        });
    });

    // Confirmation modal buttons
    document.getElementById('confirmButton')?.addEventListener('click', () => {
        if (confirmCallback) {
            confirmCallback();
        }
        closeConfirmationModal();
    });
    document.getElementById('cancelButton')?.addEventListener('click', closeConfirmationModal);
    
    setupChartViewToggle();

    // Ensure audio context is initialized on first user interaction
    document.body.addEventListener('click', initAudioContext, { once: true });
    
    // Auto-refresh dashboard if app becomes visible again after some time on a different day
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && currentPage === 'dashboard') {
            const todayString = new Date().toISOString().split('T')[0];
            // Ensure lastDashboardLoadDate is not null before comparing
            if (lastDashboardLoadDate && lastDashboardLoadDate !== todayString) {
                console.log('App became visible on a new day, refreshing dashboard.');
                loadDashboard();
            }
        }
    });
}

// Start the application once the DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);