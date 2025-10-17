

import { getSettingFromDB, getAllFromDB } from "./db.js";
import { showToast, showConfirmationModal, formatCurrency, formatReceiptDate } from "./ui.js";
import { addToCart } from "./cart.js";

// --- UTILITY FUNCTIONS ---
function justifyLine(text, width) {
  const t = (text || '').trim();
  if (!t) return ''.padEnd(width, ' ');
  if (t.length >= width) return t.slice(0, width);

  const words = t.split(/\s+/);
  if (words.length === 1) return t.padEnd(width, ' ');

  const wordsLen = words.reduce((a, w) => a + w.length, 0);
  const spacesNeeded = width - wordsLen;
  const gaps = words.length - 1;
  const base = Math.floor(spacesNeeded / gaps);
  let extra = spacesNeeded % gaps;

  let out = '';
  for (let i = 0; i < words.length; i++) {
    out += words[i];
    if (i < gaps) {
      const add = base + (extra > 0 ? 1 : 0);
      out += ' '.repeat(add);
      if (extra > 0) extra--;
    }
  }
  return out;
}

function centerPad(text, width) {
  const t = (text || '').trim();
  if (!t) return ' '.repeat(width);
  if (t.length >= width) return t.slice(0, width);
  const left = Math.floor((width - t.length) / 2);
  const right = width - t.length - left;
  return ' '.repeat(left) + t + ' '.repeat(right);
}

function wrapWords(text, width) {
  // bungkus per kata agar tidak motong di tengah kata
  const raw = (text || '').toString().replace(/\s+/g, ' ').trim();
  if (!raw) return [' '.repeat(width)];
  const words = raw.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!line.length) {
      line = w;
    } else if ((line.length + 1 + w.length) <= width) {
      line += ' ' + w;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  // pastikan tidak ada baris kosong
  return lines.map(l => l || ' '.repeat(width));
}

function wrapAndCenter(text, width) {
  return wrapWords(text, width).map(l => centerPad(l, width));
}


// --- CAMERA FUNCTIONS ---
export async function openCameraModal() {
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
        window.app.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = window.app.cameraStream;
        await video.play();
    } catch (err) {
        console.error("Error accessing camera:", err);
        errorEl.textContent = 'Gagal mengakses kamera. Pastikan izin telah diberikan.';
        errorEl.style.display = 'block';
        video.style.display = 'none';
        captureBtn.style.display = 'none';
    }
}

export function closeCameraModal() {
    if (window.app.cameraStream) {
        window.app.cameraStream.getTracks().forEach(track => track.stop());
        window.app.cameraStream = null;
    }
    const video = document.getElementById('cameraFeed');
    if (video) video.srcObject = null;
    document.getElementById('cameraModal').classList.add('hidden');
}

export function capturePhoto() {
    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('cameraCanvas');
    const photoPreview = document.getElementById('photoPreview');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    photoPreview.src = canvas.toDataURL('image/jpeg');
    photoPreview.style.display = 'block';
    video.style.display = 'none';

    captureBtn.style.display = 'none';
    retakeBtn.style.display = 'block';
    usePhotoBtn.style.display = 'block';
}

export function retakePhoto() {
    const video = document.getElementById('cameraFeed');
    const photoPreview = document.getElementById('photoPreview');
    const captureBtn = document.getElementById('captureBtn');
    const retakeBtn = document.getElementById('retakeBtn');
    const usePhotoBtn = document.getElementById('usePhotoBtn');

    photoPreview.style.display = 'none';
    video.style.display = 'block';

    captureBtn.style.display = 'flex';
    retakeBtn.style.display = 'none';
    usePhotoBtn.style.display = 'none';
}

