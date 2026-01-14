// store.js - Handhabt Shop-Logik, Modal und Status-Polling

// 1. Konfiguration der Produkte (Mapping von ID zu Name & Preis)
// Muss EXAKT mit payment.js PRICES übereinstimmen!
const licenseMapping = {
  // Einzel-Lizenzen
  "1m":           { name: "1 Monat Zugang",            price: "1,99 €" },
  "3m":           { name: "3 Monate Zugang",           price: "4,95 €" },
  "12m":          { name: "12 Monate Zugang",          price: "17,90 €" },
  "unlimited":    { name: "Unbegrenzter Zugang",       price: "59,99 €" },
  
  // Bundles
  "bundle_1m_2":  { name: "2x Keys (1 Monat)",      price: "3,79 €" },
  "bundle_3m_5":  { name: "5x Keys (3 Monate)",     price: "19,80 €" },
  "bundle_3m_2":  { name: "2x Keys (3 Monate)",      price: "8,99 €" },
  "bundle_1y_10": { name: "10x Keys (12 Monate)",    price: "149,99 €" }
};

// 2. Initialisierung beim Laden
document.addEventListener("DOMContentLoaded", () => {
  // URL Parameter prüfen (Kommen wir von Stripe zurück?)
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get("session_id");
  const success = urlParams.get("success");

  // RENEWAL DETECTION (Case 2)
  const isRenewal = urlParams.get("mode") === "renew";
  if (isRenewal) {
      document.body.classList.add('renewal-mode'); // For optional CSS styling
      // Maybe auto-open a specific plan? Or just let user choose.
      // User context implies they know they want to extend.
  }

  // Modus entscheiden: Shop anzeigen oder Status prüfen?
  if (sessionId && success) {
    switchToStatusMode(sessionId);
  } else {
    // Check Shop Status first
    fetch('/api/shop-status')
      .then(r => r.json())
      .then(data => {
          if(!data.active) {
              const content = document.getElementById("shopContent");
              const banner = document.getElementById("shopOfflineBanner");
              if(content) content.style.display = 'none';
              if(banner) banner.style.display = 'block';
          } else {
              initializeShop();
          }
      })
      .catch(e => {
          console.error("Shop Status Check Failed", e);
          initializeShop(); // Fallback to open
      });
  }

  // Event Listeners für das Modal
  const closeBtn = document.getElementById("closeModalBtn");
  if(closeBtn) closeBtn.addEventListener("click", closeModal);

  const confirmBtn = document.getElementById("confirmPurchaseBtn");
  if(confirmBtn) confirmBtn.addEventListener("click", confirmPurchase);
  
  // Klick auf Hintergrund schließt Modal
  const overlay = document.getElementById("modalOverlay");
  if(overlay) {
      overlay.addEventListener("click", (e) => {
          if(e.target === e.currentTarget) closeModal();
      });
  }
});

// =======================================================
// UTILS
// =======================================================

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return; // Fallback?

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span style="font-size:1.2rem;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // wait for fade out
    }, 4000);
}

// =======================================================
// SHOP UI LOGIC
// =======================================================

function initializeShop() {
  const shopView = document.getElementById("shop-view");
  const statusView = document.getElementById("payment-status-section");

  if(shopView) shopView.style.display = "block";
  if(statusView) statusView.style.display = "none";

  // Allen "Kaufen"-Buttons das Event hinzufügen
  const buttons = document.querySelectorAll(".license-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
        const plan = btn.getAttribute("data-plan");
        if(plan) showModal(plan);
    });
  });
}

function showModal(plan) {
  const modal = document.getElementById("modalOverlay");
  const planText = document.getElementById("modalPlan");
  const priceText = document.getElementById("modalPrice");
  const emailInput = document.getElementById("emailInput");

  const license = licenseMapping[plan];
  if (!license) return showToast("Fehler: Unbekannter Lizenztyp.", 'error');

  // Speichere den gewählten Plan im Dataset des Modals
  modal.dataset.selectedPlan = plan;
  
  // Texte setzen
  planText.textContent = license.name;
  priceText.textContent = license.price;
  
  // Input zurücksetzen
  emailInput.value = ""; 
  
  // Anzeigen
  modal.style.display = "flex"; // Flex für Zentrierung
  emailInput.focus();
}

function closeModal() {
  const modal = document.getElementById("modalOverlay");
  if(modal) modal.style.display = "none";
}

// =======================================================
// STRIPE CHECKOUT STARTEN
// =======================================================

async function confirmPurchase() {
  const modal = document.getElementById("modalOverlay");
  const plan = modal?.dataset.selectedPlan;
  const emailInput = document.getElementById("emailInput");
  const btn = document.getElementById("confirmPurchaseBtn");

  const email = emailInput?.value?.trim();
  
  // E-Mail Validierung
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Custom inline warning or alert
    showToast("Bitte geben Sie eine gültige E-Mail-Adresse ein.", 'error');
    return;
  }

  // Button Status: Loading
  const originalText = btn.innerText;
  btn.innerText = "⏳ Verbinde zu Stripe...";
  btn.disabled = true;
  btn.style.opacity = "0.7";

  try {
    // AUTH HEADER INJECTION (If logged in)
    const token = localStorage.getItem('sm_token');
    const headers = { "Content-Type": "application/json" };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // CHECK RENEWAL MODE
    const isRenewal = new URLSearchParams(window.location.search).get("mode") === "renew";

    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
          product_type: plan,
          customer_email: email,
          is_renewal: isRenewal
      })
    });

    const data = await response.json();
    
    if (data.success && data.checkout_url) {
      // Weiterleitung zu Stripe
      window.location.href = data.checkout_url;
    } else {
      throw new Error(data.error || "Keine Checkout-URL vom Server erhalten.");
    }

  } catch (err) {
    console.error("Zahlungsfehler:", err);
    showToast("Fehler beim Starten der Zahlung: " + err.message, 'error');
    btn.innerText = originalText;
    btn.disabled = false;
    btn.style.opacity = "1";
  }
}

