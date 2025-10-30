// Main application entry point
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Import all modules
import * as audio from './src/audio.js';
import * as db from './src/db.js';
import * as ui from './src/ui.js';
import * as product from './src/product.js';
import * as cart from './src/cart.js';
import * as report from './src/report.js';
import * as contact from './src/contact.js';
import * as settings from './src/settings.js';
import * as peripherals from './src/peripherals.js';
import * as sync from './src/sync.js';
import { loadDashboard, checkDashboardRefresh } from './src/ui.js';


// --- GLOBAL STATE ---
// Central state object to avoid complex module dependencies
window.app = {
    db: null,
    cart: { items: [], fees: [] },
    currentImageData: null,
    currentEditImageData: null,
    currentStoreLogoData: null,
    currentPage: 'dashboard',
    confirmCallback: null,
    html5QrCode: null,
    currentReportData: [],
    currentCashierReportData: null,
    dashboardTransactions: [],
    lowStockThreshold: 5,
    isOnline: navigator.onLine,
    isSyncing: false,
    currentReceiptTransaction: null,
    isPrinterReady: false,
    isScannerReady: false,
    isChartJsReady: false,
    salesChartInstance: null,
    scanCallback: null,
    currentPinInput: "",
    lastDashboardLoadDate: null,
    audioContext: null,
    currentContactId: null,
    dueItemsList: [],
    activePopover: null,
    cameraStream: null,
    currentUser: null, // For multi-user support
    firebaseUser: null, // For Firebase auth user,
    onLoginSuccess: null,
};

// --- GLOBAL FUNCTIONS ---
// Expose functions needed by HTML onclick attributes to the window object
const functions = {
    // audio.js
    initAudioContext: audio.initAudioContext,
    // ui.js
    showPage: ui.showPage,
    handleNavClick: ui.handleNavClick,
    loadDashboard: ui.loadDashboard,
    closeConfirmationModal: ui.closeConfirmationModal,
    // product.js
    loadProductsList: product.loadProductsList,
    showAddProductModal: product.showAddProductModal,
    closeAddProductModal: product.closeAddProductModal,
    previewImage: product.previewImage,
    addProduct: product.addProduct,
    editProduct: product.editProduct,
    closeEditProductModal: product.closeEditProductModal,
    previewEditImage: product.previewEditImage,
    updateProduct: product.updateProduct,
    deleteProduct: product.deleteProduct,
    increaseStock: product.increaseStock,
    decreaseStock: product.decreaseStock,
    showManageCategoryModal: product.showManageCategoryModal,
    closeManageCategoryModal: product.closeManageCategoryModal,
    addNewCategory: product.addNewCategory,
    deleteCategory: product.deleteCategory,
    // cart.js
    addToCart: cart.addToCart,
    updateCartItemQuantity: cart.updateCartItemQuantity,
    clearCart: cart.clearCart,
    showCartModal: cart.showCartModal,
    hideCartModal: cart.hideCartModal,
    showPaymentModal: cart.showPaymentModal,
    closePaymentModal: cart.closePaymentModal,
    handleQuickCash: cart.handleQuickCash,
    completeTransaction: cart.completeTransaction,
    startNewTransaction: cart.startNewTransaction,
    selectPaymentMethod: cart.selectPaymentMethod,
    // report.js
    generateReport: report.generateReport,
    exportReportToCSV: report.exportReportToCSV,
    returnItem: report.returnItem,
    generateCashierReport: report.generateCashierReport,
    closeCashierReportModal: report.closeCashierReportModal,
    // contact.js
    switchContactTab: contact.switchContactTab,
    showContactModal: contact.showContactModal,
    closeContactModal: contact.closeContactModal,
    saveContact: contact.saveContact,
    deleteContact: contact.deleteContact,
    showLedgerModal: contact.showLedgerModal,
    closeLedgerModal: contact.closeLedgerModal,
    showAddLedgerEntryModal: contact.showAddLedgerEntryModal,
    closeAddLedgerEntryModal: contact.closeAddLedgerEntryModal,
    saveLedgerEntry: contact.saveLedgerEntry,
    showLedgerActions: contact.showLedgerActions,
    editLedgerEntry: contact.editLedgerEntry,
    deleteLedgerEntry: contact.deleteLedgerEntry,
    showEditDueDateModal: contact.showEditDueDateModal,
    closeEditDueDateModal: contact.closeEditDueDateModal,
    saveDueDate: contact.saveDueDate,
    viewLedgerFromDueDateModal: contact.viewLedgerFromDueDateModal,
    showDueDateModal: contact.showDueDateModal,
    closeDueDateModal: contact.closeDueDateModal,
    // settings.js
    saveStoreSettings: settings.saveStoreSettings,
    previewStoreLogo: settings.previewStoreLogo,
    addFee: settings.addFee,
    deleteFee: settings.deleteFee,
    loadFees: settings.loadFees,
    showFeeSelectionModal: settings.showFeeSelectionModal,
    closeFeeSelectionModal: settings.closeFeeSelectionModal,
    applySelectedFees: settings.applySelectedFees,
    exportData: settings.exportData,
    importData: settings.importData,
    handleImport: settings.handleImport,
    showImportProductsModal: settings.showImportProductsModal,
    closeImportProductsModal: settings.closeImportProductsModal,
    handleProductImport: settings.handleProductImport,
    clearAllData: settings.clearAllData,
    // Auth & User Management (from settings.js)
    logout: settings.logout,
    lockScreen: settings.lockScreen,
    showManageUsersModal: settings.showManageUsersModal,
    closeManageUsersModal: settings.closeManageUsersModal,
    showUserFormModal: settings.showUserFormModal,
    closeUserFormModal: settings.closeUserFormModal,
    saveUser: settings.saveUser,
    deleteUser: settings.deleteUser,
    // PIN Management
    handlePinInput: settings.handlePinInput,
    handleInitialPinSetup: settings.handleInitialPinSetup,
    // Firebase Auth functions
    showLoginView: settings.showLoginView,
    showForgotPasswordView: settings.showForgotPasswordView,
    handleEmailLogin: settings.handleEmailLogin,
    handleForgotPassword: settings.handleForgotPassword,
    // peripherals.js
    openCameraModal: peripherals.openCameraModal,
    closeCameraModal: peripherals.closeCameraModal,
    capturePhoto: peripherals.capturePhoto,
    retakePhoto: peripherals.retakePhoto,
    useCapturedPhoto: peripherals.useCapturedPhoto,
    showScanModal: peripherals.showScanModal,
    scanBarcodeForInput: peripherals.scanBarcodeForInput,
    closeScanModal: peripherals.closeScanModal,
    printReceipt: peripherals.printReceipt,
    testPrint: peripherals.testPrint,
    showPrintHelpModal: peripherals.showPrintHelpModal,
    closePrintHelpModal: peripherals.closePrintHelpModal,
    showPreviewReceiptModal: peripherals.showPreviewReceiptModal,
    closePreviewReceiptModal: peripherals.closePreviewReceiptModal,
    printCashierReport: peripherals.printCashierReport,
    // sync.js
    syncWithServer: sync.syncWithServer,
};
Object.assign(window, functions);


