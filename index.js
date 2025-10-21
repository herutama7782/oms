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
    isKioskModeActive: false,
    currentPinInput: "",
    pinAttemptCount: 0,
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
    // report.js
    generateReport: report.generateReport,
    exportReportToCSV: report.exportReportToCSV,
    returnItem: report.returnItem,
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
    handleKioskModeToggle: settings.handleKioskModeToggle,
    showSetKioskPinModal: settings.showSetKioskPinModal,
    closeSetKioskPinModal: settings.closeSetKioskPinModal,
    saveKioskPinAndActivate: settings.saveKioskPinAndActivate,
    showEnterKioskPinModal: settings.showEnterKioskPinModal,
    closeEnterKioskPinModal: settings.closeEnterKioskPinModal,
    handlePinKeyPress: settings.handlePinKeyPress,
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
    
    ui.updateUiForRole(); // Update UI based on logged in user's role

    const kioskModeEnabled = await db.getSettingFromDB('kioskModeEnabled');
    if (kioskModeEnabled) {
        await settings.activateKioskMode();
    }

    loadingOverlay.classList.add('opacity-0');
    setTimeout(() => {
        loadingOverlay.style.display = 'none';
        appContainer.classList.remove('hidden');
    }, 300);
}


document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loadingOverlay');

    try {
        await loadHtmlPartials();

        window.app.isScannerReady = typeof Html5Qrcode !== 'undefined';
        window.app.isPrinterReady = typeof EscPosEncoder !== 'undefined';
        window.app.isChartJsReady = typeof Chart !== 'undefined';

        await db.initDB();
        
        // New Login Flow
        await settings.startAuthFlow(initializeMainApp);

    } catch (error) {
        console.error("Initialization failed:", error);
        if (loadingOverlay.textContent.includes('Memuat')) {
            loadingOverlay.innerHTML = `<p class="text-red-500 p-4">Gagal memuat aplikasi. Silakan coba lagi.</p>`;
        }
    }
});