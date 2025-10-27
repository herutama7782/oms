// Main application entry point

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
    handleLoginPinKeyPress: settings.handleLoginPinKeyPress,
    logout: settings.logout,
    showManageUsersModal: settings.showManageUsersModal,
    closeManageUsersModal: settings.closeManageUsersModal,
    showUserFormModal: settings.showUserFormModal,
    closeUserFormModal: settings.closeUserFormModal,
    saveUser: settings.saveUser,
    deleteUser: settings.deleteUser,
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

async function initializeMainApp() {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const appContainer = document.getElementById('appContainer');

    await settings.loadSettings();
    await product.populateCategoryDropdowns(['productCategory', 'editProductCategory', 'productCategoryFilter']);
    await loadDashboard();

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
    
    // Check if a user is logged in
    const users = await db.getAllFromDB('users');
    if (users.length > 0) {
        // If there are users, start the login flow.
        // The main app will be shown after successful login.
        await settings.startAuthFlow(async () => {
            appContainer.classList.remove('hidden');
            loadingOverlay.classList.add('opacity-0');
            setTimeout(() => loadingOverlay.style.display = 'none', 300);
            
            ui.updateUiForRole();
            ui.showPage('dashboard', { force: true });
        });
    } else {
        // If no users, this might be the first run.
        // We'll let the user setup an owner account.
         await settings.startAuthFlow(async () => {
            appContainer.classList.remove('hidden');
            loadingOverlay.classList.add('opacity-0');
            setTimeout(() => loadingOverlay.style.display = 'none', 300);
            
            ui.updateUiForRole();
            ui.showPage('dashboard', { force: true });
        });
    }
}


// --- DOMContentLoaded ---
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadHtmlPartials();
        await db.initDB();

        // Check for library readiness
        const checkLibraries = (callback) => {
            const check = () => {
                if (window.EscPosEncoder) window.app.isPrinterReady = true;
                if (window.Html5Qrcode) window.app.isScannerReady = true;
                if (window.Chart) window.app.isChartJsReady = true;

                if (window.app.isPrinterReady && window.app.isScannerReady && window.app.isChartJsReady) {
                    callback();
                } else {
                    console.warn('One or more libraries not ready, retrying...');
                    setTimeout(check, 100);
                }
            };
            check();
        };

        checkLibraries(initializeMainApp);

    } catch (error) {
        console.error("Initialization failed:", error);
    }
});