// --- INITIALIZATION ---
async function loadHtmlPartials() {
    try {
        const [pagesRes, modalsRes] = await Promise.all([
            fetch('src/html/pages.html'),
            fetch('src/html/modals.html')
        ]);

        if (!pagesRes.ok || !modalsRes.ok) {
            throw new Error(`Failed to load HTML partials. Pages: ${pagesRes.status}, Modals: ${modalsRes.status}`);
        }

        const pagesHtml = await pagesRes.text();
        const modalsHtml = await modalsRes.text();

        document.getElementById('appContainer').insertAdjacentHTML('beforeend', pagesHtml);
        document.body.insertAdjacentHTML('beforeend', modalsHtml);

    } catch (error) {
        console.error("Error loading HTML partials:", error);
        const loadingOverlay = document.getElementById('loadingOverlay');
        const appContainer = document.getElementById('appContainer');
        if(appContainer) appContainer.innerHTML = '';
        if(loadingOverlay) loadingOverlay.innerHTML = `<div class="p-4 text-center"><p class="text-red-500 font-semibold">Gagal memuat komponen aplikasi.</p><p class="text-sm text-gray-600 mt-2">Silakan periksa koneksi internet Anda dan coba muat ulang halaman.</p></div>`;
        
        if(loadingOverlay) {
             loadingOverlay.classList.remove('opacity-0');
             loadingOverlay.style.display = 'flex';
        }
       
        throw error;
    }
}

