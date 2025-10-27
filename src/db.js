import { showToast } from './ui.js';

// --- DATABASE FUNCTIONS ---
export function initDB() {
    return new Promise((resolve, reject) => {
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

        const request = indexedDB.open('POS_DB', 9); 

        request.onerror = function(event) {
            console.error("Database error:", event.target.error);
            showToast('Gagal menginisialisasi database');
            reject(event.target.error);
        };
        
        request.onsuccess = function(event) {
            window.app.db = event.target.result;
            resolve();
        };
        
        request.onupgradeneeded = async function(event) {
            window.app.db = event.target.result;
            const transaction = event.target.transaction;
            
            if (event.oldVersion < 2) {
                if (!window.app.db.objectStoreNames.contains('products')) {
                    const productStore = window.app.db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
                    productStore.createIndex('name', 'name', { unique: false });
                }
                if (!window.app.db.objectStoreNames.contains('transactions')) {
                    const transactionStore = window.app.db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
                    transactionStore.createIndex('date', 'date', { unique: false });
                }
                if (!window.app.db.objectStoreNames.contains('settings')) {
                    window.app.db.createObjectStore('settings', { keyPath: 'key' });
                }
            }
            
            if (event.oldVersion < 3) {
                if (window.app.db.objectStoreNames.contains('products')) {
                    const productStore = transaction.objectStore('products');
                    if (!productStore.indexNames.contains('barcode')) {
                        productStore.createIndex('barcode', 'barcode', { unique: true });
                    }
                }
            }

            if (event.oldVersion < 4) {
                if (!window.app.db.objectStoreNames.contains('auto_backup')) {
                    window.app.db.createObjectStore('auto_backup', { keyPath: 'key' });
                }
            }
            
            if (event.oldVersion < 5) {
                if (!window.app.db.objectStoreNames.contains('categories')) {
                    const categoryStore = window.app.db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
                    categoryStore.createIndex('name', 'name', { unique: true });
                }
                const productStore = transaction.objectStore('products');
                const categoryStore = transaction.objectStore('categories');
                const existingCategories = new Set();

                const productsRequest = productStore.getAll();
                productsRequest.onsuccess = () => {
                    const products = productsRequest.result;
                    products.forEach(p => {
                        if (p.category) {
                            existingCategories.add(p.category.trim());
                        }
                    });
                    ['Makanan', 'Minuman', 'Lainnya'].forEach(cat => existingCategories.add(cat));

                    existingCategories.forEach(categoryName => {
                        categoryStore.add({ name: categoryName });
                    });
                };
            }

            if (event.oldVersion < 6) {
                if (!window.app.db.objectStoreNames.contains('sync_queue')) {
                    window.app.db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                }
            }
             if (event.oldVersion < 7) {
                if (!window.app.db.objectStoreNames.contains('fees')) {
                    window.app.db.createObjectStore('fees', { keyPath: 'id', autoIncrement: true });
                }

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
                if (!window.app.db.objectStoreNames.contains('contacts')) {
                    const contactStore = window.app.db.createObjectStore('contacts', { keyPath: 'id', autoIncrement: true });
                    contactStore.createIndex('type', 'type', { unique: false });
                }
                if (!window.app.db.objectStoreNames.contains('ledgers')) {
                     const ledgerStore = window.app.db.createObjectStore('ledgers', { keyPath: 'id', autoIncrement: true });
                     ledgerStore.createIndex('contactId', 'contactId', { unique: false });
                }
            }
            
            if (event.oldVersion < 9) {
                if (!window.app.db.objectStoreNames.contains('users')) {
                    const userStore = window.app.db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
                    userStore.createIndex('pin', 'pin', { unique: true });
                    userStore.createIndex('role', 'role', { unique: false });
                }
                const transactionStore = transaction.objectStore('transactions');
                if (!transactionStore.indexNames.contains('userId')) {
                    transactionStore.createIndex('userId', 'userId', { unique: false });
                }
            }
        };
    });
}


export function getFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        if (!window.app.db) {
            console.error('Database not initialized on getFromDB');
            reject('Database not initialized');
            return;
        }
        const transaction = window.app.db.transaction([storeName], 'readonly');
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

export function getAllFromDB(storeName, indexName, query) {
    return new Promise((resolve, reject) => {
        if (!window.app.db) {
            console.error('Database not initialized on getAllFromDB');
            reject('Database not initialized');
            return;
        }
        const transaction = window.app.db.transaction([storeName], 'readonly');
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

export function getFromDBByIndex(storeName, indexName, key) {
    return new Promise((resolve, reject) => {
        if (!window.app.db) {
            console.error('Database not initialized on getFromDBByIndex');
            reject('Database not initialized');
            return;
        }
        // An empty key is not valid for a query. Return null immediately.
        if (key === null || key === undefined || key === '') {
            return resolve(null);
        }
        const transaction = window.app.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.get(key);
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(`Error fetching from index ${indexName} in DB: ` + event.target.error);
        };
    });
}


export function putToDB(storeName, value) {
    return new Promise((resolve, reject) => {
        if (!window.app.db) {
            console.error('Database not initialized on putToDB');
            reject('Database not initialized');
            return;
        }
        const transaction = window.app.db.transaction([storeName], 'readwrite');
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

export async function getSettingFromDB(key) {
    const setting = await getFromDB('settings', key);
    return setting ? setting.value : undefined;
}

export async function putSettingToDB(setting) {
    return putToDB('settings', setting);
}

export async function clearAllStores() {
    return new Promise((resolve, reject) => {
        if (!window.app.db) {
            reject('Database not initialized');
            return;
        }
        const transaction = window.app.db.transaction(window.app.db.objectStoreNames, 'readwrite');
        Array.from(window.app.db.objectStoreNames).forEach(storeName => {
            transaction.objectStore(storeName).clear();
        });
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
    });
}