// =======================================================
// STATUS / POLLING LOGIK (Nach dem Kauf)
// =======================================================

function switchToStatusMode(sessionId) {
  // Shop ausblenden, Status einblenden
  document.getElementById("shop-view").style.display = "none";
  const statusSection = document.getElementById("payment-status-section");
  statusSection.style.display = "block";

  // Polling starten
  pollPaymentStatus(sessionId);
}

async function pollPaymentStatus(sessionId) {
  const processingDiv = document.getElementById("status-processing");
  const successDiv = document.getElementById("status-success");
  const errorDiv = document.getElementById("status-error");
  const errorMsg = document.getElementById("error-message");
  const keysArea = document.getElementById("keys-output-area");

  let attempts = 0;
  const maxAttempts = 30; // 60 Sekunden Timeout

  const check = async () => {
    attempts++;
    console.log(`📡 Status-Check ${attempts}...`);

    try {
      const res = await fetch(`/api/order-status?session_id=${sessionId}`);
      const data = await res.json();

      if (data.success && (data.status === 'completed' || data.status === 'succeeded')) {
        // --- ERFOLG ---
        processingDiv.style.display = "none";
        successDiv.style.display = "block";
        
        let contentHtml = "";

        // A) VERLÄNGERUNG ERFOLGREICH
        if (data.renewed) {
             contentHtml += `
                <div style="text-align:center; padding:20px; border:1px solid var(--success-green); border-radius:5px; background:rgba(0,255,65,0.05); margin-bottom: 20px;">
                    <h3 style="color:var(--success-green); margin-bottom:10px;">✅ ACCOUNT VERLÄNGERT!</h3>
                    <p style="color:#fff;">Ihre Lizenz wurde sofort aktualisiert.</p>
                </div>
             `;
        }

        // B) ZUSÄTZLICHE KEYS (z.B. bei Bundles oder Gast-Kauf)
        if (data.keys && data.keys.length > 0) {
           contentHtml += `<p style="color:#e0e0e0; margin-bottom:10px;">Hier sind Ihre weiteren Zugangsschlüssel:</p>`;
           data.keys.forEach(key => {
               contentHtml += `
                  <div class="key-display-box">
                    <span style="letter-spacing:2px; color:#fff; font-weight:bold;">${key}</span>
                    <br>
                    <button class="btn" style="margin-top:15px; padding:8px 20px; font-size:0.8rem;" onclick="window.copyKey(this, '${key}')">KOPIEREN</button>
                  </div>
               `;
           });
        }

        if (!data.keys || data.keys.length === 0 && !data.renewed) {
             contentHtml += "<p>Zahlung erfolgreich verarbeitet. Bitte prüfen Sie Ihre E-Mails.</p>";
        }

        keysArea.innerHTML = contentHtml;

        // UI Cleanups wenn nur Verlängerung
        const warningEl = document.querySelector("#status-success > p[style*='color: #ffcc00']");
        if(data.renewed && (!data.keys || data.keys.length === 0)) {
             if(warningEl) warningEl.style.display = 'none';
        } else {
             if(warningEl) warningEl.style.display = 'block';
        }

        return; // Polling beenden

      } else if (data.status === 'processing' || data.status === 'pending' || data.status === 'processing_user_sync' || !data.status) {
        // --- NOCH WARTEN (Inklusive User Sync Wait) ---
        if (attempts < maxAttempts) {
           setTimeout(check, 2000); // Weiter warten
        } else {
           throw new Error("Zeitüberschreitung. Bitte E-Mail prüfen.");
        }

      } else {
        // --- FEHLER ---
        throw new Error("Zahlungsstatus: " + data.status);
      }

    } catch (err) {
      console.error("Polling Fehler:", err);
      processingDiv.style.display = "none";
      errorDiv.style.display = "block";
      errorMsg.textContent = err.message || "Verbindungsfehler.";
    }
  };

  // Start with delay to allow webhook to catch up
  setTimeout(() => check(), 1500);
}

// 3. Copy-Funktion (Global verfügbar machen für onclick im HTML)
window.copyKey = async function(btn, key) {
  try {
    await navigator.clipboard.writeText(key);
  } catch (err) {
    // Fallback für ältere Browser
    const textArea = document.createElement("textarea");
    textArea.value = key;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  // Visuelles Feedback am Button
  const originalText = btn.innerText;
  btn.innerText = "✓ KOPIERT!";
  btn.style.borderColor = "#00ff41"; 
  btn.style.color = "#00ff41";
  
  setTimeout(() => {
      btn.innerText = originalText;
      btn.style.borderColor = "";
      btn.style.color = "";
  }, 2000);
};