export function useCapturedPhoto() {
    const canvas = document.getElementById('cameraCanvas');
    const activeModal = document.getElementById('addProductModal').classList.contains('hidden') ? 'edit' : 'add';

    if (activeModal === 'add') {
        window.app.currentImageData = canvas.toDataURL('image/jpeg');
        document.getElementById('imagePreview').innerHTML = `<img src="${window.app.currentImageData}" alt="Preview" class="image-preview">`;
    } else {
        window.app.currentEditImageData = canvas.toDataURL('image/jpeg');
        document.getElementById('editImagePreview').innerHTML = `<img src="${window.app.currentEditImageData}" alt="Preview" class="image-preview">`;
    }
    
    closeCameraModal();
}

// --- BARCODE SCANNING ---

function startScanner() {
    if (!window.app.isScannerReady || !Html5Qrcode) {
        console.warn('Scanner library not ready.');
        return;
    }
    
    const onScanSuccess = async (decodedText, decodedResult) => {
        if (window.app.html5QrCode.isScanning) {
            await window.app.html5QrCode.stop();
        }

        if (window.app.scanCallback) {
            window.app.scanCallback(decodedText);
            return;
        }

        const products = await getAllFromDB('products');
        const product = products.find(p => p.barcode === decodedText);

        if (product) {
            addToCart(product.id);
            closeScanModal();
        } else {
            showToast(`Produk dengan barcode ${decodedText} tidak ditemukan.`);
            setTimeout(() => {
                if (document.getElementById('scanModal').classList.contains('hidden') === false) {
                     window.app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, (errorMessage) => {});
                }
            }, 2000);
        }
    };
    
    const onScanFailure = (error) => {};
    
    window.app.html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, onScanFailure)
      .catch((err) => {
        showToast('Gagal memulai kamera. Pastikan izin telah diberikan.');
        console.error("Failed to start QR code reader:", err);
      });
}

export function showScanModal() {
    if (!window.app.isScannerReady) {
        showToast('Pemindai barcode gagal dimuat.');
        return;
    }
    (document.getElementById('scanModal')).classList.remove('hidden');
    startScanner();
}

export function scanBarcodeForInput(targetInputId) {
    window.app.scanCallback = (decodedText) => {
        const inputEl = document.getElementById(targetInputId);
        if (inputEl) {
            inputEl.value = decodedText;
        }
        closeScanModal();
    };
    showScanModal();
};


export async function closeScanModal() {
    const modal = document.getElementById('scanModal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        if (window.app.html5QrCode && window.app.html5QrCode.isScanning) {
            try {
                await window.app.html5QrCode.stop();
            } catch (err) {
                console.error("Error stopping scanner:", err);
            }
        }
    }
    window.app.scanCallback = null;
}


// --- RECEIPT PRINTING ---

function sendToRawBT(data) {
    // data = Uint8Array dari encoder.encode()
    // Prefix "ESC d 0" sebagai guard (print & feed 0 lines = no-op)
    const guard = new Uint8Array([0x1B, 0x64, 0x00]);
    const payload = new Uint8Array(guard.length + data.length);
    payload.set(guard, 0);
    payload.set(data, guard.length);

    let binary = '';
    for (let i = 0; i < payload.byteLength; i++) {
        binary += String.fromCharCode(payload[i]);
    }
    const base64 = btoa(binary);
    const intentUrl = `rawbt:base64,${base64}`;
    window.location.href = intentUrl;
};

