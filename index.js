
// Main application entry point
// FIX: Firebase imports are removed. The compat library loaded in index.html creates a global `firebase` object.

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
    cart: { items: [], fees: [], customerId: null, customerName: null },
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
    currentReportExpenses: [], // Store fetched expenses for report
    // Pagination & Cache State
    productsCache: [], // All products loaded from DB
    filteredGridProducts: [], // Products currently shown in Grid (filtered by search)
    filteredListProducts: [], // Products currently shown in List (filtered by search/cat)
    gridPage: 1,
    listPage: 1,
    itemsPerPage: 24,
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
    showConfirmationModal: ui.showConfirmationModal,
    closeConfirmationModal: ui.closeConfirmationModal,
    updateDashboardSummaries: ui.updateDashboardSummaries,
    updateUiForRole: ui.updateUiForRole,
    showToast: ui.showToast,
    formatCurrency: ui.formatCurrency,
    updatePendingBadge: ui.updatePendingBadge,
    executeConfirm: ui.executeConfirm,
    formatReceiptDate: ui.formatReceiptDate,
    getLocalDateString: ui.getLocalDateString,
    // product.js
    loadProductsList: product.loadProductsList,
    loadMoreProductsList: product.loadMoreProductsList, // NEW
    loadMoreProductsGrid: product.loadMoreProductsGrid, // NEW
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
    addWholesalePriceRow: product.addWholesalePriceRow,
    addVariationRow: product.addVariationRow,
    updateMainFieldsState: product.updateMainFieldsState,
    updateTotalStock: product.updateTotalStock,
    addVariationWholesalePriceRow: product.addVariationWholesalePriceRow,
    toggleUnlimitedStock: product.toggleUnlimitedStock,
    showStockHistoryModal: product.showStockHistoryModal,
    closeStockHistoryModal: product.closeStockHistoryModal,
    searchProducts: product.searchProducts,
    // cart.js
    addToCart: cart.addToCart,
    addVariationToCart: cart.addVariationToCart,
    closeVariationSelectionModal: cart.closeVariationSelectionModal,
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
    handleDonationToggle: cart.handleDonationToggle,
    updateCartDisplay: cart.updateCartDisplay,
    holdTransaction: cart.holdTransaction,
    showPendingTransactionsModal: cart.showPendingTransactionsModal,
    closePendingTransactionsModal: cart.closePendingTransactionsModal,
    resumeTransaction: cart.resumeTransaction,
    deletePendingTransaction: cart.deletePendingTransaction,
    searchCustomers: cart.searchCustomers,
    selectCustomer: cart.selectCustomer,
    removeSelectedCustomer: cart.removeSelectedCustomer,
    // report.js
    generateReport: report.generateReport,
    exportReportToCSV: report.exportReportToCSV,
    returnItem: report.returnItem,
    generateCashierReport: report.generateCashierReport,
    closeCashierReportModal: report.closeCashierReportModal,
    showExpenseModal: report.showExpenseModal,
    closeExpenseModal: report.closeExpenseModal,
    showExpenseFormModal: report.showExpenseFormModal,
    closeExpenseFormModal: report.closeExpenseFormModal,
    saveExpense: report.saveExpense,
    deleteExpense: report.deleteExpense,
    // contact.js
    switchContactTab: contact.switchContactTab,
    showContactModal: contact.showContactModal,
    closeContactModal: contact.closeContactModal,
    saveContact: contact.saveContact,
    deleteContact: contact.deleteContact,
    resetContactPoints: contact.resetContactPoints,
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
    searchContacts: contact.searchContacts,
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
    startCountdown: settings.startCountdown,
    resetDonationCounter: settings.resetDonationCounter,
    extendProAccess: settings.extendProAccess,
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
    showRegisterView: settings.showRegisterView,
    showForgotPasswordView: settings.showForgotPasswordView,
    handleEmailLogin: settings.handleEmailLogin,
    handleEmailRegister: settings.handleEmailRegister,
    handleForgotPassword: settings.handleForgotPassword,
    togglePasswordVisibility: settings.togglePasswordVisibility,
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
    // UPDATED: Use searchProducts instead of filterProductsInGrid
    document.getElementById('searchProduct')?.addEventListener('input', product.searchProducts);
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
    ui.updatePendingBadge();
}

function listenForAuthStateChanges() {
    // FIX: Use the compat version of onAuthStateChanged
    window.auth.onAuthStateChanged(async (firebaseUser) => {
        const loadingOverlay = document.getElementById('loadingOverlay');
        window.app.firebaseUser = firebaseUser;

        if (firebaseUser) {
            // BUG FIX: Add check to ensure email is verified for persistent sessions.
            if (!firebaseUser.emailVerified && !firebaseUser.isAnonymous) {
                console.log("User email not verified on session load. Forcing to auth screen.");
                
                // Don't sign out automatically, they might be in the process of verifying.
                // Just prevent access to the main app.
                document.getElementById('appContainer').classList.add('hidden');
                document.getElementById('bottomNav').classList.add('hidden');
                document.getElementById('loginModal')?.classList.add('hidden');
                document.getElementById('setDevicePinModal')?.classList.add('hidden');

                loadingOverlay.classList.add('opacity-0');
                setTimeout(() => loadingOverlay.style.display = 'none', 300);
                
                const msg = 'Silakan verifikasi email Anda untuk melanjutkan.';
                settings.showAuthContainer(msg, 'info');
                
                return; // Stop further processing until verified
            }

            // Firebase user is logged in and verified.
            console.log("Firebase user detected:", firebaseUser.uid, "Is Anonymous:", firebaseUser.isAnonymous);
            await settings.initiatePinLoginFlow(firebaseUser);
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
            // FIX: Check for the global `firebase` object instead of just Chart.js etc.
            if (window.firebase && window.EscPosEncoder && window.Html5Qrcode && window.Chart && 
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
        
        // FIX: Use global `firebase` object for initialization
        const firebaseApp = firebase.initializeApp(firebaseConfig);
        window.auth = firebase.auth();
        
        try {
            // FIX: Use compat API for firestore and enabling persistence
            window.db_firestore = firebase.firestore();
            await window.db_firestore.enablePersistence();
            console.log('Firestore offline persistence enabled.');
        } catch (err) {
            console.error("Firestore initialization with persistence failed:", err);
            if (err.code === 'failed-precondition') {
                 console.warn('Firestore persistence failed: multiple tabs open or other issue.');
            }
             // Fallback to in-memory persistence
            window.db_firestore = firebase.firestore();
        }

        await db.initDB();
        await initializeAppDependencies();
        listenForAuthStateChanges();

    } catch (error) {
        console.error("Initialization failed:", error);
    }
});
