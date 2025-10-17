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
    cameraStream: null
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
    clearAllData: settings.clearAllData,
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
    shareReceipt: peripherals.shareReceipt,
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
document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const appContainer = document.getElementById('appContainer');

    window.app.isScannerReady = typeof Html5Qrcode !== 'undefined';
    window.app.isPrinterReady = typeof EscPosEncoder !== 'undefined';
    window.app.isChartJsReady = typeof Chart !== 'undefined';

    try {
        await db.initDB();
        
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

        const kioskModeEnabled = await db.getSettingFromDB('kioskModeEnabled');
        if (kioskModeEnabled) {
            await settings.activateKioskMode();
        }

    } catch (error) {
        console.error("Initialization failed:", error);
        loadingOverlay.innerHTML = `<p class="text-red-500 p-4">Gagal memuat aplikasi. Silakan coba lagi.</p>`;
    } finally {
        loadingOverlay.classList.add('opacity-0');
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
            appContainer.classList.remove('hidden');
        }, 300);
    }
});