async function initializeAppDependencies() {
    await settings.loadSettings();
    await product.populateCategoryDropdowns(['productCategory', 'editProductCategory', 'productCategoryFilter']);
    
    // Setup event listeners that are not onclick
    document.getElementById('searchProduct')?.addEventListener('input', product.filterProductsInGrid);
    document.getElementById('confirmButton')?.addEventListener('click', ui.executeConfirm);
    document.getElementById('cancelButton')?.addEventListener('click', ui.closeConfirmationModal);
    document.getElementById('cashPaidInput')?.addEventListener('input', cart.updatePaymentChange);

    report.setupChartViewToggle();
    peripherals.setupBarcodeGenerator();

    if (window.app.isScannerReady) {
        window.app.html5QrCode = new Html5Qrcode("qr-reader");
    }

    document.body.addEventListener('click', audio.initAudioContext, { once: true });

    window.addEventListener('online', sync.checkOnlineStatus);
    window.addEventListener('offline', sync.checkOnlineStatus);
    await sync.checkOnlineStatus();

    setInterval(checkDashboardRefresh, 60 * 1000);

    document.addEventListener('click', (e) => {
        if (window.app.activePopover && !window.app.activePopover.contains(e.target) && !e.target.closest('[onclick^="showLedgerActions"]')) {
            contact.closeLedgerActions();
        }
    });

    peripherals.updateFeatureAvailability();
}

function listenForAuthStateChanges() {
    onAuthStateChanged(window.auth, async (firebaseUser) => {
        const loadingOverlay = document.getElementById('loadingOverlay');
        window.app.firebaseUser = firebaseUser;

        if (firebaseUser) {
            // Firebase user is logged in. This could be a registered user or a guest.
            console.log("Firebase user detected:", firebaseUser.uid, "Is Anonymous:", firebaseUser.isAnonymous);
            await settings.initiatePinLoginFlow(firebaseUser); // This function will now handle both cases
        } else {
            // Firebase user is not logged in. Show login/register screen.
            console.log("No Firebase user. Showing auth screen.");
            document.getElementById('appContainer').classList.add('hidden');
            document.getElementById('bottomNav').classList.add('hidden');
            // Hide all PIN modals as well
            document.getElementById('loginModal')?.classList.add('hidden');
            document.getElementById('setDevicePinModal')?.classList.add('hidden');

            loadingOverlay.classList.add('opacity-0');
            setTimeout(() => loadingOverlay.style.display = 'none', 300);
            settings.showAuthContainer();
        }
    });
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful:', registration.scope);

                // This logic handles the update flow
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New update available
                                const toast = document.getElementById('toast');
                                if (toast) {
                                    toast.innerHTML = `Pembaruan tersedia! <button id="reload-button" class="ml-4 font-bold underline">Muat Ulang</button>`;
                                    toast.classList.add('show');
                                    
                                    document.getElementById('reload-button').onclick = () => {
                                        newWorker.postMessage({ action: 'skipWaiting' });
                                        window.location.reload();
                                    };
                                }
                            }
                        });
                    }
                });
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    }
}


// --- DOMContentLoaded ---
async function waitForLibraries() {
    return new Promise(resolve => {
        const check = () => {
            if (window.EscPosEncoder && window.Html5Qrcode && window.Chart && 
                window.html2canvas && window.JsBarcode) {
                
                if (!window.app.isPrinterReady) window.app.isPrinterReady = true;
                if (!window.app.isScannerReady) window.app.isScannerReady = true;
                if (!window.app.isChartJsReady) window.app.isChartJsReady = true;

                console.log('All libraries ready.');
                resolve();
            } else {
                console.warn('One or more libraries not ready, retrying...');
                setTimeout(check, 100);
            }
        };
        check();
    });
}


window.addEventListener('DOMContentLoaded', async () => {
    try {
        registerServiceWorker(); // Register SW as early as possible
        
        await loadHtmlPartials();
        
        await waitForLibraries();

        const firebaseConfig = {
            apiKey: "AIzaSyBq_BeiCGHKnhFrZvDc0U9BHuZefVaywG0",
            authDomain: "omsetin-45334.firebaseapp.com",
            projectId: "omsetin-45334",
            storageBucket: "omsetin-45334.appspot.com",
            messagingSenderId: "944626340482",
            appId: "1:944626340482:web:61d4a8c5c3c1a3b3e1c2e1"
        };
        
        const firebaseApp = initializeApp(firebaseConfig);
        window.auth = getAuth(firebaseApp);
        
        try {
            window.db_firestore = initializeFirestore(firebaseApp, {
                localCache: persistentLocalCache({})
            });
            console.log('Firestore offline persistence enabled.');
        } catch (err) {
            console.error("Firestore initialization with persistence failed:", err);
            if (err.code === 'failed-precondition') {
                 console.warn('Firestore persistence failed: multiple tabs open or other issue.');
            }
             // Fallback to in-memory persistence
            window.db_firestore = initializeFirestore(firebaseApp, {});
        }

        await db.initDB();
        await initializeAppDependencies();
        listenForAuthStateChanges();

    } catch (error) {
        console.error("Initialization failed:", error);
    }
});