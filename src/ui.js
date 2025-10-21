import { applyDefaultFees, reconcileCartFees } from './settings.js';
import { loadProductsGrid, loadProductsList } from './product.js';
import { updateCartFabBadge } from './cart.js';
import { loadContactsPage, checkDueDateNotifications } from './contact.js';
import { loadSettings } from './settings.js';
import { getAllFromDB, getSettingFromDB } from './db.js';
import { displaySalesReport } from './report.js';

let isNavigating = false;
let pageZIndex = 10; // Start with a base z-index for pages

export function formatCurrency(amount) {
    return Math.round(amount).toLocaleString('id-ID');
}

export function getLocalDateString(dateInput) {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatReceiptDate(isoString) {
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

export function updateDashboardDate() {
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
window.updateDashboardSummaries = updateDashboardSummaries;

export function loadDashboard() {
    updateDashboardDate();
    window.app.lastDashboardLoadDate = getLocalDateString(new Date());

    console.log('Refreshing dashboard stats.');

    const today = new Date();
    const todayString = getLocalDateString(today);
    const monthStart = getLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1));
    
    getAllFromDB('transactions').then(transactions => {
        window.app.dashboardTransactions = transactions;
        let todaySales = 0;
        let todayTransactionsCount = 0;
        let monthSales = 0;
        
        transactions.forEach(t => {
            const transactionDate = getLocalDateString(t.date);
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
        const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= window.app.lowStockThreshold).length;
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
    getSettingFromDB('storeLogo').then(value => {
        const logoContainer = document.getElementById('dashboardLogo');
        const logoImg = document.getElementById('dashboardLogoImg');
        if (logoContainer && logoImg && value) {
            logoImg.src = value;
            logoContainer.classList.remove('hidden');
        } else if (logoContainer) {
            logoContainer.classList.add('hidden');
        }
    });
}

export function checkDashboardRefresh() {
    const today = getLocalDateString(new Date());
    if (window.app.currentPage === 'dashboard' && window.app.lastDashboardLoadDate !== today) {
        console.log('Day has changed, refreshing dashboard.');
        loadDashboard();
    }
}

export function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }
}

export function updateSyncStatusUI(status) {
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

export async function showPage(pageName, options = { force: false, initialTab: null }) {
    const { force, initialTab } = options;

    if (window.app.isKioskModeActive && pageName !== 'kasir') {
        showToast('Mode Kios aktif. Fitur lain dinonaktifkan.');
        return; 
    }

    if (window.app.currentPage === 'kasir' && window.app.cart.items.length > 0 && pageName !== 'kasir' && !force) {
        showConfirmationModal(
            'Keranjang Belum Disimpan',
            'Anda memiliki item di keranjang. Meninggalkan halaman ini akan mengosongkan keranjang. Lanjutkan?',
            async () => {
                window.app.cart = { items: [], fees: [] };
                await applyDefaultFees();
                updateCartFabBadge();
                showPage(pageName, { force: true });
            },
            'Ya, Lanjutkan & Kosongkan',
            'bg-yellow-500' 
        );
        return;
    }

    if (window.app.currentPage === pageName || isNavigating) return;
    isNavigating = true;

    const transitionDuration = 350; // Match CSS

    const oldPage = document.querySelector('.page.active');
    const newPage = document.getElementById(pageName);
    const cartFab = document.getElementById('cartFab');

    if (!newPage) {
        isNavigating = false;
        return;
    }

    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (navItem) navItem.classList.add('active');

    // Prepare new page for transition
    newPage.style.zIndex = `${++pageZIndex}`;
    newPage.classList.add('page-enter');
    newPage.style.display = 'block';

    if (oldPage) {
        oldPage.classList.add('page-exit');
    }
    
    if (pageName === 'kasir') {
        cartFab.classList.remove('hidden');
    }

    if (pageName === 'dashboard') {
        loadDashboard();
    } else if (pageName === 'kasir') {
        loadProductsGrid();
        await reconcileCartFees();
        updateCartFabBadge();
    } else if (pageName === 'produk') {
        loadProductsList();
    } else if (pageName === 'kontak') {
        loadContactsPage(initialTab);
    } else if (pageName === 'pengaturan') {
        loadSettings();
        window.loadFees();
    }

    // Trigger transition
    requestAnimationFrame(() => {
        newPage.classList.remove('page-enter');
        newPage.classList.add('active');

        setTimeout(() => {
            if (oldPage) {
                oldPage.classList.remove('active');
                oldPage.classList.remove('page-exit');
                oldPage.style.display = 'none';
            }

            window.app.currentPage = pageName;
            isNavigating = false;
            
            if (pageName !== 'kasir') {
                cartFab.classList.add('hidden');
            }

            if (pageName === 'kasir') {
                const searchInput = document.getElementById('searchProduct');
                if (searchInput) {
                    setTimeout(() => searchInput.focus(), 50);
                }
            }
        }, transitionDuration);
    });
}

export function handleNavClick(button) {
    const pageName = button.dataset.page;
    if (pageName) {
        showPage(pageName);
    }
}

export function showConfirmationModal(title, message, onConfirm, confirmText = 'OK', confirmClass = 'bg-blue-500') {
    document.getElementById('confirmationTitle').innerHTML = title;
    document.getElementById('confirmationMessage').innerHTML = message;
    
    const confirmButton = document.getElementById('confirmButton');
    const cancelButton = document.getElementById('cancelButton');
    
    confirmButton.textContent = confirmText;
    
    const isInfoModal = onConfirm && onConfirm.toString() === '() => {}';

    if (isInfoModal) {
        cancelButton.classList.add('hidden');
        confirmButton.className = `btn text-white w-full py-2 ${confirmClass}`;
    } else {
        cancelButton.classList.remove('hidden');
        confirmButton.className = `btn text-white flex-1 py-2 ${confirmClass}`;
        cancelButton.className = 'btn bg-gray-300 text-gray-700 flex-1 py-2';
    }

    window.app.confirmCallback = onConfirm;
    document.getElementById('confirmationModal').classList.remove('hidden');
}

export function closeConfirmationModal() {
    (document.getElementById('confirmationModal')).classList.add('hidden');
    window.app.confirmCallback = null;
}

export function executeConfirm() {
    if (window.app.confirmCallback) {
        window.app.confirmCallback();
    }
    closeConfirmationModal();
}