async function _generateReceiptText(transactionData, isPreview) {
  const settings = await getAllFromDB('settings');
  const settingsMap = new Map(settings.map(s => [s.key, s.value]));

  const storeName = settingsMap.get('storeName') || 'Toko Anda';
  const storeAddress = settingsMap.get('storeAddress') || '';
  const feedbackPhone = settingsMap.get('storeFeedbackPhone') || '';
  const footerText = settingsMap.get('storeFooterText') || 'Terima kasih!';
  const paperSize = settingsMap.get('printerPaperSize') || '80mm';
  const paperWidthChars = paperSize === '58mm' ? 32 : 42;

  const receiptLine = (char) => char.repeat(paperWidthChars);
  const formatLine = (left, right) => {
    const spaces = Math.max(0, paperWidthChars - left.length - right.length);
    return left + ' '.repeat(spaces) + right;
  };

  let receiptText = '';

  // HEADER: center + word-wrap
  wrapAndCenter(storeName, paperWidthChars).forEach(l => receiptText += l + '\n');
  if (storeAddress) {
    storeAddress.split('\n').forEach(row => {
      if (row.trim()) wrapAndCenter(row, paperWidthChars).forEach(l => receiptText += l + '\n');
    });
  }

  receiptText += receiptLine('=') + '\n';
  receiptText += '\n';

  receiptText += `No: ${transactionData.id || (isPreview ? 'PREVIEW' : 'N/A')}\n`;
  receiptText += `Tgl: ${formatReceiptDate(transactionData.date)}\n`;
  receiptText += receiptLine('-') + '\n';

  transactionData.items.forEach(item => {
    receiptText += `${item.name} x${item.quantity}\n`;
    const totalItemPriceText = `Rp.${formatCurrency(item.effectivePrice * item.quantity)}`;
    let priceDetailText;
    if (item.discountPercentage > 0) {
      priceDetailText = `@ Rp.${formatCurrency(item.price)} Disc ${item.discountPercentage}%`;
    } else {
      priceDetailText = `@ Rp.${formatCurrency(item.price)}`;
    }
    receiptText += formatLine(priceDetailText, totalItemPriceText) + '\n';
  });

  const subtotalAfterDiscount = transactionData.items.reduce((sum, item) => {
    const priceToUse = item.effectivePrice !== undefined
      ? item.effectivePrice
      : (item.price * (1 - (item.discountPercentage || 0) / 100));
    return sum + Math.round(priceToUse * item.quantity);
  }, 0);

  receiptText += receiptLine('-') + '\n';
  receiptText += formatLine('Subtotal', `Rp.${formatCurrency(subtotalAfterDiscount)}`) + '\n';

  if (transactionData.fees && transactionData.fees.length > 0) {
    transactionData.fees.forEach(fee => {
      let feeName = fee.name;
      if (fee.type === 'percentage') feeName += ` ${fee.value}%`;
      const feeAmount = `Rp. ${formatCurrency(fee.amount)}`;
      receiptText += formatLine(feeName, feeAmount) + '\n';
    });
  }

  receiptText += receiptLine('-') + '\n';
  receiptText += formatLine('TOTAL', `Rp.${formatCurrency(transactionData.total)}`) + '\n';
  receiptText += formatLine('TUNAI', `Rp.${formatCurrency(transactionData.cashPaid)}`) + '\n';
  receiptText += formatLine('KEMBALI', `Rp. ${formatCurrency(transactionData.change)}`) + '\n';
  receiptText += receiptLine('=') + '\n';

  // FOOTER: center + word-wrap (tidak akan terpotong di tengah kata)
  if (footerText) {
    wrapAndCenter(footerText, paperWidthChars).forEach(l => receiptText += l + '\n');
  }
  if (feedbackPhone) {
    wrapAndCenter(`Kritik/Saran: ${feedbackPhone}`, paperWidthChars).forEach(l => receiptText += l + '\n');
  }

  return receiptText;
}

async function _generateReceiptHTML(data, isPreview) {
  const settings = await getAllFromDB('settings');
  const settingsMap = new Map(settings.map(s => [s.key, s.value]));
  const logoData = settingsMap.get('storeLogo') || null;
  const showLogo = settingsMap.get('showLogoOnReceipt') !== false;

  const paperSize = settingsMap.get('printerPaperSize') || '80mm';
  const paperWidthChars = paperSize === '58mm' ? 32 : 42;

  let receiptText = await _generateReceiptText(data, isPreview);

  const wrapperStart = `<div style="width:${paperWidthChars}ch; margin:0 auto; font-family: ui-monospace, Menlo, Monaco, Consolas, 'Courier New', monospace; line-height:1.2;">`;
  const wrapperEnd = `</div>`;

  const logoHtml = (showLogo && logoData)
    ? `<div style="width:${paperWidthChars}ch; margin:0 auto; text-align:left; margin-bottom:4px;">
         <img src="${logoData}" alt="Logo" style="display:block; width:100%; max-height:120px; object-fit:contain; background:#fff;">
       </div>`
    : '';

  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = receiptText;

  pre.innerHTML = pre.innerHTML.replace(/^(TOTAL\s+Rp\..*)$/m, `<b>$1</b>`);

  return wrapperStart + logoHtml + pre.outerHTML + wrapperEnd;
}

