// store.js

const licenseMapping = {
  "1m": { name: "1 Monat Zugang", price: "1,99 €" },
  "3m": { name: "3 Monate Zugang", price: "4,49 €" },
  "12m": { name: "12 Monate Zugang", price: "14,99 €" },
  "unlimited": { name: "Unbegrenzter Zugang", price: "49,99 €" },
  "bundle_1m_2": { name: "2× 1 Monat Zugang", price: "3,79 €" },
  "bundle_3m_2": { name: "2× 3 Monate Zugang", price: "7,99 €" },
  "bundle_3m_5": { name: "5× 3 Monate Zugang", price: "19,99 €" },
  "bundle_1y_10": { name: "10× 12 Monate Zugang", price: "129,99 €" }
};

document.addEventListener("DOMContentLoaded", () => {
  // Lizenz-Buttons
  const buttons = document.querySelectorAll(".license-btn");
  buttons.forEach(btn => {
    const plan = btn.dataset.plan;
    if (plan) {
      btn.addEventListener("click", () => showModal(plan));
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const intentId = urlParams.get("payment_intent");

  if (intentId) {
    showLoadingOverlay("🔐 Zahlung wird bestätigt...");

    fetch("/api/confirm-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment_intent_id: intentId })
    })
      .then(res => res.json())
      .then(data => {
        hideLoadingOverlay();
        if (data.success && data.keys?.length) {
          showKeyResult(data.keys, data.expires_at);
        } else {
          alert("Zahlung konnte nicht bestätigt werden.");
        }
      })
      .catch(err => {
        hideLoadingOverlay();
        console.error("Zahlungsbestätigung fehlgeschlagen:", err);
        alert("Fehler bei der Zahlungsbestätigung.");
      });
  }

  // Modal-Buttons
  document.getElementById("closeModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("confirmPurchaseBtn")?.addEventListener("click", confirmPurchase);
});

function showModal(plan) {
  const modal = document.getElementById("modalOverlay");
  const planText = document.getElementById("modalPlan");
  const priceText = document.getElementById("modalPrice");

  const license = licenseMapping[plan];
  if (!license) {
    alert("Unbekannter Lizenztyp.");
    return;
  }

  modal.dataset.selectedPlan = plan;
  planText.textContent = `🔐 Lizenz: ${license.name}`;
  priceText.textContent = `💶 Preis: ${license.price}`;
  modal.style.display = "block";
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
}

async function confirmPurchase() {
  const modal = document.getElementById("modalOverlay");
  const plan = modal?.dataset.selectedPlan;
  closeModal();

  const email = prompt("Bitte gib deine E-Mail-Adresse ein:");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Ungültige E-Mail-Adresse.");
    return;
  }

  try {
    const response = await fetch("/api/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_type: plan,
        customer_email: email
      })
    });

    const data = await response.json();
    if (!data.success || !data.client_secret) {
      alert("Fehler bei der Zahlungsinitialisierung.");
      return;
    }

    const stripe = Stripe("pk_test_51RqMSWINkidrktwy8v7ijV1jqpPV9d1Xm5wKBnQF0eil70ZwNreuipq4zhSpiFLcBV3JgrFWvy1lQAs5bcTrp5yT00thncRvKf");
    const { error } = await stripe.confirmPayment({
      clientSecret: data.client_secret,
      confirmParams: {
        return_url: window.location.origin + "/store.html"
      },
      redirect: "if_required" // oder "always"
    });
    
    if (error) {
      alert("Zahlung fehlgeschlagen: " + error.message);
    }
  } catch (err) {
    console.error("Zahlungsfehler:", err);
    alert("Fehler beim Start der Zahlung.");
  }
}


function showLoadingOverlay(text = "Bitte warten...") {
  const overlay = document.createElement("div");
  overlay.id = "paymentOverlay";
  overlay.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:black;display:flex;align-items:center;justify-content:center;color:lime;font-size:1.2rem;z-index:2000;font-family:'Courier New', monospace;";
  overlay.innerHTML = `<div><span class="spinner"></span><br>${text}</div>`;
  document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("paymentOverlay");
  if (overlay) overlay.remove();
}

function showKeyResult(keys = [], expiresAt = null) {
  const box = document.createElement("div");
  box.style = "max-width:600px;margin:80px auto;background:#000;padding:30px;border:1px solid lime;color:lime;text-align:center;box-shadow:0 0 15px lime;font-family:'Courier New', monospace;";

  box.innerHTML = `
    <h2>✅ Zahlung erfolgreich!</h2>
    <p>Hier ist dein Lizenz-Key${keys.length > 1 ? 's' : ''}:</p>
    <div style="margin:20px 0;">
      ${keys.map(k => `<code style="display:block;margin-bottom:10px;font-size:1.2rem;">${k}</code>`).join('')}
    </div>
    <p><strong>⚠️ Wichtig:</strong> Bitte kopiere den Key${keys.length > 1 ? 's' : ''} jetzt und bewahre ihn sicher auf. Nach der Aktivierung ist er mit deinem Benutzerkonto verbunden und kann <u>nicht erneut verwendet</u> werden.</p>
    ${expiresAt ? `<p>⏳ Gültig bis: <strong>${new Date(expiresAt).toLocaleDateString("de-DE")}</strong></p>` : `<p>♾️ Unbegrenzte Gültigkeit</p>`}
    <button onclick="window.location.href='store.html'" style="margin-top:20px;padding:10px 20px;border:1px solid lime;background:black;color:lime;cursor:pointer;">Zurück zum Shop</button>
  `;

  document.body.innerHTML = ""; // alles andere entfernen
  document.body.appendChild(box);
}
