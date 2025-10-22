import { getAllFromDB } from './db.js';

// WARNING: Storing API keys directly in client-side code is not secure.
// This is for demonstration purposes only.
const OPENROUTER_API_KEY = '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';
const DEEPSEEK_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callDeepSeekAPI(prompt) {
    // Use a CORS proxy to bypass browser security restrictions for client-side API calls.
    const PROXY_URL = 'https://corsproxy.io/?';
    const proxiedUrl = PROXY_URL + encodeURIComponent(DEEPSEEK_API_URL);

    try {
        const response = await fetch(proxiedUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                // Optional headers for OpenRouter ranking
                'HTTP-Referer': 'https://pos.mobile', 
                'X-Title': 'POS Mobile',
            },
            body: JSON.stringify({
                "model": "deepseek/deepseek-chat-v3.1:free",
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('DeepSeek API Error:', errorData);
            throw new Error(`API request failed with status ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();

        // Check for the expected response structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            console.error('DeepSeek API returned an invalid structure:', data);
            throw new Error('Invalid response from DeepSeek API');
        }

        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling DeepSeek API:', error);
        throw error;
    }
}


export async function getSalesInsight() {
    const insightCard = document.getElementById('aiInsightCard');
    const insightContent = document.getElementById('aiInsightContent');
    const insightButton = document.getElementById('getInsightBtn');

    if (!insightCard || !insightContent || !insightButton) return;

    insightButton.disabled = true;
    insightButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Menganalisis...`;
    insightContent.innerHTML = '';

    try {
        // 1. Fetch data
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const range = IDBKeyRange.lowerBound(thirtyDaysAgo.toISOString());
        const transactions = await getAllFromDB('transactions', 'date', range);

        if (transactions.length < 5) {
             insightContent.innerHTML = `<p class="text-sm text-gray-500">Tidak cukup data penjualan (minimal 5 transaksi dalam 30 hari terakhir) untuk menghasilkan insight.</p>`;
             return;
        }

        // 2. Summarize data
        const summary = {
            totalTransactions: transactions.length,
            totalRevenue: transactions.reduce((sum, t) => sum + t.total, 0),
            salesByDayOfWeek: [0, 0, 0, 0, 0, 0, 0], // Sun-Sat
            topProducts: {},
        };

        transactions.forEach(t => {
            const date = new Date(t.date);
            summary.salesByDayOfWeek[date.getDay()] += t.total;
            t.items.forEach(item => {
                summary.topProducts[item.name] = (summary.topProducts[item.name] || 0) + item.quantity;
            });
        });
        
        // Simplified summary for prompt
        const top5Products = Object.entries(summary.topProducts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([name, qty]) => `${name} (${qty} terjual)`)
            .join(', ');

        const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const salesByDay = summary.salesByDayOfWeek.map((sales, i) => `${dayNames[i]}: Rp ${Math.round(sales)}`).join('; ');

        const dataForPrompt = `
- Total transaksi 30 hari terakhir: ${summary.totalTransactions}
- Total pendapatan 30 hari terakhir: Rp ${Math.round(summary.totalRevenue)}
- Top 5 produk terlaris: ${top5Products || 'Tidak ada'}
- Rata-rata penjualan per hari (Minggu-Sabtu): ${salesByDay}
        `;

        // 3. Create prompt and call API
        const prompt = `Anda adalah seorang analis bisnis ahli untuk sebuah toko kecil. Berdasarkan ringkasan data penjualan 30 hari terakhir berikut, berikan satu insight bisnis yang cerdas, singkat, dan actionable (dapat ditindaklanjuti) dalam Bahasa Indonesia. Fokus pada satu ide promosi, strategi, atau observasi menarik. Contoh: "Penjualan kopi meningkat 50% pada hari hujan bulan ini. Pertimbangkan untuk membuat promo 'paket hari hujan'."
Data Penjualan:
${dataForPrompt}
Insight Anda:`;

        const insightText = await callDeepSeekAPI(prompt);

        // 4. Display result
        insightContent.innerHTML = `<p class="text-sm text-gray-700 font-medium">${insightText}</p>`;

    } catch (error) {
        console.error('Failed to get sales insight:', error);
        insightContent.innerHTML = `<p class="text-sm text-red-500">Gagal mendapatkan insight. Silakan coba lagi nanti.</p>`;
    } finally {
        insightButton.disabled = false;
        insightButton.innerHTML = `<i class="fas fa-redo"></i> Dapatkan Insight Baru`;
    }
}