async function generateReceiptEscPos(transactionData) {
  if (!window.app.isPrinterReady) throw new Error('Printer library not loaded.');

  const settings = await getAllFromDB('settings');
  const settingsMap = new Map(settings.map(s => [s.key, s.value]));
  const logoData = settingsMap.get('storeLogo') || null;
  const showLogo = settingsMap.get('showLogoOnReceipt') !== false;
  const paperSize = settingsMap.get('printerPaperSize') || '80mm';

  const paperWidthChars = paperSize === '58mm' ? 32 : 42;
  // NOTE: jika printer 80mm Anda 512 dots, ganti 576 -> 512
  const paperWidthDots  = paperSize === '58mm' ? 384 : 576;

  const encoder = new EscPosEncoder.default();
  encoder
    .initialize()
    .raw([0x1b, 0x40])   // ESC @ reset
    .raw([0x1b, 0x40])   // reset ekstra, untuk memastikan tidak ada state sisa
    .line('')            // flush baris
    .align('left')
    .raw([0x1b, 0x32]);  // default line spacing

  // Cetak logo: full width, BW threshold, mode 's8' (stabil)
  if (showLogo && logoData) {
    try {
      const image = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = logoData;
      });

      const ratio = paperWidthDots / image.width;
      const w = paperWidthDots;
      const h = Math.min(Math.round(image.height * ratio), 180);

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);

      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;
      const threshold = 185; // sesuaikan 170–200 jika perlu
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        const v = gray > threshold ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
      }

      encoder.line('');            // flush sebelum image (hindari 'd')
      encoder.align('left');
      encoder.image(imgData, 's8'); // gunakan 's8' (lebih aman di banyak printer/RawBT)
      encoder.line('');            // flush sesudah image
    } catch (e) {
      console.error('Failed to process logo for printing:', e);
    }
  }

  // Cetak teks (semua rata kiri; kolom kanan via spasi)
  const receiptText = await _generateReceiptText(transactionData, false);
  receiptText.split('\n').forEach(line => {
    if (!line) { encoder.line(''); return; }
    const safe = line.length > paperWidthChars ? line.slice(0, paperWidthChars) : line;
    if (safe.startsWith('TOTAL')) {
      encoder.bold(true).line(safe.padEnd(paperWidthChars, ' ')).bold(false);
    } else {
      encoder.line(safe.padEnd(paperWidthChars, ' '));
    }
  });

  encoder.feed(3).cut();
  return encoder.encode();
}

export async function generateReceiptContent(transactionData, targetElementId = 'receiptContent') {
    const contentEl = document.getElementById(targetElementId);
    if (contentEl) {
        contentEl.innerHTML = await _generateReceiptHTML(transactionData, targetElementId === 'previewReceiptContent');
    }
}
window.generateReceiptContent = generateReceiptContent;

export async function printReceipt(isAutoPrint = false) {
    if (!window.app.isPrinterReady) {
        showToast('Fitur cetak tidak tersedia.');
        return;
    }
    if (!window.app.currentReceiptTransaction) {
        showToast('Tidak ada data struk untuk dicetak.');
        return;
    }
    
    try {
        if (!isAutoPrint) showToast('Menyiapkan struk...', 2000);
        const data = await generateReceiptEscPos(window.app.currentReceiptTransaction);
        sendToRawBT(data);
    } catch (error) {
        console.error('Print error:', error);
        if (!isAutoPrint) {
            showConfirmationModal(
                'Gagal Mencetak Struk',
                'Struk gagal dicetak. Ini bisa terjadi jika aplikasi RawBT tidak terinstall atau belum diatur.<br><br>Coba gunakan tombol "Share ke Printer" sebagai alternatif.',
                () => {},
                'Mengerti',
                'bg-blue-500'
            );
        }
    }
};

