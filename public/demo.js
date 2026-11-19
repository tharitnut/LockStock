document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('simulation-form');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');
  const statusMsg = document.getElementById('status-message');
  const resultsSection = document.getElementById('results-section');

  const statSucceeded = document.getElementById('stat-succeeded');
  const statRejected = document.getElementById('stat-rejected');
  const statErrors = document.getElementById('stat-errors');
  const statStock = document.getElementById('stat-stock');
  const statInvariant = document.getElementById('stat-invariant');
  const statTime = document.getElementById('stat-time');
  const explanationBanner = document.getElementById('explanation-banner');
  const buyersGrid = document.getElementById('buyers-grid');

  function showStatus(message, type = 'info') {
    statusMsg.textContent = message;
    statusMsg.className = `status-message ${type}`;
    statusMsg.classList.remove('hidden');
  }

  function hideStatus() {
    statusMsg.textContent = '';
    statusMsg.classList.add('hidden');
  }

  function setLoading(isLoading) {
    if (isLoading) {
      submitBtn.disabled = true;
      btnText.textContent = 'กำลังจำลองการสั่งซื้อพร้อมกันบนฐานข้อมูล...';
      btnSpinner.classList.remove('hidden');
      hideStatus();
    } else {
      submitBtn.disabled = false;
      btnText.textContent = 'เริ่มจำลองการสั่งซื้อพร้อมกัน';
      btnSpinner.classList.add('hidden');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const stock = parseInt(document.getElementById('stock-input').value, 10);
    const buyers = parseInt(document.getElementById('buyers-input').value, 10);
    const mode = document.querySelector('input[name="mode"]:checked').value;

    if (isNaN(stock) || stock < 1 || stock > 100) {
      showStatus('กรุณากรอกจำนวนสต็อกระหว่าง 1 ถึง 100', 'error');
      return;
    }

    if (isNaN(buyers) || buyers < 1 || buyers > 50) {
      showStatus('กรุณากรอกจำนวนผู้ซื้อระหว่าง 1 ถึง 50', 'error');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/demo/api/oversell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stock, buyers, mode }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data.error?.code === 'DEMO_BUSY') {
          showStatus('⚠️ ระบบกำลังประมวลผลการจำลองอื่นอยู่ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (409 DEMO_BUSY)', 'info');
        } else if (response.status === 429) {
          showStatus('⏳ คุณทำการจำลองบ่อยเกินไป (จำกัด 5 ครั้งต่อนาที) กรุณารอสักครู่ (429 RATE_LIMITED)', 'error');
        } else {
          showStatus(`เกิดข้อผิดพลาด: ${data.error?.message || 'ไม่สามารถประมวลผลได้'}`, 'error');
        }
        return;
      }

      renderResults(data);
    } catch (err) {
      showStatus(`ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  function renderResults(data) {
    resultsSection.classList.remove('hidden');

    // Summary numbers
    statSucceeded.textContent = data.succeeded;
    statRejected.textContent = data.rejected;
    statErrors.textContent = data.errors;
    statStock.textContent = data.final_stock;
    statTime.textContent = `${data.elapsed_ms} ms`;

    // Invariant card
    if (data.invariant_ok) {
      statInvariant.textContent = '✔ ผ่าน (ถูกต้อง)';
      statInvariant.className = 'metric-value pass';
    } else {
      statInvariant.textContent = '✕ ล้มเหลว (เกิด Overselling)';
      statInvariant.className = 'metric-value fail';
    }

    // Explanation Banner
    if (data.mode === 'safe') {
      explanationBanner.className = 'explanation-box safe-mode';
      explanationBanner.innerHTML = `
        <strong>ผลการทดสอบโหมดปลอดภัย (Pessimistic Row Lock):</strong><br>
        จากสต็อกเริ่มต้น <strong>${data.stock}</strong> ชิ้น มีผู้ซื้อพร้อมกัน <strong>${data.buyers}</strong> คน<br>
        • ได้สินค้าไป <strong>${data.succeeded}</strong> คนพอดีตามสต็อกจริง<br>
        • อีก <strong>${data.rejected}</strong> คนถูกปฏิเสธด้วยสถานะ 409 INSUFFICIENT_STOCK อย่างถูกต้อง<br>
        • สต็อกคงเหลือสุดท้ายคือ <strong>${data.final_stock}</strong> ชิ้น และตรงตามสมุดบัญชี <code>stock_movements</code> (ไม่เกิดการขายเกินสต็อกแม้แต่น้อย)
      `;
    } else {
      explanationBanner.className = 'explanation-box unsafe-mode';
      explanationBanner.innerHTML = `
        <strong>ผลการทดสอบโหมดไม่ปลอดภัย (ไร้ Row Lock):</strong><br>
        จากสต็อกเริ่มต้น <strong>${data.stock}</strong> ชิ้น มีผู้ซื้อพร้อมกัน <strong>${data.buyers}</strong> คน<br>
        • เกิดการ <strong>ขายเกินสต็อก (Overselling)</strong> สำเร็จถึง <strong>${data.succeeded}</strong> คน (เกินจำนวนสต็อกที่มีจริง!)<br>
        • สต็อกคงเหลือสุดท้ายกลายเป็น <strong>${data.final_stock}</strong> และไม่สอดคล้องกับ Ledger (Invariant ไม่ผ่าน)<br>
        • นี่คือสาเหตุสำคัญที่ระบบ e-Commerce ต้องใช้ Pessimistic Locking หรือ Database Concurrency Control
      `;
    }

    // Render individual buyers grid
    buyersGrid.innerHTML = '';
    data.results.forEach((r) => {
      const cell = document.createElement('div');
      cell.className = `buyer-cell ${r.outcome}`;

      let iconText = '';
      let statusText = '';

      if (r.outcome === 'ok') {
        iconText = '✓';
        statusText = 'สำเร็จ';
      } else if (r.outcome === 'rejected') {
        iconText = '✕';
        statusText = 'สต็อกหมด';
      } else {
        iconText = '⚠️';
        statusText = r.code || 'ผิดพลาด';
      }

      cell.innerHTML = `
        <span class="buyer-id">ผู้ซื้อ #${r.i}</span>
        <span class="buyer-status" aria-label="${statusText}">${iconText} ${statusText}</span>
        <span class="buyer-time">${r.ms} ms</span>
      `;

      buyersGrid.appendChild(cell);
    });

    // Scroll smoothly to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