async function generateLabelEscPos() {
    if (!window.app.isPrinterReady) {
        throw new Error('Printer library not loaded.');
    }

    const productName = document.getElementById('product-name').value.trim();
    const productPrice = document.getElementById('product-price').value.trim();
    const barcodeCode = document.getElementById('barcode-code').value.trim();

    const paperSize = await getSettingFromDB('printerPaperSize') || '80mm';

    const encoder = new EscPosEncoder.default();
    encoder
        .initialize()
        .raw([0x1b, 0x40]);

    encoder.align('center');

    if (productName) {
        encoder.bold(true).line(productName).bold(false);
    }

    if (productPrice) {
        const formattedPrice = `Rp ${formatCurrency(productPrice)}`;
        encoder.line(formattedPrice);
    }

    encoder.line('');

    if (barcodeCode) {
        encoder.raw([0x1d, 0x6b, 0x49]);
        const barcodeLength = barcodeCode.length;
        encoder.raw([barcodeLength]);
        encoder.raw(new TextEncoder().encode(barcodeCode));

        encoder.align('center').line(barcodeCode);
    }

    encoder
        .feed(3)
        .cut();

    return encoder.encode();
}

export async function testPrint() {
    if (!window.app.isPrinterReady) {
        showToast('Fitur cetak tidak tersedia.');
        return;
    }
    try {
        const paperSize = await getSettingFromDB('printerPaperSize') || '80mm';
        const paperWidthChars = paperSize === '58mm' ? 32 : 42;
        const encoder = new EscPosEncoder.default();

        const data = encoder
            .initialize()
            .raw([0x1b, 0x40])
            .align('center')
            .width(2).height(2)
            .line('Test Cetak')
            .width(1).height(1)
            .line('----------------')
            .line('Printer terhubung!')
            .line(`Lebar kertas: ${paperWidthChars} karakter`)
            .line(new Date().toLocaleString('id-ID'))
            .feed(3)
            .cut()
            .encode();

        sendToRawBT(data);

    } catch(e) {
        showToast('Gagal melakukan test cetak.');
        console.error(e);
    }
};

export function showPrintHelpModal() {
    const modal = document.getElementById('printHelpModal');
    if (modal) modal.classList.remove('hidden');
};
export function closePrintHelpModal() {
    const modal = document.getElementById('printHelpModal');
    if (modal) modal.classList.add('hidden');
};

export async function showPreviewReceiptModal() {
    if (window.app.cart.items.length === 0) {
        showToast('Keranjang kosong, tidak ada struk untuk ditampilkan.');
        return;
    }
    
    const subtotalAfterDiscount = window.app.cart.items.reduce((sum, item) => {
        return sum + Math.round(item.effectivePrice * item.quantity);
    }, 0);

    let calculatedFees = [];
    let totalFeeAmount = 0;
    window.app.cart.fees.forEach(fee => {
        const feeAmountRaw = fee.type === 'percentage' ? subtotalAfterDiscount * (fee.value / 100) : fee.value;
        const roundedFeeAmount = Math.round(feeAmountRaw);
        calculatedFees.push({ ...fee, amount: roundedFeeAmount });
        totalFeeAmount += roundedFeeAmount;
    });
    
    const total = subtotalAfterDiscount + totalFeeAmount;

    const subtotal_raw = window.app.cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const totalDiscount_raw = window.app.cart.items.reduce((sum, item) => {
         const discountAmount = item.price * (item.discountPercentage / 100);
         return sum + (discountAmount * item.quantity);
    }, 0);

    const previewData = {
        items: window.app.cart.items,
        subtotal: subtotal_raw,
        totalDiscount: totalDiscount_raw,
        fees: calculatedFees,
        total,
        cashPaid: 0,
        change: 0,
        date: new Date().toISOString()
    };
    
    await generateReceiptContent(previewData, 'previewReceiptContent');
    document.getElementById('previewReceiptModal').classList.remove('hidden');
}

export function closePreviewReceiptModal() {
    document.getElementById('previewReceiptModal').classList.add('hidden');
}

export function updateFeatureAvailability() {
    const scanBtn = document.getElementById('scanBarcodeBtn');
    if (scanBtn) {
        if (!window.app.isScannerReady) {
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

    const printReceiptBtn = document.getElementById('printReceiptBtn');
    const autoPrintContainer = document.getElementById('autoPrintContainer');
    const testPrintBtn = document.getElementById('testPrintBtn');

    if (!window.app.isPrinterReady) {
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

            if (!autoPrintContainer.parentElement.querySelector('.library-error-note')) {
                const note = document.createElement('p');
                note.className = 'text-xs text-red-500 text-center mt-2 library-error-note';
                note.textContent = 'Fitur cetak tidak tersedia (library gagal dimuat).';
                autoPrintContainer.parentElement.insertBefore(note, autoPrintContainer.nextSibling);
            }
        }
    }
}

// --- BARCODE / LABEL GENERATOR ---
export function setupBarcodeGenerator() {
    const generateBtn = document.getElementById('generateBarcodeLabelBtn');
    const downloadPngBtn = document.getElementById('downloadPngBtn');
    const printLabelBtn = document.getElementById('printLabelBtn');

    if (!generateBtn || !downloadPngBtn || !printLabelBtn) return;

    generateBtn.addEventListener('click', () => {
        const productName = document.getElementById('product-name').value.trim();
        const productPrice = document.getElementById('product-price').value.trim();
        const barcodeCode = document.getElementById('barcode-code').value.trim();

        if (!barcodeCode) {
            showToast('Teks/Angka untuk Barcode wajib diisi.');
            return;
        }

        const outputName = document.getElementById('output-product-name');
        const outputPrice = document.getElementById('output-product-price');
        const outputBarcodeText = document.getElementById('output-barcode-text');
        
        outputName.textContent = productName;
        outputPrice.textContent = productPrice ? `Rp ${formatCurrency(productPrice)}` : '';
        outputBarcodeText.textContent = barcodeCode;

        try {
            JsBarcode("#barcode", barcodeCode, {
                format: "CODE128",
                lineColor: "#000",
                width: 2,
                height: 50,
                displayValue: false
            });
            document.getElementById('barcodeLabelOutput').classList.remove('hidden');
            document.getElementById('download-buttons').classList.remove('hidden');
        } catch (e) {
            showToast('Gagal membuat barcode. Pastikan teks valid.');
            console.error("JsBarcode error:", e);
        }
    });

    downloadPngBtn.addEventListener('click', async () => {
        try {
            const { default: html2canvas } = await import('https://cdn.skypack.dev/html2canvas');
            const labelContent = document.getElementById('labelContent');
            const canvas = await html2canvas(labelContent, {
                scale: 3,
                backgroundColor: '#ffffff'
            });
            const link = document.createElement('a');
            link.download = `label-${document.getElementById('barcode-code').value}.png`;
            link.href = canvas.toDataURL("image/png").replace("image/png", "image/octet-stream");
            link.click();
        } catch (e) {
            console.error('Download PNG failed:', e);
            showToast('Gagal mengunduh PNG. Coba lagi.');
        }
    });
    
    printLabelBtn.addEventListener('click', async () => {
        if (!window.app.isPrinterReady) {
            showToast('Fitur cetak tidak tersedia.');
            return;
        }
        try {
            const data = await generateLabelEscPos();
            sendToRawBT(data);
        } catch (e) {
            console.error('Print label failed:', e);
            showToast('Gagal mencetak label.');
        }
    });
}